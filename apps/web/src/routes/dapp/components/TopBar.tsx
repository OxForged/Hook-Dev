/* ============================================================================
   Header — README § Dapp shell.
   Screen title (Chakra Petch 600 20px) + subtitle (12.5px), a mono
   "BLOCK 21,904,118" chip that increments every 4s behind a pulsing green dot,
   and the primary "Deploy Latch" button with its sheen sweep.

   Plus two pieces of truth-telling. The sample-data chip: every figure in this
   dapp is a placeholder, so the shell says so where a visitor reading the block
   height and the KPIs will see it. And the network chip: the selected chain
   with, next to it, whether Latch is actually deployed there. Ten of the eleven
   target chains carry no contracts, and the shell must not imply otherwise.
   ============================================================================ */

import { Link } from 'react-router-dom'
import { ChainMark } from '../../../components/ChainMark.tsx'
import type { ChainRow } from '../../../data/chains.ts'
import type { ScreenMeta } from '../data/shell.ts'

interface TopBarProps {
  meta: ScreenMeta
  block: number
  net: ChainRow
  deployHref: string
  isDrawer: boolean
  navOpen: boolean
  onToggleNav: () => void
}

export function TopBar({
  meta,
  block,
  net,
  deployHref,
  isDrawer,
  navOpen,
  onToggleNav,
}: TopBarProps) {
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
          title="Mixed data. KPIs, vault holdings, recent swaps and governance read live from Ethereum Sepolia; charts, activity feed, portfolio and analytics are still placeholders."
        >
          <span aria-hidden="true">PARTLY LIVE</span>
          <span className="dapp-sr">
            Partly live. KPIs, vault holdings, recent swaps and governance are read from the deployed Sepolia contracts. Charts, activity feed, portfolio and analytics are still placeholders.
          </span>
        </p>

        <p className="dapp-net-chip">
          <ChainMark brand={net.brand} size={18} className="dapp-net-chip__mark" />
          <span className="dapp-net-chip__name">{net.name}</span>
          <span className="dapp-net-chip__id tabular">{net.chainId}</span>
          <span
            className={net.deployed ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'}
          >
            {net.deployed ? 'DEPLOYED' : 'NO DEPLOYMENT'}
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
