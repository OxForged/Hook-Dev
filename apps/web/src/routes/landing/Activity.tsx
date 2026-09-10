import { useEffect, useState } from 'react'
import { MEASURED_GAS, NETWORK_REACH, TEST_COVERAGE } from './data'
import { SEPOLIA_CHAIN_ID, readActivity, type ActivityEvent } from '../../lib/chain'
import { useProtocolMetrics, fmtToken } from '../../lib/useMetrics'
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
 */

const MIN_POINTS_FOR_SERIES = 12

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
            <div className={styles['healthRow']}>
              <span className={styles['healthName']}>Protocol fee taken</span>
              <span className={styles['healthValue']}>0.1% of 0.4% cap</span>
            </div>
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
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const swaps = counts.get('Swap') ?? 0

  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>PROTOCOL EVENTS BY TYPE</h3>

      {state.k !== 'ready' ? (
        <p className={styles['placeholderNote']}>
          {state.k === 'loading' ? 'READING CONTRACT LOGS…' : 'CHAIN UNREACHABLE'}
        </p>
      ) : rows.length === 0 ? (
        <p className={styles['placeholderNote']}>NO EVENTS RECORDED YET</p>
      ) : (
        <>
          <div className={styles['healthList']}>
            {rows.map(([name, n]) => (
              <div key={name} className={styles['healthRow']}>
                <span className={styles['healthName']}>{name}</span>
                <span className={styles['healthValue']}>{n}</span>
              </div>
            ))}
          </div>
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

/** Gas measured by executing the calls against a Sepolia fork, not estimated. */
function MeasuredGas() {
  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>GAS, MEASURED ON A SEPOLIA FORK</h3>
      <div className={styles['healthList']}>
        {MEASURED_GAS.map((row) => (
          <div key={row.name} className={styles['healthRow']}>
            <span className={styles['healthName']}>{row.name}</span>
            <span className={styles['healthValue']}>{row.gas}</span>
          </div>
        ))}
      </div>
      <p className={styles['deployCaption']}>
        Observed in executed transactions, not estimated. A Latch adds its own cost on top.
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
