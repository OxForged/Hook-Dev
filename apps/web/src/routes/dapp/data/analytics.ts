/* ============================================================================
   Analytics data — SCREENS.md § C6.
   MOCK SEAM: `loadAnalytics()`. Placeholder protocol-wide figures.
   ============================================================================ */

import type { DonutSegment, LabelledBar } from './types.ts'

export interface AnalyticsData {
  weeklyLabel: string
  /** 18 columns, percent of the 210px track. The last one renders green. */
  weeklyCalls: number[]
  networksLabel: string
  networks: DonutSegment[]
  topLatchesLabel: string
  topLatches: LabelledBar[]
}

export function loadAnalytics(): AnalyticsData {
  return {
    weeklyLabel: 'HOOK CALLS · WEEKLY',
    weeklyCalls: [42, 58, 51, 66, 74, 61, 82, 90, 77, 96, 88, 71, 84, 93, 79, 68, 87, 100],
    networksLabel: 'TVL BY NETWORK',
    networks: [
      { name: 'Ethereum', pct: 41, color: 'primary' },
      { name: 'Base', pct: 27, color: 'signal' },
      { name: 'Arbitrum', pct: 19, color: 'violet' },
      { name: 'Others', pct: 13, color: 'success' },
    ],
    topLatchesLabel: 'TOP LATCHES BY FEES',
    topLatches: [
      { name: 'DynamicFeeLatch', value: '$88.1K', pct: 100, color: 'primary' },
      { name: 'JITLatch', value: '$41.6K', pct: 47, color: 'primary' },
      { name: 'OracleLatch', value: '$29.4K', pct: 33, color: 'primary' },
      { name: 'RewardLatch', value: '$12.2K', pct: 14, color: 'primary' },
    ],
  }
}
