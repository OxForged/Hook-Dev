/* ============================================================================
   /verify/:hookAddress — the public, wallet-free Latch verification permalink.

   This page exists to be linked FROM SOMEWHERE ELSE. A Latch developer puts the
   URL on their own site; a stranger with no wallet, no connection and no prior
   context opens it and gets the on-chain trust signals for that one address.
   There is no wallet, no signing, no write path, and nothing here is gated.

   ---------------------------------------------------------------------------
   THE FAILURE THIS PAGE IS BUILT TO NOT HAVE
   ---------------------------------------------------------------------------

   The obvious way to build this screen is: take the address, read the record,
   render the fields. That version has a hole in it. Ask it about an address the
   registry has never heard of — a factory, an EOA, a typo — and a zeroed record
   renders as a real one: "Unverified · Passive · Active · no permissions". Every
   one of those words is the *most reassuring* thing that could be said about a
   contract nobody has ever looked at, and the page says them about a contract
   that does not exist. A reader cannot tell that apart from a genuinely empty,
   genuinely listed Latch.

   So the order here is not negotiable:

     1. Is the string even an address? Malformed input gets its own answer and
        never reaches the chain.
     2. Is it REGISTERED? `readRegisteredLatch` asks `isRegistered` first and
        returns `found: false` as a positive result. Nothing below step 2 renders
        until that is `true`.
     3. Only then, the trust panel.

   "Not in the registry" and "in the registry with nothing in it" are rendered by
   different components, in different colours, with different headings. They are
   built to be visually impossible to confuse.

   Loading, unreachable-chain, not-registered and registered are four distinct
   states. In particular an unreachable RPC is NEVER reported as "not found" —
   those are opposite answers, and collapsing them would let a network blip
   accuse an honest Latch of not existing.

   ---------------------------------------------------------------------------
   WHAT IS A FACT AND WHAT IS A CLAIM
   ---------------------------------------------------------------------------

   Permissions, risk class, verification level and listing state are read from
   chain. The bitmap in particular is read by the registry off the Latch's OWN
   contract at registration — there is no parameter through which a submitter can
   declare it — so it is the one thing on this page a submitter cannot lie about.

   Name, description, sourceURI and auditURI are submitter-supplied strings out
   of contract storage. They are rendered as quoted prose under a heading that
   says so, never as a capability claim, and their URLs go through `safeHttpUrl`
   so a `javascript:` URI becomes inert text instead of a link.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isAddress, type Address } from 'viem'

import {
  DEPLOYMENTS,
  LISTING_LABEL,
  RISK_LABEL,
  ACTIVE_CHAIN_ID,
  VERIFICATION_LABEL,
  capabilityClaims,
  explorerAddress,
  readRegisteredLatch,
  type LatchLookup,
  type ListingState,
  type RegisteredLatch,
  type RiskClass,
  type VerificationLevel,
} from '../../lib/chain'
import { BitGrid, type BitDef } from '../dapp/components/series-charts'
import landing from '../landing/landing.module.css'
import { SiteFooter } from '../landing/SiteFooter'
import { SiteHeader } from '../landing/SiteHeader'
import styles from './verify.module.css'

const LISTING_DEPRECATED = 1 satisfies ListingState
const LISTING_MALICIOUS = 2 satisfies ListingState
const RISK_VALUE_EXTRACTING = 2 satisfies RiskClass
const VERIFICATION_SOURCE = 1 satisfies VerificationLevel
const VERIFICATION_AUDITED = 2 satisfies VerificationLevel

const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/** Tone drives colour and nothing else — never the other way round. */
type Tone = 'ok' | 'info' | 'mute' | 'warn' | 'danger'

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ')

const toneClass = (tone: Tone) => styles[`tone-${tone}`]

/** An unverified Latch must never borrow the visual language of an audited one. */
const VERIFICATION_TONE: Record<VerificationLevel, Tone> = { 0: 'mute', 1: 'info', 2: 'ok' }
const RISK_TONE: Record<RiskClass, Tone> = { 0: 'mute', 1: 'warn', 2: 'danger' }
const LISTING_TONE: Record<ListingState, Tone> = { 0: 'ok', 1: 'warn', 2: 'danger' }

