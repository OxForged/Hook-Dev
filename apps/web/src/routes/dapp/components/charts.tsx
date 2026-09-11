/* ============================================================================
   Dapp charts — all inline SVG / DOM, no chart library.

   Colours, stroke widths, easing and stagger come from README § Interactions:
     line draw-on   stroke-dasharray 2400 -> dashoffset 0, 1.4-1.5s
     bars/columns   scaleY(.05) -> 1, transform-origin bottom, .6-.8s,
                    .03-.045s stagger
     progress bars  width transition 1s
   Every animation is a CSS animation/transition, so tokens.css's global
   prefers-reduced-motion block collapses all of it. The interaction states
   added below (dim, highlight, crosshair, tooltip fade) are CSS transitions on
   data attributes for the same reason — nothing here animates from JS.

   INTERACTION, and where it deliberately stops.

   `ColumnChart`, `BarList`, `Donut` and `DonutLegend` are the primitives fed by
   real chain reads (Analytics, the dashboard activity mix), so each datum is a
   real focusable control that states its own exact value. `Sparkline`,
   `Sparkline`, `AreaChart` and `FeeChart` were DELETED rather than left unused.
   Their only inputs were the invented series in
   `data/pool.ts`; they are left inert on purpose. Hover affordances on invented
   numbers invite the reader to inspect them, which is exactly the wrong
   invitation to extend to a placeholder.
   ============================================================================ */

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useChartTip } from '../../../charts/useChartTip'
import type { TipContent } from '../../../charts/tip'
import type { DonutSegment, LabelledBar, SeriesColor } from '../data/types.ts'
import { donutArcs } from '../lib/chart.ts'
import { SERIES_VAR } from '../lib/series.ts'

