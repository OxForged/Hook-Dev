// SPDX-License-Identifier: MIT
/**
 * Multi-hop swap calldata, executed.
 *
 * `buildSwapCall` has two encoders: a single-hop one that writes a `PoolKey`,
 * and a multi-hop one that writes a `PathKey[]`. The single-hop path is what the
 * live Sepolia pool can exercise; the multi-hop path had never touched a chain
 * at all, and `PathKey` is exactly the shape a transcription error hides in -
 * its `intermediateCurrency` is the hop's **output**, not its input, and its
 * `fee`/`parameters` belong to the pool being entered, not the one being left.
 *
 * Sepolia has one Latch pool over two tokens, so a route with two hops does not
 * exist there. This suite deploys a third token and initialises a second pool on
 * the fork, then routes through both. The second pool is synthetic; the
 * singleton, the swap math, and the periphery decoder that has to accept the
 * `PathKey[]` are the live ones.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { createCLPoolKey, type PoolKey } from "@latchprotocol/sdk";
import { buildSwapCall, type SwapHop } from "../../src/callpath/swap.js";
import { buildCLMintCall } from "../../src/callpath/liquidity.js";
import { validateIntegratorConfig, NO_INTEGRATOR_FEE } from "../../src/config/integrator.js";
import { buildQuoteBreakdown } from "../../src/core/math.js";
import {
  CL_POOL_MANAGER_INIT_ABI,
  deployMockErc20,
  setupFork,
  type ForkContext,
} from "./harness.js";
import { getLiquidityForAmounts, getSqrtRatioAtTick, Q96 } from "./clMath.js";
import { LATCH_SEPOLIA, LIVE_POOL_KEY, MOCK_ERC20_ABI, POOL_LP_FEE_PIPS } from "./sepolia.js";
import { foundry } from "viem/chains";

const TICK_LOWER = -6_000;
const TICK_UPPER = 6_000;
const SEED_AMOUNT = 5_000n * 10n ** 18n;
const AMOUNT_IN = 5n * 10n ** 18n;

let fork: ForkContext;
let thirdToken: Address;
let secondPoolKey: PoolKey;

beforeAll(async () => {
  fork = await setupFork();
  thirdToken = await deployMockErc20(fork, "Latch Test DAI", "ltDAI");

  // ltETH is the shared leg; the second pool pairs it with the new token, in
  // whichever order the addresses sort.
  const [currency0, currency1] =
    getAddress(fork.token1.address) < getAddress(thirdToken)
      ? [fork.token1.address, thirdToken]
      : [thirdToken, fork.token1.address];

  secondPoolKey = createCLPoolKey({
    currency0,
    currency1,
    hooks: "0x0000000000000000000000000000000000000000",
    poolManager: LATCH_SEPOLIA.clPoolManager,
    fee: POOL_LP_FEE_PIPS,
    tickSpacing: 60,
  });

  const initHash = await fork.walletClient.writeContract({
    account: fork.walletClient.account ?? fork.user,
    chain: foundry,
    address: LATCH_SEPOLIA.clPoolManager,
    abi: CL_POOL_MANAGER_INIT_ABI,
    functionName: "initialize",
    args: [
      {
        currency0: secondPoolKey.currency0,
        currency1: secondPoolKey.currency1,
        hooks: secondPoolKey.hooks,
        poolManager: secondPoolKey.poolManager,
        fee: secondPoolKey.fee,
        parameters: secondPoolKey.parameters,
      },
      Q96,
    ],
  });
  const initReceipt = await fork.publicClient.waitForTransactionReceipt({ hash: initHash });
  if (initReceipt.status !== "success") throw new Error("[fork] second pool init reverted");

  // Fund and approve everything the mint and the swap will move.
  await fork.fund(fork.token0.address, fork.user, 100_000n * 10n ** 18n);
  await fork.fund(fork.token1.address, fork.user, 100_000n * 10n ** 18n);
  const mintHash = await fork.walletClient.writeContract({
    account: fork.walletClient.account ?? fork.user,
    chain: foundry,
    address: thirdToken,
    abi: MOCK_ERC20_ABI,
    functionName: "mint",
    args: [fork.user, 100_000n * 10n ** 18n],
  });
  await fork.publicClient.waitForTransactionReceipt({ hash: mintHash });

  for (const token of [fork.token0.address, fork.token1.address, thirdToken]) {
    await fork.approveThrough(token, fork.deployments.clPositionManager);
    await fork.approveThrough(token, fork.deployments.universalRouter);
  }

  // Seed the second pool so a hop through it can actually fill.
  const liquidity = getLiquidityForAmounts(
    Q96,
    getSqrtRatioAtTick(TICK_LOWER),
    getSqrtRatioAtTick(TICK_UPPER),
    SEED_AMOUNT,
    SEED_AMOUNT,
  );
  const mint = buildCLMintCall({
    positionManager: fork.deployments.clPositionManager,
    poolKey: secondPoolKey,
    tickLower: TICK_LOWER,
    tickUpper: TICK_UPPER,
    liquidity,
    amount0Max: SEED_AMOUNT,
    amount1Max: SEED_AMOUNT,
    owner: fork.user,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
  });
  const seedReceipt = await fork.send({ to: mint.to, data: mint.data, value: mint.value });
  if (seedReceipt.status !== "success") throw new Error("[fork] seeding the second pool reverted");
}, 300_000);

afterAll(async () => {
  await fork?.teardown();
});

function twoHopRoute(): readonly SwapHop[] {
  return [
    {
      poolKey: LIVE_POOL_KEY,
      poolType: "CL",
      currencyIn: fork.token0.address,
      currencyOut: fork.token1.address,
    },
    {
      poolKey: secondPoolKey,
      poolType: "CL",
      currencyIn: fork.token1.address,
      currencyOut: thirdToken,
    },
  ];
}

describe("fork: multi-hop swap execution", () => {
  it("routes ltUSD -> ltETH -> ltDAI through a real CL_SWAP_EXACT_IN plan", async () => {
    const call = buildSwapCall({
      router: fork.deployments.universalRouter,
      hops: twoHopRoute(),
      amountIn: AMOUNT_IN,
      // Two 0.3% pools plus protocol fee: anything above ~99% of input is a
      // floor the route cannot clear, so 95% is a real guard, not a no-op.
      minAmountOutGross: (AMOUNT_IN * 95n) / 100n,
      minAmountOutNet: (AMOUNT_IN * 95n) / 100n,
      integrator: NO_INTEGRATOR_FEE,
      recipient: fork.user,
      sender: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });

    expect(call.planTrace).toContain("2 hops");

    const beforeIn = await fork.balanceOf(fork.token0.address, fork.user);
    const beforeMid = await fork.balanceOf(fork.token1.address, fork.user);
    const beforeOut = await fork.balanceOf(thirdToken, fork.user);

    const receipt = await fork.send({ to: call.to, data: call.data, value: call.value });
    expect(receipt.status).toBe("success");

    const spent = beforeIn - (await fork.balanceOf(fork.token0.address, fork.user));
    const midDelta = (await fork.balanceOf(fork.token1.address, fork.user)) - beforeMid;
    const received = (await fork.balanceOf(thirdToken, fork.user)) - beforeOut;

    console.info(`[fork] 2-hop ${AMOUNT_IN} ltUSD -> ${received} ltDAI, gas ${receipt.gasUsed}`);

    expect(spent).toBe(AMOUNT_IN);
    // The intermediate never leaves the vault: if the plan had settled or taken
    // it, this would be non-zero.
    expect(midDelta).toBe(0n);
    expect(received).toBeGreaterThan(0n);
    expect(received).toBeGreaterThanOrEqual((AMOUNT_IN * 95n) / 100n);
    // Two 0.3% pools plus a 0.1% protocol cut each: the output must be strictly
    // less than the input, or the path fees were not applied.
    expect(received).toBeLessThan(AMOUNT_IN);

    // Two Swap events, one per pool, both from the live singleton.
    expect(fork.swapEvents(receipt)).toHaveLength(2);
  });

  it("takes the integrator fee out of the final hop's output", async () => {
    const integrator = validateIntegratorConfig({ referrer: fork.referrer, feeBps: 50 });
    const breakdown = buildQuoteBreakdown({
      amountIn: AMOUNT_IN,
      // Conservative reference: the route cannot beat its input.
      grossAmountOut: AMOUNT_IN,
      slippageBps: 500,
      integrator,
    });
    const call = buildSwapCall({
      router: fork.deployments.universalRouter,
      hops: twoHopRoute(),
      amountIn: AMOUNT_IN,
      minAmountOutGross: breakdown.minAmountOutGross,
      minAmountOutNet: breakdown.minAmountOutNet,
      integrator,
      recipient: fork.user,
      sender: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });

    const beforeUser = await fork.balanceOf(thirdToken, fork.user);
    const beforeReferrer = await fork.balanceOf(thirdToken, fork.referrer);

    const receipt = await fork.send({ to: call.to, data: call.data, value: call.value });
    expect(receipt.status).toBe("success");

    const userGot = (await fork.balanceOf(thirdToken, fork.user)) - beforeUser;
    const referrerGot = (await fork.balanceOf(thirdToken, fork.referrer)) - beforeReferrer;

    expect(referrerGot).toBeGreaterThan(0n);
    // The fee is a portion of the whole route's output, in the final currency.
    expect(referrerGot).toBe(((userGot + referrerGot) * 50n) / 10_000n);
    expect(userGot).toBeGreaterThanOrEqual(breakdown.minAmountOutNet);
  });

  it("reverts the whole route when the final floor cannot be met", async () => {
    const call = buildSwapCall({
      router: fork.deployments.universalRouter,
      hops: twoHopRoute(),
      amountIn: AMOUNT_IN,
      // No two-hop route through 0.3% pools returns more than it took in.
      minAmountOutGross: AMOUNT_IN * 2n,
      minAmountOutNet: AMOUNT_IN * 2n,
      integrator: NO_INTEGRATOR_FEE,
      recipient: fork.user,
      sender: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });
    const beforeIn = await fork.balanceOf(fork.token0.address, fork.user);
    await expect(
      fork.send({ to: call.to, data: call.data, value: call.value }),
    ).rejects.toThrow(/reverted/);
    // Specifically the slippage guard - not, say, a malformed path that would
    // also "revert" and make this test pass for the wrong reason.
    expect(await fork.revertErrorName(call)).toBe("TooLittleReceived");
    expect(await fork.balanceOf(fork.token0.address, fork.user)).toBe(beforeIn);
  });
});
