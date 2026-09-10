/* ============================================================================
   Hook Marketplace — the browse surface over the on-chain hook registry.

   This is a SAFETY surface before it is a discovery surface. A hook holding a
   returns-delta permission can take a cut of every swap in its pool; one holding
   beforeSwap can stop trading entirely; one holding beforeRemoveLiquidity can
   refuse withdrawals, which strands funds as surely as taking them.

   So capability is shown as plain language, always visible, never behind a
   disclosure — and it comes from the registry's own on-chain classifiers rather
   than being re-derived here. A UI that computes risk itself can disagree with
   the chain, and the user would have no way to know which one lied.

   Two rules the layout enforces:

     1. Name and description are submitter-supplied strings. They are rendered as
        prose and never as a capability claim; every capability statement on this
        screen traces to the bitmap the registry read off the hook's own code.
     2. A malicious listing is never rendered as a normal card, and no filter can
        hide it. A warning a filter can dismiss is not a warning.

   READ ONLY. There is deliberately no wallet, no signing and no write path here.
   ============================================================================ */

import { useEffect, useMemo, useState } from 'react'
import {
  DEPLOYMENTS,
  LISTING_LABEL,
  RISK_LABEL,
  SEPOLIA_CHAIN_ID,
  VERIFICATION_LABEL,
  capabilityClaims,
  explorerAddress,
  readRegisteredHooks,
  type ListingState,
  type RegisteredHook,
  type RiskClass,
  type VerificationLevel,
} from '../../../lib/chain'

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; hooks: RegisteredHook[] }

const NO_HOOKS: RegisteredHook[] = []

const LISTING_ACTIVE = 0 satisfies ListingState
const LISTING_DEPRECATED = 1 satisfies ListingState
const LISTING_MALICIOUS = 2 satisfies ListingState
const RISK_VALUE_EXTRACTING = 2 satisfies RiskClass

/** An unverified hook must never borrow the visual language of an audited one. */
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

const VERIFICATION_FILTERS = [0, 1, 2] as const
const RISK_FILTERS = [0, 1, 2] as const

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

function matchesQuery(hook: RegisteredHook, q: string): boolean {
  if (!q) return true
  return (
    hook.name.toLowerCase().includes(q) ||
    hook.description.toLowerCase().includes(q) ||
    hook.address.toLowerCase().includes(q)
  )
}

