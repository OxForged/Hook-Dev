/* ============================================================================
   Latch Marketplace — the browse surface over the on-chain registry.

   A Latch is a hook contract attached to a pool.

   This is a SAFETY surface before it is a discovery surface. A Latch holding a
   returns-delta permission can take a cut of every swap in its pool; one holding
   beforeSwap can stop trading entirely; one holding beforeRemoveLiquidity can
   refuse withdrawals, which strands funds as surely as taking them.

   So capability is shown as plain language, always visible, never behind a
   disclosure — and it comes from the registry's own on-chain classifiers rather
   than being re-derived here. A UI that computes risk itself can disagree with
   the chain, and the user would have no way to know which one lied.

   STORE SHAPE, SAFETY CONTENT. The layout borrows the grammar of an app store —
   a listing grid, a trust row, a product page behind each card — because that is
   the grammar people already read when deciding whether to install something.
   What it does NOT borrow is the app-store habit of leading with the vendor's
   own marketing. The three signals in the trust row are all on-chain enums, and
   the capability block under them is decoded from the Latch's own bytecode. The
   submitter's name and description sit BELOW both, marked as their words.

   Three rules the layout enforces:

     1. Name and description are submitter-supplied strings. They are rendered as
        prose and never as a capability claim; every capability statement on this
        screen traces to the bitmap the registry read off the Latch's own code.
     2. A malicious listing is never rendered as a normal card, and no filter can
        hide it. A warning a filter can dismiss is not a warning.
     3. A dangerous Latch must not be able to look premium. Verification level
        styles the badge only — it never styles the card. The card's own tone is
        driven by listing state and capability class, so an audited
        value-extracting Latch still reads as dangerous.

   READ ONLY. There is deliberately no wallet, no signing and no write path here.
   ============================================================================ */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ChainMark } from '../../../components/ChainMark.tsx'
import { chainByKey } from '../../../data/chains.ts'
import { HOOK_CALLBACKS } from '../../../data/registry.generated.ts'
import {
  DEPLOYMENTS,
  LISTING_LABEL,
  RISK_LABEL,
  SEPOLIA_CHAIN_ID,
  VERIFICATION_LABEL,
  capabilityClaims,
  explorerAddress,
  readRegisteredLatches,
  type ListingState,
  type RegisteredLatch,
  type RiskClass,
  type VerificationLevel,
} from '../../../lib/chain'
import { dappPath } from '../paths.ts'

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; hooks: RegisteredLatch[] }

const NO_HOOKS: RegisteredLatch[] = []

const LISTING_DEPRECATED = 1 satisfies ListingState
const LISTING_MALICIOUS = 2 satisfies ListingState
const RISK_VALUE_EXTRACTING = 2 satisfies RiskClass

/** An unverified Latch must never borrow the visual language of an audited one. */
const VERIFICATION_BADGE: Record<VerificationLevel, string> = {
  0: 'dapp-badge dapp-badge--mute',
  1: 'dapp-badge dapp-badge--info',
  2: 'dapp-badge dapp-badge--ok',
}

const RISK_BADGE: Record<RiskClass, string> = {
  0: 'dapp-badge dapp-badge--mute',
  1: 'dapp-badge dapp-badge--warn',
  2: 'dapp-badge dapp-badge--danger',
}

const LISTING_BADGE: Record<ListingState, string> = {
  0: 'dapp-badge dapp-badge--ok',
  1: 'dapp-badge dapp-badge--mute',
  2: 'dapp-badge dapp-badge--danger',
}

/* One sentence per enum value, for the legend rail. These describe what the
   registry means by the word — not what any particular Latch does. */
const VERIFICATION_MEANING: Record<VerificationLevel, string> = {
  0: 'Nobody has checked the source against the deployed bytecode.',
  1: 'Someone matched published source to what is on chain. It says the code is what it claims — not that the code is safe.',
  2: 'An audit was recorded against this listing. Read the report; an audit is a document, not a guarantee.',
}

