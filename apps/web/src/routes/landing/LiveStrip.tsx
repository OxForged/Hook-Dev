/* ============================================================================
   LIVE STRIP — four facts that prove the protocol is running, and nothing else.

   Every cell is either READ FROM CHAIN or COUNTED FROM THE ADDRESS BOOK, and
   each one says which. There is no constant here that a reader could mistake
   for a measurement: no chain name typed out, no contract count typed out, no
   fee percentage typed out. If a value cannot be read, the cell renders an em
   dash and the reason — never a zero, never a cached figure, never an example.

   WHY THAT IS SPELLED OUT RATHER THAN ASSUMED. CLAUDE.md records the failure
   this rule came from: a log scan the endpoint refused surfaced as `0`, and the
   landing page announced "0 POOLS INITIALIZED" over a chain holding a live
   pool. A zero that means "we could not look" is indistinguishable from a zero
   that means "none", and the reader has no way to tell which they are seeing.
   So the states are separated in the type, not just in the copy:

     loading        the read is in flight
     ready          a value came back — including a REAL zero, which is a
                    measurement and is rendered as a number
     error          the chain would not answer; the reason is shown verbatim
     empty          the answer came back and there is nothing in it
     unconfigured   the contract exists but is not wired, so there is no
                    number to have an opinion about

   This strip deliberately does NOT duplicate StatsStrip. That one counts pool
   and swap history from logs (which the public Robinhood endpoints refuse, so
   it renders em dashes today). This one carries only O(1) reads that always
   answer, plus two facts derived from the address book.
   ========================================================================== */

import { useEffect, useState } from 'react'

import {
  ACTIVE_CHAIN_ID,
  DEPLOYMENTS,
  readBlockNumber,
  readProtocolStatus,
  type ProtocolStatus,
} from '../../lib/chain'
import styles from './livestrip.module.css'

/** The chain this build serves. Never a spelled-out name: see landing/data.ts. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * How often the head is re-read.
 *
 * NOT once per block. Robinhood produces a block every 0.102s — measured over
 * 500,000 blocks, and the same 118x-faster clock that makes every block-denominated
 * constant in this codebase wrong (CLAUDE.md, `CONFIG_DELAY_BLOCKS`). Polling at
 * chain speed would be ten `eth_blockNumber` calls a second against endpoints
 * that already rate-limit this app out of its log scans, to animate a digit
 * nobody can read at that rate.
 *
 * Three seconds is a compromise with one honest consequence: the number shown
 * is the head as of the last poll and can be ~30 blocks behind. That is fine —
 * it is a real height that really existed. What would NOT be fine is a
 * client-side counter incrementing between polls: that is an invented number,
 * and it would be invented at 0.102s intervals.
 */
const BLOCK_POLL_MS = 3_000

/** What an address looks like. Used to count the address book, never to make one. */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** Rendered wherever a value could not be read. Never a `0`. */
const UNREAD = '—'

/**
 * Contracts recorded for this chain, COUNTED rather than stated.
 *
 * A literal here would be a number that decays the moment a contract is added
 * or a redeploy lands, and it would decay silently — the failure mode of every
 * hand-maintained mirror in this repo. Counting the address book means the
 * figure is wrong only if the address book is wrong, and the address book is
 * what everything else reads too.
 *
 * `null` is excluded by construction: the SDK writes `null` for a contract that
 * does not exist on a chain and never a zero address (see the header of
 * `packages/sdk/src/deployments/index.ts`), and `typeof null !== 'string'`.
 * Nested values — the token table, the reference pool, the native currency —
 * are objects and never match either.
 *
 * PROVENANCE, stated in the cell: this counts every address the book records
 * for this chain, which includes canonical externals we did not deploy
 * (Permit2, the wrapped native token) and the governance Safe. It is a count of
 * records, not a `getCode` sweep — it says what is wired up, not what has
 * bytecode this second.
 */
function countAddresses(record: object): number {
  // `Object.values` on an interface with mixed value types resolves to the
  // `any[]` overload. Widening to `unknown[]` keeps the strictness the repo
  // asks for without a cast to a lie.
  const values: readonly unknown[] = Object.values(record)
  return values.filter((v) => typeof v === 'string' && ADDRESS_RE.test(v)).length
}

const CONTRACT_COUNT = countAddresses(CHAIN)

/**
 * Pips to a percentage. 999 -> "0.0999%".
 *
 * A unit conversion, not the fee formula. The split arithmetic — how a protocol
 * fee and an LP fee compose — lives in the controller and is deliberately not
 * reproduced here; `feeForLpFee` on chain already applied it.
 */
const pct = (pips: number): string => `${(pips / 10_000).toFixed(4)}%`

/* ---------------------------------------------------------------------------
   State
   --------------------------------------------------------------------------- */

type Status =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; status: ProtocolStatus }

type Head =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; height: bigint }

/** One cell's answer. The four failure shapes are distinct on purpose. */
type Cell =
  | { k: 'loading' }
  | { k: 'ready'; value: string; note: string }
  | { k: 'error'; reason: string }
  | { k: 'empty'; reason: string }
  | { k: 'unconfigured'; reason: string }

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : 'unreachable')

/* ---------------------------------------------------------------------------
   Cells
   --------------------------------------------------------------------------- */

/**
 * The chain. Read from the address book, which is where the identity of a
 * deployment target legitimately lives — it is not a measurement and is not
 * presented as one.
 */
const chainCell: Cell = {
  k: 'ready',
  value: CHAIN.name,
  note: `chain id ${CHAIN.chainId}`,
}

