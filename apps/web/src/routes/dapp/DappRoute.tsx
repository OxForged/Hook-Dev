/* ============================================================================
   The /app/* chunk boundary: the wallet stack and the dapp shell, together.

   Everything wallet-related lives behind this lazy import so the public site
   (landing, docs, brand, legal, verify) never downloads wagmi, RainbowKit or
   `@latchprotocol/connect`. None of those surfaces calls a wagmi hook — they
   read chain data through viem's public client in `lib/chain.ts` — and every
   module that DOES use wagmi (state.tsx, TopBar, SwapPanel, the write screens)
   is only reachable from `./index.tsx`, which is rendered only here, inside the
   provider.

   Provider lifetime: mounted for as long as the visitor is anywhere under
   /app/*, so moving between dapp screens never touches it. Leaving the dapp
   unmounts it. `wagmiConfig` is module-scoped (lib/wallet.ts), so its store and
   the persisted connection survive that; re-entering /app runs wagmi's
   reconnect-on-mount exactly as a page load does. The provider's QueryClient
   is per-mount, so cached wagmi reads are refetched on re-entry.
   ============================================================================ */

import { LatchWalletProvider } from '@latchprotocol/connect'
// RainbowKit's own styles first, then the Latch overrides layered on top of
// them. Import order is load-bearing: ours win by coming second. Both are
// scoped under `[data-rk]` / `.latch-*`, so nothing outside the dapp used them.
import '@rainbow-me/rainbowkit/styles.css'
import '@latchprotocol/connect/styles.css'

import { DEFAULT_CHAIN, wagmiConfig } from '../../lib/wallet.ts'
import DappShell from './index.tsx'

export default function DappRoute() {
  return (
    <LatchWalletProvider config={wagmiConfig} initialChain={DEFAULT_CHAIN}>
      <DappShell />
    </LatchWalletProvider>
  )
}
