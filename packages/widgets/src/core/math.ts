// SPDX-License-Identifier: MIT
/**
 * Quote arithmetic.
 *
 * Everything here is pure, integer-only and independent of any chain, adapter
 * or component, so it can be tested exhaustively. The rounding directions match
 * the contracts: fees and minimum-received amounts round **down**, maximum-spend
 * amounts round **up**. Every rounding error is therefore in the user's favour
 * or, at worst, causes a revert instead of a silent loss.
 */

import {
  calculateIntegratorFee,
  splitIntegratorFee,
  type ResolvedIntegratorConfig,
} from "../config/integrator.js";

/** Basis-point denominator as a bigint. */
export const BPS = 10_000n;

/** Pips denominator, matching `ProtocolFeeLibrary.PIPS_DENOMINATOR`. */
export const PIPS = 1_000_000n;

/**
 * Highest slippage tolerance the widgets accept, in bps (50%).
 *
 * Above this a "swap" is indistinguishable from a donation to whoever is
 * watching the mempool.
 */
export const MAX_SLIPPAGE_BPS = 5_000;

/** Slippage used when the embedder sets none. */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** Price impact at or above which the UI demands explicit confirmation. */
export const HIGH_PRICE_IMPACT_BPS = 300;

/** Price impact treated as certainly-a-mistake. */
export const SEVERE_PRICE_IMPACT_BPS = 1_000;

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) throw new RangeError(`${label} must not be negative: ${value}`);
}