function contractsCell(): Cell {
  /* Zero would be a truthful answer here — it would mean the book records
     nothing for this chain — but it is a different statement from "we could not
     read it", so it gets its own state rather than a bare `0`. */
  if (CONTRACT_COUNT === 0) {
    return { k: 'empty', reason: `no addresses are recorded for ${CHAIN.name}` }
  }
  return {
    k: 'ready',
    value: String(CONTRACT_COUNT),
    note: 'addresses in the book, externals included',
  }
}

function headCell(h: Head): Cell {
  if (h.k === 'loading') return { k: 'loading' }
  /* No last-known-good fallback. A height frozen at its last successful read,
     still captioned "live", is the most convincing wrong number this page could
     print — the format is right, the digits are plausible, and only the clock
     disagrees. Better to say the poll failed and let the next one recover. */
  if (h.k === 'error') return { k: 'error', reason: `${CHAIN.name} is unreachable — ${h.message}` }
  return {
    k: 'ready',
    value: h.height.toLocaleString('en-US'),
    note: `re-read every ${BLOCK_POLL_MS / 1000}s`,
  }
}

function feeCell(s: Status): Cell {
  if (s.k === 'loading') return { k: 'loading' }
  if (s.k === 'error') return { k: 'error', reason: `${CHAIN.name} is unreachable — ${s.message}` }

  const p = s.status

  /* The controller being DEPLOYED and the controller being IN FORCE are
     different facts, and only the pool manager knows the second one. When
     `protocolFeeController()` reads address(0) there is no rate to quote:
     quoting the controller's own configured figure would describe a contract
     that charges nobody. `readProtocolStatus` already settles this. */
  if (!p.controllerWired) {
    return {
      k: 'unconfigured',
      reason: `no fee controller is wired to the pool manager on ${CHAIN.name}`,
    }
  }

  /* `effectiveFeePips` is zero when the guardian has switched fees off. That
     zero is a MEASUREMENT — the protocol really does take nothing — so it is
     rendered as a number, unlike the em dashes above. The note carries the
     reason so the two zeros can never be confused. */
  return {
    k: 'ready',
    value: pct(p.effectiveFeePips),
    note: p.feesDisabled
      ? 'fees are switched off at the controller'
      : `${(p.splitRatio / 10_000).toFixed(0)}% of a 0.30% pool's fee`,
  }
}

/* ---------------------------------------------------------------------------
   View
   --------------------------------------------------------------------------- */

function CellView({
  label,
  cell,
  liveRegion = false,
  pulse = false,
}: {
  label: string
  cell: Cell
  /** Announce changes politely. Only the block height needs this. */
  liveRegion?: boolean
  /** Show the live indicator when the cell is ready. Purely decorative. */
  pulse?: boolean
}) {
  const value = cell.k === 'ready' ? cell.value : cell.k === 'loading' ? '·' : UNREAD
  const note =
    cell.k === 'ready' ? cell.note : cell.k === 'loading' ? `reading ${CHAIN.name}…` : cell.reason

  return (
    <div className={styles['cell']} data-state={cell.k}>
      <span className={styles['label']}>{label}</span>
      <span className={styles['valueRow']}>
        {pulse && cell.k === 'ready' ? <i className={styles['pulse']} aria-hidden="true" /> : null}
        <span
          className={styles['value']}
          aria-live={liveRegion ? 'polite' : undefined}
          aria-atomic={liveRegion ? true : undefined}
        >
          {value}
        </span>
      </span>
      <span className={styles['note']}>{note}</span>
    </div>
  )
}

export function LiveStrip() {
  const [status, setStatus] = useState<Status>({ k: 'loading' })
  const [head, setHead] = useState<Head>({ k: 'loading' })

  /* Read once. The fee is configuration, not a ticker: it changes when
     governance changes it, which is a queued operation behind a timelock, not
     something that moves between two frames of a landing page. */
  useEffect(() => {
    let off = false
    readProtocolStatus()
      .then((s) => !off && setStatus({ k: 'ready', status: s }))
      .catch((e) => !off && setStatus({ k: 'error', message: reasonOf(e) }))
    return () => {
      off = true
    }
  }, [])

  /* Poll the head. See BLOCK_POLL_MS for why this is not per-block. */
  useEffect(() => {
    let off = false
    /* One request at a time. These endpoints rate-limit by request count, and a
       poll that fires while the previous one is still in flight turns a slow
       RPC into a queue that never drains. */
    let inFlight = false

    const tick = (): void => {
      if (inFlight) return
      inFlight = true
      readBlockNumber()
        .then((h) => {
          if (!off) setHead({ k: 'ready', height: h })
        })
        .catch((e) => {
          if (!off) setHead({ k: 'error', message: reasonOf(e) })
        })
        .finally(() => {
          inFlight = false
        })
    }

    tick()
    const timer = window.setInterval(tick, BLOCK_POLL_MS)
    return () => {
      off = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <section className={styles['wrap']} aria-label={`Live protocol status on ${CHAIN.name}`}>
      <div className={styles['strip']}>
        <CellView label="CHAIN" cell={chainCell} />
        <CellView label="BLOCK" cell={headCell(head)} liveRegion pulse />
        <CellView label="FEE" cell={feeCell(status)} />
        <CellView label="CONTRACTS" cell={contractsCell()} />
      </div>
      {/* Provenance, per surface. "Read from chain" and "counted from the
          address book" are different claims and the reader is entitled to know
          which one each cell is making. */}
      <p className={styles['provenance']}>
        Block height and protocol fee are read from the deployed contracts on {CHAIN.name}. The
        chain id and the contract count are counted from the address book this app ships, not from
        a code sweep.
      </p>
    </section>
  )
}
