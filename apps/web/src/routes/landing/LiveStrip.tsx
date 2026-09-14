/* ============================================================================
   PROTOCOL ACTIVITY — Block, Volume, Fees, Creator revenue, Protocol revenue,
   and the chart of where one token's fees went.

   Owner's request, 2026-09-13: "Volume FEES Creators Revenue BLOCK in a chart
   on landing page." This replaced the Chain / Block / Fee / Contracts strip.
   The chain name now sits in ChainMarks ("Live on"); the protocol's fee RATE
   is FeeChart's subject directly below; the contract count left with the
   addresses, for the docs.

   EVERY FIGURE IS READ, AND EACH SAYS HOW:
     BLOCK             `eth_blockNumber`, polled.
     VOLUME / FEES /   `lib/protocolActivity.ts`: Swap and RevShareTaken logs
     CREATOR / PROTOCOL  over the protocol's whole history, with the cut
                       checked against `RevShareHook.totalTaken`.
   Nothing is typed out, nothing is priced, and no dollar sign appears.

   WHY THERE IS NO TIME SERIES. On Robinhood the protocol's entire swap history
   is two swaps, 24 blocks apart. A line through two points is a drawing, not a
   trend, so the chart is a share-of-fees bar and the panel says why in words.
   The wording is computed from the swap count, so it cannot outlive the fact.

   THE STATES ARE SEPARATED IN THE TYPE, not just in the copy:
     loading        the read is in flight
     ready          a value came back — including a REAL zero, rendered as a
                    number, because it is a measurement
     error          the chain would not answer; the reason is shown verbatim
     empty          the answer came back and there is nothing in it
     unconfigured   the source does not exist on this chain (no RevShareHook),
                    so there is no number to have an opinion about
   ========================================================================== */

import { useEffect, useRef, useState } from 'react'

import { ACTIVE_CHAIN_ID, DEPLOYMENTS, readBlockNumber } from '../../lib/chain'
import {
  formatTokenAmount,
  readProtocolActivity,
  type ProtocolActivity,
  type TokenActivity,
} from '../../lib/protocolActivity'
import { FeeSplit } from './FeeSplit'
import styles from './livestrip.module.css'
import { cx, prefersReducedMotion } from './ui'

/** The chain this build serves. Never a spelled-out name. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * How often the head is re-read.
 *
 * NOT once per block. Robinhood produces an L2 block every 0.102s. (That is
 * the RPC/log clock; contracts there see Ethereum's ~12 s block number
 * instead — see `packages/sdk/src/chains/clock.ts`.) Polling at chain speed
 * would be ten calls a second against endpoints that rate-limit, to animate a
 * digit nobody can read at that rate. The figure shown is the head as of the
 * last poll, and nothing increments it between polls: that would be invented.
 */
const BLOCK_POLL_MS = 3_000

/** Rendered wherever a value could not be read. Never a `0`. */
const UNREAD = '—'

const n = (v: bigint | number): string => v.toLocaleString('en-US')
const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : 'unreachable')

/* ---------------------------------------------------------------------------
   State
   --------------------------------------------------------------------------- */

type Head = { k: 'loading' } | { k: 'error'; message: string } | { k: 'ready'; height: bigint }

type Activity =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; a: ProtocolActivity }

/** One cell's answer. The failure shapes are distinct on purpose. */
type Cell =
  | { k: 'loading' }
  | { k: 'ready'; value: string; note: string }
  | { k: 'error'; reason: string }
  | { k: 'empty'; value: string; reason: string }
  | { k: 'unconfigured'; reason: string }

/** A token's display unit. Raw base units are said out loud, never scaled by a guess. */
function unitOf(t: TokenActivity): string {
  const sym = t.symbol ?? `${t.address.slice(0, 6)}…${t.address.slice(-4)}`
  return t.decimals === null ? `${sym} base units` : sym
}

/* ---------------------------------------------------------------------------
   Cells
   --------------------------------------------------------------------------- */

function headCell(h: Head): Cell {
  if (h.k === 'loading') return { k: 'loading' }
  /* No last-known-good fallback: a frozen height still captioned "live" is the
     most convincing wrong number this page could print. */
  if (h.k === 'error') return { k: 'error', reason: `${CHAIN.name} is unreachable — ${h.message}` }
  return { k: 'ready', value: n(h.height), note: `re-read every ${BLOCK_POLL_MS / 1000}s` }
}

/** The shared non-ready answers for the four log-derived cells. */
function pending(s: Activity): Cell | null {
  if (s.k === 'loading') return { k: 'loading' }
  if (s.k === 'error') return { k: 'error', reason: `${CHAIN.name} logs unreachable — reason below` }
  if (s.a.swapCount === 0 && s.a.tokens.length === 0) {
    return { k: 'empty', value: '0', reason: `no swaps in blocks ${n(s.a.fromBlock)}–${n(s.a.toBlock)}` }
  }
  return null
}

