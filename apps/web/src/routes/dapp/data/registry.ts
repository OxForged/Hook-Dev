/* ============================================================================
   LatchHookRegistry — the Hook Explorer's data model and its mock/live seam.

   THE REGISTRY IS NOT DEPLOYED. `packages/registry/src/LatchHookRegistry.sol`
   exists and is tested; it has no address on Sepolia or anywhere else. So this
   module is wired ahead: the shapes, the ABI and the decoding are all built
   against the real contract, and `registrySource()` returns the live viem-backed
   adapter the moment an address is configured. Until then it returns the
   ILLUSTRATIVE adapter, which is labelled as such everywhere it surfaces.

   WHAT COMES FROM THE CONTRACT AND WHAT DOES NOT
   ----------------------------------------------
   From `src/data/registry.generated.ts` (parsed out of the Solidity by
   scripts/sync-registry.mjs, cross-checked against the SDK's bitmap table):
   the bit layout, the masks, the enum orders, the ABI.

   From the chain, when an address is configured: `classify()`,
   `decodePermissions()`, `takesSwapCut()`, `canBlockSwaps()`,
   `canTrapLiquidity()` and `isAudited()` are CALLED, not reimplemented. They
   are pure or view, so they cost nothing and they are the contract's own answer.

   Mirrored here: the same four pure predicates, expressed in the same generated
   masks, for the one case where there is no chain to ask — the illustrative
   adapter. `assertMirrorAgrees()` re-checks the mirror against the chain's
   answer in dev, so the two can never quietly diverge.

   Editorial: what a bit MEANS for a user's money. That is prose, it cannot be
   derived, and it lives in `CALLBACK_COPY` below — keyed by the generated
   `HookCallback` union, so a new callback in the contract fails the build until
   somebody writes the sentence.
   ============================================================================ */

import {
  HOOK_CALLBACKS,
  HOOK_CALLBACK_BIT,
  PERM,
  RETURNS_DELTA_CALLBACKS,
  SWAP_CUT_CALLBACKS,
} from '../../../data/registry.generated.ts'
import type {
  HookCallback,
  Listing,
  RiskClass,
  Verification,
} from '../../../data/registry.generated.ts'
import { SDK_CHAINS } from '../../../data/chains.generated.ts'

export type { HookCallback, Listing, RiskClass, Verification }
export { HOOK_CALLBACKS, HOOK_CALLBACK_BIT, RETURNS_DELTA_CALLBACKS, SWAP_CUT_CALLBACKS }

/** A 20-byte address as a checksummable hex string. */
export type HexAddress = `0x${string}`

/** `decodePermissions()` expanded — every callback, present or absent. */
export type DecodedPermissions = Readonly<Record<HookCallback, boolean>>

/**
 * One registry record, flattened for rendering.
 *
 * Mirrors `HookRecord` plus the four derived predicates and the listing reason,
 * which lives only in the `HookListingChanged` log and not in storage.
 */
export interface HookListing {
  readonly address: HexAddress
  /** Submitter-supplied. Descriptive only — it certifies nothing. */
  readonly name: string
  readonly description: string
  readonly sourceURI: string
  readonly auditURI: string
  /** Chain ids the SUBMITTER claims. The registry marks these informational. */
  readonly claimedChainIds: readonly number[]
  readonly submitter: HexAddress
  readonly steward: HexAddress
  /** Unix seconds. */
  readonly submittedAt: number
  readonly updatedAt: number

  /** Read off the hook contract at registration. Never submitter-supplied. */
  readonly permissions: number
  /** False if a refresh saw reserved bits or an unmet returns-delta dependency. */
  readonly permissionsValid: boolean
  /** False if a refresh could no longer read the bitmap. `permissions` is then STALE. */
  readonly permissionsReadable: boolean
  readonly codehash: `0x${string}`

  readonly verification: Verification
  readonly listing: Listing

