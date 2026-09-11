/* ============================================================================
   Four more chart primitives, same rules as `charts.tsx`.

   WHY A SECOND FILE. `charts.tsx` holds the three shapes that answer "how do
   these parts compare" — columns, bars, a donut. These four answer different
   questions and share no code with those, so folding them in would have made
   one 700-line module where the reader scrolls past a donut to reach a gauge.
   Same vocabulary, same tooltip hook, same tokens; separate file.

   THE RULE THAT GOVERNS ALL OF THEM. Every one takes data the caller READ —
   from chain, from the repo, or from the reader's own form input. None of them
   synthesises a point, interpolates a gap, or extends a series to make it look
   fuller. `SeriesChart` in particular refuses to draw fewer than two points:
   one reading is not a trend, and a line through a single point is a claim
   about a shape nobody measured. It renders the empty state instead, and that
   state says how many points there actually are.

   ANIMATION IS CSS, NEVER JS. A line draws itself with stroke-dasharray, an
   area fades up, a gauge sweeps its own dashoffset, grid cells stagger. That
   is not a stylistic preference: tokens.css carries one global
   prefers-reduced-motion block, and it can only reach animations the
   stylesheet owns. A JS-driven tween would keep moving for a reader who asked
   the whole system to stop.
   ============================================================================ */

