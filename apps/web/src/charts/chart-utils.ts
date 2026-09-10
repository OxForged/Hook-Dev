import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/* ------------------------------------------------------------------ */
/* Measurement — SVG is drawn at real pixel width so text never scales */
/* ------------------------------------------------------------------ */

export function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  return [ref, width]
}

/* ------------------------------------------------------------------ */
/* Marks                                                               */
/* ------------------------------------------------------------------ */

/** Horizontal bar: square at the baseline (x), 4px rounded at the data end. */
export function hBarPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w, h / 2))
  if (rr <= 0) return `M${x},${y} h${w} v${h} h${-w} Z`
  return [
    `M${x},${y}`,
    `H${x + w - rr}`,
    `A${rr},${rr} 0 0 1 ${x + w},${y + rr}`,
    `V${y + h - rr}`,
    `A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}`,
    `H${x}`,
    'Z',
  ].join(' ')
}

/** Whole-step ticks across a max, thinned out on narrow layouts. */
export function ticksFor(max: number, step: number, plotWidth: number): number[] {
  const s = plotWidth >= 300 ? step : step * 2
  const out: number[] = []
  for (let v = 0; v <= max; v += s) out.push(v)
  return out
}

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

export type TipRow = { readonly series: string; readonly value: string; readonly color: string }

export type TipState = {
  readonly x: number
  readonly y: number
  readonly title: string
  readonly rows: readonly TipRow[]
} | null

export type LegendItem = { readonly label: string; readonly color: string }
