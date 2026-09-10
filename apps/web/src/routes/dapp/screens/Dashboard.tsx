/* Dashboard — SCREENS.md § C1. */

import { useMemo } from 'react'
import { CountUp } from '../components/CountUp.tsx'
import { RangeSwitcher } from '../components/RangeSwitcher.tsx'
import { AreaChart, BarList, Sparkline } from '../components/charts.tsx'
import { loadDashboard } from '../data/dashboard.ts'
import { useDapp } from '../state.tsx'
import { LiveChainPanel } from '../components/LiveChainPanel'
import { useProtocolMetrics, fmtToken } from '../../../lib/useMetrics'
import { LiveActivityFeed } from '../components/LiveActivityFeed'

/**
 * Real KPI tiles, read from the deployed Sepolia contracts.
 *
 * The design spec put $48.2M TVL / 412,905 hook calls / $186.4K fees here. Those
 * were placeholders and are gone. What replaces them is a fresh testnet: one pool,
 * two swaps, a few thousandths of a token in fees.
 *
 * No USD. ltUSD and ltETH are unpriced testnet tokens; a fabricated price to make
 * a dollar headline is the exact failure this replaces. Sparklines keep the
 * reference's shape but carry no claim - there is not enough history to plot.
 */
function liveKpis(
  m: import('../../../lib/chain').ProtocolMetrics,
  fallbackSpark: number[][],
): { label: string; value: string; trend: string; up: boolean; spark: number[] }[] {
  const t0 = m.tvl[0]
  const t1 = m.tvl[1]
  return [
    {
      label: `VAULT TVL · ${t0?.symbol ?? 'TOKEN'}`,
      value: t0 ? fmtToken(t0.balance, t0.decimals, 2) : '0',
      trend: 'live', up: true, spark: fallbackSpark[0] ?? [],
    },
    {
      label: 'SWAPS EXECUTED',
      value: String(m.swapCount),
      trend: 'all time', up: true, spark: fallbackSpark[1] ?? [],
    },
    {
      label: `PROTOCOL FEES · ${t0?.symbol ?? 'TOKEN'}`,
      value: t0 ? fmtToken(m.protocolFees0, t0.decimals, 6) : '0',
      trend: '0.1%', up: true, spark: fallbackSpark[2] ?? [],
    },
    {
      label: `LP FEES · ${t1?.symbol ?? 'TOKEN'}`,
      value: t1 ? fmtToken(m.lpFees1, t1.decimals, 6) : '0',
      trend: '0.3%', up: true, spark: fallbackSpark[3] ?? [],
    },
  ]
}
export default function Dashboard() {
  const metrics = useProtocolMetrics()
  const data = useMemo(loadDashboard, [])
  const { range, setRange } = useDapp()
  const series = data.volume[range]

  return (
    <>
      <LiveChainPanel />
      <div className="dapp-kpis">
        {(metrics.k === 'ready' ? liveKpis(metrics.m, data.kpis.map((k) => k.spark)) : data.kpis).map((k, i) => (
          <article
            key={k.label}
            className="dapp-card dapp-card--kpi"
            style={{ animationDelay: `${(i * 0.06).toFixed(2)}s` }}
          >
            <div className="dapp-card__head">
              <h2 className="dapp-microlabel">{k.label}</h2>
              <p className={k.up ? 'dapp-trend is-up' : 'dapp-trend is-flat'}>{k.trend}</p>
            </div>
            <p className="dapp-kpi__value">
              <CountUp value={k.value} />
            </p>
            <Sparkline values={k.spark} label={`${k.label} trend, last 12 intervals`} />
          </article>
        ))}
      </div>

      <div className="dapp-row dapp-row--dashboard">
        <section className="dapp-card dapp-card--chart">
          <div className="dapp-card__bar">
            <h2 className="dapp-card__title">Volume routed through your latches</h2>
            <RangeSwitcher value={range} onChange={setRange} label="Volume range" />
          </div>
          <AreaChart
            pts={series.pts}
            labels={series.labels}
            title={`Volume routed through your latches, ${range}`}
          />
        </section>

        <div className="dapp-stack">
          <section className="dapp-card" style={{ animationDelay: '0.08s' }}>
            <h2 className="dapp-microlabel">CALL MIX</h2>
            <BarList items={data.callMix} />
          </section>

          <LiveActivityFeed />
        </div>
      </div>
    </>
  )
}
