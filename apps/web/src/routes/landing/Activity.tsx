import { useEffect, useState } from 'react'
import { MEASURED_GAS, NETWORK_REACH, TEST_COVERAGE } from './data'
import {
  ACTIVE_CHAIN_ID,
  DEPLOYMENTS,
  readActivity,
  readProtocolStatus,
  type ActivityEvent,
  type ProtocolStatus,
} from '../../lib/chain'
import { useProtocolMetrics, fmtToken } from '../../lib/useMetrics'
import { GasCompareChart } from '../../charts/GasCompareChart'
import { pctMore } from '../../charts/chart-utils'
import { BarList } from '../dapp/components/charts'
import { Gauge, SeriesChart, type SeriesPoint } from '../dapp/components/series-charts'
import type { LabelledBar } from '../dapp/data/types'
import styles from './landing.module.css'
import { cx } from './ui'

/** The chain this build serves. Never a spelled-out name — see landing/data.ts. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * A4. Protocol activity — real, or absent.
 *
 * This section used to be six charts of invented figures behind an "ILLUSTRATIVE
 * FIGURES" label: a TVL area chart, a gas histogram, a TVL-by-network donut,
 * 1,840 latches deployed at 96 a week, and a PROTOCOL HEALTH card reporting
 * "Audit coverage: 94% of TVL".
 *
 * The disclaimer made those figures disclosed, not true. And an invented audit
 * number is the one placeholder that should never have been drawn at all — this
 * protocol has never been audited, the audience for this page is developers
 * deciding whether to trust it with other people's money, and a security claim is
 * the last place a reader expects an illustration.
 *
 * What replaces them is smaller and entirely checkable: live chain reads, gas
 * measured by executing the calls, test counts from suites that run, and an audit
 * status that says "none". For the audience this page is trying to reach, a
 * verifiable small number outperforms an impressive invented one.
 *
 * WHAT IS DRAWN, AND WHAT IS DELIBERATELY NOT
 *
 * Four charts, each of a comparison or a progression that is already IN the
 * data rather than imposed on it:
 *
 *   - the event mix is five counts on one axis, so a bar list shows which kinds
 *     of activity this deployment has actually seen;
 *   - the cumulative series is one point per real event at the block it landed
 *     in — no bucketing, no smoothing, and no plot at all below two events;
 *   - the fee gauge is one reading against one known ceiling, and both numbers
 *     are read from the deployed fee controller rather than typed here;
 *   - the gas panel is two measurements of the same operation, where the whole
 *     content is the gap between them.
 *
 * The rest of LIVE PROTOCOL STATE stays as rows. Those figures are unrelated
 * scalars — two counts, two token balances — with no shared axis and no shared
 * unit, so a chart of them would order and compare things that do not compare.
 *
 * Nothing here interpolates, smooths or extends. `SeriesChart` refuses to draw
 * fewer than two points and says how many there are instead; that empty state
 * is the correct output on a young deployment, not a gap to be filled.
 */

type FeedState =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; events: ActivityEvent[] }

type StatusState =
  | { k: 'loading' }
  | { k: 'error' }
  | { k: 'ready'; s: ProtocolStatus }

const PIPS_DENOMINATOR = 1_000_000

/** Pips of `ProtocolFeeLibrary.PIPS_DENOMINATOR` as a percentage of swap input. */
const pctOfPips = (pips: number) => `${Number(((pips / PIPS_DENOMINATOR) * 100).toFixed(4))}%`

/**
 * The protocol fee against the ceiling core will ever permit.
 *
 * Both numbers are READ: `DEFAULT_FEE_PIPS` and `MAX_PROTOCOL_FEE` off the
 * deployed fee controller. They used to be two constants typed into this file,
 * which was accurate for the one chain that existed and would have quietly
 * misreported any chain configured differently.
 *
 * `feesDisabled` is load-bearing rather than a footnote: when the guardian has
 * fees off, the rate actually charged is zero, and drawing the configured
 * default as though it were being taken would overstate what the protocol
 * takes. The gauge shows zero and the caption says why.
 */