/* ===========================================================================
   The permission bitmap, as a grid.

   ORDER IS THE CONTRACT. Bit n here is bit n in
   packages/core/src/pool-cl/interfaces/ICLHooks.sol — beforeInitialize 0x0001
   through afterRemoveLiquidityReturnsDelta 0x2000 — and it is the SAME order,
   position for position, as `CALLBACK_FIELDS` in lib/chain.ts, which is the
   order the registry's own `decodePermissions` returns. That is not a
   coincidence to be relied on quietly: `VerifiedHook` cross-checks the two and
   refuses to let them disagree in silence, because two components describing
   one bitmap two ways is how a reader ends up trusting a Latch the chain would
   have warned them about.

   Unset bits are drawn, dimmed, rather than omitted. "This Latch does NOT run
   before a swap" is as much a reading as the inverse, and a grid showing only
   what is on hides the shape of what is off.
   =========================================================================== */

const HOOK_BITS: readonly BitDef[] = [
  { bit: 0, name: 'beforeInitialize', note: 'Can reject a pool before it exists.' },
  { bit: 1, name: 'afterInitialize', note: 'Runs once, after the pool is created.' },
  { bit: 2, name: 'beforeAddLiquidity', note: 'Can refuse a deposit.' },
  { bit: 3, name: 'afterAddLiquidity', note: 'Runs after a deposit settles.' },
  { bit: 4, name: 'beforeRemoveLiquidity', note: 'Can refuse a withdrawal.' },
  { bit: 5, name: 'afterRemoveLiquidity', note: 'Runs after a withdrawal settles.' },
  { bit: 6, name: 'beforeSwap', note: 'Can block a swap, or override the fee.' },
  { bit: 7, name: 'afterSwap', note: 'Runs once the swap has executed.' },
  { bit: 8, name: 'beforeDonate', note: 'Can refuse a donation to in-range liquidity.' },
  { bit: 9, name: 'afterDonate', note: 'Runs after a donation settles.' },
  { bit: 10, name: 'beforeSwapReturnsDelta', note: 'Lets beforeSwap resize the swap amount.' },
  { bit: 11, name: 'afterSwapReturnsDelta', note: 'Lets afterSwap take a cut of the output.' },
  { bit: 12, name: 'afterAddLiquidityReturnsDelta', note: 'Lets it take a cut of a deposit.' },
  { bit: 13, name: 'afterRemoveLiquidityReturnsDelta', note: 'Lets it take a cut of a withdrawal.' },
]

/**
 * Does the grid's own reading of the bitmap agree with the registry's?
 *
 * `hook.callbacks` comes from the chain — the registry's `decodePermissions`
 * over the bitmap it read off the Latch. The grid derives the same set locally,
 * from the same integer. They must match; if they ever do not, the local
 * derivation is the one that is wrong, and the page says so instead of drawing
 * a second opinion next to the chain's.
 */
function gridAgreesWithChain(hook: RegisteredLatch): boolean {
  const derived = HOOK_BITS.filter((b) => (hook.permissions & (1 << b.bit)) !== 0).map((b) => b.name)
  return (
    derived.length === hook.callbacks.length && derived.every((n, i) => n === hook.callbacks[i])
  )
}

/**
 * Format-only address check.
 *
 * `strict: false` deliberately: the checksum is a typo detector, not a validity
 * rule, and rejecting a lowercase-with-one-capital address pasted out of a chat
 * client would be an unhelpful answer to a well-formed question. A genuinely
 * mistyped address survives this and then correctly renders as NOT REGISTERED,
 * which is the honest outcome — there is no Latch at it.
 */
function parseAddress(raw: string | undefined): Address | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return isAddress(trimmed, { strict: false }) ? (trimmed as Address) : null
}

/** `0x1234…abcd`. Matches the marketplace's shortening exactly. */
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

/* ------------------------------------------------------------------ pieces */

