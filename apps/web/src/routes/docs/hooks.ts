import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Scroll to the section named by the URL hash, on first load and whenever the
 * hash changes.
 *
 * WHY THIS EXISTS. An in-page `<a href="#keeper">` is a native fragment jump
 * and needs no help. Two ways of arriving do:
 *
 *   · A cold load of `/docs#contracts`. The route module is lazy-loaded, so the
 *     browser's own fragment scroll runs before any section exists and finds
 *     nothing.
 *   · A client-side `<Link to="/docs#contracts">` from another page (the
 *     landing footer and CTA, the `/#contracts` redirect). react-router v7 has
 *     no built-in hash scrolling, so the reader would land at the top.
 *
 * Both reach this effect through `useLocation`, which also updates on a native
 * fragment jump (it fires `popstate`), so the in-page case re-runs harmlessly
 * onto the element the browser already scrolled to. Once the element is in
 * view the ordinary scroll listener in `useScrollSpy` lights its rail item.
 *
 * THE TARGET IS HELD WHILE THE PAGE SETTLES. Content above the target keeps
 * changing height after the first jump — web fonts reflow the prose, and live
 * reads above it (verification states, chain checks) resolve into shorter or
 * taller blocks. Measured 2026-09-13: `/docs#contracts` landed with its heading
 * 71px UNDER the sticky header, because a section above shrank after the jump,
 * while `#interface` landed exactly. A single retry on `document.fonts.ready`
 * did not catch it, and its `scrollY !== landedAt` guard misread the browser's
 * own scroll anchoring as the reader scrolling.
 *
 * So for SETTLE_MS the page's size is observed and the target re-aligned on
 * every change — but the first real input from the reader (wheel, touch, key,
 * pointer) releases it immediately. Their position always wins.
 */
const SETTLE_MS = 2500

export function useHashScroll(): void {
  const { hash, key } = useLocation()

  useEffect(() => {
    if (hash.length < 2) return
    let id: string
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      return
    }
    if (!document.getElementById(id)) return

    const align = (): void => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    }
    align()

    let released = false
    const INPUTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!released) align() }) : null
    const release = (): void => {
      if (released) return
      released = true
      ro?.disconnect()
      window.clearTimeout(timer)
      for (const t of INPUTS) window.removeEventListener(t, release)
    }
    for (const t of INPUTS) window.addEventListener(t, release, { passive: true })
    ro?.observe(document.body)
    void document.fonts.ready.then(() => { if (!released) align() })
    const timer = window.setTimeout(release, SETTLE_MS)

    return release
  }, [hash, key])
}

/**
 * Which of `ids` is the section currently being read.
 *
 * Deliberately scroll-position based rather than IntersectionObserver: an
 * observer reports "which sections are visible", but a docs rail needs "which
 * heading did I last pass", which stays correct for a section taller than the
 * viewport and for the short final section at the bottom of the page.
 *
 * `offset` is the sticky header's shadow — a heading counts as reached once it
 * crosses that line.
 */
export function useScrollSpy(ids: readonly string[], offset = 110): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null)

  useEffect(() => {
    // Measured straight from the passive scroll handler rather than deferred to
    // requestAnimationFrame: seven getBoundingClientRect reads is far cheaper
    // than a frame, and rAF is throttled in backgrounded or unpainted tabs,
    // which would leave the rail stuck on the first section.
    const measure = () => {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight > window.innerHeight + 4
      const atBottom =
        scrollable && window.scrollY + window.innerHeight >= doc.scrollHeight - 2

      let current: string | null = ids[0] ?? null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        if (el.getBoundingClientRect().top - offset <= 0) current = id
      }
      // At the very bottom the last section may never cross the line.
      if (atBottom) current = ids[ids.length - 1] ?? current

      setActive((prev) => (prev === current ? prev : current))
    }

    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [ids, offset])

  return active
}

/** Live `matchMedia` result. Used to drive the rail's drawer mode below 1024px. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
