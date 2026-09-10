/* Pool Detail — SCREENS.md § C4.

   The header, fee chart and Latch-call list are still the typed placeholder
   from `data/pool.ts` (the shell's SAMPLE DATA chip covers them). The price row
   directly beneath the header is not: it reads the live Sepolia pool off chain
   and the reference markets off their providers, and labels each as such. */

import { useMemo } from 'react'
import { CountUp } from '../components/CountUp.tsx'
import { FeeChart } from '../components/charts.tsx'
import { PoolPriceCard } from '../components/PoolPriceCard.tsx'
import { loadPool } from '../data/pool.ts'

export default function PoolDetail() {
  const data = useMemo(loadPool, [])

  return (
    <>
      <section className="dapp-pool-head">
        <span className="dapp-pair" aria-hidden="true">
          <span className="dapp-pair__token" />
          <span className="dapp-pair__token dapp-pair__token--alt" />
        </span>
        <div>
          <h2 className="dapp-pool-head__pair">{data.pair}</h2>
          <p className="dapp-pool-head__attach">{data.attachment}</p>
        </div>
        <dl className="dapp-pool-stats">
          {data.stats.map((s) => (
            <div key={s.label} className="dapp-pool-stat">
              <dt className="dapp-stat__label">{s.label}</dt>
              <dd className="dapp-pool-stat__value">
                <CountUp value={s.value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <PoolPriceCard />

      <div className="dapp-row dapp-row--pool">
        <section className="dapp-card">
          <h2 className="dapp-microlabel">FEE APPLIED BY LATCH · 24H</h2>
          <FeeChart
            fee={data.feeSeries}
            volatility={data.volatilitySeries}
            title="Fee applied by latch over 24 hours, against the volatility index"
          />
          <p className="dapp-chart-legend">
            <span className="dapp-chart-legend__item">
              <span className="dapp-chart-legend__key dapp-chart-legend__key--fee" aria-hidden="true" />
              {data.legend.fee}
            </span>
            <span className="dapp-chart-legend__item">
              <span className="dapp-chart-legend__key dapp-chart-legend__key--vol" aria-hidden="true" />
              {data.legend.volatility}
            </span>
          </p>
        </section>

        <section className="dapp-card">
          <h2 className="dapp-microlabel">RECENT LATCH CALLS</h2>
          <ul className="dapp-calls">
            {data.calls.map((c, i) => (
              <li
                key={`${c.kind}-${i}`}
                className="dapp-calls__row"
                style={{ animationDelay: `${(i * 0.05).toFixed(2)}s` }}
              >
                <span className="dapp-calls__kind">{c.kind}</span>
                <span className="dapp-calls__fee">{c.fee}</span>
                <span className="dapp-calls__gas">{c.gas}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
