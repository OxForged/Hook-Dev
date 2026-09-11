/* ============================================================================
   Analytics data — SCREENS.md § C6.

   This module used to be the mock seam: `loadAnalytics()` returned invented
   weekly hook-call bars, a four-network TVL donut (Ethereum 41% / Base 27% /
   Arbitrum 19%) and dollar fee totals for latches that do not exist. All of it
   is gone. Nothing here is authored; every figure is computed from logs and
   balances read off the ACTIVE deployment's contracts by `lib/chain.ts` —
   whichever chain that is, never a chain named in a string here.

   Three things the old shape could not honestly express, and how each is
   handled now:

     - The multi-network donut. Latch has exactly ONE deployment. A donut split
       across four chains is not a rounding error, it is fiction. It is replaced
       by a split that is real and unit-consistent: how each swap's fee divides
       between the protocol and liquidity providers, read from the Swap event's
       own `fee` / `protocolFee` fields.

     - "Weekly" columns. Logs carry block numbers, not weeks; deriving a week
       from block height means assuming a block time no chain here honours
       exactly. The columns are now protocol events bucketed by BLOCK across
       the window in which activity actually occurred, and the axis says which
       blocks. The cumulative fee series below is indexed the same way, for the
       same reason.

     - "TOP LATCHES BY FEES", in dollars. No hook has ever earned a fee here —
       no live pool has a hook attached — and testnet tokens have no price. The
       screen renders that as a labelled empty state instead of a ranking.

   No USD appears anywhere. ltUSD and ltETH are unpriced testnet tokens, and a
   fabricated price is the exact failure this module exists to avoid.
   ============================================================================ */

import {
  ACTIVE_CHAIN_ID,
  formatUnits,
  readActivity,
  readProtocolMetrics,
  readRecentSwaps,
  readRegisteredLatches,
  type ActivityEvent,
  type DeployedChainId,
  type ProtocolMetrics,
  type RegisteredLatch,
  type SwapRecord,
} from '../../../lib/chain'
import type { DonutSegment, LabelledBar } from './types.ts'

/** One column of the events-per-block chart. */
export interface BlockBucket {
  fromBlock: bigint
  toBlock: bigint
  count: number
  /** Height as a percent of the tallest bucket — what ColumnChart consumes. */
  pct: number
}

/** A distinct (total pips, protocol pips) pair observed across real swaps. */
export interface FeeConfig {
  totalPips: number
  protocolPips: number
  swaps: number
}

/**
 * One token's running fee total, one point per swap that charged in it.
 *
 * Indexed by BLOCK, never by a clock derived from one. Each point is a real
 * reading — "after this swap, this much fee had been charged in this token" —
 * so the line passes through measurements only and never between them. Nothing
 * is emitted for a block in which no swap occurred: a flat segment drawn across
 * quiet blocks would assert that somebody measured them.
 *
 * ONE TOKEN PER SERIES. The two sides of a swap are different tokens and
 * nothing prices either, so a combined "total fees" line would need an exchange
 * rate that does not exist. Same reason `feeBars` keeps its bars per token.
 */
export interface FeeSeriesPoint {
  blockNumber: bigint
  /** Cumulative protocol + LP fee, in this token's smallest unit. */
  cumulative: bigint
}

export interface TokenFeeSeries {
  symbol: string
  decimals: number
  /** Ascending by block. One entry per swap whose INPUT side was this token. */
  points: FeeSeriesPoint[]
}

export interface AnalyticsData {
  latestBlock: bigint
  poolCount: number
  hookedPoolCount: number
  swapCount: number

  /** Every protocol event on the CL manager, newest first. */
  eventCount: number
  firstEventBlock: bigint | null
  lastEventBlock: bigint | null
  /** Blocks covered by a single column. 1 when the window is short enough. */
  blocksPerBucket: number
  buckets: BlockBucket[]
  /** Blocks mined since the last protocol event. */
  quietBlocks: bigint

  /** Protocol vs LP share of the swap fee. Empty when no swap has happened. */
  feeSplit: DonutSegment[]
  feeConfigs: FeeConfig[]

  /** Fees earned, split protocol/LP, one pair of bars per token. */
  feeBars: LabelledBar[]

  /**
   * Running fee total per token, one series each. A token with a single
   * fee-bearing swap yields a single point, and the chart says so rather than
   * drawing a line through it.
   */
  feeSeries: TokenFeeSeries[]

