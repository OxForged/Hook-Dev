/* ============================================================================
   A two-bar gas comparison, on one shared axis.

   Built for the landing page's "GAS, MEASURED ON A SEPOLIA FORK" panel, where
   the reader's actual question is not "what does a swap cost" but "what does
   the extra hop cost". Two numbers in a key/value list make that a subtraction
   the reader has to do; two bars on one axis make it the first thing they see.

   Why this is not `GasChart` with different data: `GasChart` compares the SAME
   test across two build profiles, so every row is a PAIR of bars and the axis
   max is a fixed constant for the whole suite. Here each row is one measured
   call and the axis is derived from the data. What is shared is the geometry —
   `hBarPath`, `ticksFor`, `useMeasuredWidth` — and the `.viz-*` styling and
   `useChartTip` tooltip, so the two charts read as one system.

   Why no `Figure` shell: on the landing surface this chart sits INSIDE a panel
   that already supplies the heading and the caption. Wrapping it in `Figure`
   would nest a second, differently-titled figure inside the first. The exact
   numbers still ride each bar's tip, so nothing the Chart/Table toggle exists
   to protect is lost.

   Every bar is a real measurement passed in by the caller. This component
   interpolates nothing and invents no baseline: with a single bar it draws a
   single bar.
   ============================================================================ */

import './viz.css'
import { fmt } from './data'
import { hBarPath, pctMore, ticksFor, useMeasuredWidth } from './chart-utils'
import { useChartTip } from './useChartTip'
import type { DatumTipProps } from './useChartTip'
import type { TipRow } from './tip'

/** The two-series palette, shared with `GasChart` (see viz.css). */
const SERIES = ['var(--s1)', 'var(--s2)'] as const

const BAR_H = 15
/** Room at the right for the value label that rides each bar's tip. */
const RIGHT_PAD = 66
/** Axis is rounded up to a whole step so the tick labels stay round numbers. */
const AXIS_STEP = 50_000

export interface GasBar {
  /** What was executed. */
  readonly name: string
  /** Gas observed, as a number so it can be scaled and compared. */
  readonly gas: number
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : '−'}${fmt.format(Math.abs(Math.round(n)))}`
}

function signedPct(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`
}

function GasBarBand({
  bar,
  baseline,
  color,
  width,
  plotW,
  axisMax,
  ticks,
  tipProps,
  on,
}: {
  bar: GasBar
  /** The bar this one is read against, or null for the baseline itself. */
  baseline: GasBar | null
  color: string
  width: number
  plotW: number
  axisMax: number
  ticks: readonly number[]
  tipProps: DatumTipProps
  on: boolean
}) {
  const x = (v: number) => (v / axisMax) * plotW
  const delta = baseline ? pctMore(baseline.gas, bar.gas) : null
  const label =
    delta === null
      ? `${bar.name}: ${fmt.format(bar.gas)} gas.`
      : `${bar.name}: ${fmt.format(bar.gas)} gas, ${signedPct(delta)} versus ${baseline?.name}.`

  return (
    <button
      type="button"
      className="viz-band viz-band--btn"
      data-on={on ? 'true' : undefined}
      aria-label={label}
      {...tipProps}
    >
      <span className="viz-band-head" aria-hidden="true">
        <span className="viz-band-name">{bar.name}</span>
        {delta === null ? (
          <span className="viz-band-delta">baseline</span>
        ) : (
          <span className="viz-band-delta">{signedPct(delta)}</span>
        )}
      </span>
      <svg width={width} height={BAR_H} role="presentation" focusable="false">
        {ticks.map((t) => (
          <line
            key={t}
            x1={x(t)}
            x2={x(t)}
            y1={0}
            y2={BAR_H}
            stroke="var(--viz-grid)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}
        <path d={hBarPath(0, 0, Math.max(x(bar.gas), 2), BAR_H)} fill={color} />
        <text x={x(bar.gas) + 7} y={BAR_H / 2} className="viz-val" dominantBaseline="middle">
          {fmt.format(bar.gas)}
        </text>
      </svg>
    </button>
  )
}

export function GasCompareChart({
  bars,
  axisTitle = 'Gas used',
  unit = 'gas',
}: {
  bars: readonly GasBar[]
  axisTitle?: string
  /** Unit for the tooltip's value row. */
  unit?: string
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const tip = useChartTip()

  const peak = Math.max(1, ...bars.map((b) => b.gas))
  const axisMax = Math.max(AXIS_STEP, Math.ceil(peak / AXIS_STEP) * AXIS_STEP)
  const plotW = Math.max(80, width - RIGHT_PAD)
  const ticks = ticksFor(axisMax, AXIS_STEP, plotW)
  const x = (v: number) => (v / axisMax) * plotW
  /* The first bar is the thing every later bar is read against. With one bar
     there is no comparison to make, and none is drawn. */
  const baseline = bars.length > 1 ? (bars[0] ?? null) : null

  return (
    <div className="viz-plot viz-plot--compact" ref={ref}>
      {width > 0 && (
        <>
          {bars.map((bar, i) => {
            const isBase = baseline === null || i === 0
            const color = SERIES[i % SERIES.length] ?? SERIES[0]
            const rows: TipRow[] = [
              { label: axisTitle, value: `${fmt.format(bar.gas)} ${unit}`, color },
            ]
            if (!isBase && baseline) {
              rows.push({
                label: `vs ${baseline.name.toLowerCase()}`,
                value: `${signed(bar.gas - baseline.gas)} ${unit} (${signedPct(
                  pctMore(baseline.gas, bar.gas),
                )})`,
                color: 'var(--label-ink)',
              })
            }
            return (
              <GasBarBand
                key={bar.name}
                bar={bar}
                baseline={isBase ? null : baseline}
                color={color}
                width={width}
                plotW={plotW}
                axisMax={axisMax}
                ticks={ticks}
                on={tip.activeId === bar.name}
                tipProps={tip.datumProps(bar.name, { title: bar.name, rows })}
              />
            )
          })}
          <svg width={width} height={20} className="viz-axis" role="presentation" focusable="false">
            <line
              x1={0}
              x2={plotW}
              y1={0.5}
              y2={0.5}
              stroke="var(--viz-axis)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            {ticks.map((t, i) => (
              <text
                key={t}
                x={x(t)}
                y={14}
                className="viz-tick"
                textAnchor={i === 0 ? 'start' : 'middle'}
              >
                {fmt.format(t)}
              </text>
            ))}
          </svg>
          <p className="viz-axis-title">{axisTitle}</p>
          {tip.element}
        </>
      )}
    </div>
  )
}
