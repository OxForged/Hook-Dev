/* ============================================================================
   Illustrative registry adapter — NOT LISTINGS.

   LatchHookRegistry is deployed nowhere, so there is nothing to read. Rather
   than leave the explorer blank, this adapter returns a handful of DELIBERATELY
   FICTIONAL records whose only purpose is to show what each state of the real
   surface looks like: an audited passive hook, an unverified hook that takes a
   cut of every swap, a deprecated one that can refuse withdrawals, a malicious
   tombstone, and one whose bitmap has become unreadable.

   Two rules this file follows so it cannot be mistaken for real data:

     1. No plausible project names. Every `name` starts with "Example" and says
        what the row demonstrates. Nothing here could be confused with a hook
        somebody actually shipped.
     2. No plausible addresses. Every address is `0xEEEE…` with a counter — a
        pattern no deployment produces.

   And one rule that keeps it honest about the CONTRACT: nothing below states a
   risk class, a decoded permission or an audit badge directly. Each row declares
   a bitmap and the curated fields a curator would have set, and every derived
   field is computed by the mirrors of the contract's own pure functions. A row
   here therefore cannot claim a capability its bitmap does not carry.
   ============================================================================ */

import { HOOK_CALLBACK_BIT } from '../../../data/registry.generated.ts'
import type { HookCallback, Listing, Verification } from '../../../data/registry.generated.ts'
import {
  ILLUSTRATIVE_SOURCE,
  mirrorCanBlockSwaps,
  mirrorCanTrapLiquidity,
  mirrorClassify,
  mirrorDecode,
  mirrorTakesSwapCut,
} from './registry.ts'
import type { HexAddress, HookListing, RegistryAdapter, RegistrySnapshot } from './registry.ts'

/** Obviously synthetic. No deployment produces an address shaped like this. */
function exampleAddress(index: number): HexAddress {
  return `0xEeEe${index.toString(16).padStart(36, '0')}` as HexAddress
}

const EXAMPLE_SUBMITTER = '0xEeEe000000000000000000000000000000005ub' as HexAddress
const DAY = 86_400

interface ExampleSpec {
  readonly name: string
  readonly description: string
  readonly callbacks: readonly HookCallback[]
  readonly verification: Verification
  readonly listing: Listing
  readonly listingReason?: string
  readonly sourceURI?: string
  readonly auditURI?: string
  /** Defaults true. False means a refresh could no longer read the bitmap. */
  readonly permissionsReadable?: boolean
  /** Defaults true. False means reserved bits or a broken dependency were seen. */
  readonly permissionsValid?: boolean
  readonly ageDays: number
}

/**
 * One example per state the real surface has to render. Ordering here is
 * deliberately arbitrary — the explorer sorts by safety, and leaving these in a
 * flattering order would hide whether that sort works.
 */
