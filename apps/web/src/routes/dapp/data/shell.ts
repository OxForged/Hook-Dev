/* ============================================================================
   Dapp shell data — nav, header meta, sponsor credits, wallet, block height.
   SCREENS.md § C (shell + per-screen header table).

   MOCK SEAM: `loadShell()` is the only entry point. Replace its body with the
   real session/registry calls; the returned shape is the contract.
   ============================================================================ */

import type { Screen } from './types.ts'

export interface NavItem {
  screen: Screen
  label: string
  /** Decorative glyph; the visible label carries the accessible name. */
  icon?: import('../../../components/NavIcon').IconName
  /** Path relative to the dapp mount point. '' is the index route. */
  path: string
}

export interface ScreenMeta {
  title: string
  subtitle: string
}

export interface ShellData {
  nav: NavItem[]
  meta: Record<Screen, ScreenMeta>
  wallet: { address: string }
  /** Starting block height; the shell ticks it +1 every 4000ms (README). */
}

/** SCREENS.md § C: sidebar nav order. */
const nav: NavItem[] = [
  { screen: 'dashboard', label: 'Dashboard', path: '', icon: 'dashboard' },
  { screen: 'marketplace', label: 'Latch Marketplace', path: 'marketplace', icon: 'explorer' },
  { screen: 'deploy', label: 'Deploy a Latch', path: 'deploy', icon: 'deploy' },
  { screen: 'pool', label: 'Pool Detail', path: 'pool', icon: 'pool' },
  { screen: 'portfolio', label: 'Portfolio', path: 'portfolio', icon: 'portfolio' },
  { screen: 'protocol', label: 'Revenue Share', path: 'protocol', icon: 'revenue' },
  { screen: 'claim', label: 'Claim', path: 'claim', icon: 'claim' },
  { screen: 'analytics', label: 'Analytics', path: 'analytics', icon: 'analytics' },
  { screen: 'settings', label: 'Settings', path: 'settings', icon: 'settings' },
]

/** SCREENS.md § C: header title + subtitle per screen. */
const meta: Record<Screen, ScreenMeta> = {
  dashboard: { title: 'Dashboard', subtitle: 'Live from Ethereum Sepolia · testnet only' },
  marketplace: { title: 'Latch Marketplace', subtitle: 'On-chain registry · Sepolia' },
  deploy: { title: 'Deploy a Latch', subtitle: 'List a Latch in the on-chain registry' },
  /* No pair or fee here any more. This meta is static, and the screen reads the
     real pair, fee and vault balances off chain — a hardcoded "ETH / USDC · 0.05%"
     in the subtitle contradicted the "ltUSD / ltETH · 0.30%" the page itself
     rendered a few pixels below it. */
  pool: { title: 'Pool detail', subtitle: 'Live pool state, read from chain' },
  portfolio: { title: 'Portfolio', subtitle: 'Positions held by the connected address' },
  /* Read live off a RevShareHook. No hook is deployed on Sepolia yet, so the
     default state of both screens is an honest "nothing to read" rather than a
     zeroed dashboard — see lib/useHookRef.ts. */
  protocol: { title: 'Revenue share', subtitle: 'RevShareHook · pools, roster, epochs' },
  claim: { title: 'Claim', subtitle: 'What a RevShareHook and its distributors owe an address' },
  analytics: { title: 'Analytics', subtitle: 'Protocol-wide Latch activity' },
  settings: { title: 'Settings', subtitle: 'Account, network and API access' },
}

export function loadShell(): ShellData {
  return {
    nav,
    meta,
    wallet: { address: '0x8f2c…41ba' },
  }
}
