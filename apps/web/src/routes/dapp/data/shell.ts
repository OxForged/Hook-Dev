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
  block: number
}

/** SCREENS.md § C: sidebar nav order. */
const nav: NavItem[] = [
  { screen: 'dashboard', label: 'Dashboard', path: '' },
  { screen: 'explorer', label: 'Hook Explorer', path: 'explorer' },
  { screen: 'deploy', label: 'Deploy a Hook', path: 'deploy' },
  { screen: 'pool', label: 'Pool Detail', path: 'pool' },
  { screen: 'portfolio', label: 'Portfolio', path: 'portfolio' },
  { screen: 'analytics', label: 'Analytics', path: 'analytics' },
  { screen: 'settings', label: 'Settings', path: 'settings' },
]

/** SCREENS.md § C: header title + subtitle per screen. */
const meta: Record<Screen, ScreenMeta> = {
  dashboard: { title: 'Dashboard', subtitle: 'Your latches across 4 networks' },
  explorer: { title: 'Latch Explorer', subtitle: '1,840 latches · 1,612 verified' },
  deploy: { title: 'Deploy a Latch', subtitle: 'Register a hook against the protocol registry' },
  pool: { title: 'Pool detail', subtitle: 'ETH / USDC · 0.05% · Base' },
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
    block: 21904118,
  }
}
