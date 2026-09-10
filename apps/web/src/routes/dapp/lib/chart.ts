/* ============================================================================
   Chart geometry.

   `linePath` is the reference's own scaling: the series is padded to 108% of
   its max and 72% of its min so the curve never touches the frame, then mapped
   across the full viewBox width with `pad` px of vertical breathing room.
   Keeping it identical keeps the drawn curves pixel-identical.
   ============================================================================ */

export interface ChartPath {
  line: string
  area: string
}

export function linePath(pts: number[], w: number, h: number, pad: number): ChartPath {
  if (pts.length === 0) return { line: '', area: '' }
  const max = Math.max(...pts) * 1.08
  const min = Math.min(...pts) * 0.72
  const span = max - min || 1
  const xs = (i: number) => (pts.length === 1 ? 0 : (i / (pts.length - 1)) * w)
  const ys = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2)
  const line = pts
    .map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`)
    .join(' ')
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` }
}

/** Four gridlines at 10 / 36 / 62 / 88% of the plot height (reference). */
export const GRID_FRACTIONS = [0.1, 0.36, 0.62, 0.88] as const

export function gridLines(height: number): number[] {
  return GRID_FRACTIONS.map((f) => Math.round(f * height))
}

/** Donut segment geometry for a circle of radius `r`, stroke laid clockwise. */
export interface DonutArc {
  dash: string
  offset: number
}

export function donutArcs(pcts: number[], r: number): DonutArc[] {
  const c = 2 * Math.PI * r
  let acc = 0
  return pcts.map((pct) => {
    const dash = (pct / 100) * c
    const arc: DonutArc = { dash: `${dash.toFixed(2)} ${(c - dash).toFixed(2)}`, offset: -acc }
    acc += dash
    return arc
  })
}
