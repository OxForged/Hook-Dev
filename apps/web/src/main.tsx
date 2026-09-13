import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './styles/tokens.css'
// Global, not dapp-scoped, despite living under routes/dapp. Shared primitives
// rendered OUTSIDE the dapp take their styles from it: ChainTag (`.chain-tag*`,
// `.dapp-sr`) and the `.dapp-badge*` classes on the landing's ecosystem cards,
// the series charts (`.dapp-series`, `.dapp-gauge`, `.dapp-bitgrid`…) in docs
// and verify, and the loading/error states in components/RouteBoundary.tsx.
// Before route splitting it reached those pages by accident, as part of one
// bundle; importing it here keeps that true now that the dapp is its own chunk.
import './routes/dapp/dapp.css'
import App from './App.tsx'
import { ROUTER_BASENAME, preloadInitialRoute } from './routes/table.ts'

// The wallet provider (wagmi, RainbowKit, @latchprotocol/connect) is NOT
// mounted here. It wraps /app/* only — see routes/dapp/DappRoute.tsx — so the
// public site never downloads it. Nothing outside the dapp calls a wagmi hook;
// the landing, docs and verify pages read chain data through viem directly.

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* The router has to be told the mount path too. Vite rewrites asset
          URLs for `base`, but it knows nothing about client-side routes: on a
          GitHub Pages project site the app is served from /<repo>/, and without
          a basename every <Link to="/docs"> points at the ORG root, which is
          not this app at all. ROUTER_BASENAME is derived from
          `import.meta.env.BASE_URL`, exactly the value vite.config.ts computed,
          so the two cannot drift. */}
      <BrowserRouter basename={ROUTER_BASENAME}>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

// Fetch the chunk for the page the URL points at before the first render, so
// a public page paints once rather than as a loading state followed by the
// page. Never rejects; a failed chunk surfaces through RouteErrorBoundary.
void preloadInitialRoute(window.location.pathname).then(render)
