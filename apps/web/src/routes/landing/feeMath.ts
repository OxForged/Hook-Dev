/* ============================================================================
   The fee arithmetic FeeChart and SwapCost share — one copy, not two.

   Both components previously kept a private `pancakeFeeFor` and `allIn`, with
   a comment in SwapCost saying the right move, the day a second surface needed
   them, was to hoist them rather than copy again. Both surfaces now sit one
   above the other on the landing page, so a drift between their arithmetic
   would be visible as two different numbers for the same pool.

   NOTHING HERE IS A LATCH RATE. Latch's per-tier protocol fee is
   `feeForLpFee(lpFee)` read from the live controller (`lib/chain.ts`
   `readFeeTiers`); this file only COMPOSES rates it is given, and computes the
   cited PancakeSwap comparison.
   ========================================================================== */

/** Hundredths of a bip, matching `ProtocolFeeLibrary.PIPS_DENOMINATOR`. */
export const ONE = 1_000_000

/**
 * PancakeSwap Infinity's split ratio, from their published source
 * (`ProtocolFeeController.sol:32`, `protocolFeeSplitRatio = 33 * 1e4`).
 *
 * A CITATION, not a measurement of their deployment — this repo has never
 * called their contracts and does not claim to have.
 */
export const PANCAKE_SPLIT = 330_000

/** Core's `ProtocolFeeLibrary.MAX_PROTOCOL_FEE` — 4000 pips, a hard 0.4% cap. */
export const MAX_PROTOCOL_FEE = 4000

/**
 * The protocol fee PancakeSwap's controller would stamp on a pool at this LP
 * fee, with their own formula and their own ratio.
 *
 * Solving `p / (p + l - p*l/ONE) == ratio` for `p`. Integer division
 * throughout, matching Solidity, so the comparison is like for like.
 */
export function pancakeFeeFor(lpFee: number): number {
  const denominator = lpFee + Math.floor((ONE * ONE) / PANCAKE_SPLIT) - ONE
  if (denominator <= 0) return MAX_PROTOCOL_FEE
  return Math.min(Math.floor((lpFee * ONE) / denominator), MAX_PROTOCOL_FEE)
}

/**
 * The rate a trader actually pays. The two fees COMPOSE, they do not add:
 * the protocol fee comes off the input first and the LP fee applies to what is
 * left — `ProtocolFeeLibrary.calculateSwapFee`. `Math.floor` because
 * Solidity's `/` truncates.
 */
export function allInPips(lp: number, protocol: number): number {
  return lp + protocol - Math.floor((lp * protocol) / ONE)
}

/** A pip figure as a percentage. 3000 pips is 0.30%. */
export function pct(pips: number, dp = 4): string {
  return `${(pips / 10_000).toFixed(dp)}%`
}
