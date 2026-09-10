/* Portfolio — SCREENS.md § C5. Real <table>; stacks into rows on mobile. */

import { useMemo } from 'react'
import { CountUp } from '../components/CountUp.tsx'
import { loadPortfolio } from '../data/portfolio.ts'
import type { PositionStatus } from '../data/portfolio.ts'

const BADGE_CLASS: Record<PositionStatus, string> = {
  ACTIVE: 'dapp-badge dapp-badge--ok',
  PENDING: 'dapp-badge dapp-badge--warn',
  PAUSED: 'dapp-badge dapp-badge--mute',
}

export default function Portfolio() {
  const data = useMemo(loadPortfolio, [])
  const [position = 'POSITION', latch = 'LATCH', value = 'VALUE', fees = 'FEES 30D', status = 'STATUS'] =
    data.columns

  return (
    <>
      <div className="dapp-kpis dapp-kpis--portfolio">
        {data.kpis.map((k, i) => (
          <article
            key={k.label}
            className="dapp-card dapp-card--kpi"
            style={{ animationDelay: `${(i * 0.06).toFixed(2)}s` }}
          >
            <h2 className="dapp-microlabel">{k.label}</h2>
            <p className="dapp-kpi__value dapp-kpi__value--portfolio">
              <CountUp value={k.value} />
            </p>
            <p className="dapp-kpi__sub">{k.sub}</p>
          </article>
        ))}
      </div>

      <div className="dapp-table-wrap">
        <table className="dapp-table">
          <caption className="dapp-sr">
            Your positions with latches attached — sample data
          </caption>
          <thead>
            <tr>
              <th scope="col">{position}</th>
              <th scope="col">{latch}</th>
              <th scope="col">{value}</th>
              <th scope="col">{fees}</th>
              <th scope="col">{status}</th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p, i) => (
              <tr key={p.pair} style={{ animationDelay: `${(i * 0.06).toFixed(2)}s` }}>
                <th scope="row" data-label={position}>
                  <span className="dapp-pos">
                    <span className="dapp-pos__token" aria-hidden="true" />
                    <span className="dapp-pos__pair">{p.pair}</span>
                  </span>
                </th>
                <td data-label={latch} className="dapp-table__latch">
                  {p.latch}
                </td>
                <td data-label={value} className="dapp-table__num">
                  {p.value}
                </td>
                <td data-label={fees} className="dapp-table__num is-fees">
                  {p.fees}
                </td>
                <td data-label={status}>
                  <span className={BADGE_CLASS[p.status]}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
