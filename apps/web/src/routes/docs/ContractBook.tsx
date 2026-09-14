/* ============================================================================
   DEPLOYED CONTRACTS — the docs' one canonical contract list. Every address
   this build's chain has, each one checkable.

   MOVED FROM THE LANDING PAGE, 2026-09-13 (owner: "contracts need to be on docs
   not on landing"). It used to mount on `/` behind a `#contracts` hash; it is
   now a first-class section of `/docs`, anchored `#contracts`, and `/#contracts`
   redirects here (routes/landing/index.tsx). Behaviour is unchanged; only the
   surface moved, so the styling is the docs' own (./contractbook.css, reading
   the same Option B tokens as docs.css).

   WHAT THIS IS FOR. An integrator is asked to route swaps through contracts
   they have never seen. The only honest answer to "why should I trust this" is
   "don't — here is every address, go and read them", and that answer is
   worthless if the addresses are hard to get at. So the whole job of this
   component is to make checking cheap: the address in full, a copy button
   that works or says it didn't, an explorer link built from the address book's
   own explorer origin, and a live `eth_getCode` per row so the reader can see
   that something is actually deployed there RIGHT NOW rather than taking a
   table's word for it.

   IT COMPLEMENTS the landing's LiveStrip RATHER THAN REPEATING IT. LiveStrip
   COUNTS these same addresses — one number, from the address book, explicitly
   captioned as a count of records rather than a code sweep. This component is
   that sweep. The count there and the row count here are derived from the
   same predicate (`isAddressString` below is `LiveStrip.countAddresses`'s
   filter), so the two surfaces cannot disagree about how many contracts exist;
   they disagree only about what has been PROVEN about them, which is the point.

   ---------------------------------------------------------------------------
   THE THREE CLAIMS THIS COMPONENT MAKES, AND WHY THEY ARE KEPT APART

     "code present"    the node answered, and there are bytes at that address
     "no code"         the node answered, and there is nothing there
     "could not check" nobody answered; we know nothing either way

   The second and third are the ones that must never merge. "No code" is a
   MEASUREMENT and it is damning — an address in our own book with nothing
   behind it is either a typo, a wrong chain, or a contract that was never
   deployed, and a reader is entitled to see it flagged. "Could not check" is
   the absence of a measurement, usually a rate-limited public endpoint, and it
   says nothing at all about the contract. Rendering a refused request as "no
   code" would libel a perfectly healthy Vault; rendering it as a green tick
   would be worse. CLAUDE.md records the same failure in its log-scan form — a
   refused scan surfaced as `0` and the page announced "0 POOLS INITIALIZED"
   over a chain holding a live pool.

   ---------------------------------------------------------------------------
   NOTHING IS CLAIMED THAT IS NOT CHECKED. In particular there is no "verified
   on Sourcify" anywhere in this file. Every contract on Robinhood is in fact
   Sourcify-verified per `ops/safe/robinhood-deployment.md`, and that is still
   not something this component may say, because it does not ask Sourcify. A
   per-row badge sourced from a markdown file is a claim with no live backing,
   and this component's entire value is that its claims have live backing.
   ========================================================================== */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Address, Hex, PublicClient } from 'viem'

import { REDEPLOYABLE_CONTRACTS, explorerAddressUrl } from '@latchprotocol/sdk'

import { ACTIVE_CHAIN_ID, DEPLOYMENTS, client } from '../../lib/chain'
import './contractbook.css'

/** The one chain this build serves. Never a spelled-out name: see LiveStrip. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * The other deployments in the same book, by name. Derived, so the intro can
 * say where their addresses live without typing a chain name.
 */
const OTHER_CHAINS: readonly string[] = Object.values(DEPLOYMENTS)
  .filter((d) => d.chainId !== CHAIN.chainId)
  .map((d) => d.name)

/* ---------------------------------------------------------------------------
   ROWS, DERIVED ENTIRELY FROM THE ADDRESS BOOK

   There is not one hex literal in this file. Every address on screen is read
   out of `DEPLOYMENTS[ACTIVE_CHAIN_ID]`, which is `LATCH_DEPLOYMENTS` in the
   SDK — the single source of truth that `apps/web` and the tenant template
   both re-export. A redeploy is one edit there and this table follows. The
   alternative is what `src/data/chains.ts` used to be: hardcoded hex that kept
   rendering a retired fee controller after governance had abandoned it, which
   is a page telling readers to go and inspect the wrong contract.
   --------------------------------------------------------------------------- */

