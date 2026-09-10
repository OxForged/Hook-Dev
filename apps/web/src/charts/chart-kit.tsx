import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LegendItem, TipState } from './chart-utils'

/* ------------------------------------------------------------------ */
/* Tooltip — value leads, series name follows, short line keys         */
/* ------------------------------------------------------------------ */

export function Tooltip({ tip, containerWidth }: { tip: TipState; containerWidth: number }) {
  if (!tip) return null
  // Keep the card inside the figure at every width.
  const w = Math.min(240, Math.max(150, containerWidth - 16))
  const left = Math.min(Math.max(tip.x - w / 2, 0), Math.max(containerWidth - w, 0))
  return (
    <div className="viz-tip" style={{ left, top: tip.y, width: w }} role="presentation">
      <div className="viz-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="viz-tip-row" key={r.series}>
          <span className="viz-tip-key" style={{ background: r.color }} aria-hidden="true" />
          <span className="viz-tip-val">{r.value}</span>
          <span className="viz-tip-series">{r.series}</span>
        </div>
      ))}
    </div>
  )
}

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
