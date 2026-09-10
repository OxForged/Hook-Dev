/* ============================================================================
   Dapp — shared data types.

   Shapes follow "latch design/README.md" § State management. Every value the
   seven screens render is a PLACEHOLDER: Latch Protocol's only deployment is on
   Ethereum Sepolia, and none of the numbers here were read off it. Each screen
   reads from its own module in this folder (`data/<screen>.ts`); swapping a
   module's `load*()` for a registry / subgraph / RPC call is the whole
   migration.
   ============================================================================ */

import type { ChainKey } from '../../../data/chains.ts'

/** README § State management: `screen`. Mirrors the seven nested routes. */
export type Screen =
  | 'dashboard'
  | 'explorer'
  | 'deploy'
  | 'pool'
  | 'portfolio'
  | 'analytics'
  | 'settings'

/** README § State management: `range` — selects the volume series. */
export type Range = '30D' | '90D' | '1Y'

/** README § State management: `filter` — filters the latch list. */
export type Filter = 'All' | 'DeFi' | 'NFT' | 'Gaming' | 'RWA'

/** README § State management: `flags` — the four settings toggles. */
export interface Flags {
  sim: boolean
  alerts: boolean
  testnet: boolean
  autoGas: boolean
}

/** The reference's single state object, kept whole (README § State management). */
export interface DappState {
  screen: Screen
  range: Range
  filter: Filter
  /** Selected callbacks. Default `["beforeSwap","afterSwap"]`. */
  cbs: string[]
  /** Thousands of gas. Default 24, max 60. */
  budget: number
  deploying: boolean
  deployed: boolean
  /** Selected network, keyed to the SDK's chain list — not a free string. */
  net: ChainKey
  flags: Flags
  block: number
}

/** README § Design tokens — data series colours, referenced by key never by hex. */
export type SeriesColor = 'primary' | 'signal' | 'violet' | 'success' | 'amber'

/** `{ pts, labels }` — the series shape the README specifies for `range`. */
export interface Series {
  pts: number[]
  labels: string[]
}

export interface LabelledBar {
  name: string
  value: string
  pct: number
  color: SeriesColor
}

export interface DonutSegment {
  name: string
  pct: number
  color: SeriesColor
}
