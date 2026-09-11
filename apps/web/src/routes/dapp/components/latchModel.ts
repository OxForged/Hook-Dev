/* ============================================================================
   The trust vocabulary of the Latch Marketplace — the data half.

   Shared by the listing card (screens/Explorer), the product page
   (screens/LatchDetail) and the components in LatchSignals.tsx, so the three
   can never describe the same Latch two ways.

   Everything here traces to a value the REGISTRY holds — the three enums, the
   classifier booleans and the permission bitmap read off the Latch's own
   bytecode. Nothing here touches the submitter's name or prose.

   Kept separate from the components (LatchSignals.tsx) so that file exports
   components only, which is what React Fast Refresh needs to hot-swap it.
   ============================================================================ */

import {
  HOOK_CALLBACKS,
  RETURNS_DELTA_CALLBACKS,
  VETO_CALLBACKS,
  type HookCallback,
} from '../../../data/registry.generated.ts'
import {
  RISK_LABEL,
  type ListingState,
  type RegisteredLatch,
  type RiskClass,
  type VerificationLevel,
} from '../../../lib/chain'

/* ---- enum values, named -------------------------------------------------- */

export const LISTING_DEPRECATED = 1 satisfies ListingState
export const LISTING_MALICIOUS = 2 satisfies ListingState
export const RISK_RESTRICTIVE = 1 satisfies RiskClass
export const RISK_VALUE_EXTRACTING = 2 satisfies RiskClass

export const VERIFICATION_VALUES = [0, 1, 2] as const
export const RISK_VALUES = [0, 1, 2] as const
export const LISTING_VALUES = [0, 1, 2] as const

export const TOTAL_CALLBACKS = HOOK_CALLBACKS.length

/* ---- badge classes --------------------------------------------------------
   Verification styles the BADGE only. It never styles a card or a hero: an
   audited Latch that can take a cut of every swap must still read as one. */

export const VERIFICATION_BADGE: Record<VerificationLevel, string> = {
  0: 'dapp-badge dapp-badge--mute',
  1: 'dapp-badge dapp-badge--info',
  2: 'dapp-badge dapp-badge--ok',
}

export const RISK_BADGE: Record<RiskClass, string> = {
  0: 'dapp-badge dapp-badge--mute',
  1: 'dapp-badge dapp-badge--warn',
  2: 'dapp-badge dapp-badge--danger',
}

export const LISTING_BADGE: Record<ListingState, string> = {
  0: 'dapp-badge dapp-badge--ok',
  1: 'dapp-badge dapp-badge--mute',
  2: 'dapp-badge dapp-badge--danger',
}

/* ---- what each enum value means -------------------------------------------
   These describe what the registry means by the word — not what any
   particular Latch does. */

export const VERIFICATION_MEANING: Record<VerificationLevel, string> = {
  0: 'Nobody has checked the source against the deployed bytecode.',
  1: 'Someone matched published source to what is on chain. It says the code is what it claims — not that the code is safe.',
  2: 'An audit was recorded against this listing. Read the report; an audit is a document, not a guarantee.',
}

export const RISK_MEANING: Record<RiskClass, string> = {
  0: 'Holds no permission that can move funds or stop a trade. It can watch and record.',
  1: 'Holds a before-callback, so it can reject a swap, a deposit or a withdrawal outright.',
  2: 'Holds a returns-delta permission: it can take a share of swaps, or refuse liquidity withdrawal.',
}

export const LISTING_MEANING: Record<ListingState, string> = {
  0: 'Listed and not marked by a guardian.',
  1: 'Superseded or abandoned by its steward. Not an accusation.',
  2: 'A guardian has marked it as known to harm users. Its verification is reset.',
}

/* ---- small helpers --------------------------------------------------------- */

/** `0x1234…abcd` by default; the detail page asks for a longer head and tail. */
export function shortAddress(address: string, head = 6, tail = 4): string {
  return address.length > head + tail + 2
    ? `${address.slice(0, head)}…${address.slice(-tail)}`
    : address
}

/**
 * sourceURI and auditURI are submitter-supplied strings straight out of
 * contract storage. Anything that is not plain http(s) — `javascript:`,
 * `data:` — is shown as inert text rather than turned into a link.
 */