function Badge({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <div className={cx(styles['badge'], toneClass(tone))}>
      <span className={styles['badgeLabel']}>{label}</span>
      <span className={styles['badgeValue']}>{value}</span>
    </div>
  )
}

function Alert({
  tone,
  title,
  children,
}: {
  tone: Tone
  title: string
  children: ReactNode
}) {
  return (
    <div className={cx(styles['alert'], toneClass(tone))} role="note">
      <span className={styles['alertDot']} aria-hidden="true" />
      <div className={styles['alertBody']}>
        <strong className={styles['alertTitle']}>{title}</strong>
        <p className={styles['alertText']}>{children}</p>
      </div>
    </div>
  )
}

/**
 * Methodology, one click away.
 *
 * The distinction this enforces: a caveat that changes how a figure should be
 * READ stays in the paragraph, because a reader who skips it misreads the page.
 * An explanation of WHY the registry behaves as it does is worth having and is
 * not worth four lines above the thing it explains. `<details>` keeps it
 * findable, keyboard-reachable and searchable by the browser's own find, with
 * no state for this page to manage.
 */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className={styles['more']}>
      <summary>{summary}</summary>
      <p>{children}</p>
    </details>
  )
}

/** Full address, monospace, with copy and an explorer link. Never truncated here. */
function AddressRow({ label, address }: { label: string; address: Address }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(address).then(
      () => {
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 1600)
      },
      () => setCopied(false),
    )
  }, [address])

  return (
    <div className={styles['addrRow']}>
      <span className={styles['addrLabel']}>{label}</span>
      <code className={styles['addrValue']}>{address}</code>
      <span className={styles['addrActions']}>
        <button type="button" className={styles['addrBtn']} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          className={styles['addrBtn']}
          href={explorerAddress(ACTIVE_CHAIN_ID, address)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Explorer ↗
        </a>
      </span>
    </div>
  )
}

