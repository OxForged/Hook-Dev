/* ============================================================================
   Chart motion helpers for the landing's visual modules (FeeChart, SwapCost,
   PresetCurve).

   THE ONE RULE: A REVEAL MUST NEVER BE ABLE TO WITHHOLD THE CHART.

   `useFirstView` renders the FINISHED state by default. It only "arms" the
   hidden pre-animation state when JS has run, motion is allowed, AND the tab
   is visible at that moment. A hidden tab — a background tab, a headless or
   automated capture — never arms, so it paints the finished chart. (An earlier
   version armed regardless and a background tab rendered axes with no
   columns.)

   Once armed, IntersectionObserver reveals it. Where IntersectionObserver does
   not exist, a rAF-throttled scroll/resize check does instead — never both, so
   no chart forces a layout read on every scroll event. `visibilitychange` is
   always watched, because a tab can be hidden between arming and first sight.

   Under `prefers-reduced-motion: reduce` it never arms, so the final state is
   the first and only paint.
   ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

import { prefersReducedMotion } from './ui'

export interface FirstView<T extends Element> {
  ref: (node: T | null) => void
  /** True between arming and first sight: render the pre-animation state. */
  hidden: boolean
}

function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight || document.documentElement.clientHeight
  return r.bottom > 0 && r.top < vh * 0.9 && r.height > 0
}

export function useFirstView<T extends Element>(): FirstView<T> {
  const [node, setNode] = useState<T | null>(null)
  const [armed, setArmed] = useState(false)
  const [seen, setSeen] = useState(false)

  const ref = useCallback((n: T | null) => setNode(n), [])

  /* Layout effect so the armed state lands before the first paint that has
     the node in it — otherwise the full chart flashes, then collapses, then
     grows. */
  useLayoutEffect(() => {
    if (node === null || seen || armed) return
    if (prefersReducedMotion() || document.visibilityState !== 'visible') {
      setSeen(true)
      return
    }
    setArmed(true)
  }, [node, seen, armed])

  useEffect(() => {
    if (node === null || !armed || seen) return

    let done = false
    const reveal = (): void => {
      if (done) return
      done = true
      /* TWO frames after arming. One rAF runs before the next paint, so a
         reveal scheduled in it can commit before the hidden state was ever
         styled — and a transition with no computed start state just jumps.
         The second frame guarantees the hidden state was painted. */
      requestAnimationFrame(() => requestAnimationFrame(() => setSeen(true)))
    }
    /* A layout read, so it is only ever run once per frame at most. */
    let queued = 0
    const check = (): void => {
      if (done || queued !== 0) return
      queued = requestAnimationFrame(() => {
        queued = 0
        if (document.visibilityState === 'visible' && inViewport(node)) reveal()
      })
    }

    let io: IntersectionObserver | null = null
    const useFallback = typeof IntersectionObserver !== 'function'
    if (!useFallback) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) reveal()
        },
        { threshold: 0.25 },
      )
      io.observe(node)
    } else {
      window.addEventListener('scroll', check, { passive: true })
      window.addEventListener('resize', check)
    }
    document.addEventListener('visibilitychange', check)
    check()

    return () => {
      done = true
      cancelAnimationFrame(queued)
      io?.disconnect()
      if (useFallback) {
        window.removeEventListener('scroll', check)
        window.removeEventListener('resize', check)
      }
      document.removeEventListener('visibilitychange', check)
    }
  }, [node, armed, seen])

  return { ref, hidden: armed && !seen }
}

/**
 * The rendered width of a chart container, so an SVG can be drawn in real
 * pixels rather than scaled from a viewBox.
 *
 * Scaling a fixed viewBox is how axis ticks end up at 6px on a phone and 16px
 * on a wide monitor. Drawing at the measured width keeps every tick at the
 * `--b-axis` size it was specified at.
 *
 * NO FEEDBACK LOOP, BY CONSTRUCTION. The measured element must be a box whose
 * width cannot depend on the chart inside it: every consumer's scroller
 * carries `contain: inline-size` and `min-width: 0`, and each chart section
 * carries `min-width: 0` as a grid item. Without that, the chart drawn at the
 * measured width raises the container's min-content, which widens the
 * container, which raises the measurement — an unbounded growth loop that
 * freezes the renderer.
 *
 * Three listeners, because none is reliable alone: a layout-time measure for
 * the first paint, ResizeObserver for container-only changes, and window
 * `resize` as the fallback a throttled tab still delivers. If all three stay
 * silent the chart simply draws at `fallback`, scaled — degraded, not blank.
 */
export function useMeasuredWidth<T extends HTMLElement>(fallback: number) {
  /* A callback ref held in state, not a ref object: the measured element
     mounts only on the ready branch, after the loading branch has already run
     every effect once with nothing to measure. */
  const [node, setNode] = useState<T | null>(null)
  const ref = useCallback((n: T | null) => setNode(n), [])
  const [width, setWidth] = useState(fallback)

  /* Only a change of at least 1px is a change. Sub-pixel jitter from a
     scrollbar or zoom level must not re-render the chart, and returning the
     previous value lets React bail out of the update entirely. */
  const measure = useCallback(() => {
    if (node === null) return
    const w = Math.round(node.clientWidth)
    if (w <= 0) return
    setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev))
  }, [node])

  useLayoutEffect(measure, [measure])

  useEffect(() => {
    if (node === null) return
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(measure)
      ro.observe(node)
    }
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [node, measure])

  return { ref, width }
}
