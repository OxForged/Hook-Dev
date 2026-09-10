/* ============================================================================
   /app/marketplace/:address — one Latch, in full.

   The marketplace shows cards; this is the product page behind a card. It is
   the in-app counterpart of the public `/verify/:hookAddress` permalink and
   reads through the same `readRegisteredLatch`, so the two can never disagree
   about whether a Latch is registered.

   The page is ordered the way a decision is actually made, which is close to
   the reverse of how a store usually sells something:

     1. Who it is, and the three on-chain signals.
     2. Any warning it has earned.
     3. What it CAN DO — the full fourteen-row permission matrix, decoded from
        its own bytecode. This is the section nobody can fake and it is the one
        that gets the most page.
     4. Only then, what the submitter says about it, marked as their words.
     5. Source and audit links, marked as claims.

   The same rule the verify page is built around applies here and is the reason
   both use `readRegisteredLatch` rather than reading the record directly: an
   address the registry has never heard of must NOT render as a listed Latch
   with empty fields. "Unverified · Passive · Active" is the most reassuring
   thing that could be said about a contract, and a zeroed struct says all
   three. So `found: false` is a different screen, not a sparse version of this
   one.

   Naming note: the URL and the copy say Latch, because that is the product.
   The contract-level names stay as they are — `LatchRegistry`,
   `getHooksRegistrationBitmap()` — because that is what the chain actually
   exposes, and renaming them in the UI would misdescribe the API a developer
   has to call.
   ============================================================================ */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ChainMark } from '../../../components/ChainMark.tsx'
import { chainByKey } from '../../../data/chains.ts'
import {
  HOOK_CALLBACKS,
  HOOK_CALLBACK_BIT,
  RETURNS_DELTA_CALLBACKS,
  VETO_CALLBACKS,
} from '../../../data/registry.generated.ts'
import {
  SEPOLIA_CHAIN_ID,
  capabilityClaims,
  explorerAddress,
  readRegisteredLatch,
  type LatchLookup,
  type RegisteredLatch,
} from '../../../lib/chain'
import { dappPath } from '../paths.ts'
import { LatchAlerts, TrustRow } from './Explorer.tsx'

type State =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; lookup: LatchLookup }

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

/* The callbacks that can cost somebody money, from the registry's own masks —
   not a judgement made here. A held row in either set is coloured as a risk. */
const RISK_BEARING = new Set<string>([...RETURNS_DELTA_CALLBACKS, ...VETO_CALLBACKS])

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

/** Mirrors Explorer's `cardTone`: listing state and capability class only. */
function detailTone(h: RegisteredLatch): 'danger' | 'caution' | 'deprecated' | 'plain' {
  if (h.listing === 2 || h.risk === 2 || !h.permissionsReadable) return 'danger'
  if (h.listing === 1) return 'deprecated'
  if (h.risk === 1 || !h.permissionsValid) return 'caution'
  return 'plain'
}

function BackLink() {
  return (
    <p className="lx-back">
      <Link to={dappPath('marketplace')}>&larr; All Latches</Link>
    </p>
  )
}