/** Registry contract, chain and the block every figure above was read at. */
function Provenance({ checkedAtBlock }: { checkedAtBlock: bigint | null }) {
  return (
    <p className={styles['provenance']}>
      Read live from the LatchRegistry at{' '}
      <a
        href={explorerAddress(ACTIVE_CHAIN_ID, CHAIN.registry)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {short(CHAIN.registry)}
      </a>{' '}
      on {CHAIN.name}
      {checkedAtBlock !== null && <> at block {checkedAtBlock.toString()}</>}. No wallet, no
      account, nothing cached — reload and you re-read the chain.
    </p>
  )
}

/* ------------------------------------------------------------------ states */

/** (a) The string in the URL is not an EVM address. This never reaches the chain. */
function InvalidAddress({ raw }: { raw: string }) {
  return (
    <section className={cx(styles['verdict'], toneClass('mute'))} aria-labelledby="v-h">
      <p className={styles['verdictKicker']}>NOT AN ADDRESS</p>
      <h1 className={styles['verdictTitle']} id="v-h">
        That is not a valid address
      </h1>
      <p className={styles['verdictBody']}>
        The URL carried {raw ? <code className={styles['raw']}>{raw}</code> : <em>nothing</em>},
        which is not a 20-byte EVM address (<code>0x</code> and exactly 40 hex characters), so
        nothing was looked up. A problem with the link, not a verdict about any Latch.
      </p>
      <p className={styles['verdictBody']}>
        <Link className={styles['inlineLink']} to="/app/marketplace">
          Browse the Latch Marketplace &rarr;
        </Link>
      </p>
    </section>
  )
}

/** (d) The RPC could not be reached. Explicitly not a statement about the Latch. */
function Unreachable({
  address,
  message,
  onRetry,
}: {
  address: Address
  message: string
  onRetry: () => void
}) {
  return (
    <section className={cx(styles['verdict'], toneClass('warn'))} aria-labelledby="v-h">
      <p className={styles['verdictKicker']}>NO ANSWER</p>
      <h1 className={styles['verdictTitle']} id="v-h">
        Could not reach {CHAIN.name}
      </h1>
      <p className={styles['verdictBody']}>
        The registry could not be read, so this page has <strong>no verdict at all</strong> about{' '}
        <code className={styles['raw']}>{short(address)}</code>. That is a failure of the network
        between you and the chain — it is not evidence that the Latch is unregistered, and it is
        not evidence that it is safe. Nothing is shown rather than something invented.
      </p>
      <p className={styles['errDetail']}>{message}</p>
      <p className={styles['verdictBody']}>
        <button type="button" className={styles['retry']} onClick={onRetry}>
          Try again
        </button>
      </p>
    </section>
  )
}

/**
 * (b) A well-formed address that the registry has never heard of.
 *
 * This is the state the page exists for. It is deliberately built out of entirely
 * different components from the verified panel — no badge grid, no capability
 * list, no metadata block, no zeroes. There is no record, so there are no fields,
 * so no field is rendered empty. Nothing on this screen can be mistaken for a
 * Latch that was checked and came back clean.
 */
function NotRegistered({
  address,
  hasCode,
  checkedAtBlock,
}: {
  address: Address
  hasCode: boolean
  checkedAtBlock: bigint
}) {
  return (
    <>
      <section className={cx(styles['verdict'], styles['verdictNone'])} aria-labelledby="v-h">
        <p className={styles['verdictKicker']}>NOT REGISTERED</p>
        <h1 className={styles['verdictTitle']} id="v-h">
          There is no registry record for this address
        </h1>
        <p className={styles['verdictBody']}>
          {hasCode ? (
            <>
              A contract exists at this address on {CHAIN.name}, but{' '}
              <strong>nobody has ever listed it</strong> in the LatchRegistry. It has no
              verification level, no risk class and no listing status, because it has no record
              — not because those values are zero.
            </>
          ) : (
            <>
              There is <strong>no contract code at all</strong> at this address on {CHAIN.name}.
              It is an empty account, an address on some other chain, or a typo. Either way it
              is not a Latch, and the registry has no record of it.
            </>
          )}
        </p>
        <AddressRow label="Queried" address={address} />
      </section>

      <Alert tone="mute" title="Absence is not a verdict, in either direction">
        Listing is free and open to anyone, so plenty of perfectly good Latches are not listed —
        and no scam is prevented by failing to register. Read this page as{' '}
        <strong>&ldquo;this address has no on-chain trust signals here&rdquo;</strong>, which is
        exactly as far as it goes. It is not a clean bill of health and it is not an accusation.
      </Alert>

      <section className={styles['panel']}>
        <h2 className={styles['panelTitle']}>What you can do instead</h2>
        <ul className={styles['plainList']}>
          <li>
            Read the bytecode and transaction history yourself on{' '}
            <a
              className={styles['inlineLink']}
              href={explorerAddress(ACTIVE_CHAIN_ID, address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              the block explorer
            </a>
            .
          </li>
          <li>
            Check you are on the right chain. This page only reads {CHAIN.name}; the same
            address on another network is a different contract.
          </li>
          <li>
            If it is your Latch, anyone can list it — registration is permissionless, free, and
            reads the permission bitmap off the contract itself.
          </li>
        </ul>
      </section>

      <Provenance checkedAtBlock={checkedAtBlock} />
    </>
  )
}

/* --------------------------------------------------------- the trust panel */

/** The single sentence at the top. Worst signal wins; nothing softens a warning. */
function verdictFor(hook: RegisteredLatch): { tone: Tone; kicker: string; title: string } {
  if (hook.listing === LISTING_MALICIOUS) {
    return {
      tone: 'danger',
      kicker: 'FLAGGED MALICIOUS',
      title: 'A guardian has flagged this Latch as known to harm users',
    }
  }
  if (!hook.permissionsReadable) {
    return {
      tone: 'danger',
      kicker: 'STALE',
      title: 'The registry can no longer read this contract',
    }
  }
  if (hook.listing === LISTING_DEPRECATED) {
    return { tone: 'warn', kicker: 'DEPRECATED', title: 'Registered, and marked retired by a curator' }
  }
  if (!hook.permissionsValid) {
    return {
      tone: 'warn',
      kicker: 'MALFORMED',
      title: 'Registered, but its permission bitmap is not one core would accept',
    }
  }
  if (hook.risk === RISK_VALUE_EXTRACTING) {
    return {
      tone: 'danger',
      kicker: 'REGISTERED · VALUE-EXTRACTING',
      title: 'This Latch can take value out of your trades',
    }
  }
  if (hook.verification === VERIFICATION_AUDITED) {
    return {
      tone: 'ok',
      kicker: 'REGISTERED · AUDITED',
      title: 'Registered, and audited by a curator',
    }
  }
  if (hook.verification === VERIFICATION_SOURCE) {
    return {
      tone: 'info',
      kicker: 'REGISTERED · SOURCE VERIFIED',
      title: 'Registered, with its source checked against its code',
    }
  }
  return { tone: 'mute', kicker: 'REGISTERED', title: 'Listed in the registry, not yet verified' }
}

function VerifiedHook({ hook, checkedAtBlock }: { hook: RegisteredLatch; checkedAtBlock: bigint }) {
  const verdict = verdictFor(hook)
  const claims = capabilityClaims(hook)
  const source = safeHttpUrl(hook.sourceURI)
  const audit = safeHttpUrl(hook.auditURI)
  const dangerous = hook.takesSwapCut || hook.canTrapLiquidity
  const gridAgrees = gridAgreesWithChain(hook)

  return (
    <>
      <section className={cx(styles['verdict'], toneClass(verdict.tone))} aria-labelledby="v-h">
        <p className={styles['verdictKicker']}>{verdict.kicker}</p>
        <h1 className={styles['verdictTitle']} id="v-h">
          {verdict.title}
        </h1>
        <AddressRow label="Latch" address={hook.address} />
      </section>

      {/* Warnings sit above everything the submitter wrote about themselves. */}
      {hook.listing === LISTING_MALICIOUS && (
        <Alert tone="danger" title="Do not route funds through a pool that uses this Latch">
          A guardian flagged this listing, and flagging force-resets its verification in the same
          transaction — whatever badge it held before does not apply. The registry keeps the
          record rather than deleting it, precisely so this warning stays reachable by the people
          already exposed to it.
        </Alert>
      )}

      {hook.listing === LISTING_DEPRECATED && (
        <Alert tone="warn" title="Superseded or abandoned, per a curator">
          Deprecation is a status, not an accusation, and any verification this Latch earned still
          stands. It usually means a newer version exists — check the source link before you build
          against this one.
        </Alert>
      )}

      {!hook.permissionsReadable && (
        <Alert tone="danger" title="The capabilities below may no longer be true">
          The registry can no longer read this contract&rsquo;s{' '}
          <code>getHooksRegistrationBitmap()</code>. The bitmap shown is the last value that was
          successfully read; the contract may have been destroyed, or swapped behind a proxy for
          something that answers differently. Treat every capability on this page as unverified.
        </Alert>
      )}

      {hook.permissionsReadable && !hook.permissionsValid && (
        <Alert tone="warn" title="Malformed permission bitmap">
          It carries reserved bits, or a returns-delta bit without the callback that bit depends
          on. Core rejects the same bitmap at pool initialization, so this Latch cannot currently
          back a pool — and no curator can attest to it in this state.
        </Alert>
      )}

      {hook.risk === RISK_VALUE_EXTRACTING && hook.listing !== LISTING_MALICIOUS && (
        <Alert tone="danger" title="Value-extracting capability">
          This Latch holds a permission that lets it take a cut of swaps or refuse liquidity
          withdrawals. Value routed through its pools moves at its discretion. That is a fact
          about its code, not a judgement about its author — but you should know it before you
          trade.
        </Alert>
      )}

      <section className={styles['badges']} aria-label="On-chain trust signals">
        <Badge
          tone={VERIFICATION_TONE[hook.verification]}
          label="VERIFICATION"
          value={VERIFICATION_LABEL[hook.verification]}
        />
        <Badge tone={RISK_TONE[hook.risk]} label="CAPABILITY CLASS" value={RISK_LABEL[hook.risk]} />
        <Badge
          tone={LISTING_TONE[hook.listing]}
          label="LISTING"
          value={LISTING_LABEL[hook.listing]}
        />
        <Badge
          tone="mute"
          label="BITMAP"
          value={`0x${hook.permissions.toString(16).padStart(4, '0')}`}
        />
      </section>

      {/* ------------------------------------------------- read from the code */}
      <section className={cx(styles['panel'], dangerous && styles['panelDanger'])}>
        <p className={styles['panelKicker']}>READ FROM THE LATCH&rsquo;S OWN CONTRACT</p>
        <h2 className={styles['panelTitle']}>What this Latch can do</h2>
        <p className={styles['panelNote']}>
          The registry reads this bitmap by calling <code>getHooksRegistrationBitmap()</code> on the
          Latch itself. No submitter can influence it. This is the part of the page nobody can fake.
        </p>
        <ul className={styles['claims']}>
          {claims.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>

        {!gridAgrees && (
          <Alert tone="warn" title="The grid below disagrees with the registry">
            The list above is the chain&rsquo;s and stands. The grid is drawn from the same bitmap
            by this page, and the two should be identical; treat the cells as unreliable and read
            the capability list instead.
          </Alert>
        )}

        {/* The badge row above already prints the bitmap as hex; this is the
            same number decoded, so the kicker does not repeat it. */}
        <p className={styles['panelKicker']}>CALLBACKS DECLARED</p>
        <div className={styles['hostedBits']}>
          <BitGrid
            bitmap={hook.permissions}
            bits={HOOK_BITS}
            label="Permission bitmap: the fourteen points in a pool's lifecycle this Latch may run at"
          />
        </div>
        <p className={styles['panelNote']}>
          {hook.callbacks.length > 0 ? (
            <>
              Lit cells are the {hook.callbacks.length} point
              {hook.callbacks.length === 1 ? '' : 's'} core will call this contract at. A dim cell
              is a reading too: it does not run there.
            </>
          ) : (
            <>The bitmap is empty: core never calls this contract during a pool&rsquo;s lifecycle.</>
          )}
        </p>
      </section>

      {/* --------------------------------------------- supplied by a stranger */}
      <section className={styles['panel']}>
        <p className={styles['panelKicker']}>SUBMITTER-SUPPLIED — NOT VERIFIED</p>
        <h2 className={styles['panelTitle']}>What the submitter says about it</h2>
        <p className={styles['panelNote']}>
          Free text written by whoever listed the Latch and stored verbatim on chain.{' '}
          <strong>Never</strong> a capability claim, and never checked against the code above.
        </p>
        <Disclosure summary="Why an edit here costs a badge">
          These strings can be repointed after a badge is granted — a source link that pointed at
          the audited code when a curator looked at it can point somewhere else tomorrow. A steward
          edit therefore resets verification to Unverified.
        </Disclosure>

        <dl className={styles['meta']}>
          <div className={styles['metaRow']}>
            <dt>Name</dt>
            <dd>
              {hook.name ? (
                <q className={styles['quoted']}>{hook.name}</q>
              ) : (
                <span className={styles['absent']}>none supplied</span>
              )}
            </dd>
          </div>
          <div className={styles['metaRow']}>
            <dt>Description</dt>
            <dd>
              {hook.description ? (
                <q className={styles['quoted']}>{hook.description}</q>
              ) : (
                <span className={styles['absent']}>none supplied</span>
              )}
            </dd>
          </div>
          <div className={styles['metaRow']}>
            <dt>Source</dt>
            <dd>
              {source ? (
                <a
                  className={styles['inlineLink']}
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {source}
                </a>
              ) : hook.sourceURI ? (
                <span className={styles['absent']}>
                  not a http(s) link — shown inert:{' '}
                  <code className={styles['raw']}>{hook.sourceURI}</code>
                </span>
              ) : (
                <span className={styles['absent']}>none supplied</span>
              )}
            </dd>
          </div>
          <div className={styles['metaRow']}>
            <dt>Audit</dt>
            <dd>
              {audit ? (
                <a
                  className={styles['inlineLink']}
                  href={audit}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {audit}
                </a>
              ) : hook.auditURI ? (
                <span className={styles['absent']}>
                  not a http(s) link — shown inert:{' '}
                  <code className={styles['raw']}>{hook.auditURI}</code>
                </span>
              ) : (
                <span className={styles['absent']}>none supplied</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* ------------------------------------------------------- who listed it */}
      <section className={styles['panel']}>
        <p className={styles['panelKicker']}>ON CHAIN</p>
        <h2 className={styles['panelTitle']}>Who listed it</h2>
        <p className={styles['panelNote']}>
          The address that sent <code>register</code>. Permissionless, so it need not be the
          author, and it is not an endorsement.
        </p>
        <AddressRow label="Submitter" address={hook.submitter} />
      </section>

      <p className={styles['verdictBody']}>
        <Link className={styles['inlineLink']} to="/app/marketplace">
          Compare it against every other listed Latch &rarr;
        </Link>
      </p>

      <Provenance checkedAtBlock={checkedAtBlock} />
    </>
  )
}

/* -------------------------------------------------------------------- page */

/**
 * `key` is the address-and-attempt the answer belongs to.
 *
 * It is carried in the state rather than cleared by an effect so that an answer
 * for one address can never be painted under another. Navigating to a second
 * /verify URL makes the stored key stale, and a stale key renders as LOADING —
 * derived during render, so there is no frame in which the previous Latch's
 * verdict sits above the new Latch's address.
 */
type State =
  | { k: 'loading'; key: string }
  | { k: 'error'; key: string; message: string }
  | { k: 'result'; key: string; lookup: LatchLookup }

export default function VerifyPage() {
  const { hookAddress } = useParams()
  const raw = hookAddress ?? ''
  const address = useMemo(() => parseAddress(raw), [raw])

  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const key = `${address ?? ''}#${attempt}`

  const [stored, setStored] = useState<State>({ k: 'loading', key: '' })
  const state: State = stored.key === key ? stored : { k: 'loading', key }

  useEffect(() => {
    if (!address) return
    let off = false
    readRegisteredLatch(address)
      .then((lookup) => !off && setStored({ k: 'result', key, lookup }))
      .catch(
        (e) =>
          !off &&
          setStored({
            k: 'error',
            key,
            message: e instanceof Error ? e.message : 'the RPC endpoint did not answer',
          }),
      )
    return () => {
      off = true
    }
  }, [address, key])

  // A single-page router keeps whatever title the previous route set.
  useEffect(() => {
    const previous = document.title
    document.title = address
      ? `Verify ${short(address)} — Latch Protocol`
      : 'Verify a Latch — Latch Protocol'
    return () => {
      document.title = previous
    }
  }, [address])

  return (
    <div className={landing['page']}>
      <SiteHeader />
      <main>
        <div className={styles['wrap']}>
          <p className={landing['eyebrow']}>PUBLIC LATCH VERIFICATION</p>

          {!address ? (
            <InvalidAddress raw={raw} />
          ) : state.k === 'loading' ? (
            <section className={cx(styles['verdict'], toneClass('mute'))} aria-busy="true">
              <p className={styles['verdictKicker']}>CHECKING</p>
              <h1 className={styles['verdictTitle']}>
                <span className={styles['pulse']}>Reading the registry&hellip;</span>
              </h1>
              <p className={styles['verdictBody']} role="status">
                Asking {CHAIN.name} whether <code className={styles['raw']}>{short(address)}</code>{' '}
                is registered. Nothing is shown until it answers.
              </p>
            </section>
          ) : state.k === 'error' ? (
            <Unreachable address={address} message={state.message} onRetry={retry} />
          ) : state.lookup.found ? (
            <VerifiedHook hook={state.lookup.latch} checkedAtBlock={state.lookup.checkedAtBlock} />
          ) : (
            <NotRegistered
              address={state.lookup.address}
              hasCode={state.lookup.hasCode}
              checkedAtBlock={state.lookup.checkedAtBlock}
            />
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
