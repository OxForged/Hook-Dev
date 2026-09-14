/* ============================================================================
   Header — README § Dapp shell.

   Screen title + subtitle, a mono block chip carrying the real chain head
   behind a pulsing green dot, and the primary "List a Latch" button — flat
   Option B blue, no sheen: B draws no decorative motion on a control.

   TYPE IS SET IN dapp.css, NOT HERE. The title is Option B's serif heading
   voice at 500, sized to the bar it shares with chips and a button;
   `.dapp-header__title` is the single place that decides it.

   Plus two pieces of truth-telling. The live chip: every figure in this dapp is
   read from the deployed contracts of the build's chain, and the chip says which
   network that is (MAINNET / TESTNET). And the network chip: that chain, with
   whether Latch is actually deployed there.

   Below the bar, two reference-price rails — crypto and US equities — sit side
   by side in `.dapp-tickers` above ~720px, and stack to full width below it.
   The equity rail renders only when VITE_FINNHUB_API_KEY is set. Its "not
   configured" line used to repeat on every screen; a missing build variable is
   a fact about the build, and it is stated ONCE, in Settings → Build
   configuration.

   THE NETWORK CHIPS NAME THE BUILD'S CHAIN, NOT THE SETTINGS PICK. They used to
   render whatever chain was picked on the Settings screen while every read
   still went to ACTIVE_CHAIN_ID, so picking Base produced "every figure is read
   from the deployed Base contracts" above Robinhood data. One build reads one
   chain, and the chips say which.

   The rails are external reference quotes, NOT Latch pool prices, and they say
   so — the pool price is read from `sqrtPriceX96` and lives in PoolPriceCard.

   The bar and the rails are one group (`.dapp-headwrap`) so they travel
   together rather than the prices sliding out from under the bar.

   THEY DO NOT TRAVEL, though — this comment claimed the group is sticky and it
   is not. `.dapp-headwrap` in dapp.css carries no `position: sticky`, and the
   rule above it explains at length why the header was UNPINNED: it is ~270px of
   status you read once, and pinning it spent a third of a 1080p viewport on
   chrome. The claim here was left behind by that change. Corrected rather than
   acted on: nothing should be made sticky on the strength of a stale comment.

   COMPACT, under 720px (`isCompact`). A phone got every piece of the desktop
   bar wrapped onto its own line — ~300px of chrome before the first card. The
   condensed bar is two rows:

     1  burger · title + subtitle · wallet button
     2  LIVE chip · network chip · block · crypto rail · equity rail

   Row 2 is ONE line that scrolls sideways inside itself (`.dapp-statusrow`),
   so it can never widen the page. It is a focusable, named region so a
   keyboard user can scroll it. Its order is the honesty order: the LIVE ·
   TESTNET chip is first and is on screen without scrolling at every width.
   Nothing is dropped, only moved: the chain switcher goes to the drawer foot
   (its absolutely positioned menu would be clipped by a scrolling row), and
   "List a Latch" is the drawer's "List a Latch" row.
   ============================================================================ */

import { Link } from 'react-router-dom'
import { LatchChainSwitcher, LatchConnectButton } from '@latchprotocol/connect'
import { ChainMark } from '../../../components/ChainMark.tsx'
import { IS_TESTNET_BUILD } from '../../../lib/chain'
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
  /** Under 720px: the two-row condensed bar. */
  isCompact: boolean
  navOpen: boolean
  onToggleNav: () => void
}

