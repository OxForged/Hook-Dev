/* ============================================================================
   KPI count-up — README § Interactions:
   "numeric prefix/suffix preserved, ~1.1s, cubic ease-out, fires when the
   element is >= 55% in view, runs once".

   JS-driven, so it carries its own matchMedia guard: under
   `prefers-reduced-motion: reduce` the final value renders immediately.
   ============================================================================ */

import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion.ts'

const DURATION = 1100
const THRESHOLD = 0.55

interface Parsed {
  prefix: string
  suffix: string
  target: number
  decimals: number
  grouped: boolean
}

/** "$48.2M" -> { prefix "$", target 48.2, decimals 1, suffix "M" }. */
function parse(value: string): Parsed | null {
  const match = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(value)
  if (!match) return null
  const [, prefix = '', raw = '', suffix = ''] = match
  const plain = raw.replace(/,/g, '')
  const target = Number(plain)
  if (!Number.isFinite(target)) return null
  const dot = plain.indexOf('.')
  return {
    prefix,
    suffix,
    target,
    decimals: dot === -1 ? 0 : plain.length - dot - 1,
    grouped: raw.includes(','),
  }
}

function render(n: number, p: Parsed): string {
  const body = p.grouped
    ? n.toLocaleString('en-US', {
        minimumFractionDigits: p.decimals,
        maximumFractionDigits: p.decimals,
      })
    : n.toFixed(p.decimals)
  return `${p.prefix}${body}${p.suffix}`
}

export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [text, setText] = useState(value)

  useEffect(() => {
    const node = ref.current
    const parsed = parse(value)
    if (!node || !parsed || prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
      setText(value)
      return
    }

    setText(render(0, parsed))
    let frame = 0
    let done = false

    const run = () => {
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION)
        const eased = 1 - Math.pow(1 - t, 3)
        setText(render(parsed.target * eased, parsed))
        if (t < 1) frame = requestAnimationFrame(step)
        else setText(value)
      }
      frame = requestAnimationFrame(step)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !done) {
            done = true
            observer.disconnect()
            run()
          }
        }
      },
      { threshold: THRESHOLD },
    )
    observer.observe(node)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  )
}
