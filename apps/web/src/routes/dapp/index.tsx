/* ============================================================================
   Latch Protocol dapp — shell + seven nested screens.

   Built to "latch design/README.md" § 3. Dapp and SCREENS.md § C. The README
   is authoritative where the reference HTML disagrees with it.

   Mounted by src/App.tsx at /app/*; this module owns everything beneath that:

     /app                        Dashboard
     /app/swap                   Swap — quote and trade through a live pool
     /app/marketplace            Latch Marketplace
     /app/marketplace/:address   Latch Detail — one Latch, in full
     /app/ecosystem              Ecosystem — third-party projects building on Latch
                                 (a curated file, not a chain read; see data/ecosystem.ts)
     /app/deploy                 Deploy a Latch
     /app/pool                   Pool Detail
     /app/portfolio              Portfolio
     /app/protocol               Revenue Share — pools the connected address owns
     /app/protocol/:poolId       Revenue Share — one pool, in full (public)
     /app/protocol/:poolId/epochs  Revenue Share — the distributor's epochs
     /app/claim                  Claim — what a hook and its distributors owe
     /app/analytics              Analytics
     /app/governance             Governance — the Safe, both timelocks, ownership, queued ops
     /app/settings               Settings

   /app/explorer is not a screen. It is the marketplace's old path, kept purely
   as a redirect to /app/marketplace so shipped links do not break.

   EVERY FIGURE RENDERED HERE IS READ FROM CHAIN. There is no placeholder data
   left in this dapp — the mock modules that used to back Pool Detail, Portfolio,
   Analytics and Settings are deleted, not disabled. If a screen cannot reach the
   chain it says so; it does not fall back to an example.

   Latch Protocol's only deployment is on Ethereum Sepolia (chain 11155111); the
   other target chains are endpoint-verified but carry no contracts. The header
   chip says LIVE · TESTNET for exactly that pair of reasons.
   ============================================================================ */

import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { chainByKey } from '../../data/chains.ts'
import { Sidebar } from './components/Sidebar.tsx'
import { TopBar } from './components/TopBar.tsx'
import { loadShell } from './data/shell.ts'
import type { Screen } from './data/types.ts'
import { useMediaQuery } from './lib/dom.ts'
import { DAPP_BASE, dappPath } from './paths.ts'
import Analytics from './screens/Analytics.tsx'
import Claim from './screens/Claim.tsx'
import Dashboard from './screens/Dashboard.tsx'
import Deploy from './screens/Deploy.tsx'
import Ecosystem from './screens/Ecosystem.tsx'
import Explorer from './screens/Explorer.tsx'
import Governance from './screens/Governance.tsx'
import LatchDetail from './screens/LatchDetail.tsx'
import PoolDetail from './screens/PoolDetail.tsx'
import Portfolio from './screens/Portfolio.tsx'
import ProtocolEpochs from './screens/ProtocolEpochs.tsx'
import ProtocolPool from './screens/ProtocolPool.tsx'
import ProtocolRevenue from './screens/ProtocolRevenue.tsx'
import Settings from './screens/Settings.tsx'
import Swap from './screens/Swap.tsx'
import { DappStateProvider, useDapp } from './state.tsx'
import './dapp.css'

/** README § Dapp shell: the sidebar collapses to a drawer under ~1024px. */
const DRAWER_QUERY = '(max-width: 1023.98px)'

const SCREEN_BY_SEGMENT: Record<string, Screen> = {
  '': 'dashboard',
  swap: 'swap',
  marketplace: 'marketplace',
  /* `explorer` is the old segment. Kept in the map so a bookmarked or shared
     /app/explorer link still resolves the header and highlights the right nav
     row while the route below redirects it. */
  explorer: 'marketplace',
  ecosystem: 'ecosystem',
  deploy: 'deploy',
  pool: 'pool',
  portfolio: 'portfolio',
  /* `protocol/:poolId` and `protocol/:poolId/epochs` resolve through the
     first-segment fallback below, so only the bare segment is listed. */
  protocol: 'protocol',
  claim: 'claim',
  analytics: 'analytics',
  governance: 'governance',
  settings: 'settings',
}

function screenFromPath(pathname: string): Screen {
  const segment = pathname.replace(DAPP_BASE, '').replace(/^\/+|\/+$/g, '')
  // A Latch detail route is `marketplace/0x…`; it belongs to the marketplace
  // screen, so match on the first segment rather than the whole path.
  const first = segment.split('/')[0] ?? ''
  return SCREEN_BY_SEGMENT[segment] ?? SCREEN_BY_SEGMENT[first] ?? 'dashboard'
}

export default function DappShell() {
  const location = useLocation()
  return (
    <DappStateProvider screen={screenFromPath(location.pathname)}>
      <Shell />
    </DappStateProvider>
  )
}

function Shell() {
  const shell = useMemo(loadShell, [])
  const { screen, block, net, resetDeployment } = useDapp()
  const location = useLocation()
  const isDrawer = useMediaQuery(DRAWER_QUERY)
  const [navOpen, setNavOpen] = useState(false)

  /* The reference clears the simulation whenever the screen changes. */
  useEffect(() => {
    setNavOpen(false)
    resetDeployment()
  }, [location.pathname, resetDeployment])

  useEffect(() => {
    if (!isDrawer) setNavOpen(false)
  }, [isDrawer])

  const meta = shell.meta[screen]

  return (
    <div className={isDrawer ? 'dapp is-drawer' : 'dapp'}>
      <a className="dapp-skip" href="#dapp-content">
        Skip to content
      </a>

      <Sidebar
        shell={shell}
        base={DAPP_BASE}
        isDrawer={isDrawer}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="dapp-main">
        <TopBar
          meta={meta}
          block={block}
          net={chainByKey(net)}
          deployHref={dappPath('deploy')}
          isDrawer={isDrawer}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((open) => !open)}
        />

        <main id="dapp-content" className="dapp-content" key={location.pathname}>
          <Routes>
            <Route index element={<Dashboard />} />
            {/* The one route here that can move a user's funds. */}
            <Route path="swap" element={<Swap />} />
            <Route path="marketplace" element={<Explorer />} />
            <Route path="marketplace/:address" element={<LatchDetail />} />
            {/* Old path. Redirect rather than delete: the previous nav shipped
                /app/explorer, and a dead link is worse than a hop. */}
            <Route path="explorer" element={<Navigate to={dappPath('marketplace')} replace />} />
            <Route path="ecosystem" element={<Ecosystem />} />
            <Route path="deploy" element={<Deploy />} />
            <Route path="pool" element={<PoolDetail />} />
            <Route path="portfolio" element={<Portfolio />} />
            {/* Revenue share. `protocol` is public except for the owned-pools
                list; `protocol/:poolId` and its epoch timeline need no wallet. */}
            <Route path="protocol" element={<ProtocolRevenue />} />
            <Route path="protocol/:poolId" element={<ProtocolPool />} />
            <Route path="protocol/:poolId/epochs" element={<ProtocolEpochs />} />
            <Route path="claim" element={<Claim />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="governance" element={<Governance />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to={DAPP_BASE} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
