/* ============================================================================
   Pool Detail data — SCREENS.md § C4.
   MOCK SEAM: `loadPool()`. Placeholder pool; no subgraph or RPC is queried.
   ============================================================================ */

export interface PoolStat {
  label: string
  value: string
}

export interface PoolCall {
  kind: string
  fee: string
  gas: string
}

export interface PoolData {
  pair: string
  attachment: string
  stats: PoolStat[]
  /** Green solid line — fee in bps applied by the latch, 24h. */
  feeSeries: number[]
  /** Blue dashed line — volatility index over the same window. */
  volatilitySeries: number[]
  legend: { fee: string; volatility: string }
  calls: PoolCall[]
}

export function loadPool(): PoolData {
  return {
    pair: 'ETH / USDC · 0.05%',
    attachment: 'DynamicFeeLatch attached · Base',
    stats: [
      { label: 'TVL', value: '$14.2M' },
      { label: 'VOLUME 24H', value: '$8.1M' },
      { label: 'FEE (LIVE)', value: '0.11%' },
      { label: 'HOOK CALLS', value: '182K' },
    ],
    feeSeries: [26, 31, 28, 42, 55, 48, 38, 44, 61, 52, 47, 39],
    volatilitySeries: [18, 24, 21, 29, 34, 31, 38, 44, 41, 52, 48, 61],
    legend: { fee: 'fee bps', volatility: 'volatility index' },
    calls: [
      { kind: 'beforeSwap', fee: '0.11%', gas: '8.2k' },
      { kind: 'afterSwap', fee: '—', gas: '3.1k' },
      { kind: 'beforeSwap', fee: '0.30%', gas: '8.6k' },
      { kind: 'beforeSwap', fee: '0.05%', gas: '8.1k' },
      { kind: 'afterSwap', fee: '—', gas: '3.0k' },
      { kind: 'beforeSwap', fee: '0.11%', gas: '8.3k' },
      { kind: 'afterSwap', fee: '—', gas: '3.2k' },
    ],
  }
}