function FeeGauge() {
  const [state, setState] = useState<StatusState>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readProtocolStatus(ACTIVE_CHAIN_ID)
      .then((s) => !off && setState({ k: 'ready', s }))
      .catch(() => !off && setState({ k: 'error' }))
    return () => {
      off = true
    }
  }, [])

  if (state.k !== 'ready') {
    return (
      <p className={styles['placeholderNote']}>
        {state.k === 'loading' ? 'READING THE FEE CONTROLLER…' : 'FEE CONTROLLER UNREACHABLE'}
      </p>
    )
  }

  const { defaultFeePips, maxFeePips, feesDisabled } = state.s
  const taken = feesDisabled ? 0 : defaultFeePips

  return (
    <div className={styles['hostedGauge']}>
      <Gauge
        value={taken}
        max={maxFeePips}
        label="Protocol fee against the cap the contract allows"
        valueText={pctOfPips(taken)}
        maxText={pctOfPips(maxFeePips)}
        color={feesDisabled ? 'success' : 'primary'}
        caption={
          feesDisabled ? (
            <>
              <strong>Fees are disabled</strong> — the configured default is{' '}
              {pctOfPips(defaultFeePips)}, and nothing is being taken.
            </>
          ) : (
            <>
              the <code>MAX_PROTOCOL_FEE</code> cap, set per swap direction
            </>
          )
        }
      />
    </div>
  )
}

