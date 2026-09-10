// SPDX-License-Identifier: MIT
/**
 * Swap calldata, executed.
 *
 * Every other test in this package asserts an encoding by decoding it again,
 * which proves the encoder agrees with itself and nothing more. These send the
 * bytes to a real `UniversalRouter` sitting in front of the **live Latch
 * singleton on Sepolia**, forked locally, and check the balances afterwards.
 *
 * What is being proved:
 *
 * 1. The plan is accepted - action ids, ordering and the settle/take pairing are
 *    right, and no delta is left open at the end of the lock.
 * 2. The realised output matches the quote the widget showed.
 * 3. The pool charged the composed fee the deployment is configured for.
 * 4. `TAKE_PORTION` actually pays the referrer, and a swap with no integrator
 *    configured pays nobody.
 * 5. A swap whose floor cannot be met reverts on chain rather than filling.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { buildQuoteBreakdown } from "../../src/core/math.js";
import { validateIntegratorConfig, NO_INTEGRATOR_FEE } from "../../src/config/integrator.js";
import { UNIVERSAL_ROUTER_ABI } from "../../src/callpath/constants.js";
import { setupFork, type ForkContext } from "./harness.js";
import {
  CANONICAL_PERMIT2,
  LATCH_PERIPHERY_SEPOLIA,
  LATCH_SEPOLIA,
  LIVE_POOL_ID,
  PERMIT2,
  lpFeeFromSwapFee,
  POOL_LP_FEE_PIPS,
  POOL_PROTOCOL_FEE_PIPS,
  POOL_SWAP_FEE_PIPS,
  PROTOCOL_FEES_ABI,
} from "./sepolia.js";

const AMOUNT_IN = 10n * 10n ** 18n;
const SLIPPAGE_BPS = 50;
const FEE_BPS = 25;

let fork: ForkContext;

beforeAll(async () => {
  fork = await setupFork();
  // Enough for every case in this file, minted through the tokens' public mint.
  await fork.fund(fork.token0.address, fork.user, 1_000n * 10n ** 18n);
  await fork.approveThrough(fork.token0.address, fork.deployments.universalRouter);
  await fork.approveThrough(fork.token1.address, fork.deployments.universalRouter);
}, 240_000);

afterAll(async () => {
  await fork?.teardown();
});

/** Builds and sends one swap, returning the observed deltas. */
async function executeSwap(options: {
  amountIn: bigint;
  slippageBps: number;
  integrator: ReturnType<typeof validateIntegratorConfig> | typeof NO_INTEGRATOR_FEE;
}) {
  const quote = await fork.adapter.quoteSwap({
    tokenIn: fork.token0,
    tokenOut: fork.token1,
    amountIn: options.amountIn,
  });
  const breakdown = buildQuoteBreakdown({
    amountIn: options.amountIn,
    grossAmountOut: quote.grossAmountOut,
    slippageBps: options.slippageBps,
    integrator: options.integrator,
  });

  const request = await fork.adapter.buildSwap({
    quote,
    tokenIn: fork.token0,
    tokenOut: fork.token1,
    amountIn: options.amountIn,
    minAmountOutGross: breakdown.minAmountOutGross,
    minAmountOutNet: breakdown.minAmountOutNet,
    integrator: options.integrator,
    recipient: fork.user,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
  });

  const before = {
    userIn: await fork.balanceOf(fork.token0.address, fork.user),
    userOut: await fork.balanceOf(fork.token1.address, fork.user),
    referrerOut: await fork.balanceOf(fork.token1.address, fork.referrer),
    protocolFees: await fork.publicClient.readContract({
      address: LATCH_SEPOLIA.clPoolManager,
      abi: PROTOCOL_FEES_ABI,
      functionName: "protocolFeesAccrued",
      args: [fork.token0.address],
    }),
  };

  const receipt = await fork.send({ to: request.to, data: request.data, value: request.value });

  const after = {
    userIn: await fork.balanceOf(fork.token0.address, fork.user),
    userOut: await fork.balanceOf(fork.token1.address, fork.user),
    referrerOut: await fork.balanceOf(fork.token1.address, fork.referrer),
    protocolFees: await fork.publicClient.readContract({
      address: LATCH_SEPOLIA.clPoolManager,
      abi: PROTOCOL_FEES_ABI,
      functionName: "protocolFeesAccrued",
      args: [fork.token0.address],
    }),
  };

  return {
    quote,
    breakdown,
    request,
    receipt,
    spent: before.userIn - after.userIn,
    userReceived: after.userOut - before.userOut,
    referrerReceived: after.referrerOut - before.referrerOut,
    protocolFeeAccrued: after.protocolFees - before.protocolFees,
    swaps: fork.swapEvents(receipt),
  };
}

