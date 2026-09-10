/* ============================================================================
   Chain list for every web surface.

   The LIST itself is not written here — it is generated into
   `./chains.generated.ts` from `packages/sdk/src/chains/endpoints.ts`
   (`CHAIN_RPCS`) by `scripts/sync-chains.mjs`, so the UI cannot drift from the
   SDK. Fourteen chains, each one verified by executing a live TSTORE probe.

   Arc mainnet (5042) is deliberately absent. It is live, but it has no public
   RPC — Circle's own mainnet hosts answer 401/403, and thirdweb's gateway
   answers `eth_chainId` from a config table while failing every
   `eth_blockNumber`. It could not be probed, so it is not claimed as a supported
   target. Only Arc Testnet (5042002) is listed.

   What IS written here is the part the SDK cannot know:

     1. Deployment status. Latch Protocol is deployed on Ethereum Sepolia and
        NOWHERE ELSE. Every other chain is a *target* — EIP-1153 verified, no
        contracts. The UI must show that difference rather than imply eleven
        live networks.

     2. Brand marks. Which chains we hold an official logo for, and which fall
        back to a typographic monogram built from the design tokens. A monogram
        is an honest placeholder; an approximated logo would be a fake.
   ============================================================================ */

import type { ChainKey, ChainNetwork, SdkChain } from './chains.generated.ts'
import { SDK_CHAINS } from './chains.generated.ts'

/* --------------------------------------------------------------- brand marks */

export interface ChainBrand {
  /** The brand's own name — what the mark actually depicts. */
  readonly name: string
  /**
   * Path under `public/` to an OFFICIAL mark, or `null` when one could not be
   * sourced. Never a redrawn approximation: see public/chains/SOURCES.md for the
   * provenance of every file below.
   */
  readonly logo: string | null
  /** Typographic fallback, used only when `logo` is null. */
  readonly monogram: string
}

/**
 * Brand keys are deliberately coarser than chain keys: a testnet carries its
 * mainnet's mark, because that is the mark that network actually uses.
 */
type BrandKey =
  | 'ethereum'
  | 'robinhood'
  | 'base'
  | 'bnb'
  | 'linea'
  | 'ink'
  | 'xlayer'
  | 'hyperevm'
  | 'monad'
  | 'plasma'
  | 'stable'
  | 'arc'

/**
 * Every mark below is an official file, downloaded as-is from the network's own
 * brand kit or its official GitHub org — never redrawn, recoloured or traced.
 * Provenance for each one is recorded in `public/chains/SOURCES.md`. A chain with
 * no sourceable official mark keeps `logo: null` and falls back to a monogram; an
 * approximated one would be a fake — see the note on `ChainBrand.logo`.
 */
const BRANDS: Record<BrandKey, ChainBrand> = {
  ethereum: { name: 'Ethereum', logo: '/chains/ethereum.svg', monogram: 'Ξ' },
  base: { name: 'Base', logo: '/chains/base.svg', monogram: 'B' },
  bnb: { name: 'BNB Chain', logo: '/chains/bnb.svg', monogram: 'BNB' },
  linea: { name: 'Linea', logo: '/chains/linea.svg', monogram: 'LIN' },
  ink: { name: 'Ink', logo: '/chains/ink.svg', monogram: 'INK' },
  xlayer: { name: 'X Layer', logo: '/chains/xlayer.svg', monogram: 'XL' },
  hyperevm: { name: 'Hyperliquid', logo: '/chains/hyperevm.svg', monogram: 'HL' },
  monad: { name: 'Monad', logo: '/chains/monad.svg', monogram: 'M' },
  plasma: { name: 'Plasma', logo: '/chains/plasma.svg', monogram: 'PL' },
  stable: { name: 'Stable', logo: '/chains/stable.svg', monogram: 'S' },
  arc: { name: 'Arc', logo: '/chains/arc.svg', monogram: 'ARC' },
  /**
   * No official mark sourced yet, so this is deliberately a monogram.
   * `public/chains/SOURCES.md` only admits assets taken as-is from the network's own
   * site, CDN or GitHub org — drawing an approximation of somebody's logo would
   * misrepresent them, and an aggregator's copy is not a source. Add the file and
   * swap `logo` when Robinhood publishes a brand kit.
   */
  robinhood: { name: 'Robinhood Chain', logo: null, monogram: 'RH' },
}