/** What an address looks like. Used to RECOGNISE one, never to make one. */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function isAddressString(v: unknown): v is Address {
  return typeof v === 'string' && ADDRESS_RE.test(v)
}

/**
 * Every key in the book that holds a contract address, in book order.
 *
 * WHY IT SCANS EVERY CHAIN AND NOT JUST THIS ONE. A key whose value is `null`
 * on this chain is indistinguishable at runtime from a key that holds an
 * object or a string — `launchpadKit: null` and any other null field look the same
 * to `typeof`. Union-ing the keys that hold an address on ANY chain in the
 * book recovers the distinction from the data rather than from a hand-written
 * list of field names: `launchpadKit` is an address on Robinhood, so it is an
 * address FIELD everywhere, and its `null` on Sepolia is a not-deployed
 * contract. A key holding an object (the token table, for one) never qualifies.
 *
 * The one thing this cannot see is a key that is `null` on every chain at
 * once — such a contract would be invisible here. None exists today; if one is
 * added, it is invisible rather than wrong, which is the failure direction to
 * prefer.
 *
 * BOOK ORDER IS KEPT ON PURPOSE. The SDK's table is written in sections —
 * settlement core, fees, governance, directory, periphery, external, hooks,
 * launchpad — and object key order preserves that grouping for free. It is the
 * only grouping signal the data actually carries, so it is the one used.
 */
function addressBookKeys(): readonly string[] {
  const seen: string[] = []
  for (const chain of Object.values(DEPLOYMENTS)) {
    // `Object.entries` on an interface resolves to the `[string, any][]`
    // overload. Widening to `unknown` keeps `any` out of the flow without a
    // cast that asserts something untrue.
    const entries: readonly (readonly [string, unknown])[] = Object.entries(chain)
    for (const [key, value] of entries) {
      if (isAddressString(value) && !seen.includes(key)) seen.push(key)
    }
  }
  return seen
}

/**
 * The keys the SDK itself flags as MOVING TARGETS.
 *
 * This is a real signal in the data, not a category invented here:
 * `REDEPLOYABLE_CONTRACTS` is exported by the address book and exists because
 * a retired contract keeps answering — a dead `LatchRegistry` returns a count
 * and renders as a healthy, empty marketplace. Surfacing it per row is the
 * difference between "this address is correct" and "this address is correct
 * today, and you should read it from the book rather than pasting it into your
 * own config".
 */
const REDEPLOYABLE: ReadonlySet<string> = new Set<string>(REDEPLOYABLE_CONTRACTS)

/** Addresses that also appear in this chain's token table, with their symbol. */
const TOKEN_SYMBOLS: ReadonlyMap<string, string> = new Map(
  CHAIN.tokens.map((t) => [t.address.toLowerCase(), t.symbol]),
)

interface Row {
  /**
   * The address-book key, and — deliberately — the name shown to the reader.
   *
   * THE BOOK CARRIES NO CONTRACT NAMES. It has addresses, decimals and
   * explorer origins, and nothing that says "Vault" or "CLPoolManager". A
   * display-name map could be written here, but it would be hand-maintained
   * and drift, and a table that reads "Vault, CLPoolManager, clQuoter" is worse
   * than one that reads consistently.
   *
   * The key is also the more USEFUL identifier for the reader of the docs:
   * `deployment.clPoolManager` is what they will type against the SDK, and it
   * is greppable in the repo. So the column is labelled as what it is — the
   * address-book key — and nothing is invented.
   */
  readonly key: string
  /** `null` means the BOOK says not deployed here. Never a zero address. */
  readonly address: Address | null
  readonly redeployable: boolean
  /** Set when this address is also in the chain's token table. Derived. */
  readonly tokenSymbol: string | null
}

/**
 * This chain's record as a plain lookup.
 *
 * A `Map` rather than an index cast: `LatchDeployment` has no index signature,
 * so `CHAIN as Record<string, unknown>` is a cast asserting something the type
 * does not say. Going through `Object.entries` reads the same values without
 * claiming anything about the interface.
 */
const CHAIN_FIELDS: ReadonlyMap<string, unknown> = new Map<string, unknown>(Object.entries(CHAIN))