  /** `classify()`. Pure, on-chain, uncheatable. */
  readonly riskClass: RiskClass
  readonly decoded: DecodedPermissions
  /** `takesSwapCut()` — bits 10/11. Can take a cut of every swap in the pool. */
  readonly takesSwapCut: boolean
  /** `canBlockSwaps()` — bit 6. Can refuse trading outright. */
  readonly canBlockSwaps: boolean
  /** `canTrapLiquidity()` — bit 4. Can refuse withdrawals. */
  readonly canTrapLiquidity: boolean

  /**
   * `isAudited()` — "the single question a front end should ask before showing a
   * trust badge" (LatchHookRegistry.sol). False for a flagged hook, and false
   * when the permissions are unreadable or invalid, even at `Verification.Audited`.
   */
  readonly auditBadge: boolean

  /**
   * Reason string from the most recent `HookListingChanged`. Null when the log
   * was not read (or none exists). A `Malicious` listing without this is a
   * tombstone with no epitaph, so the live adapter reads logs to get it.
   */
  readonly listingReason: string | null
}

/* --------------------------------------------------------- callback semantics */

/** Callbacks whose bit is set in `mask`. Derived from the generated bit table. */
function callbacksIn(mask: number): readonly HookCallback[] {
  return HOOK_CALLBACKS.filter((name) => (mask & (1 << HOOK_CALLBACK_BIT[name])) !== 0)
}

/**
 * Exactly the condition `classify()` uses for `ValueExtracting`: a returns-delta
 * bit, or `beforeRemoveLiquidity`. Both end with a user unable to get their money out.
 */
export const FUNDS_CALLBACKS: readonly HookCallback[] = callbacksIn(
  PERM.PERM_RETURNS_DELTA_MASK | PERM.PERM_BEFORE_REMOVE_LIQUIDITY,
)

/** `before*` callbacks that hold a veto but cannot take value. */
export const VETO_ONLY_CALLBACKS: readonly HookCallback[] = callbacksIn(PERM.PERM_BEFORE_MASK).filter(
  (name) => !FUNDS_CALLBACKS.includes(name),
)

/** How much a single enabled bit should alarm someone. Derived, not curated. */
export type CallbackSeverity = 'funds' | 'control' | 'observe'

export function callbackSeverity(name: HookCallback): CallbackSeverity {
  if (FUNDS_CALLBACKS.includes(name)) return 'funds'
  if (VETO_ONLY_CALLBACKS.includes(name)) return 'control'
  return 'observe'
}

/**
 * What each bit lets the hook do, in the plainest words available.
 *
 * Keyed by the generated union, so this table cannot fall behind the contract.
 * Written for someone about to put money in a pool, not for a hook author.
 */
export const CALLBACK_COPY: Readonly<Record<HookCallback, string>> = {
  beforeInitialize: 'Can refuse to let a pool be created with this hook.',
  afterInitialize: 'Runs once when a pool is created. Observes only.',
  beforeAddLiquidity: 'Can refuse deposits — it decides who may become an LP.',
  afterAddLiquidity: 'Runs after a deposit. Observes only.',
  beforeRemoveLiquidity: 'CAN REFUSE WITHDRAWALS. Liquidity can be stranded in the pool.',
  afterRemoveLiquidity: 'Runs after a withdrawal. Observes only.',
  beforeSwap: 'Can block any trade in the pool. Trading exists at this hook’s discretion.',
  afterSwap: 'Runs after a trade. Observes only.',
  beforeDonate: 'Can refuse donations to the pool.',
  afterDonate: 'Runs after a donation. Observes only.',
  beforeSwapReturnsDelta: 'TAKES A CUT OF EVERY SWAP, before the trade is priced.',
  afterSwapReturnsDelta: 'TAKES A CUT OF EVERY SWAP, after the trade is priced.',
  afterAddLiquidityReturnsDelta: 'Takes a cut of every deposit.',
  afterRemoveLiquidityReturnsDelta: 'Takes a cut of every withdrawal.',
}

/** Short label for the bit strip. `beforeSwapReturnsDelta` -> `beforeSwap+Δ`. */
export function callbackShortLabel(name: HookCallback): string {
  return name.replace(/ReturnsDelta$/, '+Δ')
}

