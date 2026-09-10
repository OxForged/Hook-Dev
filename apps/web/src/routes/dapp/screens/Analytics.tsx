/* Analytics — SCREENS.md § C6. */

import { useMemo } from 'react'
import { RangeSwitcher } from '../components/RangeSwitcher.tsx'
import { BarList, ColumnChart, Donut, DonutLegend } from '../components/charts.tsx'
import { loadAnalytics } from '../data/analytics.ts'
import { useDapp } from '../state.tsx'

export default function Analytics() {
  const data = useMemo(loadAnalytics, [])
  const { range, setRange } = useDapp()

  return (
    <div className="dapp-row dapp-row--analytics">
      <section className="dapp-card dapp-card--chart">
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">{data.weeklyLabel}</h2>
          <RangeSwitcher value={range} onChange={setRange} label="Hook calls range" />
        </div>
        <ColumnChart
          values={data.weeklyCalls}
          label={`${data.weeklyLabel}, ${data.weeklyCalls.length} weeks, ${range}`}
        />
      </section>

      <div className="dapp-stack">
        <section className="dapp-card dapp-card--donut">
          <Donut segments={data.networks} label={data.networksLabel} />
          <div className="dapp-card__donut-body">
            <h2 className="dapp-microlabel">{data.networksLabel}</h2>
            <DonutLegend segments={data.networks} />
          </div>
        </section>

        <section className="dapp-card">
          <h2 className="dapp-microlabel">{data.topLatchesLabel}</h2>
          <BarList items={data.topLatches} />
        </section>
      </div>
    </div>
  )
}
