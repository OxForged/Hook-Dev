/* ============================================================================
   Sidebar — README § Dapp shell, ported to Canvas.
   238px, white surface on the paper ground (the lighter surface now — Canvas
   inverts the old dark-sidebar-on-dark-content depth cue). Seven nav rows,
   each with a 3x16px indicator bar (Latch Blue when active), 14px label. The
   active row is a flat `--active-nav` ground with `--sky-ink` text, not a
   gradient: a gradient built to fade into a dark ground reads as a faint
   smudge on white. 0.22s transitions. Bottom: the real wallet connect control
   (@latchprotocol/connect).

   The gas-sponsor credits card that used to sit here is gone. There is no gas
   sponsor, so a progress bar reading "0.62 ETH remaining" was a picture of a
   feature that does not exist - the same class of thing as an invented chart.

   Under 1024px it becomes a drawer: fixed panel + scrim, focus trapped,
   Escape closes, and it is `inert` while closed so nothing inside is tabbable.
   ============================================================================ */

import { useRef } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { ShellData } from '../data/shell.ts'
import { useFocusTrap } from '../lib/dom.ts'
import { NavIcon } from '../../../components/NavIcon'

interface SidebarProps {
  shell: ShellData
  base: string
  isDrawer: boolean
  open: boolean
  onClose: () => void
}

export function Sidebar({ shell, base, isDrawer, open, onClose }: SidebarProps) {
  const ref = useRef<HTMLElement>(null)
  useFocusTrap(ref, isDrawer && open, onClose)

  const className = ['dapp-sidebar', isDrawer ? 'is-drawer' : '', isDrawer && open ? 'is-open' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {isDrawer && open ? (
        <div className="dapp-scrim" onClick={onClose} aria-hidden="true" />
      ) : null}
      <aside
        ref={ref}
        id="dapp-nav"
        className={className}
        aria-label="Dapp navigation"
        inert={isDrawer && !open}
      >
        {/* The lockup goes home. It is the one element every dapp user already
            expects to be clickable, and until now it was inert — leaving no way
            back to the marketing site from inside the app except the browser
            button. `Link`, not NavLink: it navigates out of the dapp, so it
            never carries an active state. */}
        <Link to="/" className="dapp-lockup" aria-label="Latch Protocol — home">
          <img src="/brand/latch-mark-transparent.png" alt="" className="dapp-lockup__mark" />
          <span className="dapp-lockup__type">
            <span className="dapp-lockup__name">LATCH</span>
            <span className="dapp-lockup__tag">PROTOCOL</span>
          </span>
        </Link>

        <nav aria-label="Screens">
          <ul className="dapp-nav">
            {shell.nav.map((item) => (
              <li key={item.screen}>
                <NavLink
                  to={item.path === '' ? base : `${base}/${item.path}`}
                  end={item.path === ''}
                  className={({ isActive }) =>
                    isActive ? 'dapp-nav__row is-active' : 'dapp-nav__row'
                  }
                  onClick={onClose}
                >
                  <span className="dapp-nav__bar" aria-hidden="true" />
                  {item.icon && <NavIcon name={item.icon} size={17} />}
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="dapp-sidebar__foot">
          <p className="dapp-sample-note">
            Live on Sepolia · testnet only
          </p>
          {/* The wallet control moved to the header (TopBar). It sat here, below
              seven nav rows, where nobody looked for it — and a second copy would
              be worse than one in the wrong place. */}
        </div>
      </aside>
    </>
  )
}