import { useId, useMemo, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'

import { useChartTip } from '../../../charts/useChartTip'
import type { TipContent, TipRow } from '../../../charts/tip'
import type { SeriesColor } from '../data/types.ts'
import { SERIES_VAR } from '../lib/series.ts'

/* ---------- geometry ------------------------------------------------------ */

const VB_W = 600
const VB_H = 180
const PAD_X = 6
const PAD_Y = 10

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/* ============================================================================
   1 · SeriesChart — a real measured series over an ordered axis.

   Used for anything indexed by block: cumulative fees taken, events per
   bucket, epoch totals. NOT used for anything indexed by wall-clock time
   derived from block height — block times are not constant, and dividing by an
   assumed 12s turns a measurement into an estimate wearing a measurement's
   clothes.

   Each point is a focusable <circle> carrying its own exact value, so the
   series is readable by keyboard and by screen reader, not only by eye. The
   crosshair follows the active point because vertical position is the whole
   reading — a tooltip alone makes the reader estimate where on the line they
   are.
   ============================================================================ */

export interface SeriesPoint {
  /** Position along the axis. Must be ordered ascending by the caller. */
  readonly x: number
  /** The measured value. */
  readonly y: number
  /** What this point is — "Block 60,111,836". */
  readonly label: string
  /** `y`, already formatted with its unit. The tooltip prints this, not `y`. */
  readonly value: string
}

export interface SeriesChartProps {
  readonly points: readonly SeriesPoint[]
  /** Accessible name for the whole plot. */
  readonly label: string
  /** What `value` measures — the tooltip's row label. */
  readonly valueLabel: string
  readonly color?: SeriesColor
  /** Fill under the line. Off for anything that is not a running total. */
  readonly area?: boolean
  /** Shown instead of a plot when there are fewer than two points. */
  readonly empty?: ReactNode
}

interface Projected {
  readonly px: number
  readonly py: number
  readonly p: SeriesPoint
}

function project(points: readonly SeriesPoint[]): Projected[] {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(0, ...ys) // a series of positives sits on a zero floor
  const y1 = Math.max(...ys)

  const xSpan = x1 - x0 || 1
  const ySpan = y1 - y0 || 1
  const w = VB_W - PAD_X * 2
  const h = VB_H - PAD_Y * 2

  return points.map((p) => ({
    px: PAD_X + ((p.x - x0) / xSpan) * w,
    py: PAD_Y + (1 - clamp01((p.y - y0) / ySpan)) * h,
    p,
  }))
}

export function SeriesChart({
  points,
  label,
  valueLabel,
  color = 'primary',
  area = false,
  empty,
}: SeriesChartProps) {
  const tip = useChartTip()
  const gradId = useId().replace(/:/g, '')

  const proj = useMemo(() => (points.length >= 2 ? project(points) : []), [points])

  /* One reading is not a series. Say so rather than drawing a flat line and
     letting the reader infer a stability nobody measured. */
  if (proj.length < 2) {
    return (
      <p className="live-note" role="status">
        {empty ??
          (points.length === 0
            ? 'No readings yet, so there is no series to draw.'
            : 'One reading so far. A line needs at least two — nothing is drawn rather than implying a trend from a single point.')}
      </p>
    )
  }

  const first = proj[0]!
  const last = proj[proj.length - 1]!
  const stroke = SERIES_VAR[color]
  const line = proj
    .map((q, i) => `${i === 0 ? 'M' : 'L'}${q.px.toFixed(2)} ${q.py.toFixed(2)}`)
    .join(' ')
  const fill = `${line} L${last.px.toFixed(2)} ${VB_H - PAD_Y} L${first.px.toFixed(2)} ${VB_H - PAD_Y} Z`
  const active = tip.activeId === null ? null : (proj[Number(tip.activeId)] ?? null)

  return (
    <svg
      className="dapp-series"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="group"
      aria-label={label}
      data-active={active ? 'true' : undefined}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid first, so the series sits on top of it. */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          className="dapp-series__grid"
          x1={PAD_X}
          x2={VB_W - PAD_X}
          y1={PAD_Y + f * (VB_H - PAD_Y * 2)}
          y2={PAD_Y + f * (VB_H - PAD_Y * 2)}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {area && <path className="dapp-series__area" d={fill} fill={`url(#${gradId})`} />}
      <path
        className="dapp-series__line"
        d={line}
        fill="none"
        stroke={stroke}
        vectorEffect="non-scaling-stroke"
      />

      {active && (
        <line
          className="dapp-series__cross"
          x1={active.px}
          x2={active.px}
          y1={PAD_Y}
          y2={VB_H - PAD_Y}
          vectorEffect="non-scaling-stroke"
          aria-hidden="true"
        />
      )}

      {proj.map((q, i) => {
        const id = String(i)
        const content: TipContent = {
          title: q.p.label,
          rows: [{ label: valueLabel, value: q.p.value, color: stroke }],
        }
        return (
          <circle
            key={i}
            className="dapp-series__dot"
            cx={q.px}
            cy={q.py}
            r={4}
            fill={stroke}
            tabIndex={0}
            role="button"
            aria-label={`${q.p.label}: ${q.p.value} ${valueLabel}`}
            data-on={tip.activeId === id ? 'true' : undefined}
            {...tip.datumProps(id, content)}
          />
        )
      })}
      {tip.element}
    </svg>
  )
}

/* ============================================================================
   2 · StackedBar — one quantity, split.

   For splits that MUST sum to a whole: `RevShareHook`'s three-way
   lpDonateBps / beneficiaryBps / distributorBps, which the contract requires
   to equal exactly 10000. Rendering it as a single bar rather than three makes
   that constraint visible — the reader can see there is no slack.

   `total` is stated, never inferred from the segments, so a caller whose parts
   do NOT sum to the whole gets a visibly short bar instead of a silently
   renormalised one that hides the discrepancy.

   THE CLASS IS `dapp-splitbar`, NOT `dapp-stack`. `.dapp-stack` was already
   taken by the app's generic vertical-flex layout helper (dapp.css:426), so
   naming the root after the component would have applied `flex-direction:
   column` to any StackedBar nested inside a stacked column — a silent break
   that only appears at the first such nesting, long after the commit that
   caused it. Component classes here are namespaced by what they DRAW, not by
   the exported symbol.
   ============================================================================ */

export interface StackSegment {
  readonly name: string
  /** Share of `total`, in the same units as `total`. */
  readonly amount: number
  /** `amount` formatted with its unit, for the tooltip. */
  readonly value: string
  readonly color: SeriesColor
}

export function StackedBar({
  segments,
  total,
  label,
  unit,
}: {
  readonly segments: readonly StackSegment[]
  /** The whole the segments divide. */
  readonly total: number
  readonly label: string
  /** What the share is a share OF. Stated, never implied. */
  readonly unit: string
}) {
  const tip = useChartTip()
  const [isolated, setIsolated] = useState<string | null>(null)
  const denom = total || 1
  const filled = segments.reduce((a, s) => a + s.amount, 0)
  const short = denom - filled

  return (
    <div className="dapp-splitbar">
      <div className="dapp-splitbar__track" role="group" aria-label={label}>
        {segments.map((s) => {
          const share = (s.amount / denom) * 100
          const rows: TipRow[] = [
            { label: 'Amount', value: s.value, color: SERIES_VAR[s.color] },
            { label: unit, value: `${share.toFixed(2)}%` },
          ]
          const props = tip.datumProps(s.name, { title: s.name, rows })
          return (
            <button
              key={s.name}
              type="button"
              className="dapp-splitbar__seg"
              style={{ width: `${share}%`, '--series': SERIES_VAR[s.color] } as CSSProperties}
              aria-label={`${s.name}: ${s.value}, ${share.toFixed(2)}% ${unit}`}
              aria-pressed={isolated === s.name}
              data-on={tip.activeId === s.name ? 'true' : undefined}
              data-dim={isolated !== null && isolated !== s.name ? 'true' : undefined}
              {...props}
              onClick={(e: MouseEvent<Element>) => {
                props.onClick(e)
                setIsolated((prev) => (prev === s.name ? null : s.name))
              }}
            />
          )
        })}
        {/* Unallocated remainder. Drawn, not hidden: a split that does not add
            up is the single most important thing this chart can report. */}
        {short > 0.0001 && (
          <span
            className="dapp-splitbar__short"
            style={{ width: `${(short / denom) * 100}%` }}
            title={`Unallocated: ${((short / denom) * 100).toFixed(2)}% ${unit}`}
          />
        )}
      </div>

      <ul className="dapp-legend dapp-legend--row">
        {segments.map((s) => (
          <li key={s.name} className="dapp-legend__row">
            <span
              className="dapp-legend__swatch"
              style={{ background: SERIES_VAR[s.color] }}
              aria-hidden="true"
            />
            <span>{s.name}</span>
            <span className="dapp-legend__pct">{((s.amount / denom) * 100).toFixed(2)}%</span>
          </li>
        ))}
      </ul>
      {tip.element}
    </div>
  )
}

/* ============================================================================
   3 · Gauge — one fraction of one known ceiling.

   The ceiling is the point. `MAX_PROTOCOL_FEE` is 4000 pips and
   `RevShareHook.MAX_FEE_PIPS` is 100_000; both are constants in deployed code,
   so "0.30% of a 10% cap" is two measured numbers rather than a number and a
   marketing frame. A bare percentage cannot say how much room is left.

   `over` exists because a reading above its ceiling is a real condition worth
   drawing in the error colour, rather than clamping into a full ring that
   merely looks maxed out.
   ============================================================================ */

export function Gauge({
  value,
  max,
  label,
  caption,
  valueText,
  maxText,
  color = 'primary',
}: {
  readonly value: number
  readonly max: number
  readonly label: string
  /** What the ceiling IS — "of the 0.4% protocol cap". */
  readonly caption: ReactNode
  /** `value` formatted with its unit. Shown in the middle. */
  readonly valueText: string
  readonly maxText: string
  readonly color?: SeriesColor
}) {
  const frac = max > 0 ? value / max : 0
  const over = frac > 1
  const shown = clamp01(frac)

  /* A 270-degree arc, so the gap at the bottom reads as "this is a gauge" and
     not "this is a donut with one segment". */
  const R = 52
  const SWEEP = 0.75
  const circ = 2 * Math.PI * R
  const track = circ * SWEEP
  const stroke = over ? 'var(--error)' : SERIES_VAR[color]

  return (
    <figure className="dapp-gauge">
      <svg viewBox="0 0 120 120" role="img" aria-label={`${label}: ${valueText} of ${maxText}`}>
        <circle
          className="dapp-gauge__track"
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${track} ${circ}`}
          transform="rotate(135 60 60)"
        />
        <circle
          className="dapp-gauge__fill"
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={stroke}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${track * shown} ${circ}`}
          transform="rotate(135 60 60)"
        />
        <text className="dapp-gauge__v" x="60" y="58" textAnchor="middle">
          {valueText}
        </text>
        <text className="dapp-gauge__m" x="60" y="76" textAnchor="middle">
          of {maxText}
        </text>
      </svg>
      <figcaption className="dapp-gauge__cap">
        {caption}
        {over && <strong className="dapp-gauge__over"> — above the cap</strong>}
      </figcaption>
    </figure>
  )
}