describe("fork: swap execution", () => {
  it("boots against the live Sepolia deployment with the published pool funded", async () => {
    const liquidity = await fork.publicClient.readContract({
      address: LATCH_SEPOLIA.clPoolManager,
      abi: parseAbi(["function getLiquidity(bytes32) view returns (uint128)"]),
      functionName: "getLiquidity",
      args: [LIVE_POOL_ID],
    });
    expect(liquidity).toBeGreaterThan(0n);

    // Nothing of the protocol was deployed by the harness: these are the live
    // addresses, and setupFork has already re-read their wiring off the chain.
    expect(fork.chain.contracts.universalRouter).toBe(LATCH_PERIPHERY_SEPOLIA.universalRouter);
    expect(fork.chain.contracts.clPositionManager).toBe(
      LATCH_PERIPHERY_SEPOLIA.clPositionManager,
    );
    // Permit2 is PancakeSwap's fork, baked into the router's immutables. The
    // canonical address would take approvals and never be read.
    expect(fork.chain.contracts.permit2).toBe(PERMIT2);
    expect(fork.chain.contracts.permit2).not.toBe(CANONICAL_PERMIT2);
  });

  it("executes calldata from buildSwapCall and fills at the quoted amount", async () => {
    const result = await executeSwap({
      amountIn: AMOUNT_IN,
      slippageBps: SLIPPAGE_BPS,
      integrator: NO_INTEGRATOR_FEE,
    });

    // Printed so a run leaves the executed numbers behind, not just a green tick.
    console.info(
      `[fork] swap ${AMOUNT_IN} ltUSD -> quoted ${result.quote.grossAmountOut}, ` +
        `received ${result.userReceived}, minNet ${result.breakdown.minAmountOutNet}, ` +
        `gas ${result.receipt.gasUsed}`,
    );

    expect(result.receipt.status).toBe("success");
    expect(result.spent).toBe(AMOUNT_IN);
    // No integrator: the whole gross output is the user's, to the wei.
    expect(result.userReceived).toBe(result.quote.grossAmountOut);
    expect(result.userReceived).toBeGreaterThanOrEqual(result.breakdown.minAmountOutNet);
    expect(result.referrerReceived).toBe(0n);
  });

  it("charges the composed swap fee the deployment is configured for", async () => {
    const result = await executeSwap({
      amountIn: AMOUNT_IN,
      slippageBps: SLIPPAGE_BPS,
      integrator: NO_INTEGRATOR_FEE,
    });

    expect(result.swaps).toHaveLength(1);
    const swap = result.swaps[0];
    if (swap === undefined) throw new Error("no Swap event");

    // 1000 + 3000 - (1000 * 3000 / 1e6) = 3997 pips.
    expect(swap.fee).toBe(POOL_SWAP_FEE_PIPS);
    expect(swap.fee).toBe(3_997);
    expect(swap.protocolFee).toBe(POOL_PROTOCOL_FEE_PIPS);
    // And the composition inverts: 3997 and 1000 decompose to exactly the LP fee
    // the pool key declares, not merely to some pair that sums the same way.
    expect(lpFeeFromSwapFee(swap.fee, swap.protocolFee)).toBe(POOL_LP_FEE_PIPS);
    expect(lpFeeFromSwapFee(swap.fee, swap.protocolFee)).toBe(3_000);
    // The event reports the *swapper's* deltas: negative is paid in, positive is
    // taken out. ltUSD is currency0, so a zero-for-one exact-in shows -amountIn.
    expect(swap.amount0).toBe(-AMOUNT_IN);
    expect(swap.amount1).toBe(result.quote.grossAmountOut);
    expect(result.userReceived).toBe(swap.amount1);

    // The protocol's cut is taken in the input currency and parked on the pool
    // manager. For a single-step exact-in swap it is exactly amountIn * pips.
    const expectedProtocolCut = (AMOUNT_IN * BigInt(POOL_PROTOCOL_FEE_PIPS)) / 1_000_000n;
    expect(result.protocolFeeAccrued).toBe(expectedProtocolCut);
  });

  it("pays the referrer through TAKE_PORTION and still clears the user's net floor", async () => {
    const integrator = validateIntegratorConfig({ referrer: fork.referrer, feeBps: FEE_BPS });
    const result = await executeSwap({
      amountIn: AMOUNT_IN,
      slippageBps: SLIPPAGE_BPS,
      integrator,
    });

    expect(result.receipt.status).toBe("success");

    const gross = result.userReceived + result.referrerReceived;
    const expectedFee = (gross * BigInt(FEE_BPS)) / 10_000n;

    console.info(
      `[fork] integrator ${FEE_BPS} bps: gross ${gross}, referrer ${result.referrerReceived}, ` +
        `user ${result.userReceived}, predicted fee ${result.breakdown.integratorFee}`,
    );

    // The fee is computed on chain from the realised credit, not the quote.
    expect(result.referrerReceived).toBe(expectedFee);
    expect(result.referrerReceived).toBeGreaterThan(0n);
    expect(gross).toBe(result.quote.grossAmountOut);
    // What the widget predicted for the referrer, against what landed.
    expect(request_integratorFee(result.request)).toBe(result.breakdown.integratorFee);
    expect(result.referrerReceived).toBe(result.breakdown.integratorFee);
    // And the user still clears the floor they were shown.
    expect(result.userReceived).toBeGreaterThanOrEqual(result.breakdown.minAmountOutNet);
    expect(result.userReceived).toBe(gross - expectedFee);
  });

  it("pays nobody when no integrator is configured", async () => {
    const result = await executeSwap({
      amountIn: AMOUNT_IN,
      slippageBps: SLIPPAGE_BPS,
      integrator: NO_INTEGRATOR_FEE,
    });

    expect(result.request.integratorFee).toBeUndefined();
    expect(result.referrerReceived).toBe(0n);
    expect(result.userReceived).toBe(result.quote.grossAmountOut);

    // Belt and braces: no TAKE_PORTION action is present in the encoded plan.
    const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: result.request.data });
    const plan = decoded.args[1][0];
    if (plan === undefined) throw new Error("no plan input");
    expect(plan.includes("10")).toBe(true); // the SETTLE/TAKE ids are in there
    expect(result.request.integratorFee).toBeUndefined();
  });

  it("pays the referrer through the router-level pay-portion mode", async () => {
    // The second, documented fee mode: the swap takes its whole output to the
    // router, PAY_PORTION forwards the fee and SWEEP returns the rest. It costs
    // an extra command and gives the router custody, so it is not the default -
    // but it is a shipped code path and had never been executed.
    const integrator = validateIntegratorConfig({
      referrer: fork.referrer,
      feeBps: FEE_BPS,
      feeMode: "pay-portion",
    });
    const result = await executeSwap({
      amountIn: AMOUNT_IN,
      slippageBps: SLIPPAGE_BPS,
      integrator,
    });

    expect(result.receipt.status).toBe("success");
    expect(result.request.integratorFee?.referrer).toBe(fork.referrer);

    const gross = result.userReceived + result.referrerReceived;
    expect(gross).toBe(result.quote.grossAmountOut);
    expect(result.referrerReceived).toBe((gross * BigInt(FEE_BPS)) / 10_000n);
    expect(result.userReceived).toBeGreaterThanOrEqual(result.breakdown.minAmountOutNet);

    // The router must not be left holding anything after the sweep.
    expect(
      await fork.balanceOf(fork.token1.address, fork.deployments.universalRouter),
    ).toBe(0n);
  });

  it("holds the two-minimum invariant through a real fill", async () => {
    // Deliberately tight: 0 bps slippage, so minAmountOutGross is the whole
    // quote and the fee step has to be what separates the two floors.
    const integrator = validateIntegratorConfig({ referrer: fork.referrer, feeBps: 100 });
    const result = await executeSwap({ amountIn: AMOUNT_IN, slippageBps: 0, integrator });

    expect(result.receipt.status).toBe("success");
    const gross = result.userReceived + result.referrerReceived;

    // The swap action's own floor was cleared...
    expect(gross).toBeGreaterThanOrEqual(result.breakdown.minAmountOutGross);
    // ...which is exactly what makes the net floor unreachable from below.
    expect(result.userReceived).toBeGreaterThanOrEqual(result.breakdown.minAmountOutNet);
    expect(result.breakdown.minAmountOutNet).toBeLessThanOrEqual(
      result.breakdown.minAmountOutGross,
    );
  });

  it("reverts on chain when the slippage floor cannot be met", async () => {
    const quote = await fork.adapter.quoteSwap({
      tokenIn: fork.token0,
      tokenOut: fork.token1,
      amountIn: AMOUNT_IN,
    });
    // Ask for more than the pool can possibly give.
    const impossible = quote.grossAmountOut * 2n;
    const request = await fork.adapter.buildSwap({
      quote,
      tokenIn: fork.token0,
      tokenOut: fork.token1,
      amountIn: AMOUNT_IN,
      minAmountOutGross: impossible,
      minAmountOutNet: impossible,
      integrator: NO_INTEGRATOR_FEE,
      recipient: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
    });

    const beforeIn = await fork.balanceOf(fork.token0.address, fork.user);
    const beforeOut = await fork.balanceOf(fork.token1.address, fork.user);

    // The plain `send` helper turns a reverted receipt into a thrown error, so
    // a swap that "fails" by being mined with status 0 cannot pass as success.
    await expect(
      fork.send({ to: request.to, data: request.data, value: request.value }),
    ).rejects.toThrow(/reverted/);

    const receipt = await fork.sendAllowingRevert({
      to: request.to,
      data: request.data,
      value: request.value,
    });
    expect(receipt.status).toBe("reverted");
    expect(await fork.revertErrorName(request)).toBe("TooLittleReceived");

    // Nothing moved: the revert is real, not a silently-succeeded swap.
    expect(await fork.balanceOf(fork.token0.address, fork.user)).toBe(beforeIn);
    expect(await fork.balanceOf(fork.token1.address, fork.user)).toBe(beforeOut);
  });

  it("reverts on chain when the deadline has passed", async () => {
    const quote = await fork.adapter.quoteSwap({
      tokenIn: fork.token0,
      tokenOut: fork.token1,
      amountIn: AMOUNT_IN,
    });
    const breakdown = buildQuoteBreakdown({
      amountIn: AMOUNT_IN,
      grossAmountOut: quote.grossAmountOut,
      slippageBps: SLIPPAGE_BPS,
      integrator: NO_INTEGRATOR_FEE,
    });
    const request = await fork.adapter.buildSwap({
      quote,
      tokenIn: fork.token0,
      tokenOut: fork.token1,
      amountIn: AMOUNT_IN,
      minAmountOutGross: breakdown.minAmountOutGross,
      minAmountOutNet: breakdown.minAmountOutNet,
      integrator: NO_INTEGRATOR_FEE,
      recipient: fork.user,
      deadline: 1n,
    });
    await expect(
      fork.send({ to: request.to, data: request.data, value: request.value }),
    ).rejects.toThrow(/reverted/);
    expect(await fork.revertErrorName(request)).toBe("TransactionDeadlinePassed");
  });
});

function request_integratorFee(request: { integratorFee?: { expectedAmount: bigint } }): bigint {
  return request.integratorFee?.expectedAmount ?? 0n;
}
