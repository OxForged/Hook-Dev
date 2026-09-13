import { Link } from 'react-router-dom'
import { BrandLockup } from '../../components/BrandLockup'
import { ThemeToggle } from '../../components/ThemeToggle'

type Props = {
  /** Label of the section currently being read, shown on the drawer trigger. */
  activeLabel: string
  railOpen: boolean
  onToggleRail: () => void
}

/**
 * Sticky docs header: lockup + `DOCS` badge, then
 * Home · Quickstart (active) · Reference · Brand Kit · Launch App.
 *
 * Option B's header: a translucent surface over a blur with one hairline
 * underneath, and a flat primary button. The sheen that used to sweep the
 * pill is gone — B has no decorative motion on actions.
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
          {/* The shared lockup — same mark, theme swap and proportions as the
              landing header and the dapp sidebar (components/BrandLockup). */}
          <BrandLockup />
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
          <span className="dk-theme-slot">
            <ThemeToggle />
          </span>
          <Link to="/app" className="dk-pill">
            Launch App
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