/* ------------------------------------------------- mirror of the pure functions */

/**
 * Local mirror of `LatchHookRegistry.classify()`, written in the generated masks
 * so it is the same expression the contract compiles. Used ONLY where there is
 * no chain to ask; the live adapter calls the real thing.
 */
export function mirrorClassify(permissions: number): RiskClass {
  if (
    (permissions & PERM.PERM_RETURNS_DELTA_MASK) !== 0 ||
    (permissions & PERM.PERM_BEFORE_REMOVE_LIQUIDITY) !== 0
  ) {
    return 'ValueExtracting'
  }
  if ((permissions & PERM.PERM_BEFORE_MASK) !== 0) return 'Restrictive'
  return 'Passive'
}

/** Local mirror of `decodePermissions()`. */
export function mirrorDecode(permissions: number): DecodedPermissions {
  const out = {} as Record<HookCallback, boolean>
  for (const name of HOOK_CALLBACKS) {
    out[name] = (permissions & (1 << HOOK_CALLBACK_BIT[name])) !== 0
  }
  return out
}

/** Local mirror of `takesSwapCut()`. */
export function mirrorTakesSwapCut(permissions: number): boolean {
  return (permissions & PERM.PERM_SWAP_CUT_MASK) !== 0
}

/** Local mirror of `canBlockSwaps()`. */
export function mirrorCanBlockSwaps(permissions: number): boolean {
  return (permissions & PERM.PERM_BEFORE_SWAP) !== 0
}

/** Local mirror of `canTrapLiquidity()`. */
export function mirrorCanTrapLiquidity(permissions: number): boolean {
  return (permissions & PERM.PERM_BEFORE_REMOVE_LIQUIDITY) !== 0
}

/** Local mirror of `isValidBitmap()`, for the reserved-bit / dependency check. */
export function mirrorIsValidBitmap(permissions: number): boolean {
  if ((permissions & PERM.PERM_RESERVED_BITS) !== 0) return false
  const pairs: ReadonlyArray<readonly [number, number]> = [
    [PERM.PERM_BEFORE_SWAP_RETURNS_DELTA, PERM.PERM_BEFORE_SWAP],
    [PERM.PERM_AFTER_SWAP_RETURNS_DELTA, PERM.PERM_AFTER_SWAP],
    [PERM.PERM_AFTER_ADD_LIQUIDITY_RETURNS_DELTA, PERM.PERM_AFTER_ADD_LIQUIDITY],
    [PERM.PERM_AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA, PERM.PERM_AFTER_REMOVE_LIQUIDITY],
  ]
  for (const [dependent, required] of pairs) {
    if ((permissions & dependent) !== 0 && (permissions & required) === 0) return false
  }
  return true
}

/**
 * Dev-only guard: the chain answered, so check the mirror said the same thing.
 * Three components describing one bitmap three ways is how users get misled; this
 * makes the second description prove itself against the first every time it runs.
 */
export function assertMirrorAgrees(listing: HookListing): void {
  if (!import.meta.env.DEV) return
  const p = listing.permissions
  const disagreements: string[] = []
  if (mirrorClassify(p) !== listing.riskClass) {
    disagreements.push(`classify: chain=${listing.riskClass} mirror=${mirrorClassify(p)}`)
  }
  if (mirrorTakesSwapCut(p) !== listing.takesSwapCut) disagreements.push('takesSwapCut')
  if (mirrorCanBlockSwaps(p) !== listing.canBlockSwaps) disagreements.push('canBlockSwaps')
  if (mirrorCanTrapLiquidity(p) !== listing.canTrapLiquidity) disagreements.push('canTrapLiquidity')
  const mirrored = mirrorDecode(p)
  for (const name of HOOK_CALLBACKS) {
    if (mirrored[name] !== listing.decoded[name]) disagreements.push(`decodePermissions.${name}`)
  }
  if (disagreements.length > 0) {
    console.error(
      `[registry] local mirror disagrees with the chain for ${listing.address} ` +
        `(bitmap ${formatBitmap(p)}): ${disagreements.join(', ')}. ` +
        'Regenerate src/data/registry.generated.ts.',
    )
  }
}

