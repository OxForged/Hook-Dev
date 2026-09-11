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
   a listing grid, an info strip under each name, a "nutrition label" of what
   the thing can do, a product page behind each card — because that is the
   grammar people already read when deciding whether to install something.
   What it does NOT borrow is the app-store habit of leading with the vendor's
   own marketing. The line under the name is the capability class, not a
   tagline. The strip is three on-chain enums. The ledger is decoded from the
   Latch's own bytecode. The submitter's name and description sit BELOW all of
   it, marked as their words. (See components/LatchSignals for the pieces.)

   Three rules the layout enforces:

     1. Name and description are submitter-supplied strings. They are rendered as
        prose and never as a capability claim; every capability statement on this
        screen traces to the bitmap the registry read off the Latch's own code.
     2. A malicious listing is never rendered as a normal card, and no filter can
        hide it. A warning a filter can dismiss is not a warning.
     3. A dangerous Latch must not be able to look premium. Verification level
        styles the badge only — it never styles the card. The card's own tone is
        driven by listing state and capability class, so an audited
        value-extracting Latch still reads as dangerous — ribbon and all.

   READ ONLY. There is deliberately no wallet, no signing and no write path here.
   ============================================================================ */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ChainTag } from '../../../components/ChainTag.tsx'
import {
  DEPLOYMENTS,
  LISTING_LABEL,
  RISK_LABEL,
  ACTIVE_CHAIN_ID,
  VERIFICATION_LABEL,
  explorerAddress,
  readRegisteredLatches,
  type RegisteredLatch,
  type RiskClass,
  type VerificationLevel,
} from '../../../lib/chain'
import { Donut, DonutLegend } from '../components/charts.tsx'
import type { DonutSegment, SeriesColor } from '../data/types.ts'
import { CapabilityLedger, LatchAlerts, Ribbon, TrustStrip } from '../components/LatchSignals.tsx'
import {
  LISTING_BADGE,
  LISTING_MALICIOUS,
  LISTING_MEANING,
  LISTING_VALUES,
  RISK_BADGE,
  RISK_MEANING,
  RISK_VALUES,
  VERIFICATION_BADGE,
  VERIFICATION_MEANING,
  VERIFICATION_VALUES,
  hasAlerts,
  latchTone,
  onChainSubline,
  safeHttpUrl,
  shortAddress as short,
} from '../components/latchModel.ts'
import { dappPath } from '../paths.ts'

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; hooks: RegisteredLatch[] }

const NO_HOOKS: RegisteredLatch[] = []

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
 * One listing.
 *
 * DOM order is decision order: identity and the three signals, any warning,
 * the ledger decoded from bytecode, and only then the submitter's prose. The
 * `__main` / `__tail` wrappers are `display: contents` in the grid, so that
 * order is also the visual order; when the card is the only one on the page
 * they become the left column and the ledger becomes the right (see the
 * container query on `.lx-grid[data-solo]`).
 */
