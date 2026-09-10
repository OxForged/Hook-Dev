/* Data-series colours resolve to tokens, never to literal hexes. */

import type { SeriesColor } from '../data/types.ts'

export const SERIES_VAR: Record<SeriesColor, string> = {
  primary: 'var(--latch-blue)',
  signal: 'var(--signal-blue)',
  violet: 'var(--violet)',
  success: 'var(--success)',
  amber: 'var(--amber)',
}
