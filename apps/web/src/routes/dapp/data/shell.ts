/* ============================================================================
   Dapp shell — nav rows and per-screen header titles.
   SCREENS.md § C (shell + per-screen header table).

   NOT a mock seam any more, and not a data source. What survives here is static
   CHROME: the nav labels, their routes and icons, and a title/subtitle per
   screen. Every figure the shell displays — block height, network, wallet — is
   read live by the components that render it.

   A subtitle here must not state anything that can change on chain. One did:
   "ETH / USDC · 0.05%" sat above a Pool Detail screen rendering "ltUSD / ltETH ·
   0.30%" read from the pool itself. Static copy cannot describe live data.

   A CHAIN NAME IS SUCH A THING. The marketplace subtitle read "· Sepolia" while
   the live deployment moved to Robinhood Chain, so it is derived from
   DEPLOYMENTS[ACTIVE_CHAIN_ID] like the dashboard's already was. Never write a
   chain name as a literal in this file.

   THE FAKE WALLET IS GONE. `wallet: { address: '0x8f2c…41ba' }` was an invented
   address that no component read. Nothing rendered it, which is exactly why it
   survived — an unused fiction is a fiction somebody wires up later. The real
   address comes from wagmi, at the component that shows it.
   ============================================================================ */

import { ACTIVE_CHAIN_ID, DEPLOYMENTS, IS_TESTNET_BUILD } from '../../../lib/chain'
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
}

/** SCREENS.md § C: sidebar nav order. */
const nav: NavItem[] = [
  { screen: 'dashboard', label: 'Dashboard', path: '', icon: 'dashboard' },
  /* Second, directly under the dashboard: it is the only row here that trades,
     and burying the one thing a visitor arrives wanting to do below eight
     read-only screens would be a strange way to present a DEX. */
  { screen: 'swap', label: 'Swap', path: 'swap', icon: 'pool' },
  { screen: 'marketplace', label: 'Latch Marketplace', path: 'marketplace', icon: 'explorer' },
  { screen: 'ecosystem', label: 'Ecosystem', path: 'ecosystem', icon: 'ecosystem' },
  { screen: 'deploy', label: 'Deploy a Latch', path: 'deploy', icon: 'deploy' },
  { screen: 'pool', label: 'Pool Detail', path: 'pool', icon: 'pool' },
  { screen: 'portfolio', label: 'Portfolio', path: 'portfolio', icon: 'portfolio' },
  { screen: 'protocol', label: 'Revenue Share', path: 'protocol', icon: 'revenue' },
  { screen: 'claim', label: 'Claim', path: 'claim', icon: 'claim' },
  { screen: 'analytics', label: 'Analytics', path: 'analytics', icon: 'analytics' },
  { screen: 'governance', label: 'Governance', path: 'governance', icon: 'docs' },
  { screen: 'settings', label: 'Settings', path: 'settings', icon: 'settings' },
]

/** SCREENS.md § C: header title + subtitle per screen. */
const meta: Record<Screen, ScreenMeta> = {
  dashboard: {
    title: 'Dashboard',
    subtitle: `Live from ${DEPLOYMENTS[ACTIVE_CHAIN_ID].name}${IS_TESTNET_BUILD ? ' · testnet only' : ''}`,
  },
  /* No pair, no fee and no chain in this subtitle. Which pools exist, what
     they charge and whether the router is even accepting swaps are all chain
     reads, and the screen makes every one of them — static copy here could
     only contradict it. */
  swap: {
    title: 'Swap',
    subtitle: 'Quoted from CLQuoter, routed through UniversalRouter',
  },
  marketplace: {
    title: 'Latch Marketplace',
    subtitle: `On-chain registry · ${DEPLOYMENTS[ACTIVE_CHAIN_ID].name}`,
  },
  /* Not a chain read and the subtitle says so — the one screen in the dapp whose
     data is a curated file, submitted by the projects themselves. */
  ecosystem: { title: 'Ecosystem', subtitle: 'Projects building on Latch · self-submitted, not verified' },
  deploy: { title: 'Deploy a Latch', subtitle: 'List a Latch in the on-chain registry' },
  /* No pair or fee here any more. This meta is static, and the screen reads the
     real pair, fee and vault balances off chain — a hardcoded "ETH / USDC · 0.05%"
     in the subtitle contradicted the "ltUSD / ltETH · 0.30%" the page itself
     rendered a few pixels below it. */
  pool: { title: 'Pool detail', subtitle: 'Live pool state, read from chain' },
  portfolio: { title: 'Portfolio', subtitle: 'Positions held by the connected address' },
  /* Read live off a RevShareHook. No hook is deployed on the active chain yet,
     so the default state of both screens is an honest "nothing to read" rather
     than a zeroed dashboard — see lib/useHookRef.ts. */
  protocol: { title: 'Revenue share', subtitle: 'RevShareHook · pools, roster, epochs' },
  claim: { title: 'Claim', subtitle: 'What a RevShareHook and its distributors owe an address' },
  analytics: { title: 'Analytics', subtitle: 'Protocol-wide Latch activity' },
  /* No chain named here on purpose — the Safe, the timelocks and who owns what
     differ between Sepolia and Robinhood, and a static subtitle cannot say
     which is true for the chain currently selected without risking the same
     drift the pool subtitle was fixed for above. */
  governance: { title: 'Governance', subtitle: 'The Safe, both timelocks, and every queued operation' },
  /* Not "Account and API access": there is no account system and no Latch API.
     The screen itself says so — a subtitle promising both contradicted it. */
  settings: { title: 'Settings', subtitle: 'Networks, RPC endpoints and build configuration' },
}

export function loadShell(): ShellData {
  return { nav, meta }
}