const EXAMPLES: readonly ExampleSpec[] = [
  {
    name: 'Example — unverified swap-cut hook',
    description:
      'Illustrates the worst common case: a hook nobody has vouched for that holds ' +
      'beforeSwapReturnsDelta, so it can take a share of every trade in its pool.',
    callbacks: ['beforeSwap', 'afterSwap', 'beforeSwapReturnsDelta'],
    verification: 'Unverified',
    listing: 'Active',
    ageDays: 3,
  },
  {
    name: 'Example — audited observer',
    description:
      'Illustrates the safest shape a hook can have: only after* callbacks, none of ' +
      'them returning a delta. It can read pool activity and it cannot touch funds.',
    callbacks: ['afterInitialize', 'afterSwap'],
    verification: 'Audited',
    listing: 'Active',
    sourceURI: 'https://example.invalid/source',
    auditURI: 'https://example.invalid/audit-report',
    ageDays: 240,
  },
  {
    name: 'Example — flagged hook (tombstone)',
    description:
      'Illustrates what the registry keeps forever instead of deleting. Flagging ' +
      'stripped this record’s verification in the same transaction.',
    callbacks: ['beforeSwap', 'afterSwap', 'beforeSwapReturnsDelta', 'afterSwapReturnsDelta'],
    verification: 'Unverified',
    listing: 'Malicious',
    listingReason:
      'Illustrative reason string. On a real listing this is what the curator or ' +
      'guardian wrote when they flagged the hook, and it is the whole point of ' +
      'keeping the record rather than deleting it.',
    ageDays: 61,
  },
  {
    name: 'Example — source-verified allowlist gate',
    description:
      'Illustrates a restrictive hook: it can refuse deposits and refuse trades, but ' +
      'it holds no returns-delta bit, so it cannot take a cut of either.',
    callbacks: ['beforeAddLiquidity', 'beforeSwap'],
    verification: 'SourceVerified',
    listing: 'Active',
    sourceURI: 'https://example.invalid/source',
    ageDays: 120,
  },
  {
    name: 'Example — deprecated withdrawal gate',
    description:
      'Illustrates why beforeRemoveLiquidity classifies as value-extracting even with ' +
      'no delta bit: a hook that can refuse withdrawals strands funds just as surely.',
    callbacks: ['beforeRemoveLiquidity', 'afterRemoveLiquidity'],
    verification: 'SourceVerified',
    listing: 'Deprecated',
    listingReason: 'Illustrative reason string. Superseded — not an accusation.',
    sourceURI: 'https://example.invalid/source',
    ageDays: 400,
  },
  {
    name: 'Example — audit badge withheld (bitmap unreadable)',
    description:
      'Illustrates isAudited() returning false at Verification.Audited: a refresh could ' +
      'no longer read this hook’s bitmap, so the permissions shown are the last ones ' +
      'seen and no badge may be shown over them.',
    callbacks: ['afterSwap', 'afterSwapReturnsDelta'],
    verification: 'Audited',
    listing: 'Active',
    sourceURI: 'https://example.invalid/source',
    auditURI: 'https://example.invalid/audit-report',
    permissionsReadable: false,
    ageDays: 180,
  },
  {
    name: 'Example — unverified observer',
    description:
      'Illustrates that unverified is not the same as dangerous, and audited is not the ' +
      'same as harmless: this hook holds fewer powers than the audited rows above it.',
    callbacks: ['afterSwap'],
    verification: 'Unverified',
    listing: 'Active',
    ageDays: 12,
  },
]

function bitmapOf(callbacks: readonly HookCallback[]): number {
  let bitmap = 0
  for (const name of callbacks) bitmap |= 1 << HOOK_CALLBACK_BIT[name]
  return bitmap
}

/** Mirrors `isAudited()` exactly — including the two conditions people forget. */
function auditBadgeOf(spec: ExampleSpec): boolean {
  return (
    spec.verification === 'Audited' &&
    spec.listing === 'Active' &&
    (spec.permissionsReadable ?? true) &&
    (spec.permissionsValid ?? true)
  )
}

function toListing(spec: ExampleSpec, index: number, now: number): HookListing {
  const permissions = bitmapOf(spec.callbacks)
  const submittedAt = now - spec.ageDays * DAY
  return {
    address: exampleAddress(index + 1),
    name: spec.name,
    description: spec.description,
    sourceURI: spec.sourceURI ?? '',
    auditURI: spec.auditURI ?? '',
    claimedChainIds: [],
    submitter: EXAMPLE_SUBMITTER,
    steward: EXAMPLE_SUBMITTER,
    submittedAt,
    updatedAt: submittedAt,
    permissions,
    permissionsValid: spec.permissionsValid ?? true,
    permissionsReadable: spec.permissionsReadable ?? true,
    codehash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    verification: spec.verification,
    listing: spec.listing,
    riskClass: mirrorClassify(permissions),
    decoded: mirrorDecode(permissions),
    takesSwapCut: mirrorTakesSwapCut(permissions),
    canBlockSwaps: mirrorCanBlockSwaps(permissions),
    canTrapLiquidity: mirrorCanTrapLiquidity(permissions),
    auditBadge: auditBadgeOf(spec),
    listingReason: spec.listingReason ?? null,
  }
}

export function createIllustrativeAdapter(): RegistryAdapter {
  return {
    info: ILLUSTRATIVE_SOURCE,
    load(): Promise<RegistrySnapshot> {
      const now = Math.floor(Date.now() / 1000)
      const listings = EXAMPLES.map((spec, i) => toListing(spec, i, now))
      return Promise.resolve({
        source: ILLUSTRATIVE_SOURCE,
        listings,
        total: listings.length,
        reasonsUnavailable: false,
      })
    },
  }
}
