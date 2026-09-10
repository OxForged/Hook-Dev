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

const PATHS: Record<IconName, React.ReactNode> = {
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
