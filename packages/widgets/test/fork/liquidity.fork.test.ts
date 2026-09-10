// SPDX-License-Identifier: MIT
/**
 * Liquidity calldata, executed.
 *
 * `buildCLMintCall` and `buildCLDecreaseCall` produce
 * `CLPositionManager.modifyLiquidities` calls whose plans have never left a unit
 * test. These mint a real position against the live Sepolia pool - forked
 * locally - and then take it back out, checking that the tokens the singleton
 * actually pulled and returned are the ones the arithmetic predicted.
 *
 * The bin path is covered by a documented gap at the bottom of this file.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { ACTIONS, POSITION_MANAGER_ABI } from "../../src/callpath/constants.js";
import { NO_INTEGRATOR_FEE } from "../../src/config/integrator.js";
import type { AddLiquidityQuote, PositionInfo } from "../../src/adapters/protocol.js";
import { nextPositionTokenId, positionOwner, setupFork, type ForkContext } from "./harness.js";
import {
  amountsForLiquidity,
  assertTickMathSelfConsistent,
  getLiquidityForAmounts,
  getSqrtRatioAtTick,
} from "./clMath.js";
import { CL_POOL_MANAGER_ABI, LATCH_SEPOLIA, LIVE_POOL_ID } from "./sepolia.js";

/** Range around the pool's tick, snapped to its spacing of 60. */
const TICK_LOWER = -600;
const TICK_UPPER = 600;

const DESIRED_0 = 100n * 10n ** 18n;
const DESIRED_1 = 100n * 10n ** 18n;

let fork: ForkContext;
let sqrtPriceX96: bigint;

beforeAll(async () => {
  assertTickMathSelfConsistent();
  fork = await setupFork();

  const slot0 = await fork.publicClient.readContract({
    address: LATCH_SEPOLIA.clPoolManager,
    abi: CL_POOL_MANAGER_ABI,
    functionName: "getSlot0",
    args: [LIVE_POOL_ID],
  });
  sqrtPriceX96 = slot0[0];

  await fork.fund(fork.token0.address, fork.user, 10_000n * 10n ** 18n);
  await fork.fund(fork.token1.address, fork.user, 10_000n * 10n ** 18n);
  await fork.approveThrough(fork.token0.address, fork.deployments.clPositionManager);
  await fork.approveThrough(fork.token1.address, fork.deployments.clPositionManager);
}, 240_000);

afterAll(async () => {
  await fork?.teardown();
});

function quoteFor(liquidity: bigint): AddLiquidityQuote {
  return {
    pool: fork.pool,
    range: { type: "CL", tickLower: TICK_LOWER, tickUpper: TICK_UPPER },
    amount0: DESIRED_0,
    amount1: DESIRED_1,
    liquidity,
    shareBps: null,
    source: "live",
  };
}