/* ============================================================================
   4 · BitGrid — a hook's permission bitmap, one cell per bit.

   `getHooksRegistrationBitmap()` returns a uint16 and core cross-checks it
   against `poolKey.parameters` at initialize. Printed as "2177" it is
   unreadable; printed as named cells it answers the only question a reader
   actually has about a stranger's hook — WHICH points in the swap lifecycle
   this contract gets to run at.

   Set bits are the reading. Unset bits are drawn too, and dimmed, because
   "this hook does NOT run before swap" is as much a fact as the inverse, and a
   grid showing only what is on would let the reader miss the shape.
   ============================================================================ */

export interface BitDef {
  /** Bit position, 0-15. */
  readonly bit: number
  readonly name: string
  /** What running at this point lets the hook do. */
  readonly note: string
}

export function BitGrid({
  bitmap,
  bits,
  label,
}: {
  readonly bitmap: number
  readonly bits: readonly BitDef[]
  readonly label: string
}) {
  const tip = useChartTip()

  return (
    <div className="dapp-bitgrid" role="group" aria-label={label}>
      {bits.map((b, i) => {
        const on = (bitmap & (1 << b.bit)) !== 0
        const id = String(b.bit)
        const content: TipContent = {
          title: b.name,
          rows: [
            { label: `Bit ${b.bit}`, value: on ? 'set' : 'not set' },
            { label: 'Effect', value: b.note },
          ],
        }
        return (
          <button
            key={b.bit}
            type="button"
            className="dapp-bitgrid__cell"
            data-set={on ? 'true' : undefined}
            data-on={tip.activeId === id ? 'true' : undefined}
            style={{ animationDelay: `${(i * 0.03).toFixed(2)}s` }}
            aria-label={`${b.name}: bit ${b.bit} ${on ? 'set' : 'not set'}`}
            {...tip.datumProps(id, content)}
          >
            <span className="dapp-bitgrid__dot" aria-hidden="true" />
            <span className="dapp-bitgrid__name" aria-hidden="true">
              {b.name}
            </span>
          </button>
        )
      })}
      {tip.element}
    </div>
  )
}