function LatchCard({ hook, index }: { hook: RegisteredLatch; index: number }) {
  const source = safeHttpUrl(hook.sourceURI)
  const audit = safeHttpUrl(hook.auditURI)
  const tone = latchTone(hook)

  return (
    <article
      className="dapp-card lx-card"
      data-tone={tone}
      style={{ animationDelay: `${(index * 0.05).toFixed(2)}s` }}
    >
      <Ribbon hook={hook} />

      <div className="lx-card__main">
        <header className="lx-card__top">
          <span className="dapp-tile lx-icon" aria-hidden="true">
            <span className="dapp-tile__diamond" />
          </span>
          <div className="lx-card__id">
            <h3 className="lx-card__name">
              {/* The whole card is the hit target — this anchor's ::after covers
                  it. Every other link on the card is lifted above that overlay,
                  so the block-explorer links still work. */}
              <Link className="lx-card__go" to={`${dappPath('marketplace')}/${hook.address}`}>
                {hook.name || 'Unnamed Latch'}
              </Link>
            </h3>
            {/* Where a store prints the vendor's tagline: the capability class
                and callback count, both on-chain, and the chain the record was
                read from. Nothing on this line is writable by the submitter. */}
            <p className="lx-card__sub" data-risk={hook.risk}>
              <span>{onChainSubline(hook)}</span>
              <ChainTag chainId={hook.chainId} size={13} className="lx-card__chain" />
            </p>
          </div>
          {/* The store's "GET" pill, repurposed. Decorative — the name is the
              real link and it already covers the card. */}
          <span className="lx-card__cta" aria-hidden="true">
            Inspect
          </span>
        </header>

        <TrustStrip hook={hook} />

        {hasAlerts(hook) && (
          <div className="lx-card__alerts">
            <LatchAlerts hook={hook} />
          </div>
        )}
      </div>

      {/* The un-fakeable half of the card. It sits ABOVE the submitter's prose
          because it is the half that decides whether the prose matters. */}
      <div className="lx-card__caps">
        <CapabilityLedger hook={hook} />
      </div>

      <div className="lx-card__tail">
        <div className="lx-card__prose">
          <p className="lx-card__desc">
            {hook.description || <span className="hx-muted">No description supplied.</span>}
          </p>
          <p className="lx-card__byline">
            Submitter&rsquo;s description, from{' '}
            <a
              href={explorerAddress(hook.chainId, hook.submitter)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {short(hook.submitter)}
            </a>{' '}
            — unverified, not a capability claim.
          </p>
        </div>

        <footer className="lx-card__foot">
          <span className="lx-links">
            <a
              href={explorerAddress(hook.chainId, hook.address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contract {short(hook.address)} ↗
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
        </footer>
      </div>
    </article>
  )
}

/* ============================================================================
   Composition of the registry, by capability class.

   WHAT IT IS FED BY. `RegisteredLatch.risk` — the `uint8` the registry's own
   pure `classify()` returned for each listing's bitmap, read in
   `readRegisteredLatches`. Nothing is re-derived here and nothing is
   interpolated: the three counts are counts, and they sum to the number of
   listings the grid below is showing.

   WHY ALL THREE CLASSES ARE DRAWN, INCLUDING THE EMPTY ONES. "No
   value-extracting Latch is listed" is a reading, and a donut that omits its
   zero classes quietly turns that reading into a gap the eye fills in. Each
   zero arc draws nothing and its legend row says 0.00%.

   WHY THE COLOURS ARE NOT THE BADGE COLOURS. The data-series palette carries
   no error red — `SeriesColor` is five tokens and none of them is `--error`.
   So severity is NOT encoded here; the badges and the card tone stay the only
   authority on that, exactly as the header of this file requires. This chart
   answers "how many of each", and the legend directly above it says what each
   class means.
   ============================================================================ */
const RISK_SERIES: Readonly<Record<RiskClass, SeriesColor>> = {
  0: 'signal',
  1: 'violet',
  2: 'amber',
}

function classSegments(hooks: readonly RegisteredLatch[]): DonutSegment[] {
  const total = hooks.length || 1
  return RISK_VALUES.map((r) => ({
    name: RISK_LABEL[r],
    pct: (hooks.filter((h) => h.risk === r).length / total) * 100,
    color: RISK_SERIES[r],
  }))
}

function ClassMix({ hooks, flaggedCount }: { hooks: readonly RegisteredLatch[]; flaggedCount: number }) {
  const [slice, setSlice] = useState<string | null>(null)
  const segments = useMemo(() => classSegments(hooks), [hooks])

  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="lx-mix-h">
      <h2 id="lx-mix-h" className="dapp-card__title">
        What is listed
      </h2>
      <Donut
        segments={segments}
        label="Listed Latches by capability class"
        unit="of listings"
        selected={slice}
        onSelect={setSlice}
      />
      <DonutLegend segments={segments} unit="of listings" selected={slice} onSelect={setSlice} />
      <p className="live-note">
        {hooks.length === 1 ? '1 listing' : `${hooks.length} listings`}, classified by the
        registry&rsquo;s own <code>classify()</code>.
        {flaggedCount > 0 &&
          ` The ${flaggedCount === 1 ? '1 flagged listing is' : `${flaggedCount} flagged listings are`} counted separately, below the grid.`}
      </p>
    </section>
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
        Three enums stored on the registry, shown on every card in this order.
      </p>

      <p className="dapp-microlabel dapp-microlabel--tight lx-legend__head">VERIFICATION</p>
      <ul className="lx-legend">
        {VERIFICATION_VALUES.map((v) => (
          <li key={v}>
            <span className={VERIFICATION_BADGE[v]}>{VERIFICATION_LABEL[v]}</span>
            <span>{VERIFICATION_MEANING[v]}</span>
          </li>
        ))}
      </ul>

      <p className="dapp-microlabel dapp-microlabel--tight lx-legend__head">CAPABILITY CLASS</p>
      <ul className="lx-legend">
        {RISK_VALUES.map((r) => (
          <li key={r}>
            <span className={RISK_BADGE[r]}>{RISK_LABEL[r]}</span>
            <span>{RISK_MEANING[r]}</span>
          </li>
        ))}
      </ul>

      <p className="dapp-microlabel dapp-microlabel--tight lx-legend__head">LISTING</p>
      <ul className="lx-legend">
        {LISTING_VALUES.map((l) => (
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

  const d = DEPLOYMENTS[ACTIVE_CHAIN_ID]
  const filtersOn = verification !== 'all' || risk !== 'all' || q !== ''

  /* One card, unfiltered, and it is the whole registry. It is laid out wide —
     not because it is featured, but because a lone card in a two-track grid
     reads as a layout bug, and stretching it lets the ledger sit beside the
     identity instead of under it. The caption says what the number means. */
  const solo = !filtersOn && visible.length === 1 && flagged.length === 0

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
          {/* Two sentences, and the second is the caveat that changes how every
              card is read: half of a listing is unverified prose. Cutting it to
              one would have cut the half that matters. */}
          <p className="live-note">
            Listing is permissionless and nobody curates this page. Capabilities are decoded from
            each Latch&rsquo;s own bytecode and cannot be self-declared; names, descriptions and
            links <em>are</em> submitter-supplied.
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
                {VERIFICATION_VALUES.map((v) => (
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
                {RISK_VALUES.map((r) => (
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
              href={explorerAddress(ACTIVE_CHAIN_ID, d.registry)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {short(d.registry)}
            </a>{' '}
            and is empty, not padded with examples.
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
              <span>
                {visible.length === 1 ? '1 Latch' : `${visible.length} Latches`}
                {filtersOn ? ' matching' : ' listed'}
              </span>
              {solo && (
                <span className="lx-count__note">
                  — the whole registry on {d.name}, not a selection. Registration is open.
                </span>
              )}
            </p>
            <div className="lx-grid" data-solo={solo ? 'true' : undefined}>
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

        {/* Only once the registry has actually answered. A donut over an
            unfinished read would be a shape drawn from nothing, and a donut
            over zero listings is three empty arcs saying less than the empty
            state already says in words. */}
        {state.k === 'ready' && listable.length > 0 && (
          <ClassMix hooks={listable} flaggedCount={flagged.length} />
        )}

        <section className="dapp-card lx-rail__card" aria-labelledby="lx-reg-h">
          <h2 id="lx-reg-h" className="dapp-card__title">
            The registry
          </h2>
          <dl className="live-grid">
            <div>
              <dt>Contract</dt>
              <dd>
                <a
                  href={explorerAddress(ACTIVE_CHAIN_ID, d.registry)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LatchRegistry ↗
                </a>
              </dd>
            </div>
            <div>
              <dt>Chain</dt>
              {/* The chain the registry was actually read from — ACTIVE_CHAIN_ID,
                  never a named network. This row said "Sepolia" from a
                  `chainByKey` lookup while every listing above it was being read
                  from Robinhood Chain. */}
              <dd className="lx-rail__chain">
                <ChainTag chainId={ACTIVE_CHAIN_ID} size={16} />
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
            Registration is free, open and permanent — there is no <code>unregister</code>. A
            listing can be deprecated or flagged, never deleted.
          </p>
          <Link to={dappPath('deploy')} className="dapp-btn dapp-btn--ghost lx-rail__cta">
            List a Latch
          </Link>
        </section>
      </aside>
    </div>
  )
}
