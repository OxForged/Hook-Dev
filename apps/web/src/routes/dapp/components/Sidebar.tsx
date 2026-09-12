/* ============================================================================
   Sidebar — README § Dapp shell, ported to Canvas.
   238px, white surface on the paper ground (the lighter surface now — Canvas
   inverts the old dark-sidebar-on-dark-content depth cue). The active row is a
   flat `--active-nav` ground with `--sky-ink` text and a Latch Blue accent bar
   pinned to its left edge, not a gradient: a gradient built to fade into a dark
   ground reads as a faint smudge on white. 0.22s transitions.

   GROUPED, 2026-09-12. Twelve flat rows plus a collapsed "More" disclosure
   became five labelled blocks and a sixth for the exits. Where the groups come
   from and why each row sits where it does is written down in data/shell.ts,
   beside the rows themselves.

   The restyle takes the reference's STRUCTURE and not its palette. The
   reference is a dark rail; this shell is theme-aware and its sidebar is the
   light surface in light mode. Hard-coding the reference's ground would have
   produced a dark column against a paper page for every reader who has not
   asked for dark mode, so every colour here is still a token.

   The gas-sponsor credits card that used to sit here is gone. There is no gas
   sponsor, so a progress bar reading "0.62 ETH remaining" was a picture of a
   feature that does not exist - the same class of thing as an invented chart.

   Under 1024px it becomes a drawer: fixed panel + scrim, focus trapped,
   Escape closes, and it is `inert` while closed so nothing inside is tabbable.
   ============================================================================ */

import { ACTIVE_CHAIN_ID, DEPLOYMENTS, IS_TESTNET_BUILD } from '../../../lib/chain'
import { useRef } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { ShellData } from '../data/shell.ts'
import { useFocusTrap } from '../lib/dom.ts'
import { externalLinks } from '../data/shell'
import { NavIcon } from '../../../components/NavIcon'

/** Group headings become element ids for `aria-labelledby`, so they have to
 *  survive being renamed to something with a space or an ampersand in it. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

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

        {/* GROUPED, with a quiet micro-label over each block. The groups and the
            reasoning behind them live in data/shell.ts, next to the rows — a
            reader deciding whether "Claim" belongs under Revenue should not
            have to open a component to find out.

            Each list is named by its own heading via aria-labelledby rather
            than by a nested <nav>. Five landmarks in one column is five things
            a screen-reader user has to skip past; five named lists inside one
            "Screens" landmark is the same structure with none of that cost.
            The first block has no heading, so it is a bare list — an
            aria-label repeating "Dashboard, Swap" would be noise. */}
        <nav aria-label="Screens" className="dapp-navgroups">
          {shell.navGroups.map((group, i) => {
            const labelId = group.heading ? `dapp-navgroup-${slug(group.heading)}` : undefined
            return (
              <div className="dapp-navgroup" key={group.heading ?? `top-${i}`}>
                {group.heading ? (
                  <p className="dapp-navgroup__label" id={labelId}>
                    {group.heading}
                  </p>
                ) : null}
                <ul className="dapp-nav" aria-labelledby={labelId}>
                  {group.items.map((item) => (
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
                        {item.icon && <NavIcon name={item.icon} size={18} />}
                        <span className="dapp-nav__label">{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>

        {/* MORE: other properties, not screens of this app.

            NO LONGER A <details>. The disclosure was defended on the grounds
            that these are exits and an exit should not be the most prominent
            thing in a navigation column — which is right, and is now done by
            the same means every other block uses: a muted heading, at the
            bottom, below five groups. A collapsed toggle did not make them
            quieter than that; it made them invisible, and cost a click to
            discover four links that were never a secret. Everything the
            <details> was worth keeping for — keyboard operable, in the tab
            order, findable by find-in-page, working before JS settles — is
            true of a plain list and needs no toggle to be true.

            Every link carries rel="noopener noreferrer". `noopener` is the
            load-bearing half: without it the opened page receives
            window.opener and can navigate THIS tab to somewhere of its
            choosing, which on a wallet-connected dapp is a phishing primitive
            rather than a curiosity. */}
        <nav aria-label="Other Latch properties" className="dapp-navgroup dapp-navgroup--more">
          <p className="dapp-navgroup__label" id="dapp-navgroup-more">
            More
          </p>
          <ul className="dapp-nav" aria-labelledby="dapp-navgroup-more">
            {externalLinks.map((link) => (
              <li key={link.href}>
                <a
                  className="dapp-nav__row dapp-nav__row--ext"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                >
                  {/* No `.dapp-nav__bar` here. The accent bar marks the row you
                      are standing on, and you can never be standing on an exit
                      — an element that exists only to stay transparent is a
                      node somebody later wires up by mistake. */}
                  <NavIcon name={link.icon} size={18} />
                  <span className="dapp-nav__stack">
                    <span className="dapp-nav__label">
                      {link.label}
                      {/* Inline, immediately after the words, at label size —
                          not parked at the far right where it reads as a
                          separate control. Decorative: the accessible name
                          below says "opens in a new tab" in words, because a
                          glyph is not an announcement. */}
                      <NavIcon name="external" size={12} />
                    </span>
                    <span className="dapp-nav__note">{link.note}</span>
                  </span>
                  <span className="dapp-visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="dapp-sidebar__foot">
          <p className="dapp-sample-note">
            Live on {DEPLOYMENTS[ACTIVE_CHAIN_ID].name}
            {IS_TESTNET_BUILD ? ' · testnet only' : ''}
          </p>
          {/* The wallet control moved to the header (TopBar). It sat here, below
              seven nav rows, where nobody looked for it — and a second copy would
              be worse than one in the wrong place. */}
        </div>
      </aside>
    </>
  )
}