/** `0x08c0` — the bitmap as the contract stores it. */
export function formatBitmap(permissions: number): string {
  return `0x${(permissions & 0xffff).toString(16).padStart(4, '0')}`
}

/* --------------------------------------------------------------- presentation */

/**
 * Ordering. CAPABILITY FIRST, attestation second.
 *
 * A passive hook cannot take your money whether or not anyone audited it; a
 * value-extracting hook can, audit or no audit. So the risk class the contract
 * derived outranks the badge a curator granted, and recency does not appear at
 * all — "newest first" is a discovery ordering, and this is a safety surface.
 *
 * `Malicious` listings are not sorted into this at all. They are pulled out and
 * shown FIRST, because a tombstone that nobody scrolls to protects nobody — the
 * registry keeps them precisely so the warning survives.
 */
const RISK_RANK: Readonly<Record<RiskClass, number>> = {
  Passive: 0,
  Restrictive: 1,
  ValueExtracting: 2,
}

const LISTING_RANK: Readonly<Record<Listing, number>> = {
  Active: 0,
  Deprecated: 1,
  Malicious: 2,
}

function trustRank(listing: HookListing): number {
  if (listing.auditBadge) return 0
  if (listing.verification === 'SourceVerified') return 1
  return 2
}

export function compareBySafety(a: HookListing, b: HookListing): number {
  const byRisk = RISK_RANK[a.riskClass] - RISK_RANK[b.riskClass]
  if (byRisk !== 0) return byRisk
  const byListing = LISTING_RANK[a.listing] - LISTING_RANK[b.listing]
  if (byListing !== 0) return byListing
  const byTrust = trustRank(a) - trustRank(b)
  if (byTrust !== 0) return byTrust
  return a.name.localeCompare(b.name)
}

/** True when the registry's own capability read cannot be relied on. */
export function isPermissionsSuspect(listing: HookListing): boolean {
  return !listing.permissionsReadable || !listing.permissionsValid
}

export function isTombstone(listing: HookListing): boolean {
  return listing.listing === 'Malicious'
}

/** `0x1234…abcd`. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function formatTimestamp(unixSeconds: number): string {
  if (unixSeconds <= 0) return '—'
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/* --------------------------------------------------------------- filtering */

/** Risk facet. The registry has no categories, so the chips filter on what it has. */
export type RiskFilter = 'All' | RiskClass

/** Trust facet, kept on its own axis so it can never be read as a risk class. */
export type TrustFilter = 'Any' | 'Audited' | 'SourceVerified' | 'Unverified'

export interface ExplorerQuery {
  readonly risk: RiskFilter
  readonly trust: TrustFilter
  readonly text: string
}

function matchesTrust(listing: HookListing, trust: TrustFilter): boolean {
  switch (trust) {
    case 'Any':
      return true
    case 'Audited':
      return listing.auditBadge
    case 'SourceVerified':
      return listing.verification === 'SourceVerified'
    case 'Unverified':
      return listing.verification === 'Unverified'
  }
}

export function filterListings(
  listings: readonly HookListing[],
  query: ExplorerQuery,
): readonly HookListing[] {
  const q = query.text.trim().toLowerCase()
  return listings.filter((l) => {
    if (query.risk !== 'All' && l.riskClass !== query.risk) return false
    if (!matchesTrust(l, query.trust)) return false
    if (q === '') return true
    return (
      l.name.toLowerCase().includes(q) ||
      l.description.toLowerCase().includes(q) ||
      l.address.toLowerCase().includes(q) ||
      l.submitter.toLowerCase().includes(q) ||
      HOOK_CALLBACKS.some((name) => l.decoded[name] && name.toLowerCase().includes(q))
    )
  })
}

/* ------------------------------------------------------------ the mock/live seam */

/** Which of the two adapters produced a snapshot. Never inferred from the data. */
export type SourceKind = 'illustrative' | 'chain'