const ROWS: readonly Row[] = addressBookKeys().map((key) => {
  const value = CHAIN_FIELDS.get(key)
  const address = isAddressString(value) ? value : null
  return {
    key,
    address,
    redeployable: REDEPLOYABLE.has(key),
    tokenSymbol: address === null ? null : (TOKEN_SYMBOLS.get(address.toLowerCase()) ?? null),
  }
})

/**
 * NULLS ARE SHOWN, NOT DROPPED.
 *
 * This table's promise is "every contract this chain has", and a silently
 * absent `launchpadKit` on Sepolia reads as a contract nobody thought to list.
 * Rendered as NOT DEPLOYED it reads as what it is: a fact about the chain,
 * recorded, with nothing to check. What is never allowed is the third option —
 * a blank cell, which reads as an address the component failed to render.
 */
const DEPLOYED_ROWS: readonly Row[] = ROWS.filter((r) => r.address !== null)

/* ---------------------------------------------------------------------------
   THE LIVE CHECK

   One `eth_getCode` per address, staggered. See RATE below for the pacing and
   why it is not a `Promise.all`.
   --------------------------------------------------------------------------- */

type Check =
  | { k: 'queued' }
  | { k: 'checking' }
  /** The node answered and there are bytes there. */
  | { k: 'code'; bytes: number }
  /** The node answered and there is NOTHING there. A measurement, and a bad one. */
  | { k: 'nocode' }
  /** Nobody answered. NOT a statement about the contract. See the header. */
  | { k: 'failed'; reason: string }

/**
 * Requests in flight at once.
 *
 * WHY NOT `Promise.all` OVER ALL OF THEM. There are twenty-five addresses on
 * the mainnet chain and the public Robinhood endpoints meter by compute unit —
 * roughly 300 CU/min — with a request-count limit on top. That budget is
 * already the reason this app's log scans render em dashes (see
 * `lib/chain.ts`), and firing twenty-five simultaneous `eth_getCode` calls
 * would spend it on first paint and leave every other reader with refusals. A
 * refusal here is not silent — it renders "could not check" — but a table of
 * twenty-five "could not check" rows proves nothing, which defeats the
 * component.
 *
 * `lib/chain.ts` settled on 3 for its log windows, which are far more
 * expensive calls than these. Matching it is conservative by construction.
 */
const MAX_IN_FLIGHT = 3

/**
 * Minimum gap between two request STARTS, across all workers.
 *
 * Concurrency alone does not pace anything: three workers against a fast node
 * still burst. This is the actual rate limit — one request every 300ms, so
 * ~3.3/s at the ceiling and never more, whatever the concurrency. Twenty-five
 * addresses therefore take a little over seven seconds to resolve, filling in
 * as they land, and the burst is one-shot: this component does not poll.
 *
 * The exact CU cost of `eth_getCode` on these endpoints is not published, so
 * this is a defensive guess rather than a computed budget. If it turns out to
 * be too fast the symptom is honest — rows say "could not check" and the
 * re-check button exists — which is why it is safe to guess here and not safe
 * to guess anywhere that produces a number.
 */
const MIN_SPACING_MS = 300

/** How the whole sweep is doing, as distinct from any one row. */
type Sweep =
  | { k: 'running' }
  /** `atBlock` is the head when the sweep STARTED; rows landed at or after it. */
  | { k: 'done'; atBlock: bigint | null }
  /** No RPC could even be constructed for this chain. Nothing was attempted. */
  | { k: 'unavailable'; reason: string }

interface Target {
  readonly key: string
  readonly address: Address
}

const TARGETS: readonly Target[] = DEPLOYED_ROWS.flatMap((r) =>
  r.address === null ? [] : [{ key: r.key, address: r.address }],
)

/**
 * Viem errors are multi-line essays. A table cell gets the first line, capped.
 * The full text is still in the console where a developer can read it.
 */