  /** Hooks listed in the registry, and how many live pools actually use one. */
  hooks: RegisteredLatch[]
}

/* -------------------------------------------------------------------------
   Bucketing
   ------------------------------------------------------------------------- */

/** Column budget. Fewer columns than this means one column per block. */
const MAX_COLUMNS = 18

function bucketByBlock(events: ActivityEvent[]): {
  buckets: BlockBucket[]
  blocksPerBucket: number
  first: bigint | null
  last: bigint | null
} {
  if (events.length === 0) {
    return { buckets: [], blocksPerBucket: 0, first: null, last: null }
  }

  let lo = events[0]!.blockNumber
  let hi = lo
  for (const e of events) {
    if (e.blockNumber < lo) lo = e.blockNumber
    if (e.blockNumber > hi) hi = e.blockNumber
  }

  // Bucket across the window activity actually occupies, not the whole
  // deployment. Spanning thousands of empty blocks to make one tall bar at the
  // left is technically sourced from real data and still reads as a chart of
  // nothing; the quiet-blocks figure states that gap in words instead.
  const span = Number(hi - lo) + 1
  const blocksPerBucket = Math.max(1, Math.ceil(span / MAX_COLUMNS))
  const n = Math.max(1, Math.ceil(span / blocksPerBucket))

  const counts = new Array<number>(n).fill(0)
  for (const e of events) {
    const i = Math.min(n - 1, Math.floor(Number(e.blockNumber - lo) / blocksPerBucket))
    counts[i] = (counts[i] ?? 0) + 1
  }

  const max = Math.max(...counts)
  const buckets = counts.map((count, i) => ({
    fromBlock: lo + BigInt(i * blocksPerBucket),
    toBlock: lo + BigInt((i + 1) * blocksPerBucket) - 1n,
    count,
    pct: max === 0 ? 0 : Math.round((count / max) * 100),
  }))

  return { buckets, blocksPerBucket, first: lo, last: hi }
}

/* -------------------------------------------------------------------------
   Fee split
   ------------------------------------------------------------------------- */

/**
 * Integer percentages that sum to exactly 100 (largest remainder).
 *
 * The donut lays arcs end to end, so segments that sum to 99 leave a visible
 * gap and 101 overlaps the first arc — either one makes the chart lie about
 * completeness.
 */
function roundTo100(values: number[]): number[] {
  const out = values.map((v) => Math.floor(v))
  let remainder = 100 - out.reduce((a, b) => a + b, 0)
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (const o of order) {
    if (remainder <= 0) break
    out[o.i] = (out[o.i] ?? 0) + 1
    remainder -= 1
  }
  return out
}

function feeSplit(swaps: SwapRecord[]): { segments: DonutSegment[]; configs: FeeConfig[] } {
  const byConfig = new Map<string, FeeConfig>()
  for (const s of swaps) {
    const key = `${s.feePips}/${s.protocolFeePips}`
    const existing = byConfig.get(key)
    if (existing) existing.swaps += 1
    else byConfig.set(key, { totalPips: s.feePips, protocolPips: s.protocolFeePips, swaps: 1 })
  }
  const configs = [...byConfig.values()].sort((a, b) => b.swaps - a.swaps)

  // Weighted by swap COUNT, not by value: the two sides of a swap are in
  // different tokens and nothing prices testnet tokens, so there is no common
  // unit to weight by. The screen says so next to the chart.
  let protocolWeighted = 0
  let totalWeighted = 0
  for (const c of configs) {
    protocolWeighted += c.protocolPips * c.swaps
    totalWeighted += c.totalPips * c.swaps
  }
  if (totalWeighted === 0) return { segments: [], configs }

  const protocolPct = (protocolWeighted / totalWeighted) * 100
  const [p, l] = roundTo100([protocolPct, 100 - protocolPct])
  return {
    segments: [
      { name: 'Protocol', pct: p ?? 0, color: 'primary' },
      { name: 'Liquidity providers', pct: l ?? 0, color: 'violet' },
    ],
    configs,
  }
}

/* -------------------------------------------------------------------------
   Fees earned, per token
   ------------------------------------------------------------------------- */

