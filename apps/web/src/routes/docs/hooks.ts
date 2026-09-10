import { useEffect, useState } from 'react'

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
