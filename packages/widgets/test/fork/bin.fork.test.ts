// SPDX-License-Identifier: MIT
/**
 * Liquidity-book calldata, executed.
 *
 * `buildBinAddCall` writes the widest parameter tuple in the package - thirteen
 * fields, four of them parallel arrays - and `buildSwapCall` has a whole second
 * swap action for bin pools. Neither had ever been sent to a chain.
 *
 * Latch's `BinPoolManager` and `BinPositionManager` are both live on Sepolia,
 * but no bin pool is initialised there, so this suite creates one on the fork
 * and seeds it. The pool is synthetic; the singleton, the bin math and the
 * deployed periphery decoder are not, and it is the decoder that has to accept
 * the tuple.
 *
 * Watch for the one thing an encoder gets wrong here: `deltaIds` is an offset
 * *added* to the active id (`id = activeId + deltaId`), even though the
 * interface's own doc comment says `deltaId = activeId - desiredId`. The
 * assertions below pin the sign by checking which bins actually received shares.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foundry } from "viem/chains";
import type { Address } from "viem";
import { createBinPoolKey, poolKeyToId, type PoolKey } from "@latchprotocol/sdk";
import { buildBinAddCall, buildBinRemoveCall } from "../../src/callpath/liquidity.js";
import { buildSwapCall, type SwapHop } from "../../src/callpath/swap.js";
import { buildUniformBinDistribution } from "../../src/adapters/mock.js";
import { validateIntegratorConfig, NO_INTEGRATOR_FEE } from "../../src/config/integrator.js";
import {
  BIN_POOL_MANAGER_INIT_ABI,
  BIN_SHARES_ABI,
  binShareTokenId,
  setupFork,
  type ForkContext,
} from "./harness.js";
import { LATCH_SEPOLIA, LT_ETH, LT_USD } from "./sepolia.js";

/** Price 1:1 in liquidity-book terms. */
const ACTIVE_ID = 2 ** 23;
const BIN_STEP = 25;
const BIN_LP_FEE = 3_000;
const SEED = 200n * 10n ** 18n;
const SWAP_IN = 2n * 10n ** 18n;

let fork: ForkContext;
let binPositionManager: Address;
let binPoolKey: PoolKey;
let binPoolId: `0x${string}`;
let seededBinIds: number[] = [];

beforeAll(async () => {
  fork = await setupFork();
  binPositionManager = fork.deployments.binPositionManager;

  binPoolKey = createBinPoolKey({
    currency0: LT_USD,
    currency1: LT_ETH,
    hooks: "0x0000000000000000000000000000000000000000",
    poolManager: LATCH_SEPOLIA.binPoolManager,
    fee: BIN_LP_FEE,
    binStep: BIN_STEP,
  });
  binPoolId = poolKeyToId(binPoolKey);

  const initHash = await fork.walletClient.writeContract({
    account: fork.walletClient.account ?? fork.user,
    chain: foundry,
    address: LATCH_SEPOLIA.binPoolManager,
    abi: BIN_POOL_MANAGER_INIT_ABI,
    functionName: "initialize",
    args: [
      {
        currency0: binPoolKey.currency0,
        currency1: binPoolKey.currency1,
        hooks: binPoolKey.hooks,
        poolManager: binPoolKey.poolManager,
        fee: binPoolKey.fee,
        parameters: binPoolKey.parameters,
      },
      ACTIVE_ID,
    ],
  });
  const initReceipt = await fork.publicClient.waitForTransactionReceipt({ hash: initHash });
  if (initReceipt.status !== "success") throw new Error("[fork] bin pool init reverted");

  await fork.fund(LT_USD, fork.user, 100_000n * 10n ** 18n);
  await fork.fund(LT_ETH, fork.user, 100_000n * 10n ** 18n);
  for (const token of [LT_USD, LT_ETH]) {
    await fork.approveThrough(token, binPositionManager);
    await fork.approveThrough(token, fork.deployments.universalRouter);
  }
}, 300_000);

afterAll(async () => {
  await fork?.teardown();
});