export function TopBar({
  meta,
  block,
  net,
  deployHref,
  isDrawer,
  isCompact,
  navOpen,
  onToggleNav,
}: TopBarProps) {
  const crypto = useMarketFeed(coinGeckoCrypto)
  const stocks = useMarketFeed(finnhubStocks)

  const burger = isDrawer ? (
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
  ) : null

  const titleBlock = (
    <div className="dapp-header__meta">
      <h1 className="dapp-header__title">{meta.title}</h1>
      <p className="dapp-header__subtitle">{meta.subtitle}</p>
    </div>
  )

  const sampleChip = (
    <p
      className="dapp-sample-chip"
      title={`Every figure in this dapp is read from the deployed ${net.name} contracts. Nothing here is sample data.`}
    >
      <span aria-hidden="true">{IS_TESTNET_BUILD ? 'LIVE · TESTNET' : 'LIVE · MAINNET'}</span>
      <span className="dapp-sr">
        Live. Every figure in this dapp is read from the deployed {net.name} contracts,
        and nothing here is sample data.
        {IS_TESTNET_BUILD ? ' Testnet only.' : ''}
      </span>
    </p>
  )

  const netChip = (
    <p className="dapp-net-chip">
      <ChainMark brand={net.brand} size={18} className="dapp-net-chip__mark" />
      <span className="dapp-net-chip__name">{net.name}</span>
      <span className="dapp-net-chip__id tabular">{net.chainId}</span>
      <span className={net.deployed ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'}>
        {net.deployed ? 'DEPLOYED' : 'NO DEPLOYMENT'}
      </span>
    </p>
  )

  const blockChip = (
    <p className="dapp-block">
      <span className="dapp-dot dapp-dot--success dapp-dot--pulse dapp-dot--sm" aria-hidden="true" />
      <span>{block === null ? 'BLOCK —' : `BLOCK ${block.toLocaleString('en-US')}`}</span>
    </p>
  )

  const rails = (
    <>
      <TickerStrip provider={coinGeckoCrypto} state={crypto} className="ltk--dapp dapp-tickers__rail" />
      {stocksConfigured() && (
        <>
          <span className="dapp-tickers__divider" aria-hidden="true" />
          <TickerStrip
            provider={finnhubStocks}
            state={stocks}
            configured
            className="ltk--dapp dapp-tickers__rail"
          />
        </>
      )}
    </>
  )

  if (isCompact) {
    return (
      <div className="dapp-headwrap dapp-headwrap--compact">
        <header className="dapp-header">
          {burger}
          {titleBlock}
          <div className="dapp-header__wallet">
            <LatchConnectButton variant="inline" />
          </div>
        </header>
        {/* A scroll container a keyboard can reach: tabIndex 0 plus a name. */}
        <div className="dapp-statusrow" role="region" aria-label="Network status and reference prices" tabIndex={0}>
          <div className="dapp-statusrow__chips">
            {sampleChip}
            {netChip}
            {blockChip}
          </div>
          <div className="dapp-tickers">{rails}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="dapp-headwrap">
      <header className="dapp-header">
        {burger}
        {titleBlock}

        <div className="dapp-header__right">
          {/* State chips: where the CONTRACTS are (sample-data disclosure, then
              network). Grouped separately from the interactive controls below
              so the two wrap as independent units — see dapp.css for why. */}
          <div className="dapp-header__status">
            {sampleChip}

            {/* Protocol state, NOT wallet state. This chip says where the CONTRACTS
                are; the two controls after it say where the WALLET is. Keeping them
                adjacent but distinct matters — this chip reading "Ethereum Sepolia"
                while a wallet sits on another network is the normal case, not a
                contradiction, and the pairing is what makes that legible. */}
            {netChip}
          </div>

          {/* Interactive controls: where the WALLET is, plus the primary action.
              The wallet lives HERE, in the header, because that is where every
              other dapp puts it and where a user looks for it. It was previously
              only at the foot of the sidebar — present, but past the seven nav
              rows and effectively undiscoverable. */}
          <div className="dapp-header__controls">
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

            {blockChip}

            <Link to={deployHref} className="dapp-btn dapp-btn--primary dapp-btn--sm">
              List a Latch
            </Link>
          </div>
        </div>
      </header>

      {/* Two honesty disclosures, one condensed row above ~720px — see
          `.dapp-tickers` in dapp.css. TickerStrip itself is untouched: each
          rail keeps its own accessible name and loading/unconfigured/error
          state, just narrower once there's room for both side by side. */}
      <div className="dapp-tickers">{rails}</div>
    </div>
  )
}
