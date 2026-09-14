import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { LINKS, MENU_RESOURCES, NAV, type NavItem } from './data'
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
const MENU_TITLE_ID = 'site-menu-title'
const GROUP_EXPLORE_ID = 'site-menu-explore'
const GROUP_RESOURCES_ID = 'site-menu-resources'

/**
 * One nav link.
 *
 * Routes go through `<Link>`; landing-page sections go through a plain `<a>`
 * whose href is rewritten for the current route (see ./links.ts). `aria-current`
 * is computed from the router's location, never from the data — the old header
 * hard-coded `active: true` on "Home", so `/privacy`, `/terms` and `/verify`
 * all announced "Home, current page" to a screen reader.
 *
 * External hrefs open in a new tab, as links.ts requires, and say so twice: a
 * decorative arrow for the eye and hidden text for a screen reader.
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
  /** Omit for a text-only link. Option B's bar is words only; the menu's
   *  primary group keeps its icons, where each row is a full-width target. */
  iconSize?: number
  onNavigate?: () => void
}) {
  const kind = linkKind(item.href)
  const current = isCurrentPage(item.href, pathname)
  const cls = cx(className, current && styles['navLinkActive'])
  const body = (
    <>
      {item.icon && iconSize !== undefined && <NavIcon name={item.icon} size={iconSize} />}
      <span className={styles['navLinkText']}>{item.label}</span>
      {kind === 'external' ? (
        <>
          <span className={styles['navLinkExternal']} aria-hidden="true">
            ↗
          </span>
          <span className={styles['srOnly']}> (opens in a new tab)</span>
        </>
      ) : null}
    </>
  )

  if (kind === 'route') {
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

  if (kind === 'external') {
    return (
      <a
        href={item.href}
        className={cls}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onNavigate}
      >
        {body}
      </a>
    )
  }

  return (
    <a href={resolveHref(item.href, pathname)} className={cls} onClick={onNavigate}>
      {body}
    </a>
  )
}

/**
 * Locks page scroll while the drawer is open, and gives it back on close.
 *
 * `overflow: hidden` on the root element rather than the `position: fixed`
 * body trick: the fixed trick restores the old scroll position on unlock, which
 * would undo the jump a section link (`#fees`) makes in the same click that
 * closes the menu. The scrollbar's width is padded back so a desktop-width
 * window narrowed below 860px does not shift sideways under the scrim.
 */