function reasonOf(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const first = raw.split('\n', 1)[0] ?? raw
  const trimmed = first.trim()
  if (trimmed === '') return 'the endpoint gave no reason'
  return trimmed.length > 110 ? `${trimmed.slice(0, 107)}…` : trimmed
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

/**
 * Walk `targets` with at most `MAX_IN_FLIGHT` workers and at least
 * `MIN_SPACING_MS` between any two request starts.
 *
 * The spacing gate is a single shared cursor rather than a per-worker sleep.
 * Per-worker sleeps give you `MAX_IN_FLIGHT` requests every `MIN_SPACING_MS`,
 * which is three times the rate you asked for — the classic version of this
 * bug. `nextSlot` is read and advanced synchronously before any `await`, so
 * the three workers cannot claim the same slot.
 */
async function runSweep(
  targets: readonly Target[],
  rpc: PublicClient,
  onResult: (key: string, check: Check) => void,
  isCancelled: () => boolean,
): Promise<void> {
  let index = 0
  let nextSlot = 0

  async function worker(): Promise<void> {
    for (;;) {
      if (isCancelled()) return
      const target = targets[index++]
      if (target === undefined) return

      const now = Date.now()
      const slot = Math.max(now, nextSlot)
      nextSlot = slot + MIN_SPACING_MS
      if (slot > now) await sleep(slot - now)
      if (isCancelled()) return

      onResult(target.key, { k: 'checking' })
      try {
        const code: Hex | undefined = await rpc.getCode({ address: target.address })
        if (isCancelled()) return
        // viem returns `undefined` for an empty account on some transports and
        // `'0x'` on others. Both mean the same thing and neither is a failure.
        const hex = code ?? '0x'
        onResult(
          target.key,
          hex === '0x' ? { k: 'nocode' } : { k: 'code', bytes: (hex.length - 2) / 2 },
        )
      } catch (e) {
        if (isCancelled()) return
        // Deliberately NOT `nocode`. See the header: an unanswered request and
        // an empty account are opposite claims about a contract.
        onResult(target.key, { k: 'failed', reason: reasonOf(e) })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_IN_FLIGHT, targets.length) }, () => worker()),
  )
}

/* ---------------------------------------------------------------------------
   Presentation helpers
   --------------------------------------------------------------------------- */

/**
 * First six characters, an ellipsis, last four.
 *
 * Decoration only. The complete address is always in the DOM beside it and in
 * the row's `title`, and the copy button copies the whole thing — a reader is
 * never asked to trust the middle of an address they cannot see.
 */
const truncate = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

const CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'redeployable', label: 'Redeployable' },
  { id: 'fixed', label: 'Fixed' },
  { id: 'undeployed', label: 'Not deployed' },
] as const

type ChipId = (typeof CHIPS)[number]['id']

/* ---------------------------------------------------------------------------
   View
   --------------------------------------------------------------------------- */

type Props = {
  /** The docs' reveal delay for this section, as every sibling section takes one. */
  style?: CSSProperties
}

