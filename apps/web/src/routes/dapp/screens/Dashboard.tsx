/* Dashboard — SCREENS.md § C1. */

import { useMemo } from 'react'
import { CountUp } from '../components/CountUp.tsx'
import { RangeSwitcher } from '../components/RangeSwitcher.tsx'
import { AreaChart, BarList, Sparkline } from '../components/charts.tsx'
import { loadDashboard } from '../data/dashboard.ts'
import { useDapp } from '../state.tsx'
import { LiveChainPanel } from '../components/LiveChainPanel'

export default function Dashboard() {
  const data = useMemo(loadDashboard, [])
  const { range, setRange } = useDapp()
  const series = data.volume[range]

  return (
    <>
      <LiveChainPanel />
      <div className="dapp-kpis">
        {data.kpis.map((k, i) => (
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

          <section className="dapp-card" style={{ animationDelay: '0.16s' }}>
            <div className="dapp-card__bar">
              <h2 className="dapp-microlabel">LIVE HOOK FEED</h2>
              <span className="dapp-dot dapp-dot--primary dapp-dot--pulse dapp-dot--sm dapp-dot--end" aria-hidden="true" />
            </div>
            <ul className="dapp-feed">
              {data.feed.map((e, i) => (
                <li
                  key={`${e.latch}-${e.callback}-${e.ago}`}
                  className="dapp-feed__row"
                  style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }}
                >
                  <span
                    className={
                      e.ok
                        ? `dapp-dot dapp-dot--success${i < 2 ? ' dapp-dot--pulse' : ''}`
                        : 'dapp-dot dapp-dot--warning'
                    }
                    aria-hidden="true"
                  />
                  <span className="dapp-feed__name">
                    {e.latch} · {e.callback}
                  </span>
                  <span className="dapp-feed__ago">{e.ago}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