function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    const previousPadding = root.style.paddingRight
    const scrollbar = window.innerWidth - root.clientWidth
    root.style.overflow = 'hidden'
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`
    return () => {
      root.style.overflow = previousOverflow
      root.style.paddingRight = previousPadding
    }
  }, [active])
}

/**
 * A1. Sticky translucent header, shared by the landing page, the legal pages,
 * the verify page and the ecosystem directory.
 *
 * OPTION B, MINIMAL CUT (2026-09-13): a 64px bar inside the content column —
 * lockup, four text-only links (Contracts left for the docs and Ecosystem
 * joined as a page, both 2026-09-13; see NAV in ./data.ts), the theme
 * control, and Launch App as the only filled element. Nothing else competes
 * with the primary action. 56px on a phone.
 *
 * WHAT LEFT THE BAR, AND WHERE IT WENT
 *   · The desktop left rail (238px, matching the dapp). B is a top bar.
 *   · The X / GitHub icon cluster. Both accounts are in the menu drawer and
 *     the footer.
 *   · The CoinGecko / Finnhub reference-price rails. External market prices
 *     are not protocol data and the owner's brief is a minimal page; the
 *     dapp header still carries both rails. `TickerStrip` is untouched.
 *
 * BELOW 860px THE LINKS MOVE INTO A DRAWER (rebuilt 2026-09-13, owner: "put
 * more in the mobile menu"). A right-hand sheet holding the four primary
 * destinations, Launch App, the resources group, the theme control and the
 * socials. It is a modal dialog in every sense a keyboard or screen-reader
 * user can feel:
 *   · Tab is trapped inside it and Escape closes it (useFocusTrap), and focus
 *     returns to the menu button.
 *   · Page scroll is locked while it is open (useScrollLock).
 *   · A route change closes it, derived in render rather than in an effect:
 *     the menu is open only while `openedOn` equals the current pathname.
 *   · Widening past 860px closes it, so no invisible sheet holds the trap.
 *
 * WHY IT IS PORTALLED to <body>. `.header` carries `backdrop-filter`, and a
 * filtered ancestor becomes the containing block for `position: fixed`
 * descendants. The previous scrim was fixed with `inset: 0` and therefore
 * covered the 64px header and nothing else, while the page behind the panel
 * stayed live and scrollable. Outside the header, `fixed` means the viewport.
 *
 * The sheet is always in the DOM, so `aria-controls` always resolves; while
 * closed it is `inert` and `visibility: hidden`, which takes every link out of
 * the tab order and the accessibility tree without cancelling the slide.
 */
export function SiteHeader() {
  const { pathname } = useLocation()
  const compact = useMediaQuery(COMPACT)
  /** The pathname the menu was opened on, or null when closed. */
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = compact && openedOn === pathname
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpenedOn(null), [])

  useFocusTrap(panelRef, open, close)
  useScrollLock(open)

  // Widening past the breakpoint hides the trigger. Clearing the state here
  // (in the listener, not in render) means narrowing again does not reopen it.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(COMPACT)
    const onChange = () => {
      if (!mql.matches) setOpenedOn(null)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const drawer = (
    <>
      <div
        className={cx(styles['drawerScrim'], open && styles['drawerScrimOpen'])}
        onClick={close}
        aria-hidden="true"
      />

      <div
        id={MENU_ID}
        ref={panelRef}
        className={cx(styles['drawer'], open && styles['drawerOpen'])}
        role="dialog"
        aria-modal="true"
        aria-labelledby={MENU_TITLE_ID}
        inert={!open}
      >
        <div className={styles['drawerHead']}>
          <p id={MENU_TITLE_ID} className={styles['drawerTitle']}>
            Menu
          </p>
          <button type="button" className={styles['drawerClose']} onClick={close}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <span className={styles['srOnly']}>Close menu</span>
          </button>
        </div>

        <div className={styles['drawerBody']}>
          <nav className={styles['drawerGroup']} aria-labelledby={GROUP_EXPLORE_ID}>
            <p id={GROUP_EXPLORE_ID} className={styles['drawerGroupLabel']}>
              Explore
            </p>
            <ul className={styles['menuList']}>
              {NAV.map((item) => (
                <li key={item.label}>
                  <NavItemLink
                    item={item}
                    pathname={pathname}
                    className={styles['menuLink'] ?? ''}
                    iconSize={18}
                    onNavigate={close}
                  />
                </li>
              ))}
            </ul>
          </nav>

          <Link
            to={LINKS.app}
            className={cx(styles['launchPill'], styles['drawerLaunch'])}
            onClick={close}
          >
            Launch App<span aria-hidden="true"> →</span>
          </Link>

          <nav className={styles['drawerGroup']} aria-labelledby={GROUP_RESOURCES_ID}>
            <p id={GROUP_RESOURCES_ID} className={styles['drawerGroupLabel']}>
              Resources
            </p>
            <ul className={styles['menuList']}>
              {MENU_RESOURCES.map((item) => (
                <li key={item.label}>
                  <NavItemLink
                    item={item}
                    pathname={pathname}
                    className={styles['menuSubLink'] ?? ''}
                    onNavigate={close}
                  />
                </li>
              ))}
            </ul>
          </nav>

          <div className={styles['drawerFoot']}>
            {/* The desktop slot hides at the same breakpoint as the links, so
                this is the visitor's only way to reach the theme below 860px. */}
            <div className={styles['drawerFootRow']}>
              <p className={styles['drawerGroupLabel']}>Appearance</p>
              <ThemeToggle showLabels className={styles['drawerTheme']} />
            </div>

            {/* The full confirmed set. A menu is a place someone has chosen to
                look, so unverified handles are exactly what must not be here —
                `SOCIALS` already excludes them. */}
            <div className={styles['drawerFootRow']}>
              <p className={styles['drawerGroupLabel']}>Follow</p>
              <ul
                className={cx(styles['socials'], styles['drawerSocials'])}
                aria-label="Latch Protocol social accounts"
              >
                {SOCIALS.map((social) => (
                  <SocialIconLink key={social.id} social={social} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  )

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
            aria-haspopup="dialog"
            onClick={() => setOpenedOn(open ? null : pathname)}
          >
            <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true" focusable="false">
              <path
                d="M1 2h16M1 7h16M1 12h11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <span className={styles['srOnly']}>Open menu</span>
          </button>
        </div>
      </div>

      {typeof document === 'undefined' ? null : createPortal(drawer, document.body)}
    </header>
  )
}
