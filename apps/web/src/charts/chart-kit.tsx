/* The tooltip that used to live here was `role="presentation"`, hand-clamped to
   the figure's own width, and driven by pointer events only — so it was clipped
   at the viewport edge, silent to a screen reader, and absent on touch. It is
   replaced by the shared `useChartTip` / `ChartTip` pair, which is
   viewport-collision-aware, carries `role="tooltip"` with `aria-describedby`,
   and answers pointer, keyboard and tap alike. */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LegendItem } from './chart-utils'

/* ------------------------------------------------------------------ */
/* Figure shell — title, legend, chart/table toggle, caption           */
/* ------------------------------------------------------------------ */

export function Figure({
  title,
  subtitle,
  legend,
  caption,
  chart,
  table,
}: {
  title: string
  subtitle: string
  legend: readonly LegendItem[]
  caption: ReactNode
  chart: ReactNode
  table: ReactNode
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  return (
    <figure className="viz card">
      <div className="viz-head">
        <div className="viz-heading">
          <h3 className="viz-title">{title}</h3>
          <p className="viz-sub">{subtitle}</p>
        </div>
        <div className="viz-toggle" role="group" aria-label={`${title}: view as`}>
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
            Chart
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </div>

      {legend.length > 1 && (
        <ul className="viz-legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span className="viz-swatch" style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      )}

      <div className="viz-body">{view === 'chart' ? chart : table}</div>

      <figcaption className="viz-cap">{caption}</figcaption>
    </figure>
  )
}
