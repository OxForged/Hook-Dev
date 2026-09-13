import { useLayoutEffect, type RefObject } from 'react'
import type { Tone } from './data'
import styles from './landing.module.css'

/** Join truthy class names. CSS-module lookups are `string | undefined` under
 *  `noUncheckedIndexedAccess`, so filtering is not optional. */
export function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * A data-series tone resolves to a class that sets `--tone` to a token. Charts
 * then read `var(--tone)` for stroke / fill / glow, so no hex reaches a
 * component and the palette stays swappable from tokens.css.
 */
const TONE_CLASS: Record<Tone, string | undefined> = {
  primary: styles['tonePrimary'],
  signal: styles['toneSignal'],
  violet: styles['toneViolet'],
  success: styles['toneSuccess'],
  amber: styles['toneAmber'],
}

export function toneClass(tone: Tone): string | undefined {
  return TONE_CLASS[tone]
}

/** True when the visitor asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * How long the reveal may withhold anything. If the observer has not fired by
 * then — a throttled tab, an odd viewport, an embedding that never intersects —
 * everything is shown at once. Same hard stop as b.html.
 */
const REVEAL_HARD_STOP_MS = 1_500

/** The attribute that hides a pending element. Set and cleared ONLY by the hook. */
const PENDING = 'data-reveal-pending'

/**
 * Option B's reveal-on-scroll, with CONTENT VISIBLE BY DEFAULT.
 *
 * `.reveal` hides nothing on its own. An element is hidden only while it
 * carries `data-reveal-pending`, and only this hook sets that attribute — at
 * the same moment it starts observing the element, so everything hidden is
 * something the hook is committed to showing. Consequences, all deliberate:
 *   · JS off, a crawler, a failed hydration, reduced motion, or no
 *     IntersectionObserver: nothing is ever marked, the page is just there.
 *   · An element that mounts AFTER the hook ran (a section behind a hash gate,
 *     a branch that resolves later) is never marked, so it is visible. A
 *     page-level "hide every .reveal" switch would hide those forever.
 *   · If the observer has not fired within 1.5s, everything is shown.
 *
 * `useLayoutEffect`, not `useEffect`: the mark lands before first paint, so
 * content does not flash visible, vanish, and fade back in.
 */
export function useRevealOnScroll(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const page = root.current
    const revealClass = styles['reveal']
    if (!page || !revealClass) return
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return

    const targets = Array.from(page.getElementsByClassName(revealClass))
    if (targets.length === 0) return

    let fired = false
    const io = new IntersectionObserver(
      (entries) => {
        fired = true
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.removeAttribute(PENDING)
          io.unobserve(entry.target)
        }
      },
      /* Threshold 0, not a ratio. A section taller than the viewport several
         times over can never reach a ratio like 0.25, and would stay hidden
         for as long as the observer lived. */
      { threshold: 0, rootMargin: '0px 0px -6% 0px' },
    )

    for (const t of targets) {
      t.setAttribute(PENDING, '')
      io.observe(t)
    }

    const stop = window.setTimeout(() => {
      if (fired) return
      for (const t of targets) t.removeAttribute(PENDING)
    }, REVEAL_HARD_STOP_MS)

    return () => {
      window.clearTimeout(stop)
      io.disconnect()
      for (const t of targets) t.removeAttribute(PENDING)
    }
  }, [root])
}