/** Exhaustive by construction: adding a chain to the SDK breaks this until mapped. */
const BRAND_OF: Record<ChainKey, BrandKey> = {
  ethereum: 'ethereum',
  base: 'base',
  bsc: 'bnb',
  linea: 'linea',
  ink: 'ink',
  xlayer: 'xlayer',
  hyperevm: 'hyperevm',
  monad: 'monad',
  monadTestnet: 'monad',
  plasma: 'plasma',
  robinhood: 'robinhood',
  stable: 'stable',
  sepolia: 'ethereum',
  stableTestnet: 'stable',
  arcTestnet: 'arc',
}

/* ---------------------------------------------------------------- deployment */

export interface DeployedContract {
  readonly name: string
  readonly address: string
}

/**
 * The only Latch deployment that exists. Verified on Sepolia Etherscan.
 * Do not add a chain here until its contracts are live and verified.
 */
export const SEPOLIA_CONTRACTS: readonly DeployedContract[] = [
  { name: 'Vault', address: '0xCe3d133eb486b448A53437A5073619FbE424d01B' },
  { name: 'CLPoolManager', address: '0xb7C8a11E0B359616eD06256783aF57114841F738' },
  { name: 'BinPoolManager', address: '0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3' },
  { name: 'LatchProtocolFeeController', address: '0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9' },
  { name: 'Create3Factory', address: '0x76473D174Aa17C23FBE49CAb50aAc4ED4d8c678F' },
]

/** Ethereum Sepolia — the one chain Latch is actually deployed on. */
export const SEPOLIA_CHAIN_ID = 11155111

/** Block-explorer address link, where we have a verified explorer for the chain. */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (chainId === SEPOLIA_CHAIN_ID) return `https://sepolia.etherscan.io/address/${address}`
  return null
}

/* --------------------------------------------------------------------- rows */

export interface ChainRow extends SdkChain {
  readonly brand: ChainBrand
  /** True only where Latch contracts are live. Today: Sepolia alone. */
  readonly deployed: boolean
  readonly contracts: readonly DeployedContract[]
}

function toRow(chain: SdkChain): ChainRow {
  const deployed = chain.chainId === SEPOLIA_CHAIN_ID
  return {
    ...chain,
    brand: BRANDS[BRAND_OF[chain.key]],
    deployed,
    contracts: deployed ? SEPOLIA_CONTRACTS : [],
  }
}

export const CHAIN_ROWS: readonly ChainRow[] = SDK_CHAINS.map(toRow)

export const MAINNET_CHAINS: readonly ChainRow[] = CHAIN_ROWS.filter(
  (c) => c.network === 'mainnet',
)

export const TESTNET_CHAINS: readonly ChainRow[] = CHAIN_ROWS.filter(
  (c) => c.network === 'testnet',
)

/* Keyed lookup. The assertion is safe by construction — CHAIN_ROWS is built from
   the generated list, and ChainKey is that same list's key union — and it buys a
   total function, so callers holding a ChainKey never handle a phantom miss. */
const ROW_BY_KEY: Record<ChainKey, ChainRow> = (() => {
  const out = {} as Record<ChainKey, ChainRow>
  for (const row of CHAIN_ROWS) out[row.key] = row
  return out
})()

export function chainByKey(key: ChainKey): ChainRow {
  return ROW_BY_KEY[key]
}

export type { ChainKey, ChainNetwork, SdkChain }