export default function ContractBook({ style }: Props) {
  const headingId = useId()
  const filterId = useId()
  const chipsId = useId()

  const [checks, setChecks] = useState<ReadonlyMap<string, Check>>(new Map())
  const [sweep, setSweep] = useState<Sweep>({ k: 'running' })
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<ChipId>('all')
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null)

  /* A generation counter, not a boolean: a re-check must cancel the sweep
     still in flight, and unmount must cancel whichever is current. Comparing
     against a captured generation does both with one variable. */
  const generation = useRef(0)

  const start = useCallback((targets: readonly Target[]) => {
    const mine = ++generation.current
    const isCancelled = (): boolean => generation.current !== mine

    let rpc: PublicClient
    try {
      rpc = client(ACTIVE_CHAIN_ID)
    } catch (e) {
      // No endpoints configured at all. Nothing was attempted, and saying so is
      // a different statement from twenty-five failed checks.
      setSweep({ k: 'unavailable', reason: reasonOf(e) })
      return
    }

    setSweep({ k: 'running' })
    setChecks((prev) => {
      const next = new Map(prev)
      for (const t of targets) next.set(t.key, { k: 'queued' })
      return next
    })

    const onResult = (key: string, check: Check): void => {
      if (isCancelled()) return
      setChecks((prev) => new Map(prev).set(key, check))
    }

    void (async () => {
      /* The head is read FIRST so the footnote can say which block the sweep
         started from. It is not read at the end, because "as of block N" after
         a seven-second sweep would date the whole table to its last row. */
      let atBlock: bigint | null = null
      try {
        atBlock = await rpc.getBlockNumber()
      } catch {
        // A missing height costs the provenance line a number, nothing more.
        atBlock = null
      }
      await runSweep(targets, rpc, onResult, isCancelled)
      if (!isCancelled()) setSweep({ k: 'done', atBlock })
    })()
  }, [])

  useEffect(() => {
    start(TARGETS)
    return () => {
      generation.current++
    }
  }, [start])

  /* Copy feedback clears itself. The timer is torn down on change so a fast
     second copy cannot be wiped by the first one's expiry. */
  useEffect(() => {
    if (copied === null) return
    const timer = window.setTimeout(() => setCopied(null), 2_000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const onCopy = useCallback(async (key: string, address: string) => {
    /* `navigator.clipboard` is typed as always present and is NOT: it is
       undefined outside a secure context, and `writeText` rejects when the
       permission is denied or the document is not focused. Both paths land in
       the same honest failure — the button says it could not copy and the
       address stays selectable on screen. A tick that appears whether or not
       anything reached the clipboard is worse than no button. */
    try {
      const clip: Clipboard | undefined = navigator.clipboard
      if (clip === undefined) throw new Error('the clipboard is unavailable here')
      await clip.writeText(address)
      setCopied({ key, ok: true })
    } catch {
      setCopied({ key, ok: false })
    }
  }, [])

  const failedKeys = useMemo(
    () => TARGETS.filter((t) => checks.get(t.key)?.k === 'failed'),
    [checks],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return ROWS.filter((r) => {
      if (chip === 'redeployable' && !r.redeployable) return false
      if (chip === 'fixed' && r.redeployable) return false
      if (chip === 'undeployed' && r.address !== null) return false
      if (needle === '') return true
      if (r.key.toLowerCase().includes(needle)) return true
      return r.address !== null && r.address.toLowerCase().includes(needle)
    })
  }, [query, chip])

  /* The tallies. Every one is a count of things this component actually knows,
     which is why "could not check" is counted separately from "no code" here
     as well as in the rows — a summary that added them together would undo the
     distinction the rows are careful to make. */
  const tally = useMemo(() => {
    let code = 0
    let nocode = 0
    let failed = 0
    let pending = 0
    for (const t of TARGETS) {
      const c = checks.get(t.key)
      if (c === undefined || c.k === 'queued' || c.k === 'checking') pending += 1
      else if (c.k === 'code') code += 1
      else if (c.k === 'nocode') nocode += 1
      else failed += 1
    }
    return { code, nocode, failed, pending }
  }, [checks])

  const notDeployed = ROWS.length - DEPLOYED_ROWS.length

  return (
    /* A direct child of `.dk-main`, so it takes the docs' `scroll-margin-top`
       under the sticky header and is one of the ids `useScrollSpy` watches. */
    <section
      id="contracts"
      className="dk-section dk-reveal dk-cb"
      style={style}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="dk-h2">
        Deployed contracts
      </h2>
      <p className="dk-body">
        Every contract address {CHAIN.name} (chain id {CHAIN.chainId}) has in the Latch address
        book, with a live <code className="dk-icode">eth_getCode</code> against each one. Nothing
        here is typed out: the rows, the addresses and the explorer links are read from{' '}
        <code className="dk-icode">LATCH_DEPLOYMENTS</code> in{' '}
        <code className="dk-icode">@latchprotocol/sdk</code> &mdash; the same export your
        integration should import &mdash; so a redeploy moves this table without anyone editing it.
        {OTHER_CHAINS.length > 0 ? (
          <>
            {' '}
            This build serves {CHAIN.name}; the addresses for {OTHER_CHAINS.join(' and ')} are in
            the same export, under <code className="dk-icode">LATCH_DEPLOYMENTS[chainId]</code>.
          </>
        ) : null}
      </p>

      <div className="dk-cb__controls">
        <div className="dk-cb__field">
          <label className="dk-cb__label" htmlFor={filterId}>
            Filter by key or address
          </label>
          <input
            id={filterId}
            className="dk-cb__input"
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="vault, hook, timelock…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Not invented categories. "Redeployable" and "Fixed" are the SDK's
            own REDEPLOYABLE_CONTRACTS split, and "Not deployed" is the book's
            `null`. There is no core/periphery/hooks field in the data to group
            by, so none is asserted. */}
        <div className="dk-cb__chips" role="group" aria-labelledby={chipsId}>
          <span id={chipsId} className="dk-cb__label">
            Narrow the list
          </span>
          <div className="dk-cb__toggle">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="dk-cb__seg"
                aria-pressed={chip === c.id}
                onClick={() => setChip(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* NOT a live region. It updates once per check landing, and twenty-five
          polite announcements in seven seconds is noise that drowns the one
          announcement that matters — which is made below, once, when the sweep
          finishes. */}
      <p className="dk-cb__tally">
        {ROWS.length} contracts recorded · {DEPLOYED_ROWS.length} with an address · {notDeployed}{' '}
        recorded as not deployed. Of the addresses: {tally.code} with code, {tally.nocode} with
        none, {tally.failed} could not be checked, {tally.pending} still checking.
      </p>

      <p className="dk-cb__sr" role="status">
        {sweep.k === 'done'
          ? `Code check finished. ${tally.code} of ${DEPLOYED_ROWS.length} addresses have code, ` +
            `${tally.nocode} have none, and ${tally.failed} could not be checked.`
          : ''}
      </p>
      {/* Copy results are announced separately: the button's own text change
          is not reliably spoken, and a silent failure is the exact thing the
          visible `Copy failed` state exists to prevent. */}
      <p className="dk-cb__sr" role="status">
        {copied === null
          ? ''
          : copied.ok
            ? `Copied the ${copied.key} address to the clipboard.`
            : `Could not copy the ${copied.key} address. It is shown in full in the row.`}
      </p>

      {sweep.k === 'unavailable' ? (
        <p className="dk-cb__banner">
          No code check ran: {sweep.reason}. Every address below is still exactly what the address
          book records — but nothing here has been confirmed against a node.
        </p>
      ) : null}

      {/* The docs table wrapper scrolls on its own. At 400px the three columns
          fit, and if a long failure message ever pushes past that it is this
          box that scrolls, never the page. */}
      <div className="dk-tablewrap">
        <table className="dk-table dk-cb__table">
          <caption className="dk-cb__sr">
            Latch contracts on {CHAIN.name}, chain id {CHAIN.chainId}, with the result of a live
            bytecode check for each address.
          </caption>
          <colgroup>
            <col className="dk-cb__c1" />
            <col className="dk-cb__c2" />
            <col className="dk-cb__c3" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">ADDRESS-BOOK KEY</th>
              <th scope="col">ADDRESS</th>
              <th scope="col">CODE ON CHAIN</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="dk-cb__empty">
                  Nothing in the address book matches that filter. {ROWS.length} contracts are
                  recorded for {CHAIN.name}.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <ContractRow
                  key={row.key}
                  row={row}
                  check={row.address === null ? null : (checks.get(row.key) ?? { k: 'queued' })}
                  copied={copied !== null && copied.key === row.key ? copied.ok : null}
                  onCopy={onCopy}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* PROVENANCE — the same discipline as LiveStrip. Which claim came from
          where is the reader's business, and "read from the book" and
          "confirmed against a node" are different claims. */}
      <p className="dk-cb__note">
        Rows and addresses are read from the address book this app ships. The code column is read
        live from {CHAIN.name}
        {sweep.k === 'done' && sweep.atBlock !== null
          ? `, in a sweep started at block ${sweep.atBlock.toLocaleString('en-US')}`
          : ''}
        . A row that says <strong>could not check</strong> means the endpoint did not answer; it is
        not a statement about the contract, and it is a different result from{' '}
        <strong>no code</strong>, which means the chain answered that the address is empty.
      </p>

      {failedKeys.length > 0 && sweep.k === 'done' ? (
        <button
          type="button"
          className="dk-btn dk-btn--ghost dk-cb__recheck"
          onClick={() => start(failedKeys)}
        >
          Re-check the {failedKeys.length} address
          {failedKeys.length === 1 ? '' : 'es'} that could not be checked
        </button>
      ) : null}

      {/* The externals caveat. Nothing in the address book distinguishes a
          contract Latch deployed from a canonical one it merely points at, so
          the distinction is stated here in prose rather than asserted as a
          per-row badge that no data backs. */}
      <div className="dk-callout">
        <span className="dk-callout__dot" aria-hidden="true" />
        <p className="dk-callout__text">
          <strong>Not everything here is ours.</strong> The book also records canonical contracts
          Latch did not deploy &mdash; <code className="dk-icode dk-icode--sm">permit2</code> and{' '}
          <code className="dk-icode dk-icode--sm">weth</code>, the wrapped native token &mdash; and{' '}
          <code className="dk-icode dk-icode--sm">governanceSafe</code>, which is the governance
          multisig rather than a protocol contract. The book carries no field marking them as
          external, so they are listed like any other row; treat a Latch claim as covering only the
          contracts in this repo. A key tagged <strong>redeployable</strong> is one the SDK flags
          as a moving target: read it from the book at call time rather than pasting it into your
          own config, because a retired instance keeps answering rather than reverting.
        </p>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------
   One row
   --------------------------------------------------------------------------- */

function ContractRow({
  row,
  check,
  copied,
  onCopy,
}: {
  row: Row
  /** `null` when there is no address to check — the not-deployed case. */
  check: Check | null
  /** `true` copied, `false` copy failed, `null` nothing to report. */
  copied: boolean | null
  onCopy: (key: string, address: string) => void
}) {
  const address = row.address

  return (
    <tr className="dk-cb__row">
      <th scope="row" className="dk-cb__key">
        <span className="dk-table__name">{row.key}</span>
        <span className="dk-cb__tags">
          {row.redeployable ? (
            <span className="dk-cb__tag" data-tag="redeployable">
              redeployable
            </span>
          ) : null}
          {row.tokenSymbol !== null ? (
            /* Derived, not asserted: this address is also in the chain's token
               table, so its symbol is a fact the book already carries. */
            <span className="dk-cb__tag" data-tag="token">
              token · {row.tokenSymbol}
            </span>
          ) : null}
        </span>
      </th>

      <td>
        {address === null ? (
          <span className="dk-cb__status" data-state="unconfigured">
            not deployed on this chain
          </span>
        ) : (
          <div className="dk-cb__addrrow">
            <span className="dk-cb__addr" title={address}>
              {/* The truncation is decoration; the full value is in the DOM
                  right beside it for assistive tech, and in the title for a
                  pointer. A reader must never have to trust an ellipsis. */}
              <span aria-hidden="true">{truncate(address)}</span>
              <span className="dk-cb__sr">{address}</span>
            </span>
            <span className="dk-cb__actions">
              {/* The visible word stays part of the accessible name rather than
                  being replaced by an `aria-label`, so voice control can still
                  say "click Copy"; the contract is named in an appended sr-only
                  span, which is what makes twenty-five identical buttons
                  distinguishable. */}
              <button
                type="button"
                className="dk-cb__btn"
                data-result={copied === null ? 'idle' : copied ? 'ok' : 'fail'}
                onClick={() => onCopy(row.key, address)}
              >
                {copied === null ? 'Copy' : copied ? 'Copied' : 'Copy failed'}
                <span className="dk-cb__sr"> the {row.key} address</span>
              </button>
              <a
                className="dk-cb__btn dk-cb__btn--explorer"
                /* Built from the address book's own explorer origin. No domain
                   is typed anywhere in this component. */
                href={explorerAddressUrl(CHAIN.chainId, address)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Explorer
                <span className="dk-cb__sr">
                  {' '}
                  for {row.key}, opens in a new tab
                </span>
              </a>
            </span>
          </div>
        )}
      </td>

      <td>
        <CheckView check={check} />
      </td>
    </tr>
  )
}

/**
 * The check column.
 *
 * Every state is carried by TEXT. `data-state` colours it, and the colour is
 * always redundant — a reader with no colour vision, or a printed page, loses
 * nothing. The dot is decoration and is `aria-hidden`.
 */
function CheckView({ check }: { check: Check | null }) {
  if (check === null) {
    return (
      <span className="dk-cb__status" data-state="unconfigured">
        nothing to check
      </span>
    )
  }

  if (check.k === 'queued' || check.k === 'checking') {
    return (
      <span className="dk-cb__status" data-state="loading">
        <i className="dk-cb__dot" aria-hidden="true" />
        {check.k === 'queued' ? 'queued' : 'checking…'}
      </span>
    )
  }

  if (check.k === 'code') {
    return (
      <span className="dk-cb__status" data-state="ok">
        <i className="dk-cb__dot" aria-hidden="true" />
        code present · {check.bytes.toLocaleString('en-US')} bytes
      </span>
    )
  }

  if (check.k === 'nocode') {
    /* A MEASUREMENT, and a serious one: the book records an address here and
       the chain says nothing is at it. Loud on purpose. */
    return (
      <span className="dk-cb__status" data-state="empty">
        <i className="dk-cb__dot" aria-hidden="true" />
        no code at this address
      </span>
    )
  }

  /* NOT "no code". The endpoint did not answer, so nothing is known about this
     contract either way, and the row says exactly that. */
  return (
    <span className="dk-cb__status" data-state="error">
      <i className="dk-cb__dot" aria-hidden="true" />
      could not check — {check.reason}
    </span>
  )
}
