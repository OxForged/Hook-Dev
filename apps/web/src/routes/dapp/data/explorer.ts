/* ============================================================================
   Hook Explorer data — SCREENS.md § C2.
   MOCK SEAM: `loadExplorer()`. Placeholder registry entries; no chain is read.
   ============================================================================ */

import type { Filter } from './types.ts'

export type LatchStatus = 'VERIFIED' | 'AUDITED' | 'REVIEW'

export interface Latch {
  name: string
  author: string
  status: LatchStatus
  desc: string
  hooks: string[]
  tvl: string
  calls: string
  gas: string
  /** SCREENS.md § C2 filter mapping. */
  categories: Exclude<Filter, 'All'>[]
}

export interface ExplorerData {
  searchPlaceholder: string
  filters: Filter[]
  latches: Latch[]
}

export function loadExplorer(): ExplorerData {
  return {
    searchPlaceholder: 'Search latches, authors, pools…',
    filters: ['All', 'DeFi', 'NFT', 'Gaming', 'RWA'],
    latches: [
      {
        name: 'DynamicFeeLatch',
        author: 'latch-labs.eth',
        status: 'VERIFIED',
        desc: 'Adjusts pool fees from realised volatility every block.',
        hooks: ['beforeSwap', 'afterSwap'],
        tvl: '$14.2M',
        calls: '182K',
        gas: '8.4k',
        categories: ['DeFi'],
      },
      {
        name: 'JITLatch',
        author: '0x4a1c…88de',
        status: 'VERIFIED',
        desc: 'Just-in-time liquidity provisioning around large swaps.',
        hooks: ['beforeSwap'],
        tvl: '$9.8M',
        calls: '64K',
        gas: '12.1k',
        categories: ['DeFi'],
      },
      {
        name: 'KYCGateLatch',
        author: 'compliance.eth',
        status: 'AUDITED',
        desc: 'Blocks transfers from addresses outside an allowlist root.',
        hooks: ['beforeAddLiquidity'],
        tvl: '$6.1M',
        calls: '9.2K',
        gas: '5.7k',
        categories: ['RWA'],
      },
      {
        name: 'RewardLatch',
        author: 'guildworks.eth',
        status: 'REVIEW',
        desc: 'Streams game rewards on swap volume thresholds.',
        hooks: ['afterSwap', 'afterDonate'],
        tvl: '$2.4M',
        calls: '27K',
        gas: '9.9k',
        categories: ['Gaming'],
      },
      {
        name: 'OracleLatch',
        author: '0x71c2…9ef4',
        status: 'VERIFIED',
        desc: 'Publishes TWAP updates as a side effect of pool activity.',
        hooks: ['afterSwap'],
        tvl: '$5.6M',
        calls: '41K',
        gas: '7.2k',
        categories: ['DeFi'],
      },
      {
        name: 'NFTMintLatch',
        author: 'studio.eth',
        status: 'REVIEW',
        desc: 'Mints a receipt NFT for liquidity positions above a size.',
        hooks: ['afterAddLiquidity'],
        tvl: '$1.1M',
        calls: '3.8K',
        gas: '18.4k',
        categories: ['NFT'],
      },
    ],
  }
}

/** Category chips + free-text search, applied client-side over the mock list. */
export function filterLatches(latches: Latch[], filter: Filter, query: string): Latch[] {
  const q = query.trim().toLowerCase()
  return latches.filter((l) => {
    const inCategory = filter === 'All' || l.categories.includes(filter)
    if (!inCategory) return false
    if (!q) return true
    return (
      l.name.toLowerCase().includes(q) ||
      l.author.toLowerCase().includes(q) ||
      l.desc.toLowerCase().includes(q) ||
      l.hooks.some((h) => h.toLowerCase().includes(q))
    )
  })
}
