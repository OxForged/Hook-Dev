/* Analytics — SCREENS.md § C6.

   Every figure on this screen is read off the deployed Sepolia contracts by
   `data/analytics.ts`. The placeholders it replaces — weekly hook-call columns,
   a four-network TVL donut, dollar fee totals for latches that do not exist —
   are documented in that module along with why each one could not be made real
   by better plumbing.

   Where the chain has nothing, this renders a labelled empty state saying so.
   Zeros dressed as data and a spinner that never resolves are the same lie told
   two different ways. */

import { useEffect, useState } from 'react'
import { BarList, ColumnChart, Donut, DonutLegend } from '../components/charts.tsx'
import { loadAnalytics, type AnalyticsData } from '../data/analytics.ts'
import { RISK_LABEL, SEPOLIA_CHAIN_ID, DEPLOYMENTS, explorerAddress } from '../../../lib/chain'

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

export default function Analytics() {
  const state = useAnalytics()
  /* Which side of the fee split the reader has isolated. Shared by the donut
     and its legend so a click on either presses both. */
  const [feeSlice, setFeeSlice] = useState<string | null>(null)
  const chain = DEPLOYMENTS[SEPOLIA_CHAIN_ID]

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
              Column height is the number of Initialize, Swap, liquidity and Donate events emitted
              by the CL pool manager in that block range — counts from logs, not a time series.
              Blocks, not weeks: Sepolia&rsquo;s block time is neither exactly 12s nor constant, so
              a date axis here would be an assumption rather than a reading.
            </p>
            <p className="live-note">
              All {n(d.eventCount)} events fall between block {n(d.firstEventBlock ?? 0n)} and{' '}
              {n(d.lastEventBlock ?? 0n)}. {n(d.quietBlocks)} blocks have been mined since with no
              protocol activity at all.
            </p>
          </>
        ) : (
          <div className="an-empty">
            <p className="an-empty__title">No protocol events yet</p>
            <p className="live-note">
              The CL pool manager at {chain.clPoolManager.slice(0, 10)}… has emitted nothing since
              deployment at block {n(chain.deployedAtBlock)}. Shown empty rather than filled with an
              example series.
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
                    {n(d.feeConfigs[0].protocolPips)} went to the protocol. Read from each Swap
                    event&rsquo;s own fee and protocolFee fields.
                  </>
                ) : (
                  <>
                    Across {n(d.feeConfigs.length)} distinct fee settings seen in Swap events,
                    weighted by swap count — testnet tokens are unpriced, so there is no common unit
                    to weight by value.
                  </>
                )}
              </p>
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
              <p className="live-note an-note">
                Token units, not dollars — ltUSD and ltETH are unpriced testnet tokens. Each bar is
                a share of that token&rsquo;s own fees, so both ends of the comparison are in the
                same unit. Apportioned per swap from that swap&rsquo;s own pips.
              </p>
            </>
          ) : (
            <div className="an-empty">
              <p className="an-empty__title">No fees earned yet</p>
              <p className="live-note">
                No swap has moved either pool token, so neither the protocol nor liquidity providers
                have accrued anything to show.
              </p>
            </div>
          )}
        </section>

        <section className="dapp-card">
          <div className="dapp-card__bar">
            <h2 className="dapp-microlabel">LATCH EARNINGS</h2>
            <LiveBadge />
          </div>
          <div className="an-empty">
            <p className="an-empty__title">Nothing to rank</p>
            <p className="live-note">
              The registry lists {n(d.hooks.length)} Latch{d.hooks.length === 1 ? '' : 'es'}, and{' '}
              {n(d.hookedPoolCount)} of {n(d.poolCount)} live pool
              {d.poolCount === 1 ? '' : 's'} {d.poolCount === 1 ? 'has' : 'have'} a Latch attached.
              {d.hookedPoolCount === 0
                ? ' With no Latch attached to a pool, no callback can have fired and no Latch has earned a fee, so there is no ranking to draw.'
                : ' Per-Latch earnings are not recorded on chain by the pool manager, so there is nothing here to rank from logs alone.'}
            </p>
          </div>
          {d.hooks.length > 0 && (
            <ul className="live-list an-hooks">
              {d.hooks.map((h) => (
                <li key={h.address}>
                  <a
                    href={explorerAddress(SEPOLIA_CHAIN_ID, h.address)}
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
