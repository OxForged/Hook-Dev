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
import { LatchChainSwitcher, LatchConnectButton } from '@latchprotocol/connect'
import { ChainMark } from '../../../components/ChainMark.tsx'
import { TickerStrip } from '../../../components/TickerStrip.tsx'
import { CHAIN_ROWS, type ChainRow } from '../../../data/chains.ts'
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
            title="Every figure in this dapp is read from the deployed Ethereum Sepolia contracts. Nothing here is sample data. Testnet only — there is no mainnet deployment."
          >
            <span aria-hidden="true">LIVE · TESTNET</span>
            <span className="dapp-sr">
              Live. Every figure in this dapp is read from the deployed Ethereum Sepolia contracts, and nothing here is sample data. Testnet only — there is no mainnet deployment.
            </span>
          </p>

          {/* Protocol state, NOT wallet state. This chip says where the CONTRACTS
              are; the two controls after it say where the WALLET is. Keeping them
              adjacent but distinct matters — this chip reading "Ethereum Sepolia"
              while a wallet sits on another network is the normal case, not a
              contradiction, and the pairing is what makes that legible. */}
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

          {/* The wallet lives HERE, in the header, because that is where every
              other dapp puts it and where a user looks for it. It was previously
              only at the foot of the sidebar — present, but past the seven nav
              rows and effectively undiscoverable. */}
          {/* The switcher ships no logos on purpose: packages/connect is a standalone
              MIT package and must not reach into this app's public/ directory. It
              takes a render prop instead, and we hand it the same ChainMark the rest
              of the dapp uses — so an unmapped chain falls back to the package's own
              monogram rather than a broken image. */}
          <LatchChainSwitcher
            className="dapp-header__chain"
            renderIcon={(chain) => {
              const row = CHAIN_ROWS.find((r) => r.chainId === chain.id)
              return row ? <ChainMark brand={row.brand} size={18} /> : null
            }}
          />
          <LatchConnectButton variant="inline" />

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
