/* ============================================================================
   /app/marketplace/:address — one Latch, in full.

   The marketplace listing shows cards; this is the page behind a card. It is
   the in-app counterpart of the public `/verify/:hookAddress` permalink and
   reads through the same `readRegisteredHook`, so the two can never disagree
   about whether a Latch is registered.

   The same rule the verify page is built around applies here and is the reason
   both use that helper rather than reading the record directly: an address the
   registry has never heard of must NOT render as a listed Latch with empty
   fields. "Unverified · Passive · Active" is the most reassuring thing that
   could be said about a contract, and a zeroed struct says all three. So
   `found: false` is a different screen, not a sparse version of this one.

   Naming note: the URL and the copy say Latch, because that is the product.
   The contract-level names stay as they are — `LatchHookRegistry`,
   `getHooksRegistrationBitmap()` — because that is what the chain actually
   exposes, and renaming them in the UI would misdescribe the API a developer
   has to call.
   ============================================================================ */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  LISTING_LABEL,
  RISK_LABEL,
  SEPOLIA_CHAIN_ID,
  VERIFICATION_LABEL,
  capabilityClaims,
  explorerAddress,
  readRegisteredHook,
  type HookLookup,
} from '../../../lib/chain'
import { dappPath } from '../paths.ts'

type State =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; lookup: HookLookup }

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

/** Listing state drives the badge colour: a flagged Latch must not look neutral. */
const LISTING_CLASS = ['dapp-badge--ok', 'dapp-badge--mute', 'dapp-badge--warn'] as const

function short(a: string): string {
  return `${a.slice(0, 10)}…${a.slice(-6)}`
}

/**
 * Submitter-supplied strings are rendered as text, never as markup, and any URI
 * is allowed through only when it is plainly http(s). A listing is written by
 * whoever registered it, so it is untrusted input on a page whose whole job is
 * telling someone whether to trust something.
 */
