/* ============================================================================
   Header — README § Dapp shell.
   Screen title (Chakra Petch 600 20px) + subtitle (12.5px), a mono block chip
   carrying the real Sepolia head behind a pulsing green dot,
   and the primary "Deploy Latch" button with its sheen sweep.

   Plus two pieces of truth-telling. The sample-data chip: every figure in this
   dapp is a placeholder, so the shell says so where a visitor reading the block
   height and the KPIs will see it. And the network chip: the selected chain
   with, next to it, whether Latch is actually deployed there. Ten of the eleven
   target chains carry no contracts, and the shell must not imply otherwise.

   Below the bar, two full-bleed reference-price rails — crypto and US equities.
   BOTH render here unconditionally, including the equity rail's "not
   configured" line when VITE_FINNHUB_API_KEY is unset. That is the difference
   from the landing header, which hides the equity rail in that case: the dapp's
   reader is an operator, for whom a missing build variable is an actionable
   fact rather than a broken promise on a marketing page.

   The rails are external reference quotes, NOT Latch pool prices, and they say
   so — the pool price is read from `sqrtPriceX96` and lives in PoolPriceCard.

   The whole group is sticky as one unit (`.dapp-headwrap`), so the bar and the
   rails travel together instead of the prices sliding out from under the bar.
   ============================================================================ */

import { Link } from 'react-router-dom'
import { ChainMark } from '../../../components/ChainMark.tsx'
import { TickerStrip } from '../../../components/TickerStrip.tsx'
import type { ChainRow } from '../../../data/chains.ts'
import {
  coinGeckoCrypto,
  finnhubStocks,
  stocksConfigured,
  useMarketFeed,
} from '../../../lib/prices.ts'
import type { ScreenMeta } from '../data/shell.ts'

interface TopBarProps {
  meta: ScreenMeta
  block: number | null
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
  const crypto = useMarketFeed(coinGeckoCrypto)
  const stocks = useMarketFeed(finnhubStocks)

  return (
    <div className="dapp-headwrap">
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
            title="Mixed data. The dashboard, Latch Marketplace, analytics, portfolio, registration and the live pool price all read from the deployed Ethereum Sepolia contracts. Two things are still sample data: the Pool Detail header strip and the Settings screen."
          >
            <span aria-hidden="true">PARTLY LIVE</span>
            <span className="dapp-sr">
              Partly live. The dashboard, Latch Marketplace, analytics, portfolio, Latch registration and the live pool price are read from the deployed Sepolia contracts. Two things are still sample data: the Pool Detail header strip and the Settings screen.
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
            <span>{block === null ? 'BLOCK —' : `BLOCK ${block.toLocaleString('en-US')}`}</span>
          </p>

          <Link to={deployHref} className="dapp-btn dapp-btn--primary dapp-btn--sm">
            Deploy Latch
            <span className="dapp-sheen" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <TickerStrip provider={coinGeckoCrypto} state={crypto} className="ltk--dapp" />
      <TickerStrip
        provider={finnhubStocks}
        state={stocks}
        configured={stocksConfigured()}
        className="ltk--dapp"
      />
    </div>
  )
}
