/* ============================================================================
   /app/marketplace/:address — one Latch, in full.

   The marketplace shows cards; this is the product page behind a card. It is
   the in-app counterpart of the public `/verify/:hookAddress` permalink and
   reads through the same `readRegisteredLatch`, so the two can never disagree
   about whether a Latch is registered.

   The page is ordered the way a decision is actually made, which is close to
   the reverse of how a store usually sells something:

     1. Who it is, the info strip of on-chain signals, and any warning it has
        earned — on the hero, above everything the submitter wrote.
     2. What it CAN DO — the three-question ledger and the full fourteen-row
        permission matrix, decoded from its own bytecode and grouped by what
        each callback is able to do. This is the section nobody can fake and
        it is the one that gets the most page.
     3. Only then, what the submitter says about it, marked as their words.
     4. The information table: every address and link, each marked as either
        read from chain or claimed by the submitter.

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

import { ChainTag, chainNameFor } from '../../../components/ChainTag.tsx'
import { HOOK_CALLBACK_BIT } from '../../../data/registry.generated.ts'
import {
  DEPLOYMENTS,
  SEPOLIA_CHAIN_ID,
  explorerAddress,
  readRegisteredLatch,
  type LatchLookup,
} from '../../../lib/chain'
import { CapabilityLedger, LatchAlerts, Ribbon, TrustStrip } from '../components/LatchSignals.tsx'
import {
  CALLBACK_GROUPS,
  TOTAL_CALLBACKS,
  bitmapHex,
  hasAlerts,
  latchTone,
  onChainSubline,
  safeHttpUrl,
  shortAddress,
} from '../components/latchModel.ts'
import { dappPath } from '../paths.ts'

/* Every result remembers which address it answers for. A result for a previous
   address is simply not shown, so navigating between two Latches never flashes
   the old record under the new URL — and there is no state to reset in an
   effect. */
type Result =
  | { for: string; k: 'error'; message: string }
  | { for: string; k: 'ready'; lookup: LatchLookup }

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

