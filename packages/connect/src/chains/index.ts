/* ============================================================================
   The Latch chain list.

   Eleven OFFERED chains, all from wagmi's curated registry, re-exported through
   `./definitions.ts` with one field replaced: `rpcUrls.default.http`, which
   carries the probed, ordered, redundant endpoint list instead of wagmi's one-
   to-three defaults.

   Ten mainnets: Ethereum, Base, BNB Smart Chain, Linea, Ink, X Layer, HyperEVM,
   Monad, Plasma, Stable. ONE testnet: Ethereum Sepolia.

   ---------------------------------------------------------------------------
   WHY ONLY ONE TESTNET, AND WHERE THE OTHER THREE WENT
   ---------------------------------------------------------------------------

   Monad Testnet (10143), Stable Testnet (2201) and Arc Testnet (5042002) are no
   longer offered. Latch has no contracts on any of them and no plan to deploy
   to a testnet other than Sepolia, so every one of them was a row in the chain
   switcher that could only ever lead somewhere empty — and, unlike a mainnet,
   with no roadmap value to justify the row. Sepolia is the one testnet a Latch
   user has a reason to be on: it is where the contracts actually are.

   Their `defineChain` entries were NOT deleted. `./definitions.ts` still defines
   and exports all three, and this module still re-exports them, for two reasons:

     1. Their RPC endpoints were genuinely probed — live `eth_chainId` and three
        `eth_blockNumber` calls per URL, ordered by median latency. Deleting that
        throws away measured work that would have to be redone the day one of
        them is wanted again.
     2. They are part of this package's published surface. Removing the exports
        would be a breaking change to an MIT package other people build against,
        for no benefit — an integrator who deliberately wants Monad Testnet can
        still pass it to `createLatchConfig({ chains: [...] })`.

   What changed is only which chains this package OFFERS by default. They are
   collected in `LATCH_UNLISTED_CHAINS` so that fact is explicit and greppable
   rather than an absence you have to notice.

   ---------------------------------------------------------------------------

   Arc MAINNET (5042) is absent for a different reason: wagmi ships it, but it
   has no public RPC. See the header of `./definitions.ts`.

   IMPORTANT — presence here means "EIP-1153 verified target", NOT "Latch is
   live". Latch Protocol is deployed on Ethereum Sepolia and nowhere else.
   `LATCH_DEPLOYED_CHAIN_IDS` is the list a write path may actually use.
   ============================================================================ */

import type { Chain } from 'viem'

import {
  arcTestnet,
  base,
  bsc,
  hyperEvm,
  ink,
  linea,
  mainnet,
  monad,
  monadTestnet,
  plasma,
  sepolia,
  robinhood,
  stable,
  stableTestnet,
  xLayer,
} from './definitions.js'

export {
  arcTestnet,
  base,
  bsc,
  hyperEvm,
  ink,
  linea,
  mainnet,
  monad,
  monadTestnet,
  plasma,
  robinhood,
  sepolia,
  stable,
  stableTestnet,
  xLayer,
  LATCH_PUBLIC_RPCS,
  SINGLE_ENDPOINT_CHAIN_IDS,
  THIN_ENDPOINT_CHAIN_IDS,
  UNVERIFIED_CHAIN_METADATA,
} from './definitions.js'

/** Latch target chains that are mainnets. */
export const LATCH_MAINNET_CHAINS = [
  // First in the list because it is the stated first mainnet deploy target.
  robinhood,
  mainnet,
  base,
  bsc,
  linea,
  ink,
  xLayer,
  hyperEvm,
  monad,
  plasma,
  stable,
] as const satisfies readonly Chain[]

/**
 * Latch target chains that are testnets.
 *
 * Sepolia alone — it is the only testnet with a Latch deployment. See the
 * header of this file for the three that were removed and why their definitions
 * were kept.
 */
export const LATCH_TESTNET_CHAINS = [sepolia] as const satisfies readonly Chain[]

/**
 * Every Latch target chain.
 *
 * Typed as a non-empty tuple because that is what wagmi's `createConfig` and
 * RainbowKit's `getDefaultConfig` require for `chains`.
 */
export const LATCH_CHAINS = [
  ...LATCH_MAINNET_CHAINS,
  ...LATCH_TESTNET_CHAINS,
] as unknown as readonly [Chain, ...Chain[]]

/**
 * Chains this package defines and has probed, but deliberately does not offer.
 *
 * Not in `LATCH_CHAINS`, so no default config, switcher or transport touches
 * them. Exported so the omission is a documented decision rather than a silent
 * gap, and so an integrator who wants one can opt in by hand:
 *
 * ```ts
 * import { LATCH_CHAINS, monadTestnet } from '@latchprotocol/connect/chains'
 * createLatchConfig({ chains: [...LATCH_CHAINS, monadTestnet] })
 * ```
 *
 * Their `rpcUrls` are the same probed, fastest-first lists as everything in
 * `LATCH_CHAINS`; the only thing they lack is a reason for a Latch user to be
 * on them.
 */
export const LATCH_UNLISTED_CHAINS = [
  monadTestnet,
  stableTestnet,
  arcTestnet,
] as const satisfies readonly Chain[]

/**
 * The only chain Latch contracts are actually deployed on today.
 *
 * A write path must check against this, not against `LATCH_CHAINS`. Sending a
 * transaction to a Latch address on a chain with no deployment burns gas on a
 * call to an empty account, which succeeds silently rather than reverting.
 */
export const LATCH_DEPLOYED_CHAIN_IDS: readonly number[] = [sepolia.id]

/** Default chain for a fresh session: the one chain with live contracts. */
export const LATCH_DEFAULT_CHAIN: Chain = sepolia

/** Lookup by id across the whole Latch list. */
export function latchChainById(chainId: number): Chain | undefined {
  return LATCH_CHAINS.find((c) => c.id === chainId)
}

/** True when Latch contracts exist on `chainId`. */
export function isLatchDeployedChain(chainId: number): boolean {
  return LATCH_DEPLOYED_CHAIN_IDS.includes(chainId)
}
