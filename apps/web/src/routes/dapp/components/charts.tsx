/* ============================================================================
   Dapp charts — all inline SVG / DOM, no chart library.

   Colours, stroke widths, easing and stagger come from README § Interactions:
     line draw-on   stroke-dasharray 2400 -> dashoffset 0, 1.4-1.5s
     bars/columns   scaleY(.05) -> 1, transform-origin bottom, .6-.8s,
                    .03-.045s stagger
     progress bars  width transition 1s
   Every animation is a CSS animation/transition, so tokens.css's global
   prefers-reduced-motion block collapses all of it.
   ============================================================================ */

import { useId } from 'react'
import type { CSSProperties } from 'react'
import type { DonutSegment, LabelledBar } from '../data/types.ts'
import { donutArcs, gridLines, linePath } from '../lib/chart.ts'
import { SERIES_VAR } from '../lib/series.ts'

/* ---------- KPI sparkline: 12 bars rising on a .03s stagger --------------- */

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  return (
    <div className="dapp-spark" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span
          key={i}
          className={i === values.length - 1 ? 'dapp-spark__bar is-last' : 'dapp-spark__bar'}
          style={{ height: `${v}%`, animationDelay: `${(i * 0.03).toFixed(2)}s` }}
        />
      ))}
    </div>
  )
}

/* ---------- Volume area chart --------------------------------------------- */

const AREA_W = 720
const AREA_H = 210
const AREA_PAD = 12

export function AreaChart({
  pts,
  labels,
  title,
}: {
  pts: number[]
  labels: string[]
  title: string
}) {
  const gradientId = useId()
  const { line, area } = linePath(pts, AREA_W, AREA_H, AREA_PAD)
  return (
    <>
      <svg
        className="dapp-area"
        viewBox={`0 0 ${AREA_W} ${AREA_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--latch-blue)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--latch-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines(AREA_H).map((y) => (
          <line key={y} x1="0" x2={AREA_W} y1={y} y2={y} className="dapp-grid" />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        {/* keyed by the path so a range change replays the draw-on */}
        <path key={line} d={line} className="dapp-line dapp-line--draw" />
      </svg>
      <div className="dapp-axis">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </>
  )
}

/* ---------- Pool detail: fee line + dashed volatility line ---------------- */

const FEE_W = 720
const FEE_H = 200

export function FeeChart({
  fee,
  volatility,
  title,
}: {
  fee: number[]
  volatility: number[]
  title: string
}) {
  const feePath = linePath(fee, FEE_W, FEE_H, AREA_PAD)
  const volPath = linePath(volatility, FEE_W, AREA_H, AREA_PAD)
  return (
    <svg
      className="dapp-area dapp-area--fee"
      viewBox={`0 0 ${FEE_W} ${FEE_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={title}
    >
      {gridLines(AREA_H).map((y) => (
        <line key={y} x1="0" x2={FEE_W} y1={y} y2={y} className="dapp-grid" />
      ))}
      <path d={feePath.line} className="dapp-line dapp-line--fee dapp-line--draw" />
      <path d={volPath.line} className="dapp-line dapp-line--vol" />
    </svg>
  )
}

/* ---------- Analytics column chart ---------------------------------------- */

export function ColumnChart({ values, label }: { values: number[]; label: string }) {
  return (
    <div className="dapp-cols" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span
          key={i}
          className={i === values.length - 1 ? 'dapp-cols__bar is-last' : 'dapp-cols__bar'}
          style={{ height: `${v}%`, animationDelay: `${(i * 0.04).toFixed(2)}s` }}
        />
      ))}
    </div>
  )
}

/* ---------- Labelled progress bars (CALL MIX, TOP LATCHES BY FEES) -------- */

export function BarList({ items }: { items: LabelledBar[] }) {
  return (
    <div className="dapp-bars">
      {items.map((b) => (
        <div key={b.name} className="dapp-bars__row">
          <div className="dapp-bars__head">
            <span>{b.name}</span>
            <span className="dapp-bars__value">{b.value}</span>
          </div>
          <div className="dapp-bars__track">
            <span
              className="dapp-bars__fill"
              style={{ width: `${b.pct}%`, '--series': SERIES_VAR[b.color] } as CSSProperties}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- TVL by network donut ------------------------------------------ */

const DONUT_R = 46

export function Donut({ segments, label }: { segments: DonutSegment[]; label: string }) {
  const arcs = donutArcs(
    segments.map((s) => s.pct),
    DONUT_R,
  )
  return (
    <svg className="dapp-donut" viewBox="0 0 120 120" role="img" aria-label={label}>
      <circle cx="60" cy="60" r={DONUT_R} fill="none" className="dapp-donut__track" strokeWidth="14" />
      {segments.map((s, i) => (
        <circle
          key={s.name}
          cx="60"
          cy="60"
          r={DONUT_R}
          fill="none"
          stroke={SERIES_VAR[s.color]}
          strokeWidth="14"
          strokeDasharray={arcs[i]?.dash}
          strokeDashoffset={arcs[i]?.offset}
          transform="rotate(-90 60 60)"
        />
      ))}
    </svg>
  )
}

export function DonutLegend({ segments }: { segments: DonutSegment[] }) {
  return (
    <ul className="dapp-legend">
      {segments.map((s) => (
        <li key={s.name} className="dapp-legend__row">
          <span className="dapp-legend__swatch" style={{ background: SERIES_VAR[s.color] }} />
          <span>{s.name}</span>
          <span className="dapp-legend__pct">{s.pct}%</span>
        </li>
      ))}
    </ul>
  )
}