describe("fork: liquidity-book execution", () => {
  it("adds liquidity across a bin span with buildBinAddCall calldata", async () => {
    const distribution = buildUniformBinDistribution(
      ACTIVE_ID - 2,
      ACTIVE_ID + 2,
      ACTIVE_ID,
    );
    expect(distribution).toHaveLength(5);
    seededBinIds = distribution.map((share) => share.binId);

    const call = buildBinAddCall({
      positionManager: binPositionManager,
      poolKey: binPoolKey,
      amount0: SEED,
      amount1: SEED,
      amount0Max: SEED,
      amount1Max: SEED,
      activeIdDesired: ACTIVE_ID,
      idSlippage: 5,
      deltaIds: distribution.map((share) => share.deltaId),
      distributionX: distribution.map((share) => share.distributionX),
      distributionY: distribution.map((share) => share.distributionY),
      to: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });

    const before0 = await fork.balanceOf(LT_USD, fork.user);
    const before1 = await fork.balanceOf(LT_ETH, fork.user);

    const receipt = await fork.send({ to: call.to, data: call.data, value: call.value });
    expect(receipt.status).toBe("success");

    const spent0 = before0 - (await fork.balanceOf(LT_USD, fork.user));
    const spent1 = before1 - (await fork.balanceOf(LT_ETH, fork.user));
    console.info(`[fork] bin add: spent ${spent0} ltUSD / ${spent1} ltETH across 5 bins`);

    expect(spent0).toBeGreaterThan(0n);
    expect(spent1).toBeGreaterThan(0n);
    expect(spent0).toBeLessThanOrEqual(SEED);
    expect(spent1).toBeLessThanOrEqual(SEED);

    // Shares landed on activeId + deltaId, which pins the sign convention.
    for (const binId of seededBinIds) {
      const shares = await fork.publicClient.readContract({
        address: binPositionManager,
        abi: BIN_SHARES_ABI,
        functionName: "balanceOf",
        args: [fork.user, binShareTokenId(binPoolId, binId)],
      });
      expect(shares).toBeGreaterThan(0n);
    }
    // ...and nothing landed on a bin outside the span.
    const outside = await fork.publicClient.readContract({
      address: binPositionManager,
      abi: BIN_SHARES_ABI,
      functionName: "balanceOf",
      args: [fork.user, binShareTokenId(binPoolId, ACTIVE_ID + 3)],
    });
    expect(outside).toBe(0n);
  });

  it("swaps through the bin pool with BIN_SWAP_EXACT_IN_SINGLE calldata", async () => {
    const integrator = validateIntegratorConfig({ referrer: fork.referrer, feeBps: 30 });
    const hop: SwapHop = {
      poolKey: binPoolKey,
      poolType: "BIN",
      currencyIn: LT_USD,
      currencyOut: LT_ETH,
    };
    const call = buildSwapCall({
      router: fork.deployments.universalRouter,
      hops: [hop],
      amountIn: SWAP_IN,
      minAmountOutGross: (SWAP_IN * 90n) / 100n,
      minAmountOutNet: (SWAP_IN * 89n) / 100n,
      integrator,
      recipient: fork.user,
      sender: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });
    expect(call.planTrace).toContain("BIN swap exact-in");

    const beforeUser = await fork.balanceOf(LT_ETH, fork.user);
    const beforeReferrer = await fork.balanceOf(LT_ETH, fork.referrer);

    const receipt = await fork.send({ to: call.to, data: call.data, value: call.value });
    expect(receipt.status).toBe("success");

    const userGot = (await fork.balanceOf(LT_ETH, fork.user)) - beforeUser;
    const referrerGot = (await fork.balanceOf(LT_ETH, fork.referrer)) - beforeReferrer;
    console.info(`[fork] bin swap ${SWAP_IN} ltUSD -> user ${userGot}, referrer ${referrerGot}`);

    expect(userGot).toBeGreaterThan(0n);
    expect(referrerGot).toBe(((userGot + referrerGot) * 30n) / 10_000n);
    expect(userGot).toBeGreaterThanOrEqual((SWAP_IN * 89n) / 100n);
  });

  it("removes bin liquidity with buildBinRemoveCall calldata", async () => {
    const amounts: bigint[] = [];
    for (const binId of seededBinIds) {
      amounts.push(
        await fork.publicClient.readContract({
          address: binPositionManager,
          abi: BIN_SHARES_ABI,
          functionName: "balanceOf",
          args: [fork.user, binShareTokenId(binPoolId, binId)],
        }),
      );
    }
    expect(amounts.every((amount) => amount > 0n)).toBe(true);

    const call = buildBinRemoveCall({
      positionManager: binPositionManager,
      poolKey: binPoolKey,
      amount0Min: 0n,
      amount1Min: 0n,
      ids: seededBinIds,
      amounts,
      from: fork.user,
      recipient: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });

    const before0 = await fork.balanceOf(LT_USD, fork.user);
    const before1 = await fork.balanceOf(LT_ETH, fork.user);

    const receipt = await fork.send({ to: call.to, data: call.data, value: call.value });
    expect(receipt.status).toBe("success");

    const got0 = (await fork.balanceOf(LT_USD, fork.user)) - before0;
    const got1 = (await fork.balanceOf(LT_ETH, fork.user)) - before1;
    console.info(`[fork] bin remove: returned ${got0} ltUSD / ${got1} ltETH`);

    expect(got0 + got1).toBeGreaterThan(0n);
    for (const binId of seededBinIds) {
      const shares = await fork.publicClient.readContract({
        address: binPositionManager,
        abi: BIN_SHARES_ABI,
        functionName: "balanceOf",
        args: [fork.user, binShareTokenId(binPoolId, binId)],
      });
      expect(shares).toBe(0n);
    }
  });

  it("reverts a bin add whose active-id slippage is exceeded", async () => {
    const distribution = buildUniformBinDistribution(
      ACTIVE_ID - 1,
      ACTIVE_ID + 1,
      ACTIVE_ID,
    );
    const call = buildBinAddCall({
      positionManager: binPositionManager,
      poolKey: binPoolKey,
      amount0: 10n ** 18n,
      amount1: 10n ** 18n,
      amount0Max: 10n ** 18n,
      amount1Max: 10n ** 18n,
      // Nowhere near where the pool actually is.
      activeIdDesired: ACTIVE_ID + 5_000,
      idSlippage: 0,
      deltaIds: distribution.map((share) => share.deltaId),
      distributionX: distribution.map((share) => share.distributionX),
      distributionY: distribution.map((share) => share.distributionY),
      to: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });
    await expect(
      fork.send({ to: call.to, data: call.data, value: call.value }),
    ).rejects.toThrow(/reverted/);
    expect(await fork.revertErrorName(call)).toBe("IdSlippageCaught");
  });

  it("encodes no fee step on the bin liquidity path", async () => {
    const distribution = buildUniformBinDistribution(ACTIVE_ID, ACTIVE_ID, ACTIVE_ID);
    const call = buildBinAddCall({
      positionManager: binPositionManager,
      poolKey: binPoolKey,
      amount0: 10n ** 18n,
      amount1: 10n ** 18n,
      amount0Max: 10n ** 18n,
      amount1Max: 10n ** 18n,
      activeIdDesired: ACTIVE_ID,
      idSlippage: 5,
      deltaIds: distribution.map((share) => share.deltaId),
      distributionX: distribution.map((share) => share.distributionX),
      distributionY: distribution.map((share) => share.distributionY),
      to: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });
    // Two actions only: BIN_ADD_LIQUIDITY then SETTLE_PAIR.
    expect(call.planTrace.split("\n")).toHaveLength(2);

    const referrerBefore = await fork.balanceOf(LT_ETH, fork.referrer);
    const receipt = await fork.send({ to: call.to, data: call.data, value: call.value });
    expect(receipt.status).toBe("success");
    expect(await fork.balanceOf(LT_ETH, fork.referrer)).toBe(referrerBefore);
    expect(NO_INTEGRATOR_FEE.active).toBe(false);
  });
});