function volumeCell(s: Activity, t: TokenActivity | undefined): Cell {
  const p = pending(s)
  if (p || s.k !== 'ready' || !t) return p ?? { k: 'loading' }
  const u = unitOf(t)
  return {
    k: 'ready',
    value: `${formatTokenAmount(t.volumeIn, t.decimals)} ${u}`,
    note:
      t.swapsIn === 0
        ? `no swap paid in ${u} (of ${n(s.a.swapCount)})`
        : `paid in, ${n(t.swapsIn)} of ${n(s.a.swapCount)} swap${s.a.swapCount === 1 ? '' : 's'}`,
  }
}

function feesCell(s: Activity, t: TokenActivity | undefined): Cell {
  const p = pending(s)
  if (p || s.k !== 'ready' || !t) return p ?? { k: 'loading' }
  const swapFee = t.lpSwapFee + t.protocolSwapFee
  const cut = t.cutLp + t.cutCreators + t.cutHolders
  const f = (v: bigint): string => formatTokenAmount(v, t.decimals)
  return {
    k: 'ready',
    value: `${f(swapFee + cut)} ${unitOf(t)}`,
    note: `swap fee ${f(swapFee)} + Latch cut ${f(cut)}`,
  }
}

function creatorCell(s: Activity, t: TokenActivity | undefined): Cell {
  const p = pending(s)
  if (p || s.k !== 'ready' || !t) return p ?? { k: 'loading' }
  if (s.a.cutHooks === 0) {
    return { k: 'unconfigured', reason: `no Latch RevShareHook is configured on ${CHAIN.name}` }
  }
  return {
    k: 'ready',
    value: `${formatTokenAmount(t.cutCreators, t.decimals)} ${unitOf(t)}`,
    note:
      s.a.cutCheck.k === 'verified'
        ? 'beneficiary roster · matches totalTaken'
        : s.a.cutCheck.k === 'unavailable'
          ? 'beneficiary roster · no counter to check against'
          : 'beneficiary roster share of the Latch cut',
  }
}

function protocolCell(s: Activity, t: TokenActivity | undefined): Cell {
  const p = pending(s)
  if (p || s.k !== 'ready' || !t) return p ?? { k: 'loading' }
  const f = (v: bigint): string => formatTokenAmount(v, t.decimals)
  const u = unitOf(t)
  /* A zero here is a MEASUREMENT: every swap's own `protocolFee` field said
     so. It renders as a number, and the note says why it is zero. */
  const why =
    t.swapsIn === 0
      ? `no swap paid in ${u}`
      : t.protocolFeeSwaps === 0
        ? `no swap carried a protocol fee`
        : 'protocol slice of the swap fee'
  return {
    k: 'ready',
    value: `${f(t.protocolSwapFee)} ${u}`,
    note: `${why} · ${f(t.protocolAccrued)} uncollected`,
  }
}

/* ---------------------------------------------------------------------------
   Motion: a count-up on the FIRST real value, and a flash on each real update.
   Nothing increments between reads. Off under `prefers-reduced-motion`.
   --------------------------------------------------------------------------- */

/** Prefix, a grouped/decimal number, suffix. "0.005994 LTT1" -> "", "0.005994", " LTT1". */
const NUMERIC = /^([^0-9]*)(\d[\d,]*(?:\.\d+)?)(.*)$/
const COUNT_MS = 900

function useCountOnce(value: string | null): { text: string | null; flash: number } {
  const [anim, setAnim] = useState<string | null>(null)
  const [flash, setFlash] = useState(0)
  const started = useRef(false)
  const last = useRef<string | null>(null)

  useEffect(() => {
    if (value === null) return

    if (started.current) {
      if (value !== last.current) {
        last.current = value
        setFlash((x) => x + 1)
      }
      return
    }

    started.current = true
    last.current = value
    if (prefersReducedMotion()) return

    const m = NUMERIC.exec(value)
    if (m === null) return
    const prefix = m[1] ?? ''
    const digits = m[2] ?? ''
    const suffix = m[3] ?? ''
    const plain = digits.replace(/,/g, '')
    const target = Number(plain)
    if (!Number.isFinite(target) || target === 0) return
    const decimals = (plain.split('.')[1] ?? '').length
    const grouped = digits.includes(',')
    const format = (x: number): string => {
      const fixed = x.toFixed(decimals)
      const body = grouped
        ? Number(fixed).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })
        : fixed
      return prefix + body + suffix
    }

    let frame = 0
    let finished = false
    const t0 = performance.now()
    const step = (now: number): void => {
      const p = Math.min(1, (now - t0) / COUNT_MS)
      if (p < 1) {
        setAnim(format(target * (1 - Math.pow(1 - p, 3))))
        frame = requestAnimationFrame(step)
      } else {
        finished = true
        setAnim(null)
      }
    }
    frame = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(frame)
      if (!finished) started.current = false
      setAnim(null)
    }
  }, [value])

  return { text: anim ?? value, flash }
}