describe("fork: concentrated-liquidity execution", () => {
  it("reproduces the pool's own price from the transcribed tick math", () => {
    // The pool sits a hair above tick 0; the range bounds are what the harness
    // predicts amounts from, so they must agree with the contracts exactly.
    expect(getSqrtRatioAtTick(0)).toBe(1n << 96n);
    expect(sqrtPriceX96).toBeGreaterThanOrEqual(getSqrtRatioAtTick(0));
    expect(sqrtPriceX96).toBeLessThan(getSqrtRatioAtTick(TICK_UPPER));
  });

  it("mints a position with buildCLMintCall calldata and pulls the predicted amounts", async () => {
    const liquidity = getLiquidityForAmounts(
      sqrtPriceX96,
      getSqrtRatioAtTick(TICK_LOWER),
      getSqrtRatioAtTick(TICK_UPPER),
      DESIRED_0,
      DESIRED_1,
    );
    expect(liquidity).toBeGreaterThan(0n);

    const predicted = amountsForLiquidity(sqrtPriceX96, TICK_LOWER, TICK_UPPER, liquidity, true);

    const expectedTokenId = await nextPositionTokenId(
      fork.publicClient,
      fork.deployments.clPositionManager,
    );

    const request = await fork.adapter.buildAddLiquidity({
      quote: quoteFor(liquidity),
      amount0Max: DESIRED_0,
      amount1Max: DESIRED_1,
      recipient: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
      integrator: NO_INTEGRATOR_FEE,
    });

    // The plan really is MINT then SETTLE_PAIR, in that order.
    const decoded = decodeFunctionData({ abi: POSITION_MANAGER_ABI, data: request.data });
    expect(decoded.functionName).toBe("modifyLiquidities");

    const before0 = await fork.balanceOf(fork.token0.address, fork.user);
    const before1 = await fork.balanceOf(fork.token1.address, fork.user);
    const poolLiquidityBefore = await fork.publicClient.readContract({
      address: LATCH_SEPOLIA.clPoolManager,
      abi: CL_POOL_MANAGER_ABI,
      functionName: "getLiquidity",
      args: [LIVE_POOL_ID],
    });

    const receipt = await fork.send({
      to: request.to,
      data: request.data,
      value: request.value,
    });
    expect(receipt.status).toBe("success");

    const spent0 = before0 - (await fork.balanceOf(fork.token0.address, fork.user));
    const spent1 = before1 - (await fork.balanceOf(fork.token1.address, fork.user));

    expect(spent0).toBe(predicted.amount0);
    expect(spent1).toBe(predicted.amount1);
    expect(spent0).toBeLessThanOrEqual(DESIRED_0);
    expect(spent1).toBeLessThanOrEqual(DESIRED_1);

    // The NFT exists and belongs to the recipient the widget named.
    expect(
      await positionOwner(fork.publicClient, fork.deployments.clPositionManager, expectedTokenId),
    ).toBe(fork.user);

    const poolLiquidityAfter = await fork.publicClient.readContract({
      address: LATCH_SEPOLIA.clPoolManager,
      abi: CL_POOL_MANAGER_ABI,
      functionName: "getLiquidity",
      args: [LIVE_POOL_ID],
    });
    // The range straddles the active tick, so the pool's in-range liquidity grows
    // by exactly what was minted.
    expect(poolLiquidityAfter - poolLiquidityBefore).toBe(liquidity);

    mintedTokenId = expectedTokenId;
    mintedLiquidity = liquidity;
  });

  it("removes the position with buildCLDecreaseCall calldata and returns the principal", async () => {
    expect(mintedTokenId).not.toBeNull();
    const tokenId = mintedTokenId;
    if (tokenId === null) throw new Error("mint did not run");

    const onChainLiquidity = await fork.publicClient.readContract({
      address: fork.deployments.clPositionManager,
      abi: parseAbi(["function getPositionLiquidity(uint256) view returns (uint128)"]),
      functionName: "getPositionLiquidity",
      args: [tokenId],
    });
    expect(onChainLiquidity).toBe(mintedLiquidity);

    const predicted = amountsForLiquidity(
      sqrtPriceX96,
      TICK_LOWER,
      TICK_UPPER,
      onChainLiquidity,
      false,
    );

    const position: PositionInfo = {
      id: String(tokenId),
      tokenId,
      pool: fork.pool,
      range: { type: "CL", tickLower: TICK_LOWER, tickUpper: TICK_UPPER },
      liquidity: onChainLiquidity,
      amount0: predicted.amount0,
      amount1: predicted.amount1,
      feesOwed0: 0n,
      feesOwed1: 0n,
      inRange: true,
      source: "live",
    };

    const request = await fork.adapter.buildRemoveLiquidity({
      position,
      percentBps: 10_000,
      amount0Min: predicted.amount0,
      amount1Min: predicted.amount1,
      recipient: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
      integrator: NO_INTEGRATOR_FEE,
    });

    const before0 = await fork.balanceOf(fork.token0.address, fork.user);
    const before1 = await fork.balanceOf(fork.token1.address, fork.user);

    const receipt = await fork.send({
      to: request.to,
      data: request.data,
      value: request.value,
    });
    expect(receipt.status).toBe("success");

    const got0 = (await fork.balanceOf(fork.token0.address, fork.user)) - before0;
    const got1 = (await fork.balanceOf(fork.token1.address, fork.user)) - before1;

    expect(got0).toBe(predicted.amount0);
    expect(got1).toBe(predicted.amount1);

    expect(
      await fork.publicClient.readContract({
        address: fork.deployments.clPositionManager,
        abi: parseAbi(["function getPositionLiquidity(uint256) view returns (uint128)"]),
        functionName: "getPositionLiquidity",
        args: [tokenId],
      }),
    ).toBe(0n);
  });

  it("rejects a removal whose minimum-out cannot be met", async () => {
    // Mint a fresh position so the failure is genuinely the slippage guard.
    // Attempting this against the already-emptied position instead reverts in
    // `SafeCast` - still a revert, but a different one, and a negative test that
    // accepts any revert would have called that a pass.
    const liquidity = getLiquidityForAmounts(
      sqrtPriceX96,
      getSqrtRatioAtTick(TICK_LOWER),
      getSqrtRatioAtTick(TICK_UPPER),
      10n * 10n ** 18n,
      10n * 10n ** 18n,
    );
    const tokenId = await nextPositionTokenId(
      fork.publicClient,
      fork.deployments.clPositionManager,
    );
    const mint = await fork.adapter.buildAddLiquidity({
      quote: quoteFor(liquidity),
      amount0Max: DESIRED_0,
      amount1Max: DESIRED_1,
      recipient: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
      integrator: NO_INTEGRATOR_FEE,
    });
    await fork.send({ to: mint.to, data: mint.data, value: mint.value });

    const held = amountsForLiquidity(sqrtPriceX96, TICK_LOWER, TICK_UPPER, liquidity, false);
    const position: PositionInfo = {
      id: String(tokenId),
      tokenId,
      pool: fork.pool,
      range: { type: "CL", tickLower: TICK_LOWER, tickUpper: TICK_UPPER },
      liquidity,
      amount0: held.amount0,
      amount1: held.amount1,
      feesOwed0: 0n,
      feesOwed1: 0n,
      inRange: true,
      source: "live",
    };
    const request = await fork.adapter.buildRemoveLiquidity({
      position,
      percentBps: 10_000,
      // Ten times what the position can possibly return.
      amount0Min: held.amount0 * 10n,
      amount1Min: held.amount1 * 10n,
      recipient: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
      integrator: NO_INTEGRATOR_FEE,
    });

    const before0 = await fork.balanceOf(fork.token0.address, fork.user);
    await expect(
      fork.send({ to: request.to, data: request.data, value: request.value }),
    ).rejects.toThrow(/reverted/);
    expect(await fork.revertErrorName(request)).toBe("MinimumAmountInsufficient");
    expect(await fork.balanceOf(fork.token0.address, fork.user)).toBe(before0);
  });

  it("carries the integrator config without taking anything on the liquidity path", async () => {
    // Documented behaviour: TAKE_PORTION splits an output currency, and a
    // deposit has none. The encoder must therefore emit no fee action at all.
    const liquidity = getLiquidityForAmounts(
      sqrtPriceX96,
      getSqrtRatioAtTick(TICK_LOWER),
      getSqrtRatioAtTick(TICK_UPPER),
      10n ** 18n,
      10n ** 18n,
    );
    const request = await fork.adapter.buildAddLiquidity({
      quote: quoteFor(liquidity),
      amount0Max: DESIRED_0,
      amount1Max: DESIRED_1,
      recipient: fork.user,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_200),
      integrator: NO_INTEGRATOR_FEE,
    });
    expect(request.integratorFee).toBeUndefined();

    const decoded = decodeFunctionData({ abi: POSITION_MANAGER_ABI, data: request.data });
    const unlockData = decoded.args[0];
    // The action byte string is the first dynamic member; TAKE_PORTION is 0x10.
    expect(unlockData.toLowerCase()).not.toContain(
      actionByte(ACTIONS.CL_MINT_POSITION) + actionByte(ACTIONS.TAKE_PORTION),
    );

    const referrerBefore0 = await fork.balanceOf(fork.token0.address, fork.referrer);
    const referrerBefore1 = await fork.balanceOf(fork.token1.address, fork.referrer);
    const receipt = await fork.send({
      to: request.to,
      data: request.data,
      value: request.value,
    });
    expect(receipt.status).toBe("success");
    expect(await fork.balanceOf(fork.token0.address, fork.referrer)).toBe(referrerBefore0);
    expect(await fork.balanceOf(fork.token1.address, fork.referrer)).toBe(referrerBefore1);
  });
});

let mintedTokenId: bigint | null = null;
let mintedLiquidity = 0n;

function actionByte(action: number): string {
  return action.toString(16).padStart(2, "0");
}
