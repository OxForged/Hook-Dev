import { useEffect, useState } from 'react'
import { MEASURED_GAS, NETWORK_REACH, TEST_COVERAGE } from './data'
import { SEPOLIA_CHAIN_ID, readActivity, type ActivityEvent } from '../../lib/chain'
import { useProtocolMetrics, fmtToken } from '../../lib/useMetrics'
import { GasCompareChart } from '../../charts/GasCompareChart'
import { pctMore } from '../../charts/chart-utils'
import { BarList } from '../dapp/components/charts'
import type { LabelledBar } from '../dapp/data/types'
import styles from './landing.module.css'
import { cx } from './ui'

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
 * Two of the three panels are charts, and both are charts of a COMPARISON that
 * already exists in the data:
 *
 *   - the event mix is five counts on one axis, so the bar list shows which
 *     kinds of activity this deployment has actually seen;
 *   - the gas panel is two measurements of the same operation, where the whole
 *     content is the gap between them.
 *
 * LIVE PROTOCOL STATE stays as rows. Those five figures are unrelated scalars —
 * two counts, two token balances, one rate — with no shared axis and no shared
 * unit, so a chart of them would order and compare things that do not compare.
 * The one exception is the protocol fee, which IS a ratio (what is taken,
 * against the ceiling the contract allows), and gets a meter for exactly that
 * reason.
 *
 * There are six protocol events and two swaps on this deployment. Nothing here
 * interpolates, smooths, or extends that into a trend: every bar drawn is a
 * number that is also printed next to it, and the "too few swaps to plot a time
 * series" caveat stays, because it is the reason there is no time series.
 */

const MIN_POINTS_FOR_SERIES = 12

/**
 * The fee the deployed controller charges, and the ceiling the core allows.
 *
 * Both in pips of `ProtocolFeeLibrary.PIPS_DENOMINATOR` (1e6), matching
 * `DEFAULT_FEE_PIPS` and `MAX_PROTOCOL_FEE` on the Sepolia fee controller —
 * the same pair `readProtocolStatus` reads, and the same 1000 that shows up in
 * the `protocolFee` field of every real Swap log on this deployment.
 */
const FEE_PIPS = 1000
const FEE_CAP_PIPS = 4000
const PIPS_DENOMINATOR = 1_000_000

const pctOfPips = (pips: number) => (pips / PIPS_DENOMINATOR) * 100

/**
 * A genuine part-of-whole: 0.1% taken against the 0.4% the contract will ever
 * permit. Not interactive — it restates one scalar that is printed directly
 * above it, and a hover affordance would promise an inspection there is nothing
 * to inspect. `role="meter"` carries the same reading to a screen reader.
 */
function FeeMeter() {
  const taken = pctOfPips(FEE_PIPS)
  const cap = pctOfPips(FEE_CAP_PIPS)
  const share = (FEE_PIPS / FEE_CAP_PIPS) * 100
  const text = `${taken}% taken of the ${cap}% cap`

  return (
    <div className={styles['feeMeter']}>
      <div className={styles['healthRow']}>
        <span className={styles['healthName']}>Protocol fee taken</span>
        <span className={styles['healthValue']}>
          {taken}% of {cap}% cap
        </span>
      </div>
      <div
        className={styles['meterTrack']}
        role="meter"
        aria-label="Protocol fee against the cap the contract allows"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={taken}
        aria-valuetext={text}
      >
        <span className={styles['meterFill']} style={{ width: `${share}%` }} aria-hidden="true" />
      </div>
      <p className={styles['meterScale']} aria-hidden="true">
        <span>0%</span>
        <span>{cap}% cap</span>
      </p>
    </div>
  )
}

type FeedState =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; events: ActivityEvent[] }

/** Live pools, swaps and vault TVL, read from the deployed Sepolia contracts. */
function LiveState() {
  const s = useProtocolMetrics()

  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>LIVE PROTOCOL STATE · ETHEREUM SEPOLIA</h3>

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
            <FeeMeter />
          </div>
          <p className={styles['deployCaption']}>
            Block {s.m.latestBlock.toString()} · testnet only, no mainnet deployment. No USD figure:
            these are unpriced testnet tokens, and inventing a price to produce a dollar headline is
            the failure this section replaced.
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

/** Real protocol events by type. Not Latch callbacks — none have ever fired. */
function EventMix() {
  const [state, setState] = useState<FeedState>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readActivity(SEPOLIA_CHAIN_ID, 200)
      .then((events) => !off && setState({ k: 'ready', events }))
      .catch(
        (e) =>
          !off && setState({ k: 'error', message: e instanceof Error ? e.message : 'unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])

  const counts = new Map<string, number>()
  if (state.k === 'ready') {
    for (const e of state.events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  }
  const bars = toBars(counts)
  const swaps = counts.get('Swap') ?? 0

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
          <p className={styles['deployCaption']}>
            {swaps < MIN_POINTS_FOR_SERIES
              ? `Too few swaps (${swaps}) to plot a time series; the count is shown instead.`
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
          ? ` The second hop costs ${(next.gas - base.gas).toLocaleString('en-US')} gas more, ${delta.toFixed(1)}% on top of a single-hop swap.`
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
        Contracts are deployed on one network. The other ten are targets, and are labelled as such
        everywhere in this app.
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
      <p className={styles['deployCaption']}>
        No third-party audit has been performed. Said plainly, because a reader deciding whether to
        trust this with other people&rsquo;s money should not have to infer it from silence.
      </p>
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
