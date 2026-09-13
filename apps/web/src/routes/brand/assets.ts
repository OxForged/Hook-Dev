/**
 * Brand kit inventory.
 *
 * Every entry points at a real file in `apps/web/public/brand/`, served from
 * `/brand/<file>`. Nothing here is decorative: each `href` is handed to a real
 * `<a download>`, so a wrong path is a broken download, not a broken image.
 *
 * Source of truth: "latch design/README.md" § Assets and
 * "latch design/SCREENS.md" § D. Brand kit page.
 */

const BRAND = '/brand'

export type Ground = 'void' | 'glow' | 'light'

export interface Download {
  /** Button label, exactly what the file is. */
  readonly label: string
  readonly href: string
  /** Accessible name — "PNG" alone tells a screen reader nothing. */
  readonly aria: string
}

export interface LogoAsset {
  readonly id: string
  readonly name: string
  /** Mono meta line under the name. */
  readonly meta: string
  readonly src: string
  readonly alt: string
  readonly ground: Ground
  /** Preview sizing — layout data, not a token. */
  readonly preview: 'wide' | 'wide-narrow' | 'tall' | 'icon'
  readonly downloads: readonly Download[]
}

/**
 * § Logo — six tiles, in the reference's order.
 *
 * SVG buttons appear only where an SVG of *that* asset exists. The kit ships
 * `latch-lockup.svg`, `latch-mark.svg`, `latch-wordmark.svg` and `favicon.svg`
 * — there is no on-light lockup, no single-blue mark and no app-icon SVG, so
 * those three tiles say "PNG only" rather than handing over a different file
 * under an SVG label.
 */
export const logos: readonly LogoAsset[] = [
  {
    id: 'lockup',
    name: 'Primary lockup',
    meta: 'transparent · mark + wordmark',
    src: `${BRAND}/latch-lockup-transparent.png`,
    alt: 'Latch Protocol primary lockup: the Latch mark beside the LATCH PROTOCOL wordmark, in white and blue on the dark brand ground.',
    ground: 'void',
    preview: 'wide',
    downloads: [
      {
        label: 'PNG',
        href: `${BRAND}/latch-lockup-transparent.png`,
        aria: 'Download the primary lockup as a transparent PNG',
      },
      {
        label: 'SVG',
        href: `${BRAND}/latch-lockup.svg`,
        aria: 'Download the primary lockup as an SVG',
      },
    ],
  },
  {
    id: 'lockup-onlight',
    name: 'Lockup on light',
    meta: 'dark ink for light surfaces · PNG only',
    src: `${BRAND}/latch-lockup-onlight.png`,
    alt: 'The Latch Protocol lockup in dark ink, shown on a pale grey surface.',
    ground: 'light',
    preview: 'wide',
    downloads: [
      {
        label: 'PNG',
        href: `${BRAND}/latch-lockup-onlight.png`,
        aria: 'Download the on-light lockup as a transparent PNG',
      },
    ],
  },
  {
    id: 'mark',
    name: 'Mark',
    meta: 'white + blue · transparent',
    src: `${BRAND}/latch-mark-transparent.png`,
    alt: 'The Latch mark on its own, drawn in white with a blue inner eye.',
    ground: 'glow',
    preview: 'tall',
    downloads: [
      {
        label: 'PNG',
        href: `${BRAND}/latch-mark-transparent.png`,
        aria: 'Download the mark as a transparent PNG',
      },
      { label: 'SVG', href: `${BRAND}/latch-mark.svg`, aria: 'Download the mark as an SVG' },
    ],
  },
  {
    id: 'mark-blue',
    name: 'Mark · single blue',
    meta: 'one-color applications · PNG only',
    src: `${BRAND}/latch-mark-blue.png`,
    alt: 'The Latch mark drawn in a single flat blue, for one-colour applications.',
    ground: 'void',
    preview: 'tall',
    downloads: [
      {
        label: 'PNG',
        href: `${BRAND}/latch-mark-blue.png`,
        aria: 'Download the single-blue mark as a transparent PNG',
      },
    ],
  },
  {
    id: 'wordmark',
    name: 'Wordmark',
    meta: 'no mark · wide placements',
    src: `${BRAND}/latch-wordmark-transparent.png`,
    alt: 'The LATCH PROTOCOL wordmark set on its own, without the Latch mark.',
    ground: 'void',
    preview: 'wide-narrow',
    downloads: [
      {
        label: 'PNG',
        href: `${BRAND}/latch-wordmark-transparent.png`,
        aria: 'Download the wordmark as a transparent PNG',
      },
      {
        label: 'SVG',
        href: `${BRAND}/latch-wordmark.svg`,
        aria: 'Download the wordmark as an SVG',
      },
    ],
  },
  {
    id: 'app-icon',
    name: 'App icon',
    meta: '1024 · rounded square · PNG only',
    src: `${BRAND}/app-icon-1024.png`,
    alt: 'The Latch app icon: the Latch mark centred on a dark rounded square with a glowing blue rim.',
    ground: 'void',
    preview: 'icon',
    downloads: [
      {
        label: 'PNG',
        href: `${BRAND}/app-icon-1024.png`,
        aria: 'Download the app icon as a 1024 by 1024 PNG',
      },
    ],
  },
]