function CellView({
  label,
  cell,
  liveRegion = false,
  pulse = false,
  flashOnUpdate = false,
  className,
}: {
  label: string
  cell: Cell
  /** Announce changes politely. Only the block height needs this. */
  liveRegion?: boolean
  /** Show the live indicator when the cell is ready. Purely decorative. */
  pulse?: boolean
  /** Flash the value when a NEW real read replaces the previous one. */
  flashOnUpdate?: boolean
  className?: string | undefined
}) {
  const real = cell.k === 'ready' || cell.k === 'empty' ? cell.value : null
  const counted = useCountOnce(cell.k === 'ready' ? cell.value : null)
  const value =
    cell.k === 'ready' ? (counted.text ?? cell.value) : cell.k === 'empty' ? cell.value : cell.k === 'loading' ? '·' : UNREAD
  const note =
    cell.k === 'ready' ? cell.note : cell.k === 'loading' ? `reading ${CHAIN.name}…` : cell.reason

  return (
    <div className={cx(styles['cell'], className)} data-state={cell.k}>
      <span className={styles['label']}>{label}</span>
      <span className={styles['valueRow']}>
        {pulse && cell.k === 'ready' ? <i className={styles['pulse']} aria-hidden="true" /> : null}
        {/* The painted figure is aria-hidden: mid count-up it is a frame of an
            animation, not a value. The real value is exposed beside it. */}
        <span
          key={counted.flash}
          className={cx(styles['value'], flashOnUpdate && counted.flash > 0 && styles['flash'])}
          aria-hidden="true"
        >
          {value}
        </span>
        <span
          className={styles['sr']}
          aria-live={liveRegion ? 'polite' : undefined}
          aria-atomic={liveRegion ? true : undefined}
        >
          {real ?? value}
        </span>
      </span>
      <span className={styles['note']}>{note}</span>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Words that depend on the reading
   --------------------------------------------------------------------------- */

/** Why there is no line over time, computed from the swap count. */
function seriesNote(a: ProtocolActivity): string {
  const count = a.swapCount
  const blocks = a.swapBlocks
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  if (count === 0 || first === undefined || last === undefined) return ''
  if (count <= 2) {
    const where =
      blocks.length === 1
        ? `at block ${n(first)}`
        : `at blocks ${n(first)} and ${n(last)}, ${n(last - first)} blocks apart`
    return (
      `No chart over time: the protocol’s whole history is ${count === 1 ? 'one swap' : 'two swaps'}, ${where}. ` +
      `${count === 1 ? 'One reading' : 'Two readings'} cannot make a trend, so these are lifetime totals, not a line.`
    )
  }
  return (
    `${n(count)} swaps between blocks ${n(first)} and ${n(last)}. ` +
    'These are lifetime totals; no series over time is drawn on this page.'
  )
}

function cutCheckText(a: ProtocolActivity): string {
  switch (a.cutCheck.k) {
    case 'verified':
      return `each pool’s sum equal to its totalTaken counter (${n(a.cutCheck.pairs)} checked)`
    case 'unavailable':
      return (
        `${n(a.cutCheck.verified)} of ${n(a.cutCheck.pairs)} checked against totalTaken; ` +
        'the rest are on a hook that predates that counter'
      )
    case 'none':
      return 'with nothing yet to check against totalTaken'
  }
}

/* ---------------------------------------------------------------------------
   View
   --------------------------------------------------------------------------- */

export function LiveStrip() {
  const [head, setHead] = useState<Head>({ k: 'loading' })
  const [activity, setActivity] = useState<Activity>({ k: 'loading' })
  const [selected, setSelected] = useState(0)

  /* One read per session: `readProtocolActivity` caches its promise. Started
     after mount, so it never holds up first paint. */
  useEffect(() => {
    let off = false
    readProtocolActivity()
      .then((a) => !off && setActivity({ k: 'ready', a }))
      .catch((e: unknown) => !off && setActivity({ k: 'error', message: reasonOf(e) }))
    return () => {
      off = true
    }
  }, [])

  /* Poll the head. One request at a time: a poll fired while the previous one
     is in flight turns a slow RPC into a queue that never drains. */
  useEffect(() => {
    let off = false
    let inFlight = false
    const tick = (): void => {
      if (inFlight) return
      inFlight = true
      readBlockNumber()
        .then((h) => !off && setHead({ k: 'ready', height: h }))
        .catch((e: unknown) => !off && setHead({ k: 'error', message: reasonOf(e) }))
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

  const tokens = activity.k === 'ready' ? activity.a.tokens : []
  const token = tokens[selected] ?? tokens[0]
  const unit = token ? unitOf(token) : null

  return (
    <section className={styles['wrap']} aria-labelledby="activity-title">
      <div className={styles['head']}>
        <div className={styles['headText']}>
          <h2 id="activity-title" className={styles['title']}>
            Protocol activity on {CHAIN.name}
          </h2>
          <p className={styles['caption']}>
            Lifetime totals read from the deployed contracts, in token units.
            {tokens.length > 1 ? ' Pick a token to read its figures.' : ''}
          </p>
        </div>
        {tokens.length > 1 ? (
          <div className={styles['toggle']} role="group" aria-label="Token the figures are shown in">
            {tokens.map((t, i) => (
              <button
                key={t.address}
                type="button"
                className={cx(styles['tab'], t === token && styles['tabOn'])}
                aria-pressed={t === token}
                onClick={() => setSelected(i)}
              >
                {unitOf(t)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles['strip']}>
        <CellView label="BLOCK" cell={headCell(head)} liveRegion pulse flashOnUpdate className={styles['cellBlock']} />
        <CellView label="VOLUME" cell={volumeCell(activity, token)} />
        <CellView label="FEES" cell={feesCell(activity, token)} />
        <CellView label="CREATOR REVENUE" cell={creatorCell(activity, token)} />
        <CellView label="PROTOCOL REVENUE" cell={protocolCell(activity, token)} />
      </div>

      <div className={styles['panel']}>
        {activity.k === 'loading' ? (
          <div className={styles['stateCard']} data-state="loading" aria-busy="true">
            <p className={styles['stateText']}>
              <i className={styles['stateDot']} aria-hidden="true" />
              Reading every Swap and RevShareTaken log on {CHAIN.name} since block{' '}
              {n(CHAIN.deployedAtBlock)}…
            </p>
          </div>
        ) : activity.k === 'error' ? (
          <div className={styles['stateCard']} data-state="error">
            <p className={styles['stateText']}>
              {CHAIN.name} is unreachable for a log read, so no totals and no chart are drawn —
              nothing is estimated in their place.
            </p>
            <p className={styles['stateRaw']}>{activity.message}</p>
          </div>
        ) : token === undefined || unit === null ? (
          <div className={styles['stateCard']} data-state="empty">
            <p className={styles['stateText']}>
              No swap has happened on {CHAIN.name} between blocks {n(activity.a.fromBlock)} and{' '}
              {n(activity.a.toBlock)}, so there are no fees to split.
            </p>
          </div>
        ) : (
          <>
            <FeeSplit
              token={token}
              symbol={unit}
              cutConfigured={activity.a.cutHooks > 0}
              chainName={CHAIN.name}
            />
            <p className={styles['series']}>
              {seriesNote(activity.a)}{' '}
              {token.isTestToken === true
                ? `${unit} is a test token nothing prices, so no dollar value is shown.`
                : 'No dollar value is shown: amounts are in the token’s own units.'}
            </p>
          </>
        )}
      </div>

      {/* Provenance, per figure. A total summed from logs and a counter read
          in one call are different claims, and the reader is entitled to
          know which each figure is. */}
      <p className={styles['provenance']}>
        <strong>Block</strong>: <code>eth_blockNumber</code>, re-read every {BLOCK_POLL_MS / 1000}s.{' '}
        {activity.k === 'ready' ? (
          <>
            <strong>Volume and swap fees</strong>: summed from all {n(activity.a.swapCount)} Swap
            logs on both pool managers, blocks {n(activity.a.fromBlock)}–{n(activity.a.toBlock)},
            input side, split by each swap’s own <code>fee</code> and <code>protocolFee</code>.{' '}
            <strong>Latch cut and creator revenue</strong>:{' '}
            {activity.a.cutHooks === 0 ? (
              <>not read — this chain has no Latch RevShareHook.</>
            ) : (
              <>
                <code>RevShareTaken</code> logs from Latch’s own RevShareHook deployments, over the
                same blocks, {cutCheckText(activity.a)}.
              </>
            )}{' '}
            <strong>Uncollected protocol fees</strong>: <code>protocolFeesAccrued</code> on both
            pool managers.
          </>
        ) : (
          <>
            <strong>Volume, fees and revenue</strong>: summed from Swap and{' '}
            <code>RevShareTaken</code> logs since block {n(CHAIN.deployedAtBlock)}, then checked
            against <code>totalTaken</code>.
          </>
        )}
      </p>
    </section>
  )
}
