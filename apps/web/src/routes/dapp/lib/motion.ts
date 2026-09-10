/* ============================================================================
   Reduced-motion guard for JS-driven animation.

   tokens.css already collapses every CSS animation and transition under
   `@media (prefers-reduced-motion: reduce)`. Anything driven from JS — the
   block ticker, the KPI count-ups — is invisible to that rule and needs this.
   README § Interactions: "Reduced motion … honor this".
   ============================================================================ */

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

/** Live-updating: flips if the OS setting changes while the app is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', onChange)
    setReduced(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