export default function LatchDetail() {
  const { address } = useParams()
  const [state, setState] = useState<State>({ k: 'idle' })
  const sepolia = chainByKey('sepolia')

  const malformed = !address || !ADDRESS_RE.test(address)

  useEffect(() => {
    if (malformed || !address) return
    let off = false
    setState({ k: 'loading' })
    readRegisteredLatch(address as `0x${string}`)
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
        <BackLink />
      </section>
    )
  }

  if (state.k === 'loading' || state.k === 'idle') {
    return (
      /* The heading names what is being read, so the live region is the whole
         card rather than the sentence under it — announcing "Looking up 0x…"
         without "Reading the registry" leaves out the only word that says what
         kind of answer is coming. */
      <section className="dapp-card" role="status">
        <h2 className="dapp-card__title">Reading the Latch registry…</h2>
        <p className="live-note">Looking up {short(address!)} on Ethereum Sepolia.</p>
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
        <BackLink />
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
        <BackLink />
      </section>
    )
  }

  const h = state.lookup.latch
  const claims = capabilityClaims(h)
  const source = safeHttpUrl(h.sourceURI)
  const audit = safeHttpUrl(h.auditURI)
  const held = new Set(h.callbacks)
  const tone = detailTone(h)

  return (
    <div className="lx-detail" data-tone={tone}>
      <BackLink />

      {/* 1 — who it is, and the three signals. */}
      <section className="dapp-card lx-hero" aria-labelledby="ld-name">
        <div className="lx-hero__top">
          <span className="dapp-tile lx-hero__icon" aria-hidden="true">
            <span className="dapp-tile__diamond" />
          </span>
          <div className="lx-hero__id">
            <h2 id="ld-name" className="lx-hero__name">
              {h.name || 'Unnamed Latch'}
            </h2>
            <p className="lx-hero__addr">
              <a
                href={explorerAddress(h.chainId, h.address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {short(h.address)} ↗
              </a>
              <span className="lx-hero__chain">
                <ChainMark brand={sepolia.brand} size={14} className="lx-hero__mark" />
                {sepolia.name}
              </span>
            </p>
          </div>
        </div>

        <TrustRow hook={h} size="lg" />

        {/* 2 — any warning it has earned, before anything it says about itself. */}
        <LatchAlerts hook={h} />
      </section>

      {/* 3 — the un-fakeable section. */}
      <section className="dapp-card" aria-labelledby="ld-caps">
        <div className="dapp-card__head">
          <h3 id="ld-caps" className="dapp-card__title dapp-card__title--lg">
            What this Latch can do
          </h3>
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
          <ul className="hx-caps__list" style={{ marginTop: 12 }}>
            {claims.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : (
          <p className="live-note">
            This Latch declares no callbacks at all. It cannot intervene in a pool&rsquo;s
            behaviour.
          </p>
        )}

        <p className="dapp-microlabel dapp-microlabel--tight" style={{ marginTop: 18 }}>
          ALL {HOOK_CALLBACKS.length} CALLBACKS · {held.size} HELD
        </p>
        {/* Every row, held or not. An omitted row would read as "unknown". */}
        <ul className="lx-perms">
          {HOOK_CALLBACKS.map((name) => {
            const on = held.has(name)
            return (
              <li
                key={name}
                data-held={on ? 'yes' : 'no'}
                data-danger={RISK_BEARING.has(name) ? 'yes' : 'no'}
              >
                <span className="lx-perm__mark" aria-hidden="true">
                  {on ? '●' : '○'}
                </span>
                <span>{name}</span>
                <span className="dapp-sr">{on ? ' — held' : ' — not held'}</span>
                <span className="lx-perm__bit tabular">bit {HOOK_CALLBACK_BIT[name]}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 4 — the submitter's own words, marked as theirs. */}
      <section className="dapp-card" aria-labelledby="ld-said">
        <h3 id="ld-said" className="dapp-card__title dapp-card__title--lg">
          What the submitter says
        </h3>
        <p className="live-note">
          Everything in this card was typed by whoever registered the Latch. None of it is
          verified, and none of it is a capability claim — the section above is.
        </p>
        <blockquote className="lx-quote" style={{ marginTop: 12 }}>
          {h.description || <span className="hx-muted">No description supplied.</span>}
          <cite className="lx-quote__by">
            — {h.name || 'Unnamed Latch'}, as listed by{' '}
            <a
              href={explorerAddress(h.chainId, h.submitter)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {short(h.submitter)} ↗
            </a>
          </cite>
        </blockquote>

        <dl className="lx-kv" style={{ marginTop: 16 }}>
          <div>
            <dt>Source</dt>
            <dd className="lx-kv__mono">
              {source ? (
                <a href={source} target="_blank" rel="noopener noreferrer">
                  {source} ↗
                </a>
              ) : (
                <span className="hx-muted">{h.sourceURI || 'none given'}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Audit</dt>
            <dd className="lx-kv__mono">
              {audit ? (
                <a href={audit} target="_blank" rel="noopener noreferrer">
                  {audit} ↗
                </a>
              ) : (
                <span className="hx-muted">{h.auditURI || 'none given'}</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="dapp-note" style={{ marginTop: 12 }}>
          A link here is a claim, not a verification — follow it and read what is on the other end.
        </p>
      </section>

      <section className="dapp-card">
        <h3 className="dapp-card__title">Share this record</h3>
        <p className="live-note">
          The same record, on a page that needs no wallet and no app:{' '}
          <a href={`/verify/${h.address}`} target="_blank" rel="noopener noreferrer">
            public verification permalink ↗
          </a>
        </p>
        <BackLink />
      </section>
    </div>
  )
}
