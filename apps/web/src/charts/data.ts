/**
 * Every number in this file is measured or derived from the repository.
 *
 * Latch Protocol is not deployed on any chain. There is deliberately no TVL,
 * volume, user, liquidity or price data on this page — not even as a
 * placeholder. If a section would need usage data, the section is not here.
 */

/* ------------------------------------------------------------------ */
/* Dataset 1 — settlement backend gas, measured with `forge test`      */
/* ------------------------------------------------------------------ */

export type GasRow = {
  /** Test name as it appears in the suite. */
  readonly test: string
  /** Gas under the Cancun build profile (EIP-1153 transient storage). */
  readonly cancun: number
  /** Gas under the Shanghai build profile (persistent storage). */
  readonly shanghai: number
}

/** Sorted by penalty, largest first — the delta is the point of the chart. */
export const GAS_ROWS: readonly GasRow[] = [
  { test: 'reserveIsZeroed_afterLockExits', cancun: 108629, shanghai: 138689 },
  { test: 'reserveDoesNotLeakBetweenLocks', cancun: 132095, shanghai: 165023 },
  { test: 'drain_settleWithoutPaying_isBlocked', cancun: 167699, shanghai: 195232 },
  { test: 'sync_outsideLock_reverts', cancun: 32600, shanghai: 34600 },
  { test: 'backendIdentity_matchesProfile', cancun: 3621, shanghai: 3786 },
  { test: 'sync_outsideLock_reverts_evenWithVaultBalance', cancun: 87292, shanghai: 89292 },
] as const

/** Derived, never hand-typed, so the label can never drift from the data. */
export function gasDeltaPct(row: GasRow): number {
  return ((row.shanghai - row.cancun) / row.cancun) * 100
}

export const GAS_MAX = 200000

/* ------------------------------------------------------------------ */
/* Dataset 2 — protocol fee composition                                */
/* Verified against packages/core/src/libraries/ProtocolFeeLibrary.sol */
/* ------------------------------------------------------------------ */

/** Hundredths of a bip. `ProtocolFeeLibrary.PIPS_DENOMINATOR`. */
const PIPS_DENOMINATOR = 1_000_000

/** The scenario this chart plots: a flat 1,000 pip (0.10%) protocol fee. */
export const PROTOCOL_FEE_PIPS = 1000

/** `ProtocolFeeLibrary.MAX_PROTOCOL_FEE` — 4000 pips. */
export const MAX_PROTOCOL_FEE_PIPS = 4000

/**
 * Port of `ProtocolFeeLibrary.calculateSwapFee`:
 *   protocolFee + lpFee - (protocolFee * lpFee / 1_000_000)
 * The division truncates in Solidity, so it truncates here.
 */
export function calculateSwapFee(protocolFeePips: number, lpFeePips: number): number {
  return protocolFeePips + lpFeePips - Math.floor((protocolFeePips * lpFeePips) / PIPS_DENOMINATOR)
}

export type FeeTier = {
  readonly tier: string
  /** LP fee in pips, as passed in `poolKey.fee`. */
  readonly lp: number
}

export const FEE_TIERS: readonly FeeTier[] = [
  { tier: 'Stable', lp: 100 },
  { tier: 'Low', lp: 500 },
  { tier: 'Standard', lp: 3000 },
  { tier: 'Exotic', lp: 10000 },
] as const

export type FeeTierComputed = {
  readonly tier: string
  readonly lp: number
  /** `total - lp` — the cross-term makes this slightly under 1,000 at high LP fees. */
  readonly protocol: number
  readonly total: number
  /** What the swapper's cost is multiplied by, relative to the LP fee alone. */
  readonly ratio: number
}

export const FEE_ROWS: readonly FeeTierComputed[] = FEE_TIERS.map((t) => {
  const total = calculateSwapFee(PROTOCOL_FEE_PIPS, t.lp)
  return { tier: t.tier, lp: t.lp, protocol: total - t.lp, total, ratio: total / t.lp }
})

export const FEE_MAX = 11000

/** `11×` for a multiple, `+33%` for an increment — whichever reads honestly. */
export function formatIncrease(ratio: number): string {
  return ratio >= 2 ? `${Math.round(ratio)}×` : `+${Math.round((ratio - 1) * 100)}%`
}

/** The same figure as a phrase that reads correctly either way. */
export function increasePhrase(ratio: number): string {
  return ratio >= 2
    ? `${Math.round(ratio)}× the LP fee`
    : `+${Math.round((ratio - 1) * 100)}% over the LP fee`
}

/** Pips → percent of swap input, trimmed of trailing zeroes. */
export function pipsToPct(pips: number): string {
  const pct = pips / 10000
  return `${pct.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`
}

export const fmt = new Intl.NumberFormat('en-US')
