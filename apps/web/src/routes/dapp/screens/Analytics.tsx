/* Analytics — SCREENS.md § C6.

   Every figure on this screen is read off the ACTIVE deployment's contracts by
   `data/analytics.ts`. The placeholders it replaces — weekly hook-call columns,
   a four-network TVL donut, dollar fee totals for latches that do not exist —
   are documented in that module along with why each one could not be made real
   by better plumbing.

   NO CHAIN IS NAMED IN A STRING HERE. Every mention comes from
   `DEPLOYMENTS[ACTIVE_CHAIN_ID].name`. One build serves one network, and a
   testnet name rendered under a mainnet header is the same class of error as an
   invented number: authoritative-looking and wrong.

   Where the chain has nothing, this renders a labelled empty state saying so.
   Zeros dressed as data and a spinner that never resolves are the same lie told
   two different ways. */

import { useEffect, useMemo, useState } from 'react'
import { BarList, ColumnChart, Donut, DonutLegend } from '../components/charts.tsx'
import { SeriesChart, type SeriesPoint } from '../components/series-charts.tsx'
import { Methodology } from '../components/ProtocolCharts.tsx'
import { loadAnalytics, type AnalyticsData, type TokenFeeSeries } from '../data/analytics.ts'
import {
  RISK_LABEL,
  ACTIVE_CHAIN_ID,
  DEPLOYMENTS,
  explorerAddress,
  formatUnits,
} from '../../../lib/chain'

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; d: AnalyticsData }