function short(a: string): string {
  return shortAddress(a, 10, 6)
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
  const [result, setResult] = useState<Result | null>(null)
  const chainName = chainNameFor(SEPOLIA_CHAIN_ID)
  const registry = DEPLOYMENTS[SEPOLIA_CHAIN_ID].registry

  const malformed = !address || !ADDRESS_RE.test(address)

  useEffect(() => {
    if (malformed || !address) return
    let off = false
    readRegisteredLatch(address as `0x${string}`)
      .then((lookup) => !off && setResult({ for: address, k: 'ready', lookup }))
      .catch(
        (e) =>
          !off &&
          setResult({
            for: address,
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

  const state = result && result.for === address ? result : null

  if (state === null) {
    return (
      /* The heading names what is being read, so the live region is the whole
         card rather than the sentence under it — announcing "Looking up 0x…"
         without "Reading the registry" leaves out the only word that says what
         kind of answer is coming. */
      <section className="dapp-card" role="status">
        <h2 className="dapp-card__title">Reading the Latch registry…</h2>
        <p className="live-note">
          Looking up {short(address)} on {chainName}.
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
            : `There is no contract at this address on ${chainName}.`}{' '}
          It has no verification level, no capability class and no listing status — because it has
          no record, not because those values are zero. Checked at block{' '}
          {checkedAtBlock.toString()}.
        </p>
        <p className="dapp-note">
          <a
            href={explorerAddress(SEPOLIA_CHAIN_ID, address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View {short(address)} on the block explorer ↗
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
  const source = safeHttpUrl(h.sourceURI)
  const audit = safeHttpUrl(h.auditURI)
  const held = new Set(h.callbacks)
  const tone = latchTone(h)

  return (
    <div className="lx-detail" data-tone={tone}>
      <BackLink />

      {/* 1 — who it is, the strip, and any warning. */}
      <section className="dapp-card lx-hero" aria-labelledby="ld-name">
        <Ribbon hook={h} />

        <div className="lx-hero__top">
          <span className="dapp-tile lx-hero__icon" aria-hidden="true">
            <span className="dapp-tile__diamond" />
          </span>
          <div className="lx-hero__id">
            <h2 id="ld-name" className="lx-hero__name">
              {h.name || 'Unnamed Latch'}
            </h2>
            <p className="lx-hero__sub" data-risk={h.risk}>
              {onChainSubline(h)}
            </p>
            <p className="lx-hero__by">
              Listed by{' '}
              <a
                href={explorerAddress(h.chainId, h.submitter)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {short(h.submitter)}
              </a>
              <span className="lx-hero__dot" aria-hidden="true">
                ·
              </span>
              <ChainTag chainId={h.chainId} size={14} />
            </p>
          </div>
          <div className="lx-hero__actions">
            <a
              className="dapp-btn dapp-btn--ghost dapp-btn--sm"
              href={explorerAddress(h.chainId, h.address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contract ↗
            </a>
            {source && (
              <a
                className="dapp-btn dapp-btn--ghost dapp-btn--sm"
                href={source}
                target="_blank"
                rel="noopener noreferrer"
              >
                Source ↗
              </a>
            )}
            {audit && (
              <a
                className="dapp-btn dapp-btn--ghost dapp-btn--sm"
                href={audit}
                target="_blank"
                rel="noopener noreferrer"
              >
                Audit ↗
              </a>
            )}
          </div>
        </div>

        <TrustStrip hook={h} extended />

        {hasAlerts(h) && (
          <div className="lx-hero__alerts">
            <LatchAlerts hook={h} />
          </div>
        )}
      </section>

      {/* 2 — the un-fakeable section. */}
      <section className="dapp-card lx-section" aria-labelledby="ld-caps">
        <div className="dapp-card__head">
          <h3 id="ld-caps" className="dapp-card__title dapp-card__title--lg">
            Permissions
          </h3>
          <span className="dapp-badge dapp-badge--info tabular">BITMAP {bitmapHex(h)}</span>
        </div>
        <p className="live-note">
          Read by calling <code>getHooksRegistrationBitmap()</code> on the Latch&rsquo;s own
          contract, and classified by the registry. A submitter cannot declare a permission
          their code does not have, so this is the part of the page nobody can fake.
        </p>

        <CapabilityLedger hook={h} detail />

        <div className="lx-matrix">
          <p className="dapp-microlabel dapp-microlabel--tight">
            ALL {TOTAL_CALLBACKS} CALLBACKS · {held.size} HELD
          </p>
          {/* Every row, held or not, grouped by what a held bit lets the Latch
              do. An omitted row would read as "unknown" rather than as "no". */}
          {CALLBACK_GROUPS.map((g) => {
            const n = g.names.filter((name) => held.has(name)).length
            return (
              <section key={g.kind} className="lx-matrix__group" data-kind={g.kind} data-any={n > 0 ? 'yes' : 'no'}>
                <h4 className="lx-matrix__h">
                  <span className="lx-matrix__swatch" aria-hidden="true" />
                  {g.title}
                  <span className="lx-matrix__n tabular">
                    {n} of {g.names.length} held
                  </span>
                </h4>
                <p className="lx-matrix__why">{g.meaning}</p>
                <ul className="lx-perms">
                  {g.names.map((name) => {
                    const on = held.has(name)
                    return (
                      <li key={name} data-held={on ? 'yes' : 'no'} data-kind={g.kind}>
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
            )
          })}
        </div>
      </section>

      {/* 3 — the submitter's own words, marked as theirs. */}
      <section className="dapp-card lx-section" aria-labelledby="ld-said">
        <div className="dapp-card__head">
          <h3 id="ld-said" className="dapp-card__title dapp-card__title--lg">
            What the submitter says
          </h3>
          <span className="dapp-badge dapp-badge--mute">UNVERIFIED</span>
        </div>
        <p className="live-note">
          Everything in this card was typed by whoever registered the Latch. None of it is
          verified, and none of it is a capability claim — the section above is.
        </p>
        <blockquote className="lx-quote">
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
      </section>

      {/* 4 — the information table. Each row says where it came from. */}
      <section className="dapp-card lx-section" aria-labelledby="ld-info">
        <h3 id="ld-info" className="dapp-card__title dapp-card__title--lg">
          Information
        </h3>
        <dl className="lx-info">
          <div className="lx-info__row">
            <dt>
              Address <span className="lx-info__src">on chain</span>
            </dt>
            <dd className="lx-info__mono">
              <a
                href={explorerAddress(h.chainId, h.address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {h.address} ↗
              </a>
            </dd>
          </div>
          <div className="lx-info__row">
            <dt>
              Chain <span className="lx-info__src">on chain</span>
            </dt>
            <dd>
              <ChainTag chainId={h.chainId} size={14} />
            </dd>
          </div>
          <div className="lx-info__row">
            <dt>
              Registry <span className="lx-info__src">on chain</span>
            </dt>
            <dd className="lx-info__mono">
              <a
                href={explorerAddress(SEPOLIA_CHAIN_ID, registry)}
                target="_blank"
                rel="noopener noreferrer"
              >
                LatchRegistry {shortAddress(registry)} ↗
              </a>
            </dd>
          </div>
          <div className="lx-info__row">
            <dt>
              Submitter <span className="lx-info__src">on chain</span>
            </dt>
            <dd className="lx-info__mono">
              <a
                href={explorerAddress(h.chainId, h.submitter)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {h.submitter} ↗
              </a>
            </dd>
          </div>
          <div className="lx-info__row">
            <dt>
              Bitmap <span className="lx-info__src">on chain</span>
            </dt>
            <dd className="lx-info__mono tabular">
              {bitmapHex(h)} · {held.size} of {TOTAL_CALLBACKS} callbacks
            </dd>
          </div>
          <div className="lx-info__row">
            <dt>
              Source <span className="lx-info__src lx-info__src--claim">submitter&rsquo;s link</span>
            </dt>
            <dd className="lx-info__mono">
              {source ? (
                <a href={source} target="_blank" rel="noopener noreferrer">
                  {source} ↗
                </a>
              ) : (
                <span className="hx-muted">{h.sourceURI || 'none given'}</span>
              )}
            </dd>
          </div>
          <div className="lx-info__row">
            <dt>
              Audit <span className="lx-info__src lx-info__src--claim">submitter&rsquo;s link</span>
            </dt>
            <dd className="lx-info__mono">
              {audit ? (
                <a href={audit} target="_blank" rel="noopener noreferrer">
                  {audit} ↗
                </a>
              ) : (
                <span className="hx-muted">{h.auditURI || 'none given'}</span>
              )}
            </dd>
          </div>
          <div className="lx-info__row">
            <dt>Public record</dt>
            <dd className="lx-info__mono">
              <a href={`/verify/${h.address}`} target="_blank" rel="noopener noreferrer">
                /verify/{shortAddress(h.address)} ↗
              </a>
              <span className="lx-info__aside"> — the same record, no wallet, no app.</span>
            </dd>
          </div>
        </dl>
        <p className="dapp-note lx-section__note">
          A link marked as the submitter&rsquo;s is a claim, not a verification — follow it and
          read what is on the other end.
        </p>
        <BackLink />
      </section>
    </div>
  )
}
