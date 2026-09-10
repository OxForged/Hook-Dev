/* ============================================================================
   Dashboard data — SCREENS.md § C1.
   MOCK SEAM: `loadDashboard()`. Placeholder figures; nothing here is live.
   ============================================================================ */

import type { LabelledBar, Range, Series } from './types.ts'

export interface Kpi {
  label: string
  value: string
  trend: string
  /** true → green trend, false → Sky Ink (SCREENS.md § C1: MEDIAN OVERHEAD). */
  up: boolean
  /** 12 sparkline bar heights, percent of the 32px track. */
  spark: number[]
}


export interface DashboardData {
  kpis: Kpi[]
  volume: Record<Range, Series>
  callMix: LabelledBar[]
}

/* Sparkline heights, transcribed from the reference's generator
   `30 + round(52 * |sin(seed + i*0.7)|)` at seeds 0.4 / 2.1 / 3.8 / 5.5 so the
   bars match the reference exactly without carrying its code. */
const SPARKS: number[][] = [
  [50, 76, 81, 61, 33, 66, 82, 73, 45, 51, 77, 80],
  [75, 47, 48, 75, 81, 63, 31, 64, 81, 74, 47, 49],
  [62, 81, 76, 49, 46, 74, 81, 64, 31, 63, 81, 76],
  [67, 34, 60, 80, 77, 51, 44, 73, 82, 66, 33, 61],
]

export function loadDashboard(): DashboardData {
  return {
    kpis: [
      { label: 'TVL WITH LATCHES', value: '$48.2M', trend: '+6.4%', up: true, spark: SPARKS[0] ?? [] },
      { label: 'HOOK CALLS 24H', value: '412,905', trend: '+12.1%', up: true, spark: SPARKS[1] ?? [] },
      { label: 'FEES EARNED 30D', value: '$186.4K', trend: '+3.8%', up: true, spark: SPARKS[2] ?? [] },
      { label: 'MEDIAN OVERHEAD', value: '8,412 gas', trend: '-2.2%', up: false, spark: SPARKS[3] ?? [] },
    ],
    volume: {
      '30D': { pts: [18, 24, 21, 29, 34, 31, 38, 44, 41, 52, 48, 61], labels: ['W1', 'W2', 'W3', 'W4'] },
      '90D': { pts: [12, 19, 26, 22, 33, 41, 38, 47, 55, 51, 63, 72], labels: ['Jun', 'Jul', 'Aug'] },
      '1Y': { pts: [4, 7, 11, 9, 16, 22, 27, 34, 41, 52, 63, 78], labels: ['Q4', 'Q1', 'Q2', 'Q3'] },
    },
    callMix: [
      { name: 'beforeSwap', value: '8.2M', pct: 100, color: 'primary' },
      { name: 'afterSwap', value: '6.4M', pct: 78, color: 'signal' },
      { name: 'beforeAddLiquidity', value: '1.9M', pct: 24, color: 'violet' },
      { name: 'afterRemoveLiquidity', value: '0.7M', pct: 9, color: 'success' },
    ],
  }
}
