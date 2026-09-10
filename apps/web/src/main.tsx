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
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LatchWalletProvider>
  </StrictMode>,
)
