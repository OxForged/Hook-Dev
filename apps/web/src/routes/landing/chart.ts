/**
 * Chart geometry for the landing page. Pure maths — no colour, no DOM.
 * Mirrors the reference's projection so the curve is identical.
 */

export const CHART_W = 720
export const CHART_H = 240
const CHART_PAD = 14

/** Gridline positions, as a fraction of the chart height. */
const GRID_FRACTIONS = [0.08, 0.34, 0.6, 0.86] as const

export interface Point {
  readonly x: number
  readonly y: number
}

export interface AreaChart {
  /** `M…L…` path for the stroked line. */
  readonly line: string
  /** The same path closed down to the baseline, for the gradient fill. */
  readonly area: string
  readonly dots: readonly Point[]
  readonly gridY: readonly number[]
}

export function buildAreaChart(pts: readonly number[]): AreaChart {
  const max = Math.max(...pts) * 1.08
  const min = Math.min(...pts) * 0.7
  const span = max - min || 1
  const last = pts.length - 1

  const dots: Point[] = pts.map((v, i) => ({
    x: last <= 0 ? 0 : (i / last) * CHART_W,
    y: CHART_PAD + (1 - (v - min) / span) * (CHART_H - CHART_PAD * 2),
  }))

  const line = dots
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  return {
    line,
    area: `${line} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z`,
    dots,
    gridY: GRID_FRACTIONS.map((f) => Math.round(f * CHART_H)),
  }
}

/** Donut geometry: radius 46, stroke 14, in a 120×120 box (README § Screens 1.4). */
export const DONUT = { size: 120, cx: 60, cy: 60, r: 46 } as const

export interface DonutSegment {
  readonly dash: string
  readonly offset: number
}

/** Lays consecutive segments end to end around the ring, starting at 12 o'clock. */
export function buildDonut(percentages: readonly number[]): DonutSegment[] {
  const circumference = 2 * Math.PI * DONUT.r
  let travelled = 0
  return percentages.map((pct) => {
    const dash = (pct / 100) * circumference
    const segment: DonutSegment = {
      dash: `${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`,
      offset: Number((-travelled).toFixed(2)),
    }
    travelled += dash
    return segment
  })
}

/** Column height as a percentage of the tallest column in the set. */
export function columnHeights(values: readonly number[]): number[] {
  const peak = Math.max(...values)
  return values.map((v) => Math.round((v / peak) * 100))
}
