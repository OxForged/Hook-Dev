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