function useAnalytics(): State {
  const [state, setState] = useState<State>({ k: 'loading' })
  useEffect(() => {
    let off = false
    loadAnalytics()
      .then((d) => !off && setState({ k: 'ready', d }))
      .catch(
        (e) =>
          !off &&
          setState({ k: 'error', message: e instanceof Error ? e.message : 'chain unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])
  return state
}

function LiveBadge() {
  return (
    <span className="dapp-badge dapp-badge--ok an-badge">
      <span className="dapp-dot dapp-dot--success dapp-dot--sm dapp-dot--pulse" aria-hidden="true" />
      LIVE
    </span>
  )
}

const n = (v: number | bigint) => v.toLocaleString('en-US')

/** The two sides of the fee split, kept as data so the legend can toggle them. */
const FEE_SERIES = [
  { key: 'primary', label: 'Protocol' },
  { key: 'violet', label: 'Liquidity providers' },
] as const

/**
 * A token's running fee total, plotted against block height.
 *
 * ONE TOKEN PER CHART, deliberately. Nothing prices these tokens, so there is no
 * rate at which an ltETH fee and an ltUSD fee could be added into one line —
 * the same constraint that keeps the fee bars below per token.
 *
 * `SeriesChart` refuses to draw fewer than two points and says how many there
 * are, which is the correct output for a deployment where a token has been the
 * input side of exactly one swap. Nothing is padded to make the chart appear.
 */
function FeeSeriesCard({ series, chainName }: { series: TokenFeeSeries; chainName: string }) {
  const points: SeriesPoint[] = useMemo(
    () =>
      series.points.map((p) => ({
        x: Number(p.blockNumber),
        /* The token's SMALLEST unit, not a rounded decimal string. `y` only
           positions the point; rounding to 8 places first would flatten a
           series of sub-microtoken fees to a line of zeros while the tooltip
           went on printing distinct values. The reader's number is `value`. */
        y: Number(p.cumulative),
        label: `Block #${n(p.blockNumber)}`,
        value: `${formatUnits(p.cumulative, series.decimals, 6)} ${series.symbol}`,
      })),
    [series],
  )

  const last = series.points[series.points.length - 1]

  return (
    <section className="dapp-card">
      <div className="dapp-card__bar">
        <h2 className="dapp-microlabel">FEES CHARGED IN {series.symbol} · BY BLOCK</h2>
        <LiveBadge />
      </div>
      <SeriesChart
        points={points}
        area
        color="signal"
        label={`Cumulative swap fee charged in ${series.symbol} on ${chainName}, against block height`}
        valueLabel={`${series.symbol} charged, running total`}
        empty={`One swap has charged a fee in ${series.symbol}. A line needs two readings, so none is drawn.`}
      />
      {points.length >= 2 && (
        <div className="dapp-axis">
          <span>#{n(points[0]?.x ?? 0)}</span>
          <span>running total · block height</span>
          <span>#{n(points[points.length - 1]?.x ?? 0)}</span>
        </div>
      )}
      <p className="live-note an-note">
        {last ? formatUnits(last.cumulative, series.decimals, 6) : '0'} {series.symbol} charged
        across {n(series.points.length)} swap{series.points.length === 1 ? '' : 's'}.
      </p>
      <Methodology label="How this total is built">
        <p className="live-note">
          Each point is one swap whose input side was {series.symbol}, apportioned from that
          swap&rsquo;s own <code>fee</code> field rather than the controller&rsquo;s current default
          — a fee change would otherwise rewrite history. The line joins measured swaps only and
          never crosses a block nobody swapped in. Protocol and LP shares together, in token units:
          there is no price for {series.symbol}.
        </p>
      </Methodology>
    </section>
  )
}

export default function Analytics() {
  const state = useAnalytics()
  /* Which side of the fee split the reader has isolated. Shared by the donut
     and its legend so a click on either presses both. */
  const [feeSlice, setFeeSlice] = useState<string | null>(null)
  const chain = DEPLOYMENTS[ACTIVE_CHAIN_ID]

  if (state.k !== 'ready') {
    return (
      <section className="dapp-card dapp-card--chart">
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">PROTOCOL ANALYTICS</h2>
          <LiveBadge />
        </div>
        <p className={`live-note${state.k === 'error' ? ' live-note--err' : ''}`} role="status">
          {state.k === 'loading'
            ? `Reading protocol events, pools and swap fees from the ${chain.name} contracts…`
            : `Could not reach ${chain.name}: ${state.message}. Nothing shown rather than placeholder figures.`}
        </p>
      </section>
    )
  }

  const d = state.d
  const hasEvents = d.buckets.length > 0

  return (
    <div className="dapp-row dapp-row--analytics">
      <section className="dapp-card dapp-card--chart">
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">PROTOCOL EVENTS BY BLOCK</h2>
          <LiveBadge />
        </div>

        <dl className="an-stats">
          <div>
            <dt>Events</dt>
            <dd>{n(d.eventCount)}</dd>
          </div>
          <div>
            <dt>Swaps</dt>
            <dd>{n(d.swapCount)}</dd>
          </div>
          <div>
            <dt>Pools</dt>
            <dd>{n(d.poolCount)}</dd>
          </div>
          <div>
            <dt>Head block</dt>
            <dd>{n(d.latestBlock)}</dd>
          </div>
        </dl>

        {hasEvents ? (
          <>
            <ColumnChart
              points={d.buckets.map((b) => {
                // The last bucket's arithmetic end can run past the last block
                // that actually carried an event; report the observed end.
                const to = d.lastEventBlock !== null && b.toBlock > d.lastEventBlock
                  ? d.lastEventBlock
                  : b.toBlock
                return {
                  pct: b.pct,
                  value: n(b.count),
                  unit: b.count === 1 ? 'protocol event' : 'protocol events',
                  label:
                    b.fromBlock === to
                      ? `Block #${n(b.fromBlock)}`
                      : `Blocks #${n(b.fromBlock)}–#${n(to)}`,
                }
              })}
              label={`${n(d.eventCount)} protocol events across blocks ${n(d.firstEventBlock ?? 0n)} to ${n(d.lastEventBlock ?? 0n)}, ${n(d.buckets.length)} column${d.buckets.length === 1 ? '' : 's'} of ${n(d.blocksPerBucket)} block${d.blocksPerBucket === 1 ? '' : 's'}`}
            />
            <div className="dapp-axis">
              <span>#{n(d.firstEventBlock ?? 0n)}</span>
              <span>
                {d.blocksPerBucket === 1
                  ? '1 block per column'
                  : `${n(d.blocksPerBucket)} blocks per column`}
              </span>
              <span>#{n(d.lastEventBlock ?? 0n)}</span>
            </div>
            <p className="live-note an-note">
              All {n(d.eventCount)} events fall between block {n(d.firstEventBlock ?? 0n)} and{' '}
              {n(d.lastEventBlock ?? 0n)}; {n(d.quietBlocks)} blocks have been mined since with no
              protocol activity.
            </p>
            <Methodology label="What a column counts, and why blocks">
              <p className="live-note">
                Column height is the number of Initialize, Swap, liquidity and Donate events the CL
                pool manager emitted in that block range — counts from logs, not a time series.
                Blocks rather than weeks because {chain.name}&rsquo;s block time is neither exactly
                12s nor constant, so a date axis would be an assumption rather than a reading.
              </p>
            </Methodology>
          </>
        ) : (
          <div className="an-empty">
            <p className="an-empty__title">No protocol events yet</p>
            <p className="live-note">
              The CL pool manager at {chain.clPoolManager.slice(0, 10)}… has emitted nothing since
              block {n(chain.deployedAtBlock)}.
            </p>
          </div>
        )}
      </section>

      <div className="dapp-stack">
        {d.feeSplit.length > 0 ? (
          <section className="dapp-card dapp-card--donut">
            <Donut
              segments={d.feeSplit}
              label="Swap fee split between protocol and liquidity providers"
              unit="of the swap fee charged"
              selected={feeSlice}
              onSelect={setFeeSlice}
            />
            <div className="dapp-card__donut-body">
              <h2 className="dapp-microlabel">SWAP FEE SPLIT</h2>
              <DonutLegend
                segments={d.feeSplit}
                unit="of the swap fee charged"
                selected={feeSlice}
                onSelect={setFeeSlice}
              />
              <p className="live-note an-note">
                {d.feeConfigs.length === 1 && d.feeConfigs[0] ? (
                  <>
                    Every recorded swap charged {n(d.feeConfigs[0].totalPips)} pips, of which{' '}
                    {n(d.feeConfigs[0].protocolPips)} went to the protocol.
                  </>
                ) : (
                  <>
                    {n(d.feeConfigs.length)} distinct fee settings seen, weighted by swap count.
                  </>
                )}
              </p>
              <Methodology label="Where these two numbers come from">
                <p className="live-note">
                  Each Swap event&rsquo;s own <code>fee</code> and <code>protocolFee</code> fields,
                  weighted by swap COUNT rather than by value: the two sides of a swap are different
                  tokens and nothing prices them, so there is no common unit to weight by.
                </p>
              </Methodology>
            </div>
          </section>
        ) : (
          <section className="dapp-card">
            <div className="dapp-card__bar">
              <h2 className="dapp-microlabel">SWAP FEE SPLIT</h2>
              <LiveBadge />
            </div>
            <div className="an-empty">
              <p className="an-empty__title">No swaps to split</p>
              <p className="live-note">
                A fee split needs a swap to have charged a fee. None has.
              </p>
            </div>
          </section>
        )}

        <section className="dapp-card">
          <div className="dapp-card__bar">
            <h2 className="dapp-microlabel">FEES EARNED · BY TOKEN</h2>
            <LiveBadge />
          </div>
          {d.feeBars.length > 0 ? (
            <>
              <BarList
                items={d.feeBars}
                valueLabel="earned, in token units"
                shareLabel="of this token’s fees"
                series={FEE_SERIES.filter((s) => d.feeBars.some((b) => b.color === s.key))}
              />
              <p className="live-note an-note">Token units, not dollars.</p>
              <Methodology label="What each bar is a share of">
                <p className="live-note">
                  That token&rsquo;s OWN fees, so both ends of a comparison are in the same unit —
                  the pool tokens are unpriced, so an ltUSD bar measured against an ltETH bar would
                  need a rate that does not exist. Apportioned per swap from that swap&rsquo;s own
                  pips.
                </p>
              </Methodology>
            </>
          ) : (
            <div className="an-empty">
              <p className="an-empty__title">No fees earned yet</p>
              <p className="live-note">
                No swap has moved either pool token, so nothing has accrued.
              </p>
            </div>
          )}
        </section>

        {/* One card per token that has ever been the input side of a fee-bearing
            swap. A token with a single such swap still gets its card — the chart
            says "one reading" rather than the screen hiding that it has data at
            all. */}
        {d.feeSeries.map((s) => (
          <FeeSeriesCard key={s.symbol} series={s} chainName={chain.name} />
        ))}

        <section className="dapp-card">
          <div className="dapp-card__bar">
            <h2 className="dapp-microlabel">LATCH EARNINGS</h2>
            <LiveBadge />
          </div>
          <div className="an-empty">
            <p className="an-empty__title">Nothing to rank</p>
            <p className="live-note">
              The registry lists {n(d.hooks.length)} Latch{d.hooks.length === 1 ? '' : 'es'};{' '}
              {n(d.hookedPoolCount)} of {n(d.poolCount)} live pool
              {d.poolCount === 1 ? '' : 's'} {d.poolCount === 1 ? 'has' : 'have'} one attached.
            </p>
            <Methodology label="Why there is no ranking">
              <p className="live-note">
                {d.hookedPoolCount === 0
                  ? 'No pool has a Latch attached, so no callback can have fired and no Latch has earned a fee.'
                  : 'The pool manager records no per-Latch earnings on chain, so nothing can be ranked from logs alone.'}
              </p>
            </Methodology>
          </div>
          {d.hooks.length > 0 && (
            <ul className="live-list an-hooks">
              {d.hooks.map((h) => (
                <li key={h.address}>
                  <a
                    href={explorerAddress(ACTIVE_CHAIN_ID, h.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-hit
                  >
                    {h.name || h.address}
                  </a>
                  <span className="live-fee">{RISK_LABEL[h.risk]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
