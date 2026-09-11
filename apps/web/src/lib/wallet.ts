/* ============================================================================
   The app's single wagmi config.

   Module-scoped on purpose. `createLatchConfig` builds every connector, so
   calling it inside a component re-creates them on each mount — StrictMode's
   double-invoke, an HMR boundary or a route remount would then drop a live
   wallet session and re-prompt the user. Built once here, imported everywhere.

   CHAINS: Sepolia only, deliberately, even though `LATCH_CHAINS` lists eleven.
   `DEPLOYMENTS` in `lib/chain.ts` has exactly one entry, so every other chain
   in that list is somewhere the dapp can read nothing and write nothing. A
   network switcher that offers ten dead networks is the same class of lie as a
   chart of invented numbers: it looks like a capability and isn't one. When a
   second deployment lands, add it to `DEPLOYMENTS` and to `WALLET_CHAINS`
   together — never one without the other.
   ============================================================================ */

import { createLatchConfig, hasWalletConnect, sepolia } from '@latchprotocol/connect'
import type { Chain } from 'viem'

import { DEPLOYMENTS, SEPOLIA_CHAIN_ID } from './chain'

/** Chains the wallet may connect to. Must stay in step with `DEPLOYMENTS`. */
export const WALLET_CHAINS: readonly [Chain, ...Chain[]] = [sepolia]

/**
 * Guard against the two lists drifting apart. Cheap, runs once at module load,
 * and turns a silent "why can't I switch to that network" into a loud failure
 * during development.
 */
if (import.meta.env.DEV) {
  const deployed = Object.keys(DEPLOYMENTS).map(Number).sort()
  const offered = WALLET_CHAINS.map((c) => c.id).sort()
  if (deployed.join() !== offered.join()) {
    console.warn(
      `[wallet] chain lists disagree — DEPLOYMENTS has [${deployed}], the wallet offers [${offered}]. ` +
        'A chain in one but not the other is a network the user can select but the dapp cannot use.',
    )
  }
}

export const wagmiConfig = createLatchConfig({
  chains: WALLET_CHAINS,
  appName: 'Latch Protocol',
  appDescription: 'Hooks platform for AMMs, launchpads, stock pairs and revenue share.',
  appUrl: 'https://latch.guru',
  appIcon: 'https://latch.guru/brand/app-icon-512.png',
})

/** The chain a fresh connection targets. */
export const DEFAULT_CHAIN: Chain = sepolia

export { SEPOLIA_CHAIN_ID }

/**
 * False when `VITE_WALLETCONNECT_PROJECT_ID` is unset, in which case the connect
 * modal offers browser wallets only. Surfaced in the UI so the absence reads as
 * a configuration state rather than a broken WalletConnect row.
 */
export const walletConnectEnabled = hasWalletConnect()