function HookCard({ hook, index }: { hook: RegisteredHook; index: number }) {
  const flagged = hook.listing === LISTING_MALICIOUS
  const source = safeHttpUrl(hook.sourceURI)
  const audit = safeHttpUrl(hook.auditURI)
  const claims = capabilityClaims(hook)
  const dangerous = hook.takesSwapCut || hook.canTrapLiquidity

  return (
    <article
      className={[
        'dapp-card dapp-card--latch hx-card',
        flagged ? 'hx-card--flagged' : '',
        hook.listing === LISTING_DEPRECATED ? 'hx-card--deprecated' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ animationDelay: `${(index * 0.05).toFixed(2)}s` }}
    >
      <div className="dapp-latch__head">
        <span className="dapp-tile" aria-hidden="true">
          <span className="dapp-tile__diamond" />
        </span>
        <span className="dapp-latch__id">
          <span className="dapp-latch__name">{hook.name || 'Unnamed hook'}</span>
          <a
            className="dapp-latch__author hx-addr"
            href={explorerAddress(SEPOLIA_CHAIN_ID, hook.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {short(hook.address)}
          </a>
        </span>
        <span className={VERIFICATION_BADGE[hook.verification]}>
          {VERIFICATION_LABEL[hook.verification]}
        </span>
      </div>

      <p className="hx-badges">
        <span className={RISK_BADGE[hook.risk]}>{RISK_LABEL[hook.risk]}</span>
        {hook.listing !== LISTING_ACTIVE && (
          <span
            className={
              flagged ? 'dapp-badge dapp-badge--danger' : 'dapp-badge dapp-badge--mute'
            }
          >
            {LISTING_LABEL[hook.listing]}
          </span>
        )}
      </p>

      {/* Malicious listings get the loudest line on the card, above everything the
          submitter wrote about themselves. */}
      {flagged && (
        <p className="hx-alert hx-alert--danger">
          A guardian has flagged this hook as known to harm users. Its verification has been
          reset. Do not route funds through a pool that uses it.
        </p>
      )}

      {/* Deprecated is a status, not an accusation — marked, not alarmed. */}
      {hook.listing === LISTING_DEPRECATED && (
        <p className="hx-note">
          Deprecated — superseded or abandoned by its steward. Not an accusation; any
          verification it earned still stands.
        </p>
      )}

      {hook.risk === RISK_VALUE_EXTRACTING && (
        <p className="hx-alert hx-alert--danger">
          Value-extracting. This hook holds a permission that lets it take a cut of swaps or
          refuse liquidity withdrawals. Value routed through its pools moves at its discretion.
        </p>
      )}

      {!hook.permissionsReadable && (
        <p className="hx-alert hx-alert--danger">
          STALE — the registry can no longer read this contract&rsquo;s bitmap. The capabilities
          below are the last values that were successfully read and may no longer be true.
        </p>
      )}

      {!hook.permissionsValid && (
        <p className="hx-alert">
          Malformed bitmap — it carries reserved bits, or a returns-delta bit without the
          callback that bit depends on. It cannot be attested to in this state.
        </p>
      )}

      <p className="dapp-latch__desc">
        {hook.description || <span className="hx-muted">No description supplied.</span>}
      </p>

      <div className={`hx-caps ${dangerous ? 'hx-caps--danger' : ''}`}>
        <p className="dapp-microlabel dapp-microlabel--tight">WHAT THIS HOOK CAN DO</p>
        <ul className="hx-caps__list">
          {claims.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
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

      <div className="dapp-latch__foot">
        <span className="dapp-stat">
          <span className="dapp-stat__label">BITMAP</span>
          <span className="dapp-stat__value">
            0x{hook.permissions.toString(16).padStart(4, '0')}
          </span>
        </span>
        <span className="dapp-stat">
          <span className="dapp-stat__label">LISTED BY</span>
          <span className="dapp-stat__value">{short(hook.submitter)}</span>
        </span>
        <span className="dapp-stat hx-links">
          <span className="dapp-stat__label">LINKS</span>
          <span className="hx-links__row">
            <a
              href={explorerAddress(SEPOLIA_CHAIN_ID, hook.address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contract
            </a>
            {source ? (
              <a href={source} target="_blank" rel="noopener noreferrer">
                Source
              </a>
            ) : (
              <span className="hx-muted">No source</span>
            )}
            {audit ? (
              <a href={audit} target="_blank" rel="noopener noreferrer">
                Audit
              </a>
            ) : (
              <span className="hx-muted">No audit</span>
            )}
          </span>
        </span>
      </div>
    </article>
  )
}

export default function Explorer() {
  const [state, setState] = useState<State>({ k: 'loading' })
  const [query, setQuery] = useState('')
  const [verification, setVerification] = useState<VerificationLevel | 'all'>('all')
  const [risk, setRisk] = useState<RiskClass | 'all'>('all')

  useEffect(() => {
    let off = false
    readRegisteredHooks()
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

  const listable = useMemo(
    () => hooks.filter((h) => h.listing !== LISTING_MALICIOUS),
    [hooks],
  )

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
  const filtersOn = verification !== 'all' || risk !== 'all' || q !== ''

  return (
    <>
      <section className="dapp-card hx-head" aria-labelledby="hx-h">
        <div className="dapp-card__head">
          <h2 id="hx-h" className="dapp-card__title">
            Hook marketplace
          </h2>
          <span className="live-badge">
            <span className="live-dot" aria-hidden="true" />
            LIVE
          </span>
        </div>
        <p className="live-note">
          Every listing is read from the LatchHookRegistry on {d.name}. Capabilities are read
          from each hook&rsquo;s own contract — a submitter cannot declare permissions their code
          does not have. Names and descriptions <em>are</em> submitter-supplied and are never a
          capability claim.{' '}
          <a
            href={explorerAddress(SEPOLIA_CHAIN_ID, d.registry)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Registry contract
          </a>
        </p>
      </section>

      <div className="dapp-toolbar">
        <div className="dapp-search">
          <span className="dapp-search__ring" aria-hidden="true" />
          <input
            type="search"
            className="dapp-search__input"
            placeholder="Search hooks by name, description or address…"
            aria-label="Search hooks by name, description or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="hx-filters">
        <div className="hx-filterset">
          <p className="dapp-microlabel dapp-microlabel--tight" id="hx-f-verify">
            VERIFICATION
          </p>
          <div className="dapp-chips dapp-chips--tight" role="group" aria-labelledby="hx-f-verify">
            <button
              type="button"
              className={verification === 'all' ? 'dapp-chip is-active' : 'dapp-chip'}
              aria-pressed={verification === 'all'}
              onClick={() => setVerification('all')}
            >
              All
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
                <span className="hx-count">{listable.filter((h) => h.verification === v).length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hx-filterset">
          <p className="dapp-microlabel dapp-microlabel--tight" id="hx-f-risk">
            CAPABILITY CLASS
          </p>
          <div className="dapp-chips dapp-chips--tight" role="group" aria-labelledby="hx-f-risk">
            <button
              type="button"
              className={risk === 'all' ? 'dapp-chip is-active' : 'dapp-chip'}
              aria-pressed={risk === 'all'}
              onClick={() => setRisk('all')}
            >
              All
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

      {state.k === 'loading' && (
        <p className="dapp-empty hx-state" role="status">
          Reading the registry&hellip;
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
          No hooks are listed yet. The registry is deployed at{' '}
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
          <div className="dapp-grid dapp-grid--latches hx-flagged__grid">
            {flagged.map((h, i) => (
              <HookCard key={h.address} hook={h} index={i} />
            ))}
          </div>
        </section>
      )}

      {state.k === 'ready' && hooks.length > 0 && (
        <div className="dapp-grid dapp-grid--latches">
          {visible.map((h, i) => (
            <HookCard key={h.address} hook={h} index={i} />
          ))}
        </div>
      )}

      {state.k === 'ready' && listable.length > 0 && visible.length === 0 && (
        <p className="dapp-empty hx-state">
          No hook matches that {filtersOn ? 'search and filter' : 'view'}.{' '}
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
    </>
  )
}
