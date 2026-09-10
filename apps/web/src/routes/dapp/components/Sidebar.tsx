/* ============================================================================
   Sidebar — README § Dapp shell.
   238px, ground #060A12, right border #101A2C. Seven nav rows, each with a
   3x16px indicator bar (Latch Blue when active), 13.5px label, the sidebar
   gradient behind the active row, 0.22s transitions. Bottom: gas sponsor
   credits card (62%) and the wallet button with its pulsing green dot.

   Under 1024px it becomes a drawer: fixed panel + scrim, focus trapped,
   Escape closes, and it is `inert` while closed so nothing inside is tabbable.
   ============================================================================ */

import { useRef } from 'react'
import { NavLink } from 'react-router-dom'
import type { ShellData } from '../data/shell.ts'
import { useFocusTrap } from '../lib/dom.ts'

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
        <div className="dapp-lockup">
          <img src="/brand/latch-mark-transparent.png" alt="" className="dapp-lockup__mark" />
          <span className="dapp-lockup__type">
            <span className="dapp-lockup__name">LATCH</span>
            <span className="dapp-lockup__tag">PROTOCOL</span>
          </span>
        </div>

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
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="dapp-sidebar__foot">
          <p className="dapp-sample-note">
            Sample data · not connected to any chain
          </p>
          <div className="dapp-credits">
            <p className="dapp-microlabel">{shell.gasCredits.label}</p>
            <div
              className="dapp-credits__track"
              role="progressbar"
              aria-label={shell.gasCredits.label}
              aria-valuenow={shell.gasCredits.pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className="dapp-credits__fill" style={{ width: `${shell.gasCredits.pct}%` }} />
            </div>
            <p className="dapp-credits__value">{shell.gasCredits.remaining}</p>
          </div>
          <button type="button" className="dapp-wallet">
            <span className="dapp-wallet__avatar" aria-hidden="true" />
            <span className="dapp-wallet__address">{shell.wallet.address}</span>
            <span className="dapp-dot dapp-dot--success dapp-dot--pulse" aria-hidden="true" />
            <span className="dapp-sr">Wallet connected (sample session)</span>
          </button>
        </div>
      </aside>
    </>
  )
}
