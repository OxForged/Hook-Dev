/**
 * Navigation icons for the landing header and the dapp sidebar.
 *
 * Inline SVG rather than an icon font or a dependency: there are a dozen glyphs, they
 * must inherit `currentColor` so active/hover states come from the design tokens, and
 * a webfont would add a network request plus a flash of missing icons.
 *
 * Every icon is 20x20 on a 24-unit grid, 1.6 stroke, round caps — matched to the
 * spec's line weights so they sit correctly beside IBM Plex Sans at 14px.
 *
 * These are decorative: every call site pairs the icon with a visible text label, so
 * each renders `aria-hidden` and contributes nothing to the accessible name. An icon
 * that duplicates its own label just makes screen readers say everything twice.
 */

export type IconName =
  | 'home'
  | 'developers'
  | 'docs'
  | 'ecosystem'
  | 'about'
  | 'brand'
  | 'launch'
  | 'revenue'
  | 'dashboard'
  | 'explorer'
  | 'deploy'
  | 'pool'
  | 'portfolio'
  | 'analytics'
  | 'settings'
  | 'claim'
  /* Added 2026-09-12. `swap` and `governance` exist because two rows were
     borrowing a glyph that meant something else: Swap wore `pool`, which Pool
     Detail also wears, and Governance wore `docs`. Two rows with one icon is
     two rows a reader cannot tell apart at a glance, which is most of what an
     icon is for. `quest` and `terminal` are for the More menu. */
  | 'swap'
  | 'governance'
  | 'quest'
  | 'terminal'
  /* Hero category glyphs, added 2026-09-12. The hero drew the SAME diamond for
     all six market categories, which is a placeholder wearing the confidence of
     a finished design — six tiles a reader cannot tell apart say nothing at all.
     These are CATEGORIES, not companies: there is no vendor mark for "perps",
     and CLAUDE.md forbids drawing an approximation of anybody's logo, so each is
     an honest custom glyph for the thing itself. */
  | 'amm'
  | 'dex'
  | 'perps'
  | 'rwa'
  | 'stocks'
  /* Added 2026-09-12 with the nav restyle. This one is not a destination glyph:
     it sits INLINE, immediately after an external link's label, and says the
     link leaves the site. It is here rather than as an inline <svg> in the
     sidebar for the reason every other glyph is here — one 24-unit grid, one
     stroke weight, one `currentColor` contract — and because the sidebar is now
     the second surface that needs it.

     What it replaces: a literal "↗" character. That rendered at whatever weight
     the reader's symbol font happened to supply, sitting beside 1.6-stroke line
     icons, and it was the one mark in the rail that did not scale with the rest.

     Decorative, like every glyph here. The accessible name still says "opens in
     a new tab" in words at each call site; a symbol is not an announcement. */
  | 'external'