function feeBars(m: ProtocolMetrics): LabelledBar[] {
  const sides = [
    { token: m.tvl[0], protocol: m.protocolFees0, lp: m.lpFees0 },
    { token: m.tvl[1], protocol: m.protocolFees1, lp: m.lpFees1 },
  ]

  const bars: LabelledBar[] = []
  for (const s of sides) {
    const t = s.token
    if (!t) continue
    const total = s.protocol + s.lp
    // A token that has never been the input side of a swap earned nothing.
    // Rendering a zero-length bar for it would imply it competed and lost.
    if (total === 0n) continue
    // Bars are a share of THIS token's fees, so both ends of a comparison are
    // in the same unit. Comparing an ltUSD bar against an ltETH bar by length
    // would need a price neither token has.
    const share = (v: bigint) => Number((v * 10_000n) / total) / 100
    bars.push({
      name: `${t.symbol} · protocol`,
      value: formatUnits(s.protocol, t.decimals, 6),
      pct: share(s.protocol),
      color: 'primary',
    })
    bars.push({
      name: `${t.symbol} · liquidity providers`,
      value: formatUnits(s.lp, t.decimals, 6),
      pct: share(s.lp),
      color: 'violet',
    })
  }
  return bars
}

/* -------------------------------------------------------------------------
   Cumulative fee series, per token
   ------------------------------------------------------------------------- */

const absBig = (v: bigint) => (v < 0n ? -v : v)

/**
 * Turn real Swap logs into one running total per token.
 *
 * The apportionment is the same one `readProtocolMetrics` uses — each swap's
 * OWN `fee` field against its own input amount — so this series and the KPI
 * totals cannot disagree. Reusing the controller's current default instead
 * would silently rewrite history the moment a fee changed.
 *
 * Token identity follows the same positional convention as `feeBars`: side 0 of
 * a swap is `metrics.tvl[0]`. That holds while the deployment has one pool,
 * which is what the chain says today; it is stated here rather than assumed
 * silently, because a second pool with different currencies would break it.
 */
function feeSeries(m: ProtocolMetrics, swaps: SwapRecord[]): TokenFeeSeries[] {
  const tokens = [m.tvl[0], m.tvl[1]]
  const running = [0n, 0n]
  const points: FeeSeriesPoint[][] = [[], []]

  // readRecentSwaps hands back newest-first for the activity feed; a series
  // reads the other way.
  const ascending = [...swaps].sort((a, b) => Number(a.blockNumber - b.blockNumber))

  for (const s of ascending) {
    const side = s.amount0 > 0n ? 0 : 1
    const gross = absBig(side === 0 ? s.amount0 : s.amount1)
    const fee = (gross * BigInt(s.feePips)) / 1_000_000n
    if (fee === 0n) continue
    running[side] = (running[side] ?? 0n) + fee
    points[side]?.push({ blockNumber: s.blockNumber, cumulative: running[side] ?? 0n })
  }

  const out: TokenFeeSeries[] = []
  for (const [i, t] of tokens.entries()) {
    const pts = points[i]
    if (!t || !pts || pts.length === 0) continue
    out.push({ symbol: t.symbol, decimals: t.decimals, points: pts })
  }
  return out
}

/* -------------------------------------------------------------------------
   Loader
   ------------------------------------------------------------------------- */

/**
 * Everything the Analytics screen renders, read live.
 *
 * Throws if the chain is unreachable. The caller must show that failure rather
 * than substituting anything — a figure that silently degrades from real to
 * invented is indistinguishable to the reader.
 */
export async function loadAnalytics(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<AnalyticsData> {
  const [metrics, events, swaps, hooks] = await Promise.all([
    readProtocolMetrics(chainId),
    readActivity(chainId, 5000),
    readRecentSwaps(chainId, 5000),
    readRegisteredLatches(chainId),
  ])

  const { buckets, blocksPerBucket, first, last } = bucketByBlock(events)
  const { segments, configs } = feeSplit(swaps)

  return {
    latestBlock: metrics.latestBlock,
    poolCount: metrics.poolCount,
    hookedPoolCount: metrics.hookedPoolCount,
    swapCount: metrics.swapCount,
    eventCount: events.length,
    firstEventBlock: first,
    lastEventBlock: last,
    blocksPerBucket,
    buckets,
    quietBlocks: last === null ? 0n : metrics.latestBlock - last,
    feeSplit: segments,
    feeConfigs: configs,
    feeBars: feeBars(metrics),
    feeSeries: feeSeries(metrics, swaps),
    hooks,
  }
}
