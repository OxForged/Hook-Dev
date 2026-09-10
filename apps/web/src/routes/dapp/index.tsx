/* ============================================================================
   Latch Protocol dapp — shell + seven nested screens.

   Built to "latch design/README.md" § 3. Dapp and SCREENS.md § C. The README
   is authoritative where the reference HTML disagrees with it.

   Mounted by src/App.tsx at /app/*; this module owns everything beneath that:

     /app             Dashboard
     /app/explorer    Hook Explorer
     /app/deploy      Deploy a Hook
     /app/pool        Pool Detail
     /app/portfolio   Portfolio
     /app/analytics   Analytics
     /app/settings    Settings

   Every figure rendered here is placeholder data from `./data/*`. Latch
   Protocol's only deployment is on Ethereum Sepolia (chain 11155111); the other
   ten target chains carry no contracts at all. The header carries a SAMPLE DATA
   chip plus a network chip stating the selected chain's deployment status, and
   the sidebar a matching note, so no visitor reads these as live metrics.
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
import Dashboard from './screens/Dashboard.tsx'
import Deploy from './screens/Deploy.tsx'
import Explorer from './screens/Explorer.tsx'
import LatchDetail from './screens/LatchDetail.tsx'
import PoolDetail from './screens/PoolDetail.tsx'
import Portfolio from './screens/Portfolio.tsx'
import Settings from './screens/Settings.tsx'
import { DappStateProvider, useDapp } from './state.tsx'
import './dapp.css'

/** README § Dapp shell: the sidebar collapses to a drawer under ~1024px. */
const DRAWER_QUERY = '(max-width: 1023.98px)'

const SCREEN_BY_SEGMENT: Record<string, Screen> = {
  '': 'dashboard',
  marketplace: 'marketplace',
  /* `explorer` is the old segment. Kept in the map so a bookmarked or shared
     /app/explorer link still resolves the header and highlights the right nav
     row while the route below redirects it. */
  explorer: 'marketplace',
  deploy: 'deploy',
  pool: 'pool',
  portfolio: 'portfolio',
  analytics: 'analytics',
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
            <Route path="marketplace" element={<Explorer />} />
            <Route path="marketplace/:address" element={<LatchDetail />} />
            {/* Old path. Redirect rather than delete: the previous nav shipped
                /app/explorer, and a dead link is worse than a hop. */}
            <Route path="explorer" element={<Navigate to={dappPath('marketplace')} replace />} />
            <Route path="deploy" element={<Deploy />} />
            <Route path="pool" element={<PoolDetail />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to={DAPP_BASE} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