function assertBps(value: number, label: string, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer in [0, ${max}]: ${value}`);
  }
}

/** `floor(amount * bps / 10_000)`. */
export function portionOf(amount: bigint, bps: number): bigint {
  assertNonNegative(amount, "amount");
  assertBps(bps, "bps", 10_000);
  return (amount * BigInt(bps)) / BPS;
}

/** `floor(amount * pips / 1_000_000)`. */
export function pipsOf(amount: bigint, pips: number): bigint {
  assertNonNegative(amount, "amount");
  assertBps(pips, "pips", 1_000_000);
  return (amount * BigInt(pips)) / PIPS;
}

/**
 * Minimum amount that must be received for the transaction to be acceptable.
 *
 * Rounds down, so the on-chain check is never tighter than the user's stated
 * tolerance.
 */
export function minimumReceived(expected: bigint, slippageBps: number): bigint {
  assertNonNegative(expected, "expected");
  assertBps(slippageBps, "slippageBps", MAX_SLIPPAGE_BPS);
  return (expected * (BPS - BigInt(slippageBps))) / BPS;
}

/**
 * Maximum amount the user is willing to spend.
 *
 * Rounds up, so a one-wei rounding difference on-chain does not revert an
 * otherwise valid exact-output swap.
 */
export function maximumSpent(expected: bigint, slippageBps: number): bigint {
  assertNonNegative(expected, "expected");
  assertBps(slippageBps, "slippageBps", MAX_SLIPPAGE_BPS);
  const numerator = expected * (BPS + BigInt(slippageBps));
  return numerator % BPS === 0n ? numerator / BPS : numerator / BPS + 1n;
}

/**
 * Price impact in basis points: how much worse the realised rate is than the
 * pool's rate for an infinitesimal trade.
 *
 * `spotAmountOut` is what the same input would return at the current price with
 * no impact and no LP fee. Returns `null` when that reference is unavailable or
 * zero, because a fabricated zero would read as "no impact" - the most
 * dangerous possible default.
 */
export function priceImpactBps(
  grossAmountOut: bigint,
  spotAmountOut: bigint | null | undefined,
): number | null {
  if (spotAmountOut === null || spotAmountOut === undefined || spotAmountOut <= 0n) return null;
  assertNonNegative(grossAmountOut, "grossAmountOut");
  if (grossAmountOut >= spotAmountOut) return 0;
  const impact = ((spotAmountOut - grossAmountOut) * BPS) / spotAmountOut;
  return Number(impact);
}

/** Severity buckets for a price impact, used for presentation and gating. */
export type PriceImpactSeverity = "unknown" | "low" | "elevated" | "high" | "severe";

/** Classifies a price impact in bps. */
export function priceImpactSeverity(bps: number | null): PriceImpactSeverity {
  if (bps === null) return "unknown";
  if (bps >= SEVERE_PRICE_IMPACT_BPS) return "severe";
  if (bps >= HIGH_PRICE_IMPACT_BPS) return "high";
  if (bps >= 100) return "elevated";
  return "low";
}

/** Inputs to {@link buildQuoteBreakdown}. */
export interface QuoteBreakdownInput {
  /** Input amount, in the input currency's smallest unit. */
  readonly amountIn: bigint;
  /** Output before any integrator fee, as returned by the adapter. */
  readonly grossAmountOut: bigint;
  /** Output at the current price with no impact, if the adapter can supply it. */
  readonly spotAmountOut?: bigint | null;
  /** LP fee already deducted by the pool, in the output currency. */
  readonly lpFeeAmount?: bigint;
  /** Pool's LP fee rate in pips. */
  readonly lpFeePips?: number;
  /** User's slippage tolerance. */
  readonly slippageBps: number;
  /** Validated integrator config. */
  readonly integrator: ResolvedIntegratorConfig;
}

/**
 * Everything a swap UI and a swap call path need, derived once.
 *
 * The two minimums matter and are not interchangeable:
 *
 * - `minAmountOutGross` is checked by the swap action, before the fee is split.
 * - `minAmountOutNet` is what the user is guaranteed to actually receive, and is
 *   the value the final take/sweep enforces.
 */
export interface QuoteBreakdown {
  readonly amountIn: bigint;
  readonly grossAmountOut: bigint;
  readonly integratorFee: bigint;
  readonly integratorFeeBps: number;
  readonly netAmountOut: bigint;
  readonly minAmountOutGross: bigint;
  readonly minAmountOutNet: bigint;
  readonly lpFeeAmount: bigint;
  readonly lpFeePips: number;
  readonly slippageBps: number;
  readonly priceImpactBps: number | null;
  readonly priceImpactSeverity: PriceImpactSeverity;
}

/**
 * Derives the full quote breakdown.
 *
 * `minAmountOutNet` is computed as `minGross - portion(minGross)` rather than
 * `portion(netAmountOut)`. That matters: the fee is taken on-chain from the
 * *realised* output, not the quoted one, and `x - floor(x * bps / 10_000)` is
 * monotonically non-decreasing in `x`. So this is a genuine floor on what the
 * user receives whenever the swap itself clears `minAmountOutGross`.
 */
export function buildQuoteBreakdown(input: QuoteBreakdownInput): QuoteBreakdown {
  const { amountIn, grossAmountOut, slippageBps, integrator } = input;
  assertNonNegative(amountIn, "amountIn");
  assertNonNegative(grossAmountOut, "grossAmountOut");
  assertBps(slippageBps, "slippageBps", MAX_SLIPPAGE_BPS);

  const split = splitIntegratorFee(grossAmountOut, integrator);
  const minAmountOutGross = minimumReceived(grossAmountOut, slippageBps);
  const minAmountOutNet = integrator.active
    ? minAmountOutGross - calculateIntegratorFee(minAmountOutGross, integrator.feeBps)
    : minAmountOutGross;

  const impact = priceImpactBps(grossAmountOut, input.spotAmountOut ?? null);

  return {
    amountIn,
    grossAmountOut,
    integratorFee: split.integratorFee,
    integratorFeeBps: split.feeBps,
    netAmountOut: split.netAmount,
    minAmountOutGross,
    minAmountOutNet,
    lpFeeAmount: input.lpFeeAmount ?? 0n,
    lpFeePips: input.lpFeePips ?? 0,
    slippageBps,
    priceImpactBps: impact,
    priceImpactSeverity: priceImpactSeverity(impact),
  };
}

/**
 * Exchange rate as a floating-point number of output units per input unit.
 *
 * Display only. Never feed this back into a call path - it loses precision by
 * construction.
 */
export function exchangeRate(
  amountIn: bigint,
  decimalsIn: number,
  amountOut: bigint,
  decimalsOut: number,
): number | null {
  if (amountIn <= 0n || amountOut <= 0n) return null;
  const scaledIn = Number(amountIn) / 10 ** decimalsIn;
  const scaledOut = Number(amountOut) / 10 ** decimalsOut;
  if (!Number.isFinite(scaledIn) || scaledIn === 0) return null;
  return scaledOut / scaledIn;
}

/** Progress of a sale as a percentage in `[0, 100]`. */
export function progressPercent(sold: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  const capped = sold > total ? total : sold;
  return Number((capped * 10_000n) / total) / 100;
}

/** Clamps `value` to `[min, max]`. */
export function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  if (min > max) throw new RangeError(`clampBigInt: min ${min} exceeds max ${max}`);
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Rounds a tick down to the nearest usable multiple of `tickSpacing`. */
export function floorTickToSpacing(tick: number, tickSpacing: number): number {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new RangeError(`tickSpacing must be a positive integer: ${tickSpacing}`);
  }
  return Math.floor(tick / tickSpacing) * tickSpacing;
}

/** Rounds a tick up to the nearest usable multiple of `tickSpacing`. */
export function ceilTickToSpacing(tick: number, tickSpacing: number): number {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new RangeError(`tickSpacing must be a positive integer: ${tickSpacing}`);
  }
  return Math.ceil(tick / tickSpacing) * tickSpacing;
}