const PATHS: Record<IconName, React.ReactNode> = {
  /* The constant-product curve itself. x*y=k is the one shape that means AMM
     and nothing else — a coin pair or a droplet would mean liquidity generally. */
  amm: (
    <>
      <path d="M4 20C4 11 11 4 20 4" />
      <path d="M4 4h0.01" />
      <path d="M4 20h16" />
      <path d="M4 20V4" />
    </>
  ),
  /* Two parties trading: nodes joined across a divide. Deliberately not the
     swap arrows, which already mean "perform a swap" in the nav. */
  dex: (
    <>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="12" r="2.6" />
      <path d="M8.6 12h6.8" />
      <path d="M6 9.4V4.5" />
      <path d="M18 14.6v4.9" />
    </>
  ),
  /* A candle with wicks running past the frame — a position that does not
     expire, which is the whole of what "perpetual" means. */
  perps: (
    <>
      <path d="M8 3v18" />
      <rect x="5.4" y="7.5" width="5.2" height="9" />
      <path d="M17 3v18" />
      <rect x="14.4" y="11" width="5.2" height="6" />
    </>
  ),
  /* A building. Real-world assets are the things with deeds and coupons, and a
     facade reads that way faster than any abstraction. */
  rwa: (
    <>
      <path d="M3.5 9.5 12 4l8.5 5.5" />
      <path d="M5.5 9.5v9M11 9.5v9M13 9.5v9M18.5 9.5v9" />
      <path d="M3 20.5h18" />
    </>
  ),
  /* Two trend lines diverging — a spread. A stock PAIR is the relationship
     between two instruments, not one line going up. */
  stocks: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M5 16l4-5 3.5 3L19 5" />
      <path d="M5 8.5l4 3 3.5-1.5L19 15.5" />
    </>
  ),
  /* A box with the arrow already leaving it. The opening in the top-right
     corner is the load-bearing part: a closed box with an arrow inside reads as
     "expand", and an arrow with no box reads as "up and to the right". */
  external: (
    <>
      <path d="M10.5 5.5H5.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
      <path d="M13.5 4.5h6v6" />
      <path d="M19.5 4.5 11 13" />
    </>
  ),
  /* Two arrows passing — the universal shape for an exchange, and deliberately
     not a pool or a pair of coins, both of which already mean something here. */
  swap: (
    <>
      <path d="M4.5 8.5h15" />
      <path d="M15.5 4.5 19.5 8.5 15.5 12.5" />
      <path d="M19.5 15.5h-15" />
      <path d="M8.5 11.5 4.5 15.5 8.5 19.5" />
    </>
  ),
  /* A balance. Governance is the weighing of a proposal, and a scale reads that
     way in every jurisdiction — unlike a gavel, which reads as enforcement. */
  governance: (
    <>
      <path d="M12 3.5v17" />
      <path d="M5.5 20.5h13" />
      <path d="M4 7.5h16" />
      <path d="M7.5 7.5 4.5 14h6z" />
      <path d="M16.5 7.5 13.5 14h6z" />
    </>
  ),
  /* A flag on a route. A quest is a destination reached, not a task ticked. */
  quest: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4.5h11l-2.5 4 2.5 4H6z" />
    </>
  ),
  /* A prompt and a caret. The one glyph nobody mistakes for anything else. */
  terminal: (
    <>
      <path d="M3.5 4.5h17v15h-17z" />
      <path d="M7.5 9.5 10.5 12 7.5 14.5" />
      <path d="M13 15h4" />
    </>
  ),
  // landing
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  developers: <path d="m8 8-5 4 5 4M16 8l5 4-5 4M13.5 4l-3 16" />,
  docs: (
    <>
      <path d="M5 3.5h9l5 5V20.5H5z" />
      <path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" />
    </>
  ),
  ecosystem: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="4" r="1.8" />
      <circle cx="19" cy="16" r="1.8" />
      <circle cx="5" cy="16" r="1.8" />
      <path d="M12 6v3M14.6 13.6l2.7 1.6M9.4 13.6l-2.7 1.6" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </>
  ),
  brand: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9 10.5h6" />
    </>
  ),
  launch: <path d="M5 19 19 5M10 5h9v9" />,
  // Revenue share: one source splitting three ways.
  revenue: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="4.5" cy="19" r="2.5" />
      <circle cx="12" cy="19" r="2.5" />
      <circle cx="19.5" cy="19" r="2.5" />
      <path d="M12 7.5v3M12 10.5H5.2a.7.7 0 0 0-.7.7v5.3M12 10.5v6M12 10.5h6.8a.7.7 0 0 1 .7.7v5.3" />
    </>
  ),

  // dapp
  dashboard: (
    <>
      <path d="M3.5 3.5h7v7h-7zM13.5 3.5h7v4.5h-7zM13.5 12h7v8.5h-7zM3.5 14h7v6.5h-7z" />
    </>
  ),
  explorer: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  deploy: <path d="M12 20V5m0 0-5 5m5-5 5 5M4.5 20h15" />,
  pool: (
    <>
      <path d="M3.5 15.5c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" />
      <path d="M3.5 19.5c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" />
      <path d="M12 3.5 7.5 9h9z" />
    </>
  ),
  portfolio: (
    <>
      <path d="M3.5 7.5h17v13h-17z" />
      <path d="M9 7.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2.5" />
    </>
  ),
  analytics: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  // Claim: a share of a pot, coming out to an open hand.
  claim: (
    <>
      <path d="M4.5 8.5h15v4a7.5 7.5 0 0 1-15 0z" />
      <path d="M8 8.5V5.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" />
      <path d="M12 15v5.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
}

export function NavIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      {PATHS[name]}
    </svg>
  )
}
