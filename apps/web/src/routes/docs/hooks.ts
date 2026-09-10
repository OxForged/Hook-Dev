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
    let frame = 0

    const measure = () => {
      frame = 0
      const scrollBottom = window.scrollY + window.innerHeight
      const atBottom = scrollBottom >= document.documentElement.scrollHeight - 2

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

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
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