export function safeHttpUrl(uri: string): string | null {
  if (!uri) return null
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

export function bitmapHex(hook: RegisteredLatch): string {
  return `0x${hook.permissions.toString(16).padStart(4, '0')}`
}

/**
 * The card's tone — what colour the whole card reads as.
 *
 * Deliberately NOT a function of verification. Listing state and capability
 * class only, so a dangerous Latch cannot buy its way out of looking dangerous.
 */
export type Tone = 'danger' | 'caution' | 'deprecated' | 'plain'

export function latchTone(hook: RegisteredLatch): Tone {
  if (hook.listing === LISTING_MALICIOUS) return 'danger'
  if (hook.risk === RISK_VALUE_EXTRACTING || !hook.permissionsReadable) return 'danger'
  if (hook.listing === LISTING_DEPRECATED) return 'deprecated'
  if (hook.risk === RISK_RESTRICTIVE || !hook.permissionsValid) return 'caution'
  return 'plain'
}

/** True when `LatchAlerts` will render at least one line. */
export function hasAlerts(hook: RegisteredLatch): boolean {
  return (
    hook.listing !== 0 ||
    hook.risk === RISK_VALUE_EXTRACTING ||
    !hook.permissionsReadable ||
    !hook.permissionsValid
  )
}

/**
 * The one line under a Latch's name. Where a store would print the vendor's
 * tagline, this prints the capability class and the callback count — both
 * on-chain, neither writable by the submitter.
 */
export function onChainSubline(hook: RegisteredLatch): string {
  const n = hook.callbacks.length
  return `${RISK_LABEL[hook.risk]} · ${n} of ${TOTAL_CALLBACKS} callback${n === 1 ? '' : 's'}`
}

/* ---- callbacks, by what they can do ---------------------------------------- */

export type CallbackKind = 'delta' | 'veto' | 'observe'

const DELTA = new Set<string>(RETURNS_DELTA_CALLBACKS)
const VETO = new Set<string>(VETO_CALLBACKS)

/** From the registry's own masks — not a judgement made here. */
export function callbackKind(name: HookCallback): CallbackKind {
  if (DELTA.has(name)) return 'delta'
  if (VETO.has(name)) return 'veto'
  return 'observe'
}

export const CALLBACK_GROUPS: ReadonlyArray<{
  kind: CallbackKind
  title: string
  meaning: string
  names: readonly HookCallback[]
}> = [
  {
    kind: 'delta',
    title: 'Returns-delta — can move value',
    meaning:
      'A held bit here lets the Latch return a balance delta: take from a swap or a liquidity change, or withhold on withdrawal.',
    names: HOOK_CALLBACKS.filter((n) => callbackKind(n) === 'delta'),
  },
  {
    kind: 'veto',
    title: 'Before-callbacks — can refuse',
    meaning:
      'Runs before the action and can revert it. A held bit means the Latch can refuse that swap, deposit, withdrawal, donation or pool initialisation.',
    names: HOOK_CALLBACKS.filter((n) => callbackKind(n) === 'veto'),
  },
  {
    kind: 'observe',
    title: 'After-callbacks — can observe',
    meaning:
      'Runs after the action has settled. Without a returns-delta bit it can record and react, but not stop or reprice what already happened.',
    names: HOOK_CALLBACKS.filter((n) => callbackKind(n) === 'observe'),
  },
]

/* ---- the ledger's three questions ------------------------------------------ */

export const LEDGER_ROWS: ReadonlyArray<{
  key: 'takesSwapCut' | 'canBlockSwaps' | 'canTrapLiquidity'
  kind: 'value' | 'veto'
  ask: string
  why: string
}> = [
  {
    key: 'takesSwapCut',
    kind: 'value',
    ask: 'Take a share of every swap',
    why: 'A returns-delta bit on a swap callback lets the Latch keep part of each trade.',
  },
  {
    key: 'canBlockSwaps',
    kind: 'veto',
    ask: 'Block or reprice swaps',
    why: 'A beforeSwap bit lets the Latch revert a swap, or change its price, before it settles.',
  },
  {
    key: 'canTrapLiquidity',
    kind: 'value',
    ask: 'Refuse liquidity withdrawal',
    why: 'A hold on remove-liquidity lets the Latch keep a provider from taking funds back out.',
  },
]
