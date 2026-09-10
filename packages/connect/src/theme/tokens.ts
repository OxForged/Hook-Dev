/* ============================================================================
   Latch brand values, transcribed from `apps/web/src/styles/tokens.css`, which
   is itself transcribed from "latch design/README.md" § Design tokens.

   Why literals and not `var(--latch-blue)`: RainbowKit's theme object is read by
   its own vanilla-extract runtime, and several fields are composed into inline
   styles and canvas fills where a CSS custom property does not resolve. A
   package must also render correctly when mounted in a host that never loaded
   Latch's token sheet. The literals below are therefore the source of truth for
   THIS package, and they must be kept in step with tokens.css by hand.

   The design commits to a single dark world (Void ground). There is deliberately
   no light theme; the spec defines none.
   ============================================================================ */

export const LATCH_COLORS = {
  /* brand */
  latchBlue: '#2b8bff',
  deepBlue: '#0a63e0',
  signalBlue: '#4a9bff',
  skyInk: '#8fc2ff',

  /* grounds */
  void: '#04060c',
  panel: '#070c17',
  panelAlt: '#080e1a',
  codeGround: '#05080f',
  deepPanel: '#061024',

  /* lines */
  hairline: '#16223a',
  hairlineSoft: '#131f34',
  hairlineBlue2: '#24314c',
  hairlineDark: '#101a2c',
  borderHover: '#25528f',
  activeNav: '#173768',

  /* ink */
  ink: '#e4ecf9',
  inkBright: '#ffffff',
  mutedInk: '#8a9bb6',
  labelInk: '#657ca0',
  faintInk: '#697c9a',

  /* status */
  success: '#5fd39a',
  warning: '#e0c05f',
  error: '#e06a6a',
} as const

export const LATCH_FONTS = {
  body: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  display: '"Chakra Petch", ui-sans-serif, system-ui, sans-serif',
} as const

export const LATCH_RADII = {
  btn: '12px',
  chip: '10px',
  card: '16px',
  sm: '14px',
  pill: '999px',
} as const

export const LATCH_SHADOWS = {
  /* --sh-btn */
  button: '0 10px 30px rgba(26, 127, 255, 0.32)',
  /* --sh-card-hover */
  card: '0 18px 48px rgba(4, 10, 24, 0.8)',
} as const

/** `--header-bg` in tokens.css — the ground the sticky header and modal scrim use. */
export const LATCH_SCRIM = 'rgba(4, 6, 12, 0.82)'

/** README § Interactions & behavior — every timing uses this curve. */
export const LATCH_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