export interface SourceInfo {
  readonly kind: SourceKind
  /** Chip text. `SAMPLE DATA` matches the shell's existing truth-telling chip. */
  readonly chip: string
  /** One sentence a visitor can read to know what they are looking at. */
  readonly note: string
  readonly chainId: number | null
  readonly address: HexAddress | null
}

export interface RegistrySnapshot {
  readonly source: SourceInfo
  /** Every registered hook the adapter could read, unsorted. */
  readonly listings: readonly HookListing[]
  /** `hookCount()` — total registered, which may exceed what was fetched. */
  readonly total: number
  /** True when `listingReason` could not be sourced (no log read was possible). */
  readonly reasonsUnavailable: boolean
}

/** The seam. Two implementations: illustrative, and viem against a real address. */
export interface RegistryAdapter {
  readonly info: SourceInfo
  load(signal?: AbortSignal): Promise<RegistrySnapshot>
}

/* --------------------------------------------------------------- configuration */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export interface RegistryDeployment {
  readonly address: HexAddress
  readonly chainId: number
  readonly rpcUrl: string
  /** Block to scan `HookListingChanged` from. Registry deploy block, ideally. */
  readonly fromBlock: bigint
}

function envString(key: string): string | null {
  const raw: unknown = import.meta.env[key]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The registry's address, if somebody has deployed one and pointed us at it.
 *
 * Deployment is a CONFIG CHANGE, not a code change:
 *   VITE_HOOK_REGISTRY_ADDRESS=0x…      (required)
 *   VITE_HOOK_REGISTRY_CHAIN_ID=11155111 (required)
 *   VITE_HOOK_REGISTRY_RPC_URL=…         (optional; defaults to the SDK's endpoint)
 *   VITE_HOOK_REGISTRY_FROM_BLOCK=…      (optional; bounds the log scan)
 *
 * A malformed value returns null and falls back to the illustrative adapter
 * rather than throwing, because a typo in an env var must not be able to make
 * mock rows appear under a "live" label — the fallback is the labelled one.
 */
export function configuredRegistry(): RegistryDeployment | null {
  const address = envString('VITE_HOOK_REGISTRY_ADDRESS')
  const chainIdRaw = envString('VITE_HOOK_REGISTRY_CHAIN_ID')
  if (address === null || chainIdRaw === null) return null
  if (!ADDRESS_RE.test(address)) {
    console.error(`[registry] VITE_HOOK_REGISTRY_ADDRESS is not an address: ${address}`)
    return null
  }
  const chainId = Number(chainIdRaw)
  if (!Number.isInteger(chainId) || chainId <= 0) {
    console.error(`[registry] VITE_HOOK_REGISTRY_CHAIN_ID is not a chain id: ${chainIdRaw}`)
    return null
  }
  const configuredRpc = envString('VITE_HOOK_REGISTRY_RPC_URL')
  const sdkChain = SDK_CHAINS.find((c) => c.chainId === chainId)
  const rpcUrl = configuredRpc ?? sdkChain?.fastestEndpoint ?? ''
  if (rpcUrl === '') {
    console.error(`[registry] no RPC endpoint for chain ${chainId}; set VITE_HOOK_REGISTRY_RPC_URL`)
    return null
  }
  const fromBlockRaw = envString('VITE_HOOK_REGISTRY_FROM_BLOCK')
  let fromBlock = 0n
  if (fromBlockRaw !== null) {
    try {
      fromBlock = BigInt(fromBlockRaw)
    } catch {
      console.error(`[registry] VITE_HOOK_REGISTRY_FROM_BLOCK is not a number: ${fromBlockRaw}`)
    }
  }
  return { address: address as HexAddress, chainId, rpcUrl, fromBlock }
}

export const ILLUSTRATIVE_SOURCE: SourceInfo = {
  kind: 'illustrative',
  chip: 'SAMPLE DATA',
  note:
    'LatchHookRegistry is not deployed on any chain. The rows below are illustrative ' +
    'examples of what the explorer renders, not registry listings — the names are ' +
    'placeholders and the addresses are not real contracts.',
  chainId: null,
  address: null,
}