function safeHttpUrl(uri: string): string | null {
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export default function LatchDetail() {
  const { address } = useParams()
  const [state, setState] = useState<State>({ k: 'idle' })

  const malformed = !address || !ADDRESS_RE.test(address)

  useEffect(() => {
    if (malformed || !address) return
    let off = false
    setState({ k: 'loading' })
    readRegisteredHook(address as `0x${string}`)
      .then((lookup) => !off && setState({ k: 'ready', lookup }))
      .catch(
        (e) =>
          !off &&
          setState({
            k: 'error',
            message: e instanceof Error ? e.message : 'chain unreachable',
          }),
      )
    return () => {
      off = true
    }
  }, [address, malformed])

  const back = (
    <p className="dapp-note" style={{ marginTop: 18 }}>
      <Link to={dappPath('marketplace')}>&larr; Back to the Latch Marketplace</Link>
    </p>
  )

  if (malformed) {
    return (
      <section className="dapp-card" aria-labelledby="ld-h">
        <div className="dapp-card__head">
          <h2 id="ld-h" className="dapp-card__title">
            That is not a valid address
          </h2>
          <span className="dapp-badge dapp-badge--warn">NOT AN ADDRESS</span>
        </div>
        <p className="live-note">
          A Latch is identified by a 20-byte EVM address — <code>0x</code> followed by exactly 40
          hexadecimal characters. Nothing was looked up, so this says nothing about any Latch.
        </p>
        {back}
      </section>
    )
  }

  if (state.k === 'loading' || state.k === 'idle') {
    return (
      <section className="dapp-card">
        <h2 className="dapp-card__title">Reading the registry…</h2>
        <p className="live-note" role="status">
          Looking up {short(address!)} on Ethereum Sepolia.
        </p>
      </section>
    )
  }

  if (state.k === 'error') {
    return (
      <section className="dapp-card">
        <div className="dapp-card__head">
          <h2 className="dapp-card__title">Could not reach the chain</h2>
          <span className="dapp-badge dapp-badge--warn">UNREACHABLE</span>
        </div>
        <p className="live-note live-note--err" role="status">
          {state.message}. This is a network failure, not a verdict — an unreachable RPC is not the
          same answer as &ldquo;not registered&rdquo;, and this page will not conflate them.
        </p>
        {back}
      </section>
    )
  }

  if (!state.lookup.found) {
    const { hasCode, checkedAtBlock } = state.lookup
    return (
      <section className="dapp-card" aria-labelledby="ld-nr">
        <div className="dapp-card__head">
          <h2 id="ld-nr" className="dapp-card__title">
            This Latch is not in the registry
          </h2>
          <span className="dapp-badge dapp-badge--warn">NOT REGISTERED</span>
        </div>
        <p className="live-note">
          {hasCode
            ? 'A contract exists at this address, but nobody has ever listed it.'
            : 'There is no contract at this address on Ethereum Sepolia.'}{' '}
          It has no verification level, no capability class and no listing status — because it has
          no record, not because those values are zero. Checked at block{' '}
          {checkedAtBlock.toString()}.
        </p>
        <p className="dapp-note">
          <a
            href={explorerAddress(SEPOLIA_CHAIN_ID, address!)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View {short(address!)} on Etherscan ↗
          </a>
        </p>
        <p className="dapp-note">
          Anyone can list a Latch — registration is permissionless and free.{' '}
          <Link to={dappPath('deploy')}>Deploy a Latch</Link>.
        </p>
        {back}
      </section>
    )
  }

  const h = state.lookup.hook
  const claims = capabilityClaims(h)
  const source = safeHttpUrl(h.sourceURI)
  const audit = safeHttpUrl(h.auditURI)

  return (
    <>
      <section className="dapp-card" aria-labelledby="ld-name">
        <div className="dapp-card__head">
          <h2 id="ld-name" className="dapp-card__title">
            {h.name}
          </h2>
          <span className={`dapp-badge ${LISTING_CLASS[h.listing] ?? 'dapp-badge--mute'}`}>
            {LISTING_LABEL[h.listing]}
          </span>
        </div>

        <p className="live-note">{h.description}</p>
        <p className="dapp-note">
          Name and description are written by whoever registered this Latch. They are not
          verified, and they are never a capability claim — the capabilities below are.
        </p>

        <dl className="live-grid" style={{ marginTop: 14 }}>
          <div>
            <dt>Address</dt>
            <dd>
              <a
                href={explorerAddress(SEPOLIA_CHAIN_ID, h.address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {short(h.address)} ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Submitter</dt>
            <dd>
              <a
                href={explorerAddress(SEPOLIA_CHAIN_ID, h.submitter)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {short(h.submitter)} ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>{VERIFICATION_LABEL[h.verification]}</dd>
          </div>
          <div>
            <dt>Capability class</dt>
            <dd>{RISK_LABEL[h.risk]}</dd>
          </div>
        </dl>
      </section>

      <section className="dapp-card">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">What this Latch can do</h3>
          <span className="dapp-badge dapp-badge--info">
            BITMAP 0x{h.permissions.toString(16).padStart(4, '0')}
          </span>
        </div>
        <p className="live-note">
          Read by calling <code>getHooksRegistrationBitmap()</code> on the Latch&rsquo;s own
          contract. A submitter cannot declare a permission their code does not have, so this is
          the part of the page nobody can fake.
        </p>
        {claims.length > 0 ? (
          <ul className="live-list">
            {claims.map((c) => (
              <li key={c}>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="live-note">
            This Latch declares no callbacks at all. It cannot intervene in a pool&rsquo;s
            behaviour.
          </p>
        )}
      </section>

      <section className="dapp-card">
        <h3 className="dapp-card__title">Source and audit</h3>
        <p className="live-note">
          Both links are supplied by the submitter. A link here is a claim, not a verification —
          follow it and read what is on the other end.
        </p>
        <ul className="live-list">
          <li>
            <span>Source</span>
            <span className="live-fee">
              {source ? (
                <a href={source} target="_blank" rel="noopener noreferrer">
                  {source} ↗
                </a>
              ) : (
                h.sourceURI || 'none given'
              )}
            </span>
          </li>
          <li>
            <span>Audit</span>
            <span className="live-fee">
              {audit ? (
                <a href={audit} target="_blank" rel="noopener noreferrer">
                  {audit} ↗
                </a>
              ) : (
                h.auditURI || 'none given'
              )}
            </span>
          </li>
        </ul>
        <p className="dapp-note" style={{ marginTop: 14 }}>
          Share this Latch with someone who has no wallet:{' '}
          <a href={`/verify/${h.address}`} target="_blank" rel="noopener noreferrer">
            public verification permalink ↗
          </a>
        </p>
        {back}
      </section>
    </>
  )
}
