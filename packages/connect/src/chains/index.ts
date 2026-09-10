/* ============================================================================
   The Latch chain list.

   Fourteen chains, matching `packages/sdk/src/chains/endpoints.ts` exactly — the
   same fourteen the web app renders from `chains.generated.ts`. All of them come
   from wagmi's curated registry, re-exported through `./definitions.ts` with one
   field replaced: `rpcUrls.default.http`, which carries the probed, ordered,
   redundant endpoint list instead of wagmi's one-to-three defaults.

   Ten mainnets: Ethereum, Base, BNB Smart Chain, Linea, Ink, X Layer, HyperEVM,
   Monad, Plasma, Stable. Four testnets: Sepolia, Monad Testnet, Stable Testnet,
   Arc Testnet.

   Arc MAINNET (5042) is absent on purpose: wagmi ships it, but it has no public
   RPC. See the header of `./definitions.ts`.

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

/** Latch target chains that are testnets. */
export const LATCH_TESTNET_CHAINS = [
  sepolia,
  monadTestnet,
  stableTestnet,
  arcTestnet,
] as const satisfies readonly Chain[]

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