/** Live pools, swaps and vault TVL, read from the deployed contracts. */
function LiveState() {
  const s = useProtocolMetrics()

  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>
        LIVE PROTOCOL STATE · {CHAIN.name.toUpperCase()}
      </h3>

      {s.k === 'loading' && <p className={styles['placeholderNote']}>READING CHAIN&hellip;</p>}
      {s.k === 'error' && (
        <p className={styles['placeholderNote']}>
          COULD NOT REACH THE CHAIN — NO FIGURES SHOWN RATHER THAN STALE ONES
        </p>
      )}

      {s.k === 'ready' && (
        <>
          <div className={styles['healthList']}>
            <div className={styles['healthRow']}>
              <span className={styles['healthName']}>Pools initialized</span>
              <span className={styles['healthValue']}>{s.m.poolCount}</span>
            </div>
            <div className={styles['healthRow']}>
              <span className={styles['healthName']}>Swaps executed</span>
              <span className={styles['healthValue']}>{s.m.swapCount}</span>
            </div>
            {s.m.tvl.map((t) => (
              <div key={t.token} className={styles['healthRow']}>
                <span className={styles['healthName']}>Vault holds {t.symbol}</span>
                <span className={styles['healthValue']}>{fmtToken(t.balance, t.decimals, 2)}</span>
              </div>
            ))}
          </div>
          <FeeGauge />
          <p className={styles['deployCaption']}>
            Block {s.m.latestBlock.toString()}. Token units only — nothing prices this pair.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Series colours per event kind, so a kind keeps its colour as counts move it
 * up and down the list. Keyed by name rather than by rank for that reason.
 */
const EVENT_COLOR: Record<string, LabelledBar['color']> = {
  Swap: 'primary',
  'Add liquidity': 'signal',
  'Remove liquidity': 'violet',
  Donate: 'success',
  Initialize: 'amber',
}

/**
 * Counts -> bars, longest first.
 *
 * `pct` is a share of the LARGEST count, not of the total: with five kinds the
 * biggest share-of-total bar would be a third of the track and the differences
 * between the rest would be invisible. What that percentage measures is stated
 * on the tooltip (`shareLabel`) rather than left for the reader to guess, and
 * the raw count sits on the row either way.
 */
function toBars(counts: Map<string, number>): LabelledBar[] {
  const max = Math.max(1, ...counts.values())
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({
      name,
      value: String(n),
      pct: Math.round((n / max) * 100),
      color: EVENT_COLOR[name] ?? 'primary',
    }))
}

/**
 * Events -> a cumulative series indexed by BLOCK.
 *
 * One point per event, at the block that event actually landed in, with y as
 * the running count. Nothing is bucketed and nothing is interpolated: every
 * point is a log entry, and two events in one block simply share an x.
 *
 * The axis is block height, not wall-clock time, and that is deliberate. Block
 * times are not constant, so dividing a height by an assumed interval turns a
 * measurement into an estimate wearing a measurement's clothes. Height is what
 * the chain reported.
 *
 * Ordered ascending here because `readActivity` returns newest-first for the
 * feed's benefit, and `SeriesChart` requires ascending x from its caller.
 */
function toSeries(events: readonly ActivityEvent[]): SeriesPoint[] {
  return [...events]
    .sort((a, b) => Number(a.blockNumber - b.blockNumber))
    .map((e, i) => ({
      x: Number(e.blockNumber),
      y: i + 1,
      label: `Block ${e.blockNumber.toLocaleString('en-US')}`,
      value: `${i + 1} · ${e.kind}`,
    }))
}

/** Real protocol events by type and over blocks. Not Latch callbacks — none have ever fired. */
function EventMix() {
  const [state, setState] = useState<FeedState>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readActivity(ACTIVE_CHAIN_ID, 200)
      .then((events) => !off && setState({ k: 'ready', events }))
      .catch(
        (e) =>
          !off && setState({ k: 'error', message: e instanceof Error ? e.message : 'unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])

  const events = state.k === 'ready' ? state.events : []
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  const bars = toBars(counts)
  const series = toSeries(events)
  const firstBlock = series[0]?.label

  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>PROTOCOL EVENTS BY TYPE</h3>

      {state.k !== 'ready' ? (
        <p className={styles['placeholderNote']}>
          {state.k === 'loading' ? 'READING CONTRACT LOGS…' : 'CHAIN UNREACHABLE'}
        </p>
      ) : bars.length === 0 ? (
        <p className={styles['placeholderNote']}>NO EVENTS RECORDED YET</p>
      ) : (
        <>
          <BarList
            items={bars}
            className={styles['hostedBars'] ?? ''}
            valueLabel="recorded"
            shareLabel="of the most frequent event type"
          />

          <div className={styles['hostedSeries']}>
            <SeriesChart
              points={series}
              label="Protocol events over block height, cumulative"
              valueLabel="events so far"
              area
              empty={`${events.length} event${events.length === 1 ? '' : 's'} so far. A line needs two — nothing is drawn rather than implying a shape from one point.`}
            />
          </div>

          <p className={styles['deployCaption']}>
            {series.length >= 2
              ? `Cumulative, one point per event, from ${firstBlock}. Block height, not elapsed time — block intervals are not constant.`
              : 'Protocol events, not Latch callbacks.'}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Gas measured by executing the calls against a Sepolia fork, not estimated.
 *
 * `MEASURED_GAS` stores the figures pre-formatted for a key/value row, which is
 * what they were for; the chart needs them as numbers to put them on a shared
 * axis. Parsed here rather than duplicated, so `./data` stays the one place the
 * measurements live.
 */
function MeasuredGas() {
  const bars = MEASURED_GAS.map((row) => ({ name: row.name, gas: Number(row.gas.replace(/,/g, '')) }))
  const base = bars[0]
  const next = bars[1]
  const delta = base && next ? pctMore(base.gas, next.gas) : null

  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>GAS, MEASURED ON A SEPOLIA FORK</h3>
      <div className={styles['chartHost']}>
        <GasCompareChart bars={bars} />
      </div>
      <p className={styles['deployCaption']}>
        Observed in executed transactions, not estimated.
        {base && next && delta !== null
          ? ` A second hop costs ${(next.gas - base.gas).toLocaleString('en-US')} gas more, +${delta.toFixed(1)}%.`
          : ''}{' '}
        A Latch adds its own cost on top.
      </p>
    </div>
  )
}

/** Where Latch actually is, versus where it is going. */
function NetworkReach() {
  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>NETWORK REACH</h3>
      <div className={styles['healthList']}>
        {NETWORK_REACH.map((row) => (
          <div key={row.name} className={cx(styles['healthRow'], styles[row.toneClass])}>
            <span className={styles['statusDot']} aria-hidden="true" />
            <span className={styles['healthName']}>{row.name}</span>
            <span className={styles['healthValue']}>{row.value}</span>
          </div>
        ))}
      </div>
      <p className={styles['deployCaption']}>
        Targets are EIP-1153-probed networks with no contracts, labelled as such everywhere here.
      </p>
    </div>
  )
}

/** Test counts from suites that actually run, and the audit status. */
function Assurance() {
  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>ASSURANCE</h3>
      <div className={styles['healthList']}>
        {TEST_COVERAGE.map((row) => (
          <div key={row.name} className={cx(styles['healthRow'], styles[row.toneClass])}>
            <span className={styles['statusDot']} aria-hidden="true" />
            <span className={styles['healthName']}>{row.name}</span>
            <span className={styles['healthValue']}>{row.value}</span>
          </div>
        ))}
      </div>
      <p className={styles['deployCaption']}>No third-party audit has been performed.</p>
    </div>
  )
}

export function Activity() {
  return (
    <section
      id="activity"
      className={cx(styles['section'], styles['reveal'], styles['delay1'])}
      aria-labelledby="activity-title"
    >
      <div className={styles['sectionHead']}>
        <div>
          <p className={styles['eyebrow']}>PROTOCOL ACTIVITY</p>
          <h2 id="activity-title" className={styles['h2']}>
            Measured, not illustrated.
          </h2>
        </div>
      </div>

      <div className={styles['activityGrid']}>
        <LiveState />
        <div className={styles['sideColumn']}>
          <EventMix />
          <MeasuredGas />
        </div>
      </div>

      <div className={styles['activityRow']}>
        <NetworkReach />
        <Assurance />
      </div>
    </section>
  )
}
