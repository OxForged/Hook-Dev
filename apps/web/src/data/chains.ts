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

import { LATCH_DEPLOYMENTS, type ContractKey, type LatchChainId } from '@latchprotocol/sdk'

import { ACTIVE_CHAIN_ID } from '../lib/chain'

/* ---------------------------------------------------------------- deployment */

export interface DeployedContract {
  readonly name: string
  readonly address: string
}

/**
 * Display names for the address-book keys this surface shows.
 *
 * THE ADDRESSES ARE NOT HERE. They come from `LATCH_DEPLOYMENTS` in the SDK,
 * which is the single source of truth, so a redeploy is one edit there and this
 * file follows. It did not used to be: both lists below were hardcoded hex, and
 * on 2026-09-13 the fee controller was replaced and this file kept rendering the
 * retired one — a screen telling readers to go and inspect a contract that
 * governance had already abandoned. That is the exact failure the address book
 * exists to prevent, and restating an address anywhere defeats it.
 *
 * What stays curated is WHICH keys each chain shows, below — a judgement about
 * what a reader should be told, not a fact about where a contract lives.
 */
const CONTRACT_LABELS: Partial<Record<ContractKey, string>> = {
  vault: 'Vault',
  clPoolManager: 'CLPoolManager',
  binPoolManager: 'BinPoolManager',
  clPoolManagerOwner: 'CLPoolManagerOwner',
  binPoolManagerOwner: 'BinPoolManagerOwner',
  feeController: 'LatchProtocolFeeControllerV2',
  registry: 'LatchRegistry',
  revShareHook: 'RevShareHook',
  timelockCustody: 'LatchTimelock · custody 48h',
  launchRegistry: 'LatchLaunchRegistry',
  launchGuardHook: 'LaunchGuardHook',
  launchpadKit: 'LaunchpadKit',
  universalRouter: 'UniversalRouter',
  clPositionManager: 'CLPositionManager',
  binPositionManager: 'BinPositionManager',
  create3Factory: 'Create3Factory',
}

/**
 * Sepolia shows the core only, and that is deliberate rather than an oversight.
 *
 * The timelocks own nothing there, so listing them would imply a governance
 * model that is not in force. The same reasoning keeps the launchpad and the
 * revenue-share hook off this list: what a reader learns from a Sepolia address
 * is "the code deploys", not "this is how Latch is governed".
 */
const SEPOLIA_KEYS: readonly ContractKey[] = [
  'vault',
  'clPoolManager',
  'binPoolManager',
  'feeController',
  'create3Factory',
]

/**
 * Robinhood Chain — the FIRST MAINNET, live 2026-09-11, every contract verified
 * on Sourcify (see `ops/safe/robinhood-deployment.md`).
 *
 * Longer than the Sepolia list on purpose: this is the full protocol, and the
 * governance contracts are listed because here they are load-bearing.
 */
const ROBINHOOD_KEYS: readonly ContractKey[] = [
  'vault',
  'clPoolManager',
  'binPoolManager',
  'clPoolManagerOwner',
  'binPoolManagerOwner',
  'feeController',
  'registry',
  'revShareHook',
  'timelockCustody',
  'launchRegistry',
  'launchGuardHook',
  'launchpadKit',
  'universalRouter',
  'clPositionManager',
  'binPositionManager',
  'create3Factory',
]

/**
 * Resolve keys to addresses against the SDK book, in the order given.
 *
 * A key whose address is `null` is DROPPED rather than rendered. `null` in the
 * address book means "not deployed on this chain" and never the zero address —
 * so a contract that does not exist yet simply does not appear, instead of
 * appearing as a link to nothing.
 */
function contractsFor(chainId: LatchChainId, keys: readonly ContractKey[]): readonly DeployedContract[] {
  const deployment = LATCH_DEPLOYMENTS[chainId]
  return keys.flatMap((key) => {
    const address = deployment[key]
    if (!address) return []
    return [{ name: CONTRACT_LABELS[key] ?? key, address }]
  })
}

export const SEPOLIA_CONTRACTS: readonly DeployedContract[] = contractsFor(11155111, SEPOLIA_KEYS)

export const ROBINHOOD_CONTRACTS: readonly DeployedContract[] = contractsFor(4663, ROBINHOOD_KEYS)

export const SEPOLIA_CHAIN_ID = 11155111
export const ROBINHOOD_CHAIN_ID = 4663

/** Which contracts exist on a chain. Empty means "Latch is not deployed here". */
const CONTRACTS_BY_CHAIN: Record<number, readonly DeployedContract[]> = {
  [SEPOLIA_CHAIN_ID]: SEPOLIA_CONTRACTS,
  [ROBINHOOD_CHAIN_ID]: ROBINHOOD_CONTRACTS,
}

/** Block-explorer address link, where we have a verified explorer for the chain.
    Returns null rather than guessing a URL pattern: a dead explorer link reads
    as "this contract does not exist", which is worse than no link. */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (chainId === SEPOLIA_CHAIN_ID) return `https://sepolia.etherscan.io/address/${address}`
  if (chainId === ROBINHOOD_CHAIN_ID) {
    return `https://robinhoodchain.blockscout.com/address/${address}`
  }
  return null
}

/* --------------------------------------------------------------------- rows */

export interface ChainRow extends SdkChain {
  readonly brand: ChainBrand
  /** True only where Latch contracts are live. Today: Robinhood and Sepolia. */
  readonly deployed: boolean
  readonly contracts: readonly DeployedContract[]
}

function toRow(chain: SdkChain): ChainRow {
  /* Derived from the contract table rather than a hardcoded chain id, so
     adding a deployment is one edit instead of two that can disagree. */
  const contracts = CONTRACTS_BY_CHAIN[chain.chainId] ?? []
  return {
    ...chain,
    brand: BRANDS[BRAND_OF[chain.key]],
    deployed: contracts.length > 0,
    contracts,
  }
}

export const CHAIN_ROWS: readonly ChainRow[] = SDK_CHAINS.map(toRow)

/** Chains this BUILD presents as deployed — exactly the one network it serves.
    A mainnet site listing Sepolia contracts is a testnet address under mainnet
    chrome, which is the same class of error as an invented figure: it reads as
    authoritative and is not. The Sepolia site is a separate build of the same
    codebase (`VITE_NETWORK=testnet`). */
export const DEPLOYED_CHAINS: readonly ChainRow[] = CHAIN_ROWS.filter(
  (c) => c.deployed && c.chainId === ACTIVE_CHAIN_ID,
)

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

/** The row for the one chain this build reads (`ACTIVE_CHAIN_ID`). Throws at
    module load if the generated list lacks it, rather than labelling reads
    with some other chain's name. */
export const ACTIVE_CHAIN_ROW: ChainRow = (() => {
  const row = CHAIN_ROWS.find((r) => r.chainId === ACTIVE_CHAIN_ID)
  if (!row) throw new Error(`chains.generated.ts has no row for the build's chain ${ACTIVE_CHAIN_ID}`)
  return row
})()

export type { ChainKey, ChainNetwork, SdkChain }