const RISK_MEANING: Record<RiskClass, string> = {
  0: 'Holds no permission that can move funds or stop a trade. It can watch and record.',
  1: 'Holds a before-callback, so it can reject a swap, a deposit or a withdrawal outright.',
  2: 'Holds a returns-delta permission: it can take a share of swaps, or refuse liquidity withdrawal.',
}

const LISTING_MEANING: Record<ListingState, string> = {
  0: 'Listed and not marked by a guardian.',
  1: 'Superseded or abandoned by its steward. Not an accusation.',
  2: 'A guardian has marked it as known to harm users. Its verification is reset.',
}

const VERIFICATION_FILTERS = [0, 1, 2] as const
const RISK_FILTERS = [0, 1, 2] as const

const TOTAL_CALLBACKS = HOOK_CALLBACKS.length

/** `0x1234…abcd`. */
function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/**
 * sourceURI and auditURI are submitter-supplied strings straight out of contract
 * storage. Anything that is not plain http(s) — `javascript:`, `data:` — is shown
 * as inert text rather than turned into a link the user can click.
 */
function safeHttpUrl(uri: string): string | null {
  if (!uri) return null
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/**
 * What the live region says. The singular is spelled out rather than pluralised
 * with a `(s)`, because a screen reader reads that aloud as "one Latch bracket s
 * matches".
 *
 * Flagged listings are counted separately for the same reason they are rendered
 * separately: they are not part of the filtered result set, and folding them
 * into one total would let a warning disappear into a number.
 */
function resultSentence(matched: number, flagged: number): string {
  const head =
    matched === 0
      ? 'No Latches match'
      : matched === 1
        ? '1 Latch matches'
        : `${matched} Latches match`
  if (flagged === 0) return `${head}.`
  const tail =
    flagged === 1
      ? '1 flagged Latch is shown separately.'
      : `${flagged} flagged Latches are shown separately.`
  return `${head}. ${tail}`
}

/** A keystroke should not interrupt the previous announcement. */
const ANNOUNCE_DELAY_MS = 700

function matchesQuery(hook: RegisteredLatch, q: string): boolean {
  if (!q) return true
  return (
    hook.name.toLowerCase().includes(q) ||
    hook.description.toLowerCase().includes(q) ||
    hook.address.toLowerCase().includes(q)
  )
}

/**
 * The card's tone — what colour the whole card reads as.
 *
 * Deliberately NOT a function of verification. An audited Latch that can take a
 * cut of every swap is still a Latch that can take a cut of every swap, and the
 * card must say so before it says anyone vouched for it.
 */
function cardTone(hook: RegisteredLatch): 'danger' | 'caution' | 'deprecated' | 'plain' {
  if (hook.listing === LISTING_MALICIOUS) return 'danger'
  if (hook.risk === RISK_VALUE_EXTRACTING || !hook.permissionsReadable) return 'danger'
  if (hook.listing === LISTING_DEPRECATED) return 'deprecated'
  if (hook.risk === 1 || !hook.permissionsValid) return 'caution'
  return 'plain'
}

/** The alert lines a Latch earns. Shared by the card and the detail page's hero. */
export function LatchAlerts({ hook }: { hook: RegisteredLatch }) {
  return (
    <>
      {/* Malicious listings get the loudest line, above everything the submitter
          wrote about themselves. */}
      {hook.listing === LISTING_MALICIOUS && (
        <p className="hx-alert hx-alert--danger">
          A guardian has flagged this Latch as known to harm users. Its verification has been
          reset. Do not route funds through a pool that uses it.
        </p>
      )}

      {hook.risk === RISK_VALUE_EXTRACTING && (
        <p className="hx-alert hx-alert--danger">
          Value-extracting. This Latch holds a permission that lets it take a cut of swaps or
          refuse liquidity withdrawals. Value routed through its pools moves at its discretion.
        </p>
      )}

      {!hook.permissionsReadable && (
        <p className="hx-alert hx-alert--danger">
          STALE — the registry can no longer read this contract&rsquo;s bitmap. The capabilities
          shown are the last values that were successfully read and may no longer be true.
        </p>
      )}

      {!hook.permissionsValid && (
        <p className="hx-alert">
          Malformed bitmap — it carries reserved bits, or a returns-delta bit without the
          callback that bit depends on. It cannot be attested to in this state.
        </p>
      )}

      {/* Deprecated is a status, not an accusation — marked, not alarmed. */}
      {hook.listing === LISTING_DEPRECATED && (
        <p className="hx-note">
          Deprecated — superseded or abandoned by its steward. Not an accusation; any
          verification it earned still stands.
        </p>
      )}
    </>
  )
}

/**
 * The three on-chain signals, always in the same order, always all three present.
 *
 * A missing cell would be read as "not applicable" when what it really means is
 * "we did not say", so every Latch renders every row even when the answer is the
 * boring one.
 */
export function TrustRow({ hook, size }: { hook: RegisteredLatch; size?: 'lg' }) {
  return (
    <dl className={size === 'lg' ? 'lx-trust lx-trust--lg' : 'lx-trust'}>
      <div className="lx-trust__cell">
        <dt className="dapp-microlabel dapp-microlabel--tight">VERIFICATION</dt>
        <dd>
          <span className={VERIFICATION_BADGE[hook.verification]}>
            {VERIFICATION_LABEL[hook.verification]}
          </span>
        </dd>
      </div>
      {/* "CAPABILITY", not "CAPABILITY CLASS": the longer label wraps to two
          lines in a card-width cell and drops its badge out of line with the
          other two. The legend in the rail spells the full name out. */}
      <div className="lx-trust__cell">
        <dt className="dapp-microlabel dapp-microlabel--tight">CAPABILITY</dt>
        <dd>
          <span className={RISK_BADGE[hook.risk]}>{RISK_LABEL[hook.risk]}</span>
        </dd>
      </div>
      <div className="lx-trust__cell">
        <dt className="dapp-microlabel dapp-microlabel--tight">LISTING</dt>
        <dd>
          <span className={LISTING_BADGE[hook.listing]}>{LISTING_LABEL[hook.listing]}</span>
        </dd>
      </div>
    </dl>
  )
}

function LatchCard({ hook, index }: { hook: RegisteredLatch; index: number }) {
  const source = safeHttpUrl(hook.sourceURI)
  const audit = safeHttpUrl(hook.auditURI)
  const claims = capabilityClaims(hook)
  const tone = cardTone(hook)
  const held = hook.callbacks.length

  return (
    <article
      className="dapp-card lx-card"
      data-tone={tone}
      style={{ animationDelay: `${(index * 0.05).toFixed(2)}s` }}
    >
      <div className="lx-card__top">
        <span className="dapp-tile lx-icon" aria-hidden="true">
          <span className="dapp-tile__diamond" />
        </span>
        <div className="lx-card__id">
          <h3 className="lx-card__name">
            {/* The whole card is the hit target — this anchor's ::after covers it.
                Every other link on the card is lifted above that overlay, so the
                block-explorer links still work. */}
            <Link className="lx-card__go" to={`${dappPath('marketplace')}/${hook.address}`}>
              {hook.name || 'Unnamed Latch'}
            </Link>
          </h3>
          <a
            className="lx-card__addr"
            href={explorerAddress(SEPOLIA_CHAIN_ID, hook.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {short(hook.address)} ↗
          </a>
        </div>
      </div>

      <TrustRow hook={hook} />

      <LatchAlerts hook={hook} />

      {/* The un-fakeable half of the card. It sits ABOVE the submitter's prose
          because it is the half that decides whether the prose matters. */}
      <div className={`hx-caps ${tone === 'danger' ? 'hx-caps--danger' : ''}`}>
        <p className="dapp-microlabel dapp-microlabel--tight">
          WHAT THIS LATCH CAN DO · FROM ITS OWN BYTECODE
        </p>
        <ul className="hx-caps__list">
          {claims.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="lx-caps__meter">
          <span className="lx-caps__bitmap tabular">
            0x{hook.permissions.toString(16).padStart(4, '0')}
          </span>
          <span className="lx-caps__count">
            {held} of {TOTAL_CALLBACKS} callbacks held
          </span>
        </p>
      </div>

      {hook.callbacks.length > 0 && (
        <p className="dapp-tags">
          {hook.callbacks.map((c) => (
            <span key={c} className="dapp-tag">
              {c}
            </span>
          ))}
        </p>
      )}

      <p className="lx-card__desc">
        {hook.description || <span className="hx-muted">No description supplied.</span>}
      </p>
      <p className="lx-card__byline">
        Written by the submitter, {short(hook.submitter)} — not verified, and not a capability
        claim.
      </p>

      <div className="lx-card__foot">
        <span className="lx-links">
          <a
            href={explorerAddress(SEPOLIA_CHAIN_ID, hook.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Contract ↗
          </a>
          {source ? (
            <a href={source} target="_blank" rel="noopener noreferrer">
              Source ↗
            </a>
          ) : (
            <span className="hx-muted">No source</span>
          )}
          {audit ? (
            <a href={audit} target="_blank" rel="noopener noreferrer">
              Audit ↗
            </a>
          ) : (
            <span className="hx-muted">No audit</span>
          )}
        </span>
        <span className="lx-card__more" aria-hidden="true">
          Full record →
        </span>
      </div>
    </article>
  )
}

/** The legend. Every row is an on-chain enum value, not an editorial rating. */
function SignalLegend() {
  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="lx-legend-h">
      <h2 id="lx-legend-h" className="dapp-card__title">
        Reading the signals
      </h2>
      <p className="live-note">
        Three enums, all stored on the registry. Each card shows all three in this order.
      </p>

      <p className="dapp-microlabel dapp-microlabel--tight lx-legend__head">VERIFICATION</p>
      <ul className="lx-legend">
        {VERIFICATION_FILTERS.map((v) => (
          <li key={v}>
            <span className={VERIFICATION_BADGE[v]}>{VERIFICATION_LABEL[v]}</span>
            <span>{VERIFICATION_MEANING[v]}</span>
          </li>
        ))}
      </ul>

      <p className="dapp-microlabel dapp-microlabel--tight lx-legend__head">CAPABILITY CLASS</p>
      <ul className="lx-legend">
        {RISK_FILTERS.map((r) => (
          <li key={r}>
            <span className={RISK_BADGE[r]}>{RISK_LABEL[r]}</span>
            <span>{RISK_MEANING[r]}</span>
          </li>
        ))}
      </ul>

      <p className="dapp-microlabel dapp-microlabel--tight lx-legend__head">LISTING</p>
      <ul className="lx-legend">
        {([0, 1, 2] as const).map((l) => (
          <li key={l}>
            <span className={LISTING_BADGE[l]}>{LISTING_LABEL[l]}</span>
            <span>{LISTING_MEANING[l]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Explorer() {
  const [state, setState] = useState<State>({ k: 'loading' })
  const [query, setQuery] = useState('')
  const [verification, setVerification] = useState<VerificationLevel | 'all'>('all')
  const [risk, setRisk] = useState<RiskClass | 'all'>('all')

  useEffect(() => {
    let off = false
    readRegisteredLatches()
      .then((hooks) => !off && setState({ k: 'ready', hooks }))
      .catch(
        (e) =>
          !off &&
          setState({ k: 'error', message: e instanceof Error ? e.message : 'unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])

  /* Stable identity so the memos below do not recompute on every keystroke. */
  const hooks = useMemo(() => (state.k === 'ready' ? state.hooks : NO_HOOKS), [state])
  const q = query.trim().toLowerCase()

  /* Flagged listings are pulled out of the browse grid entirely: they are shown so
     they can be recognised, not so they can be shopped for. The chips do not apply
     to them, so no filter combination can make a warning disappear. */
  const flagged = useMemo(
    () => hooks.filter((h) => h.listing === LISTING_MALICIOUS && matchesQuery(h, q)),
    [hooks, q],
  )

  const listable = useMemo(() => hooks.filter((h) => h.listing !== LISTING_MALICIOUS), [hooks])

  const visible = useMemo(
    () =>
      listable.filter(
        (h) =>
          matchesQuery(h, q) &&
          (verification === 'all' || h.verification === verification) &&
          (risk === 'all' || h.risk === risk),
      ),
    [listable, q, verification, risk],
  )

  const d = DEPLOYMENTS[SEPOLIA_CHAIN_ID]
  const sepolia = chainByKey('sepolia')
  const filtersOn = verification !== 'all' || risk !== 'all' || q !== ''

  /* The grid re-renders on every keystroke; the announcement must not. A polite
     live region that changes on each character is read as a stream of interrupted
     fragments and is worse than saying nothing, so this lags the grid by a beat
     and only ever speaks a settled count. Empty until the registry has actually
     been read — "0 Latches match" while still loading would be a false answer. */
  const summary = state.k === 'ready' ? resultSentence(visible.length, flagged.length) : ''
  const [settled, setSettled] = useState('')

  useEffect(() => {
    if (summary === '') return
    const t = window.setTimeout(() => setSettled(summary), ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [summary])

  /* Derived, not stored: while the registry is still being read there is no
     count to announce, and the last settled sentence must not linger. */
  const announcement = summary === '' ? '' : settled

  return (
    <div className="lx-layout">
      <div className="lx-main">
        <section className="dapp-card hx-head" aria-labelledby="hx-h">
          <div className="dapp-card__head">
            <h2 id="hx-h" className="dapp-card__title dapp-card__title--lg">
              Every Latch listed on chain
            </h2>
            <span className="live-badge">
              <span className="live-dot" aria-hidden="true" />
              LIVE
            </span>
          </div>
          <p className="live-note">
            Listing is permissionless: anyone can add a Latch, and nobody curates this page. What
            makes it readable is that the dangerous part cannot be self-declared — capabilities
            are decoded from each Latch&rsquo;s own bytecode by the registry, so a submitter
            cannot claim permissions their code does not have. Names, descriptions and links{' '}
            <em>are</em> submitter-supplied.
          </p>
        </section>

        <div className="lx-toolbar">
          <div className="dapp-search lx-search">
            <span className="dapp-search__ring" aria-hidden="true" />
            <input
              type="search"
              className="dapp-search__input"
              placeholder="Search Latches by name, description or address…"
              aria-label="Search Latches by name, description or address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="hx-filters">
            <div className="hx-filterset">
              <p className="dapp-microlabel dapp-microlabel--tight" id="hx-f-verify">
                VERIFICATION
              </p>
              <div
                className="dapp-chips dapp-chips--tight"
                role="group"
                aria-labelledby="hx-f-verify"
              >
                <button
                  type="button"
                  className={verification === 'all' ? 'dapp-chip is-active' : 'dapp-chip'}
                  aria-pressed={verification === 'all'}
                  onClick={() => setVerification('all')}
                >
                  All
                  <span className="hx-count">{listable.length}</span>
                </button>
                {VERIFICATION_FILTERS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={verification === v ? 'dapp-chip is-active' : 'dapp-chip'}
                    aria-pressed={verification === v}
                    onClick={() => setVerification(v)}
                  >
                    {VERIFICATION_LABEL[v]}
                    <span className="hx-count">
                      {listable.filter((h) => h.verification === v).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="hx-filterset">
              <p className="dapp-microlabel dapp-microlabel--tight" id="hx-f-risk">
                CAPABILITY CLASS
              </p>
              <div
                className="dapp-chips dapp-chips--tight"
                role="group"
                aria-labelledby="hx-f-risk"
              >
                <button
                  type="button"
                  className={risk === 'all' ? 'dapp-chip is-active' : 'dapp-chip'}
                  aria-pressed={risk === 'all'}
                  onClick={() => setRisk('all')}
                >
                  All
                  <span className="hx-count">{listable.length}</span>
                </button>
                {RISK_FILTERS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={risk === r ? 'dapp-chip is-active' : 'dapp-chip'}
                    aria-pressed={risk === r}
                    onClick={() => setRisk(r)}
                  >
                    {RISK_LABEL[r]}
                    <span className="hx-count">{listable.filter((h) => h.risk === r).length}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* The chips and the grid both carry live counts, and neither is announced
            by changing on screen. This is the one place that says the result count
            out loud. Visually hidden — the counts are already on the chips. */}
        <p className="dapp-sr" role="status" aria-live="polite" data-testid="hx-count-announce">
          {announcement}
        </p>

        {state.k === 'loading' && (
          <p className="dapp-empty hx-state" role="status">
            Reading the Latch registry on {d.name}&hellip;
          </p>
        )}

        {state.k === 'error' && (
          <p className="dapp-empty hx-state hx-state--err" role="status">
            Could not read the registry: {state.message}. Nothing is shown rather than stale
            listings.
          </p>
        )}

        {state.k === 'ready' && hooks.length === 0 && (
          <p className="dapp-empty hx-state">
            No Latches are listed yet. The registry is deployed at{' '}
            <a
              href={explorerAddress(SEPOLIA_CHAIN_ID, d.registry)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {short(d.registry)}
            </a>{' '}
            and is genuinely empty — shown as empty rather than padded with examples.
          </p>
        )}

        {flagged.length > 0 && (
          <section className="hx-flagged" aria-labelledby="hx-flagged-h">
            <h3 id="hx-flagged-h" className="hx-flagged__title">
              Flagged malicious — {flagged.length}
            </h3>
            <p className="hx-flagged__note">
              Shown so they can be recognised, not so they can be used. The filters above do not
              apply here.
            </p>
            <div className="lx-grid hx-flagged__grid">
              {flagged.map((h, i) => (
                <LatchCard key={h.address} hook={h} index={i} />
              ))}
            </div>
          </section>
        )}

        {state.k === 'ready' && visible.length > 0 && (
          <>
            <p className="lx-count" role="presentation">
              {visible.length === 1 ? '1 Latch' : `${visible.length} Latches`}
              {filtersOn ? ' matching' : ' listed'}
            </p>
            <div className="lx-grid">
              {visible.map((h, i) => (
                <LatchCard key={h.address} hook={h} index={i} />
              ))}
            </div>
          </>
        )}

        {state.k === 'ready' && listable.length > 0 && visible.length === 0 && (
          <p className="dapp-empty hx-state">
            No Latch matches that {filtersOn ? 'search and filter' : 'view'}.{' '}
            <button
              type="button"
              className="hx-linkbtn"
              onClick={() => {
                setQuery('')
                setVerification('all')
                setRisk('all')
              }}
            >
              Clear filters
            </button>
          </p>
        )}
      </div>

      {/* The rail is the reason a one-listing marketplace still reads as finished
          rather than broken: the page's job is teaching someone to judge a Latch,
          and that job does not get smaller when there is only one to judge. */}
      <aside className="lx-rail" aria-label="How to read this page">
        <SignalLegend />

        <section className="dapp-card lx-rail__card" aria-labelledby="lx-reg-h">
          <h2 id="lx-reg-h" className="dapp-card__title">
            The registry
          </h2>
          <dl className="live-grid">
            <div>
              <dt>Contract</dt>
              <dd>
                <a
                  href={explorerAddress(SEPOLIA_CHAIN_ID, d.registry)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LatchRegistry ↗
                </a>
              </dd>
            </div>
            <div>
              <dt>Chain</dt>
              <dd className="lx-rail__chain">
                <ChainMark brand={sepolia.brand} size={16} className="lx-rail__mark" />
                {sepolia.name}
              </dd>
            </div>
            <div>
              <dt>Listed</dt>
              <dd className="tabular">
                {state.k === 'ready' ? `${hooks.length} · latchCount()` : '—'}
              </dd>
            </div>
          </dl>
          <p className="live-note lx-rail__note">
            Registration is permissionless and free, and it is permanent — the registry has no{' '}
            <code>unregister</code>. A Latch listed here can be deprecated or flagged, never
            deleted.
          </p>
          <Link to={dappPath('deploy')} className="dapp-btn dapp-btn--ghost lx-rail__cta">
            List a Latch
          </Link>
        </section>
      </aside>
    </div>
  )
}
