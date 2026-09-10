import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './ui'

/** Splits "$412M" into prefix "$", digits "412", suffix "M". */
const NUMERIC = /^([^0-9.,-]*)([\d.,]+)(.*)$/

const DURATION_MS = 1100
/** README § Interactions: the count fires when the element is >= 55% in view. */
const THRESHOLD = 0.55

/**
 * Counts a formatted figure up from zero the first time it scrolls into view,
 * preserving any prefix, suffix, decimals and thousands grouping. Runs once.
 * Under `prefers-reduced-motion: reduce` the final value is simply shown.
 */
export function useCountUp<T extends HTMLElement>(value: string) {
  const ref = useRef<T | null>(null)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    if (typeof IntersectionObserver !== 'function') return

    const parts = NUMERIC.exec(value)
    if (!parts) return
    const prefix = parts[1] ?? ''
    const digits = parts[2] ?? ''
    const suffix = parts[3] ?? ''

    const plain = digits.replace(/,/g, '')
    const target = Number.parseFloat(plain)
    if (!Number.isFinite(target)) return

    const decimals = (plain.split('.')[1] ?? '').length
    const grouped = digits.includes(',')

    const format = (n: number): string => {
      const fixed = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n))
      return prefix + (grouped ? Number(fixed).toLocaleString('en-US') : fixed) + suffix
    }

    let frame = 0
    let started = false

    const run = () => {
      const startedAt = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - startedAt) / DURATION_MS)
        // cubic ease-out
        const eased = 1 - Math.pow(1 - p, 3)
        setDisplay(p < 1 ? format(target * eased) : value)
        if (p < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || started) continue
          started = true
          observer.disconnect()
          run()
        }
      },
      { threshold: THRESHOLD },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  return { ref, display }
}
