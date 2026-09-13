import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LINKS, MENU_NAV, NAV, type NavItem } from './data'
import { isCurrentPage, linkKind, resolveHref } from './links'
import styles from './landing.module.css'
import { Lockup } from './Lockup'
import { SocialIconLink } from './SocialIcons'
import { SOCIALS } from './socials'
import { cx } from './ui'
import { useFocusTrap, useMediaQuery } from './useDisclosure'
import { NavIcon } from '../../components/NavIcon'
import { ThemeToggle } from '../../components/ThemeToggle'

/** Matches the `.headerBar` collapse point in landing.module.css. Both must move together. */
const COMPACT = '(max-width: 860px)'
const MENU_ID = 'site-menu'

/**
 * One nav link.
 *
 * Routes go through `<Link>`; landing-page sections go through a plain `<a>`
 * whose href is rewritten for the current route (see ./links.ts). `aria-current`
 * is computed from the router's location, never from the data — the old header
 * hard-coded `active: true` on "Home", so `/privacy`, `/terms` and `/verify`
 * all announced "Home, current page" to a screen reader.
 */
function NavItemLink({
  item,
  pathname,
  className,
  iconSize,
  onNavigate,
}: {
  item: NavItem
  pathname: string
  className: string
  /** Omit for a text-only link. Option B's bar is words only; the collapsed
   *  menu keeps its icons, where each row is a full-width target. */
  iconSize?: number
  onNavigate?: () => void
}) {
  const current = isCurrentPage(item.href, pathname)
  const cls = cx(className, current && styles['navLinkActive'])
  const body = (
    <>
      {item.icon && iconSize !== undefined && <NavIcon name={item.icon} size={iconSize} />}
      {item.label}
    </>
  )

  if (linkKind(item.href) === 'route') {
    return (
      <Link
        to={item.href}
        className={cls}
        aria-current={current ? 'page' : undefined}
        onClick={onNavigate}
      >
        {body}
      </Link>
    )
  }

  return (
    <a href={resolveHref(item.href, pathname)} className={cls} onClick={onNavigate}>
      {body}
    </a>
  )
}

/**
 * A1. Sticky translucent header, shared by the landing page, the legal pages
 * and the verify page.
 *
 * OPTION B, MINIMAL CUT (2026-09-13): a 64px bar inside the content column —
 * lockup, four text-only links, the theme control, and Launch App as the only
 * filled element. Nothing else competes with the primary action.
 *
 * WHAT LEFT THE BAR, AND WHERE IT WENT
 *   · The desktop left rail (238px, matching the dapp). B is a top bar.
 *   · The X / GitHub icon cluster. Both accounts are in the collapsed menu and
 *     the footer.
 *   · The CoinGecko / Finnhub reference-price rails. External market prices
 *     are not protocol data and the owner's brief is a minimal page; the
 *     dapp header still carries both rails. `TickerStrip` is untouched.
 *
 * BELOW 860px the links and theme control collapse into a disclosure menu.
 * The lockup and Launch App stay in the bar at every width. The panel is always
 * in the DOM so `aria-controls` always resolves; `hidden` keeps its links out
 * of the tab order while closed.
 */
export function SiteHeader() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useFocusTrap(panelRef, open, close)

  // Widening past the breakpoint hides the trigger; leaving `open` true would
  // strand an invisible panel holding the focus trap.
  const compact = useMediaQuery(COMPACT)
  useEffect(() => {
    if (!compact) setOpen(false)
  }, [compact])

  // A route change means the visitor got where they were going.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header className={styles['header']}>
      <div className={styles['headerBar']}>
        <div className={styles['headerLeft']}>
          <Lockup />

          <nav className={styles['nav']} aria-label="Primary">
            <ul className={styles['navList']}>
              {NAV.map((item) => (
                <li key={item.label}>
                  <NavItemLink
                    item={item}
                    pathname={pathname}
                    className={styles['navLink'] ?? ''}
                  />
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className={styles['headerRight']}>
          <span className={styles['themeToggleSlot']}>
            <ThemeToggle />
          </span>

          <Link to={LINKS.app} className={styles['launchPill']}>
            Launch App
          </Link>

          <button
            type="button"
            className={styles['menuBtn']}
            aria-expanded={open}
            aria-controls={MENU_ID}
            onClick={() => setOpen((value) => !value)}
          >
            <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true" focusable="false">
              {open ? (
                <path
                  d="M2 2l12 10M14 2L2 12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />
              ) : (
                <path
                  d="M1 2h14M1 7h14M1 12h10"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />
              )}
            </svg>
            <span className={styles['srOnly']}>{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </div>

      {open && <div className={styles['menuScrim']} onClick={close} aria-hidden="true" />}

      <div id={MENU_ID} ref={panelRef} className={styles['menuPanel']} hidden={!open}>
        <nav aria-label="Site">
          <ul className={styles['menuList']}>
            {MENU_NAV.map((item) => (
              <li key={item.label}>
                <NavItemLink
                  item={item}
                  pathname={pathname}
                  className={styles['menuLink'] ?? ''}
                  iconSize={17}
                  onNavigate={close}
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* Theme lives in the collapsed menu too: the desktop slot hides at
            the same breakpoint as the socials/nav lists, and this is the
            visitor's only way to reach it below 860px. */}
        <div className={styles['menuFoot']}>
          <p className={styles['menuLabel']}>THEME</p>
          <ThemeToggle />
        </div>

        {/* The full confirmed set, which the header's two currently equal.
            A menu is a place someone has chosen to look, so unverified
            handles are exactly what must not be here — `SOCIALS` already
            excludes them. */}
        <div className={styles['menuFoot']}>
          <p className={styles['menuLabel']}>FOLLOW</p>
          <ul className={styles['socials']} aria-label="Latch Protocol social accounts">
            {SOCIALS.map((social) => (
              <SocialIconLink key={social.id} social={social} />
            ))}
          </ul>
        </div>
      </div>
    </header>
  )
}
