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

/** README § State management: `screen`. Mirrors the nested routes.
    `marketplace` was `explorer`: the product name is the Latch Marketplace, and
    the thing listed there is a Latch. "Hook" is kept for CONTRACT-level names
    only (LatchHookRegistry, getHooksRegistrationBitmap, IHooks) - those are the
    on-chain API and renaming them would be a lie about what the chain exposes. */
export type Screen =
  | 'dashboard'
  | 'marketplace'
  /* Third-party projects building on Latch: /app/ecosystem. A curated file,
     not a chain read — see data/ecosystem.ts. */
  | 'ecosystem'
  | 'deploy'
  | 'pool'
  | 'portfolio'
  /* Revenue share, the operator's side: /app/protocol, /app/protocol/:poolId
     and /app/protocol/:poolId/epochs all belong to this screen, because
     `screenFromPath` matches on the FIRST path segment. */
  | 'protocol'
  /* Revenue share, the holder's side: /app/claim. */
  | 'claim'
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
  /** Real Sepolia head, polled. null while loading or if the chain is unreachable. */
  block: number | null
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
