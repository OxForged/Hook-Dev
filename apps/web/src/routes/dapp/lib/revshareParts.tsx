/* ============================================================================
   Shared parts for the four revenue-share screens.

   Presentation only — every one of these renders something it was handed. The
   important ones are the STATE cards, because the repo's hardest rule lives
   here: loading, error, empty and not-found have to look different from one
   another and different from data, and none of them may show a figure.

     <Reading>       a read is in flight. Names what is being read.
     <Unreachable>   the RPC did not answer. Says so, offers a retry, and
                     shows NO numbers at all.
     <NotDeployed>   there is no RevShareHook address to read from.
     <Empty>         the read succeeded and the answer is nothing.

   `<Money>` is the other rule: an amount is always printed with its token
   symbol, never converted to a currency. Sepolia tokens are unpriced, so a
   dollar figure on this surface would be invented.
   ============================================================================ */

import { Link } from 'react-router-dom'
import { useState } from 'react'

import { DEPLOYMENTS } from '../../../lib/chain'
import {
  REVSHARE_CHAIN_ID,
  amountWithUnit,
  explorer,
  isPoolId,
  shortHex,
  type HookRef,
  type TokenMeta,
} from './revshare'
import { dappPath } from '../paths'

const CHAIN = DEPLOYMENTS[REVSHARE_CHAIN_ID]

/* --------------------------------------------------------------- primitives */

export function Money({ v, token }: { v: bigint; token: TokenMeta }) {
  return <span className="dapp-table__num">{amountWithUnit(v, token)}</span>
}

export function Addr({ value, label }: { value: string; label?: string }) {
  return (
    <a
      className="hx-addr"
      href={explorer(`address/${value}`)}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
    >
      {label ?? shortHex(value)}
    </a>
  )
}

export function PoolIdText({ value }: { value: string }) {
  return (
    <span className="hx-addr" title={value}>
      {shortHex(value, 10, 8)}
    </span>
  )
}

/* -------------------------------------------------------------- state cards */

export function Reading({ what }: { what: string }) {
  return (
    <section className="dapp-card" aria-busy="true">
      <p className="dp-tx__row">
        <span className="dapp-dot dapp-dot--primary dapp-dot--lg dapp-dot--pulse" aria-hidden="true" />
        Reading {what} from {CHAIN.name}…
      </p>
    </section>
  )
}

export function Unreachable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="dapp-card hx-state hx-state--err">
      <h2 className="dapp-card__title">{CHAIN.name} is unreachable</h2>
      <p className="live-note">
        The RPC did not answer, so this screen has nothing to show. It will not fall back to
        placeholder figures — an unreachable chain and an empty result are different answers, and
        only one of them is about your pools.
      </p>
      <p className="dp-failure__raw" style={{ marginTop: 8 }}>
        {message}
      </p>
      <button type="button" className="dapp-btn dapp-btn--sm" style={{ marginTop: 10 }} onClick={onRetry}>
        Try again
      </button>
    </section>
  )
}

export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="dapp-card an-empty">
      <p className="an-empty__title">{title}</p>
      <div className="live-note">{children}</div>
    </section>
  )
}

/**
 * No hook address anywhere. The honest default on Sepolia today — the protocol
 * is deployed there, a RevShareHook is not.
 */
export function NotDeployed({ malformed }: { malformed: boolean }) {
  return (
    <section className="dapp-card an-empty">
      <p className="an-empty__title">No RevShareHook to read</p>
      <p className="live-note">
        {malformed
          ? 'The ?hook= parameter in this URL is not a 20-byte address, so it was ignored.'
          : `This build has no RevShareHook address for ${CHAIN.name}, and there is no registry of hooks by type to discover one from.`}{' '}
        The protocol&rsquo;s own contracts — vault, pool managers, registry — are deployed and live;
        a revenue-share hook on top of them is not. Rather than read zeros off an address that does
        not exist, these screens show nothing.
      </p>
      <ul className="live-list" style={{ marginTop: 10 }}>
        <li>
          <span>Point them at a deployment</span>
          <span className="live-fee">add ?hook=0x… to the URL</span>
        </li>
        <li>
          <span>Or set a default for the whole build</span>
          <span className="live-fee">VITE_REVSHARE_HOOK</span>
        </li>
      </ul>
      <p className="live-note" style={{ marginTop: 10 }}>
        The contract read from is <code>RevShareHook</code> in{' '}
        <code>packages/hooks-revshare</code>. Everything on these four screens is a call to it or to
        the epoch distributor it names.
      </p>
    </section>
  )
}

/** Where the hook address came from. Provenance, on every screen that reads one. */
export function HookProvenance({ hook }: { hook: HookRef }) {
  return (
    <p className="live-note">
      Reading <Addr value={hook.address} /> on {CHAIN.name}
      {hook.source === 'url'
        ? ' — address taken from the ?hook= parameter in this URL, not from a protocol deployment record.'
        : ' — the build-time default from VITE_REVSHARE_HOOK.'}
    </p>
  )
}

/**
 * A pool id lookup.
 *
 * Screen B is public — anyone may inspect a pool&rsquo;s revenue share without a
 * wallet — so the not-connected state of screen A offers this rather than a
 * dead end. It validates the id shape locally; whether the pool exists is the
 * chain&rsquo;s answer, given on the next screen.
 */
export function PoolIdLookup({ withHook }: { withHook: (path: string) => string }) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const valid = isPoolId(trimmed)

  return (
    <div className="dp-field" style={{ marginTop: 12 }}>
      <label className="dapp-microlabel" htmlFor="rs-poolid">
        LOOK UP A POOL BY ID
      </label>
      <input
        id="rs-poolid"
        className="dp-input dp-input--mono"
        placeholder="0x… (32 bytes)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {trimmed !== '' && !valid && (
        <p className="dp-hint dp-hint--err">A pool id is 32 bytes — 0x followed by 64 hex characters.</p>
      )}
      {valid && (
        <Link
          className="dapp-btn dapp-btn--primary dapp-btn--sm"
          style={{ marginTop: 8, display: 'inline-block' }}
          to={withHook(dappPath(`protocol/${trimmed}`))}
        >
          Open this pool
        </Link>
      )}
    </div>
  )
}

/** A labelled figure in a KPI tile. `sub` carries the provenance, always. */
export function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="dapp-card dapp-card--kpi">
      <p className="dapp-microlabel">{label}</p>
      <p className="dapp-kpi__value">{value}</p>
      <p className="dapp-kpi__sub">{sub}</p>
    </div>
  )
}

export function ScreenIntro({
  title,
  children,
  hook,
}: {
  title: string
  children: React.ReactNode
  hook?: HookRef | undefined
}) {
  return (
    <section className="dapp-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">{title}</h2>
        <span className="live-badge">
          <span className="live-dot" aria-hidden="true" />
          LIVE
        </span>
      </div>
      <div className="live-note">{children}</div>
      {hook && (
        <div style={{ marginTop: 8 }}>
          <HookProvenance hook={hook} />
        </div>
      )}
    </section>
  )
}

