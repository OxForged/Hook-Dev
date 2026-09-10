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
  gasCredits: { label: string; pct: number; remaining: string }
  wallet: { address: string }
  /** Starting block height; the shell ticks it +1 every 4000ms (README). */
}

/** SCREENS.md § C: sidebar nav order. */
const nav: NavItem[] = [
  { screen: 'dashboard', label: 'Dashboard', path: '', icon: 'dashboard' },
  { screen: 'explorer', label: 'Hook Explorer', path: 'explorer', icon: 'explorer' },
  { screen: 'deploy', label: 'Deploy a Hook', path: 'deploy', icon: 'deploy' },
  { screen: 'pool', label: 'Pool Detail', path: 'pool', icon: 'pool' },
  { screen: 'portfolio', label: 'Portfolio', path: 'portfolio', icon: 'portfolio' },
  { screen: 'analytics', label: 'Analytics', path: 'analytics', icon: 'analytics' },
  { screen: 'settings', label: 'Settings', path: 'settings', icon: 'settings' },
]

/** SCREENS.md § C: header title + subtitle per screen. */
const meta: Record<Screen, ScreenMeta> = {
  dashboard: { title: 'Dashboard', subtitle: 'Live from Ethereum Sepolia · testnet only' },
  explorer: { title: 'Latch Explorer', subtitle: 'On-chain registry · Sepolia' },
  deploy: { title: 'Deploy a Latch', subtitle: 'Register a hook against the protocol registry' },
  /* Sepolia, not Base: Base is a verified target with no Latch contracts on it. */
  pool: { title: 'Pool detail', subtitle: 'ETH / USDC · 0.05% · Ethereum Sepolia' },
  portfolio: { title: 'Portfolio', subtitle: '5 positions with latches attached' },
  analytics: { title: 'Analytics', subtitle: 'Protocol-wide hook activity' },
  settings: { title: 'Settings', subtitle: 'Account, network and API access' },
}

export function loadShell(): ShellData {
  return {
    nav,
    meta,
    gasCredits: { label: 'GAS SPONSOR CREDITS', pct: 62, remaining: '0.62 ETH remaining' },
    wallet: { address: '0x8f2c…41ba' },
  }
}
