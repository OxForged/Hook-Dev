import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { LatchWalletProvider } from '@latchprotocol/connect'
// RainbowKit's own styles first, then the Latch overrides layered on top of
// them. Import order is load-bearing: ours win by coming second.
import '@rainbow-me/rainbowkit/styles.css'
import '@latchprotocol/connect/styles.css'

import './styles/tokens.css'
import App from './App.tsx'
import { DEFAULT_CHAIN, wagmiConfig } from './lib/wallet.ts'

// The provider wraps the whole router, not just /app: the landing page reads
// chain data too, and mounting it per-route would tear down the wagmi store on
// every navigation between the site and the dapp.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LatchWalletProvider config={wagmiConfig} initialChain={DEFAULT_CHAIN}>
      {/* The router has to be told the mount path too. Vite rewrites asset
          URLs for `base`, but it knows nothing about client-side routes: on a
          GitHub Pages project site the app is served from /<repo>/, and without
          a basename every <Link to="/docs"> points at the ORG root, which is
          not this app at all. `import.meta.env.BASE_URL` is exactly the value
          vite.config.ts computed, so the two cannot drift.

          BASE_URL always carries a trailing slash and react-router wants none,
          so it is trimmed — except at the root, where '' is the correct
          basename and '/' would be wrong. */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/+$/, '')}>
        <App />
      </BrowserRouter>
    </LatchWalletProvider>
  </StrictMode>,
)
