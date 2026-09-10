/* ============================================================================
   Header — README § Dapp shell.
   Screen title (Chakra Petch 600 20px) + subtitle (12.5px), a mono
   "BLOCK 21,904,118" chip that increments every 4s behind a pulsing green dot,
   and the primary "Deploy Latch" button with its sheen sweep.

   Plus the sample-data chip: every figure in this dapp is a placeholder and the
   protocol is not deployed on any chain, so the shell says so where a visitor
   reading the block height and the KPIs will see it.
   ============================================================================ */

import { Link } from 'react-router-dom'
import type { ScreenMeta } from '../data/shell.ts'

interface TopBarProps {
  meta: ScreenMeta
  block: number
  deployHref: string
  isDrawer: boolean
  navOpen: boolean
  onToggleNav: () => void
}

export function TopBar({ meta, block, deployHref, isDrawer, navOpen, onToggleNav }: TopBarProps) {
  return (
    <header className="dapp-header">
      {isDrawer ? (
        <button
          type="button"
          className="dapp-burger"
          aria-expanded={navOpen}
          aria-controls="dapp-nav"
          onClick={onToggleNav}
        >
          <span className="dapp-burger__bars" aria-hidden="true" />
          <span className="dapp-sr">{navOpen ? 'Close navigation' : 'Open navigation'}</span>
        </button>
      ) : null}

      <div className="dapp-header__meta">
        <h1 className="dapp-header__title">{meta.title}</h1>
        <p className="dapp-header__subtitle">{meta.subtitle}</p>
      </div>

      <div className="dapp-header__right">
        <p
          className="dapp-sample-chip"
          title="Every figure in this app is placeholder data. Latch Protocol is not deployed on any chain."
        >
          <span aria-hidden="true">SAMPLE DATA</span>
          <span className="dapp-sr">
            Sample data. Every figure in this app is a placeholder — Latch Protocol is not deployed
            on any chain.
          </span>
        </p>

        <p className="dapp-block">
          <span className="dapp-dot dapp-dot--success dapp-dot--pulse dapp-dot--sm" aria-hidden="true" />
          <span>BLOCK {block.toLocaleString('en-US')}</span>
        </p>

        <Link to={deployHref} className="dapp-btn dapp-btn--primary dapp-btn--sm">
          Deploy Latch
          <span className="dapp-sheen" aria-hidden="true" />
        </Link>
      </div>
    </header>
  )
}
