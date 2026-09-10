import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LINKS, MENU_NAV, NAV, type NavItem } from './data'
import { isCurrentPage, linkKind, resolveHref } from './links'
import styles from './landing.module.css'
import { Lockup } from './Lockup'
import { SocialIconLink } from './SocialIcons'
import { HEADER_SOCIALS, SOCIALS } from './socials'
import { cx } from './ui'
import { useFocusTrap, useMediaQuery } from './useDisclosure'
import { NavIcon } from '../../components/NavIcon'

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
  iconSize: number
  onNavigate?: () => void
}) {
  const current = isCurrentPage(item.href, pathname)
  const cls = cx(className, current && styles['navLinkActive'])
  const body = (
    <>
      {item.icon && <NavIcon name={item.icon} size={iconSize} />}
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
 * HIERARCHY. Four links, then the accounts, then the one thing we want clicked.
 * See NAV in ./data.ts for what was cut and why. The Launch App pill is the
 * only filled element in the bar, so the primary action is unambiguous at a
 * glance — everything else is quiet text.
 *
 * BELOW 860px the links and the icon cluster collapse into a disclosure menu.
 * The lockup and the Launch App pill stay in the bar at every width: the way
 * home and the way into the app are never more than one tap away. The panel is
 * always in the DOM so `aria-controls` always resolves; `hidden` keeps its
 * links out of the tab order while closed, which is also why there is no
 * JS-driven "is this a phone" gate on the markup — CSS decides what shows, and
 * the media query below only closes a menu left open when a window is widened.
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
        <Lockup />

        <nav className={styles['nav']} aria-label="Primary">
          <ul className={styles['navList']}>
            {NAV.map((item) => (
              <li key={item.label}>
                <NavItemLink
                  item={item}
                  pathname={pathname}
                  className={styles['navLink'] ?? ''}
                  iconSize={15}
                />
              </li>
            ))}
          </ul>

          <ul className={styles['headerSocials']} aria-label="Latch Protocol accounts">
            {HEADER_SOCIALS.map((social) => (
              <SocialIconLink key={social.id} social={social} size="sm" />
            ))}
          </ul>

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
        </nav>
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

        {/* All five here, not the header's two: a menu is a place someone has
            chosen to look, so the full set costs nothing and the publishing
            channels get their one on-screen home above the fold. */}
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