/** Percentages arrive as ints from some sources and 2dp floats from others. */
function pct(v: number): string {
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`
}

/* ---------- Analytics column chart ----------------------------------------

   One column = one real bucket. `pct` is only the drawn height; `value` is the
   count the reader actually wants, and it is what the tooltip and the
   accessible name report. A bucket with nothing in it draws no bar at all —
   not a 2px stub — but stays focusable and says "0", because a gap in the data
   is itself a reading.
   -------------------------------------------------------------------------- */

export interface ColumnPoint {
  /** Height as a percent of the tallest column. Presentation only. */
  pct: number
  /** The exact underlying count, already formatted. */
  value: string
  /** What this column covers — a block, or a block range. */
  label: string
  /** What `value` counts. Per-point, so the caller can get plurals right. */
  unit: string
}

export function ColumnChart({
  points,
  label,
}: {
  points: readonly ColumnPoint[]
  label: string
}) {
  const tip = useChartTip()
  const active = tip.activeId === null ? null : (points[Number(tip.activeId)] ?? null)
  const last = points.length - 1

  return (
    <div
      className="dapp-cols"
      role="group"
      aria-label={label}
      data-active={active ? 'true' : undefined}
    >
      {points.map((p, i) => {
        const id = String(i)
        const color = SERIES_VAR[i === last ? 'success' : 'primary']
        const content: TipContent = {
          title: p.label,
          rows: [{ label: p.unit, value: p.value, color }],
        }
        return (
          <button
            key={i}
            type="button"
            className="dapp-cols__col"
            data-on={tip.activeId === id ? 'true' : undefined}
            aria-label={`${p.label}: ${p.value} ${p.unit}`}
            {...tip.datumProps(id, content)}
          >
            <span
              className={i === last ? 'dapp-cols__bar is-last' : 'dapp-cols__bar'}
              style={{
                height: p.pct > 0 ? `max(2px, ${p.pct}%)` : '0',
                animationDelay: `${(i * 0.04).toFixed(2)}s`,
              }}
            />
          </button>
        )
      })}
      {/* Crosshair: read the active column's height straight across the plot. */}
      {active ? (
        <span className="dapp-cols__cross" style={{ bottom: `${active.pct}%` }} aria-hidden="true" />
      ) : null}
      {tip.element}
    </div>
  )
}

/* ---------- Labelled progress bars (ACTIVITY MIX, FEES BY TOKEN) ----------

   The row already prints its name and value, so the bar's LENGTH is the only
   thing the reader cannot read off the page — that share is what the tooltip
   adds. `series` turns the colour key into a set of toggles that isolate one
   series; it is optional because a bar list whose rows are each their own
   series (the activity mix) has nothing to isolate.
   -------------------------------------------------------------------------- */

export interface BarSeries {
  key: SeriesColor
  label: string
}

export function BarList({
  items,
  unit,
  valueLabel,
  shareLabel,
  series,
  className,
}: {
  items: LabelledBar[]
  /** Unit for `value`, when the name does not already carry it. */
  unit?: string
  /** What `value` measures. */
  valueLabel?: string
  /** What `pct` is a share OF. Stated, never implied. */
  shareLabel?: string
  series?: readonly BarSeries[]
  /** Host-surface hook. The landing page mounts this same primitive outside the
      dapp shell, where `--dapp-ease` is unset and the rhythm differs; one class
      lets that surface supply both without a second bar list existing. */
  className?: string
}) {
  const tip = useChartTip()
  const [isolated, setIsolated] = useState<SeriesColor | null>(null)

  return (
    <div className={className ? `dapp-barlist ${className}` : 'dapp-barlist'}>
      {series && series.length > 1 ? (
        <ul className="dapp-serieskey">
          {series.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className="dapp-serieskey__btn"
                aria-pressed={isolated === s.key}
                onClick={() => setIsolated((prev) => (prev === s.key ? null : s.key))}
              >
                <span
                  className="dapp-legend__swatch"
                  style={{ background: SERIES_VAR[s.key] }}
                  aria-hidden="true"
                />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="dapp-bars">
        {items.map((b, i) => {
          const id = String(i)
          const rows = [
            {
              label: valueLabel ?? 'Value',
              value: unit ? `${b.value} ${unit}` : b.value,
              color: SERIES_VAR[b.color],
            },
            ...(shareLabel ? [{ label: shareLabel, value: pct(b.pct) }] : []),
          ]
          const name = `${b.name}: ${unit ? `${b.value} ${unit}` : b.value}${
            shareLabel ? `, ${pct(b.pct)} ${shareLabel}` : ''
          }`
          return (
            <button
              key={b.name}
              type="button"
              className="dapp-bars__row"
              data-on={tip.activeId === id ? 'true' : undefined}
              data-dim={isolated && b.color !== isolated ? 'true' : undefined}
              aria-label={name}
              {...tip.datumProps(id, { title: b.name, rows })}
            >
              <span className="dapp-bars__head" aria-hidden="true">
                <span>{b.name}</span>
                <span className="dapp-bars__value">{b.value}</span>
              </span>
              <span className="dapp-bars__track" aria-hidden="true">
                <span
                  className="dapp-bars__fill"
                  style={{ width: `${b.pct}%`, '--series': SERIES_VAR[b.color] } as CSSProperties}
                />
              </span>
            </button>
          )
        })}
      </div>
      {tip.element}
    </div>
  )
}

/* ---------- Donut + its legend, linked ------------------------------------

   Selection lives in the caller so the two halves stay in step: clicking a
   legend row dims every other arc, and clicking an arc presses the matching
   legend row. Both carry `aria-pressed`, so the state is not a colour change
   only a sighted reader can perceive.
   -------------------------------------------------------------------------- */

const DONUT_R = 46

function arcTip(s: DonutSegment, unit: string): TipContent {
  return { title: s.name, rows: [{ label: unit, value: pct(s.pct), color: SERIES_VAR[s.color] }] }
}

export function Donut({
  segments,
  label,
  unit,
  selected,
  onSelect,
}: {
  segments: DonutSegment[]
  label: string
  /** What the percentage is a share of. */
  unit: string
  selected?: string | null
  onSelect?: (name: string | null) => void
}) {
  const tip = useChartTip()
  const arcs = donutArcs(
    segments.map((s) => s.pct),
    DONUT_R,
  )

  return (
    <svg className="dapp-donut" viewBox="0 0 120 120" role="group" aria-label={label}>
      <circle cx="60" cy="60" r={DONUT_R} fill="none" className="dapp-donut__track" strokeWidth="14" />
      {segments.map((s, i) => {
        const props = tip.datumProps(s.name, arcTip(s, unit))
        const select = () => onSelect?.(selected === s.name ? null : s.name)
        return (
          <circle
            key={s.name}
            className="dapp-donut__arc"
            cx="60"
            cy="60"
            r={DONUT_R}
            fill="none"
            stroke={SERIES_VAR[s.color]}
            strokeWidth="14"
            strokeDasharray={arcs[i]?.dash}
            strokeDashoffset={arcs[i]?.offset}
            transform="rotate(-90 60 60)"
            tabIndex={0}
            role="button"
            aria-label={`${s.name}: ${pct(s.pct)} ${unit}`}
            aria-pressed={onSelect ? selected === s.name : undefined}
            data-on={tip.activeId === s.name || selected === s.name ? 'true' : undefined}
            data-dim={selected && selected !== s.name ? 'true' : undefined}
            {...props}
            onClick={(e) => {
              props.onClick(e)
              select()
            }}
            onKeyDown={(e) => {
              // SVG shapes get no synthetic click from Enter/Space.
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              select()
            }}
          />
        )
      })}
      {tip.element}
    </svg>
  )
}

export function DonutLegend({
  segments,
  unit,
  selected,
  onSelect,
}: {
  segments: DonutSegment[]
  unit: string
  selected?: string | null
  onSelect?: (name: string | null) => void
}) {
  if (!onSelect) {
    return (
      <ul className="dapp-legend">
        {segments.map((s) => (
          <li key={s.name} className="dapp-legend__row">
            <span className="dapp-legend__swatch" style={{ background: SERIES_VAR[s.color] }} />
            <span>{s.name}</span>
            <span className="dapp-legend__pct">{pct(s.pct)}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="dapp-legend">
      {segments.map((s) => (
        <li key={s.name}>
          <button
            type="button"
            className="dapp-legend__row dapp-legend__row--btn"
            aria-pressed={selected === s.name}
            aria-label={`${s.name}: ${pct(s.pct)} ${unit}`}
            data-dim={selected && selected !== s.name ? 'true' : undefined}
            onClick={() => onSelect(selected === s.name ? null : s.name)}
          >
            <span
              className="dapp-legend__swatch"
              style={{ background: SERIES_VAR[s.color] }}
              aria-hidden="true"
            />
            <span aria-hidden="true">{s.name}</span>
            <span className="dapp-legend__pct" aria-hidden="true">
              {pct(s.pct)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
