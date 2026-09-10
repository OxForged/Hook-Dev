import { Link } from 'react-router-dom'

type Props = {
  /** Label of the section currently being read, shown on the drawer trigger. */
  activeLabel: string
  railOpen: boolean
  onToggleRail: () => void
}

/**
 * Sticky docs header — SCREENS.md § B1: lockup + `DOCS` badge, then
 * Home · Quickstart (active) · Reference · Brand Kit · Launch App pill.
 *
 * Ground and blur follow the README ("Sticky translucent header
 * `rgba(4,6,12,.82)` + `blur(14px)`, bottom border `#131C2E`"); the reference
 * HTML uses .86 and the README wins.
 *
 * Below 1024px the four text links move into the rail drawer and a second
 * header row carries the drawer trigger, so the header never wraps and the
 * sticky offset stays constant.
 */
export default function DocsHeader({ activeLabel, railOpen, onToggleRail }: Props) {
  return (
    <header className="dk-header">
      <div className="dk-header__row">
        <div className="dk-brand">
          <img src="/brand/latch-mark-transparent.png" alt="" className="dk-brand__mark" />
          <span className="dk-lockup">
            <span className="dk-lockup__name">LATCH</span>
            <span className="dk-lockup__sub">PROTOCOL</span>
          </span>
          <span className="dk-badge">DOCS</span>
        </div>

        <nav className="dk-nav" aria-label="Site">
          <Link to="/" className="dk-nav__link">
            Home
          </Link>
          <a href="#quickstart" className="dk-nav__link dk-nav__link--active" aria-current="page">
            Quickstart
          </a>
          <a href="#interface" className="dk-nav__link">
            Reference
          </a>
          <Link to="/brand" className="dk-nav__link">
            Brand Kit
          </Link>
          <Link to="/app" className="dk-pill">
            Launch App
            <span className="dk-sheen" aria-hidden="true" />
          </Link>
        </nav>
      </div>

      <div className="dk-railbar">
        <button
          type="button"
          className="dk-railbar__btn"
          onClick={onToggleRail}
          aria-expanded={railOpen}
          aria-controls="docs-rail"
        >
          <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
            <path
              d="M1 1h12M1 6h12M1 11h8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          Contents
        </button>
        <span className="dk-railbar__here">{activeLabel}</span>
      </div>
    </header>
  )
}