export interface Favicon {
  readonly size: number
  readonly label: string
  readonly href: string
  /** Rendered box + image edge, per the reference: min(size, 72) (+22 for the box). */
  readonly px: number
}

/** § Icon & favicon — 16 / 32 / 64 / 180 / 512, clamped to 72px on screen. */
export const favicons: readonly Favicon[] = [16, 32, 64, 180, 512].map((size) => ({
  size,
  label: `${size}px`,
  href: `${BRAND}/favicon-${size}.png`,
  px: Math.min(size, 72),
}))

export interface Swatch {
  readonly name: string
  readonly role: string
  /**
   * Token the swatch paints itself with — never a literal hex in a component.
   *
   * There is deliberately no `hex` field any more. This list used to carry
   * hand-copied values (#2B8BFF, #04060C…) from the retired dark palette, and
   * went on printing them under swatches painted from tokens that had since
   * moved — a label contradicting the colour directly above it. The values
   * shown now are read from the token's own declaration at runtime (see
   * `useTokenValues` in components.tsx), so they cannot drift from tokens.css.
   */
  readonly token: string
  /** Grounds close to the card's own colour need a hairline so the swatch edge is visible. */
  readonly needsRule: boolean
}

/** § Color — Option B: one blue doing the work, green for live status, cool neutrals. */
export const palette: readonly Swatch[] = [
  { name: 'Latch Blue', role: 'primary · actions, accents', token: '--latch-blue', needsRule: false },
  { name: 'Deep Blue', role: 'hover, pressed', token: '--deep-blue', needsRule: false },
  { name: 'Live Green', role: 'live status, success', token: '--success', needsRule: false },
  { name: 'Ground', role: 'page background', token: '--void', needsRule: true },
  { name: 'Surface', role: 'cards, panels', token: '--panel', needsRule: true },
  { name: 'Hairline', role: 'borders, dividers', token: '--hairline', needsRule: true },
  { name: 'Ink', role: 'primary text', token: '--ink', needsRule: false },
  { name: 'Muted Ink', role: 'body copy, subtitles', token: '--muted-ink', needsRule: false },
]

export interface TypeSpecimen {
  readonly name: string
  readonly meta: string
  /** Font token + weight used for the 44px "Aa". */
  readonly font: string
  readonly weight: number
}

/**
 * § Typography — three specimens, named for what index.html actually loads.
 *
 * The previous names (Chakra Petch, IBM Plex Sans, IBM Plex Mono) were from an
 * earlier direction and rendered in none of those faces. Inter and JetBrains
 * Mono are the Google Fonts request in index.html; the heading serif is a
 * system stack with no web font behind it, and the specimen says so.
 */
export const specimens: readonly TypeSpecimen[] = [
  {
    name: 'Serif · system stack',
    meta: 'Iowan Old Style, Palatino, Georgia · 500 · headings',
    font: 'var(--font-serif)',
    weight: 500,
  },
  { name: 'Inter', meta: '400 / 600 · body, UI', font: 'var(--font-body)', weight: 400 },
  {
    name: 'JetBrains Mono',
    meta: '400 / 500 · numbers, addresses, code',
    font: 'var(--font-mono)',
    weight: 500,
  },
]

/** § Usage — minimum sizes. */
export const minimums: readonly { readonly what: string; readonly size: string }[] = [
  { what: 'Full lockup', size: '120px wide' },
  { what: 'Mark only', size: '24px wide' },
  { what: 'Powered By badge', size: '160px wide' },
]

/** § Usage — the DON'T list, rendered under an `--error` label. */
export const donts: readonly string[] = [
  'Recolor the mark outside blue and white',
  'Stretch, rotate or outline it',
  'Add glow, bevel or drop shadow to the lockup',
  'Place the mark on a busy photo without a solid plate',
  'Rebuild the wordmark in another typeface',
]
