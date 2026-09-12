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

/**
 * One labelled block of nav rows.
 *
 * WHY THERE IS NO `soon` FLAG ON `NavItem`, and why nothing here is badged.
 *
 * The restyle brief called for a right-aligned SOON badge on rows that are not
 * yet available. Every one of these twelve rows resolves to a screen that reads
 * the live deployment: Swap builds real router calldata, Deploy sends a real
 * `register` transaction, and Revenue Share and Claim both resolve a
 * `RevShareHook` from `DEPLOYMENTS` on either chain. There is nothing here to
 * badge, so there is no badge — a SOON on a working screen is the same class of
 * claim as an invented figure, and a flag that no row sets is a flag somebody
 * sets wrongly later.
 *
 * If a row ever is genuinely unavailable, the honest version is a `soon` field
 * here plus a `.dapp-nav__soon` span in Sidebar.tsx — not a badge decided in the
 * component, where nobody reviewing this file would see it.
 */
export interface NavGroup {
  /**
   * Micro-label above the group, or `null` for rows that sit at the top of the
   * rail with nothing over them. Written in sentence case and uppercased by the
   * stylesheet: a screen reader reading the DOM should get a word, not letters.
   */
  readonly heading: string | null
  readonly items: readonly NavItem[]
}

export interface ScreenMeta {
  title: string
  subtitle: string
}

export interface ShellData {
  navGroups: readonly NavGroup[]
  meta: Record<Screen, ScreenMeta>
}

/**
 * The "More" menu: other properties, not screens of this app.
 *
 * Deliberately NOT `NavItem`. That type is keyed by `screen: Screen` and its
 * `path` is relative to the dapp mount point, because every row it describes is
 * a route this router owns. Forcing an off-site URL through it would mean
 * inventing a fake `Screen` and a `path` that is not a path, and the first
 * person to iterate `nav` looking for routes would find four entries that are
 * not routes. A different kind of destination gets a different type.
 *
 * These open in a new tab, which is the one case where `target="_blank"` is
 * right: the reader is leaving for a sibling product, not navigating within
 * this one, and a wallet-connected session is an expensive thing to lose to a
 * misplaced click. `rel="noopener noreferrer"` is not optional on any of them —
 * without `noopener` the opened page gets a handle on `window.opener` and can
 * navigate this tab somewhere else, which is a phishing primitive, not a
 * theoretical one.
 */
export interface ExternalLink {
  readonly label: string
  readonly href: string
  readonly icon: import('../../../components/NavIcon').IconName
  /** Shown under the label. What the destination IS, not marketing copy. */
  readonly note: string
}

export const externalLinks: readonly ExternalLink[] = [
  { label: 'Launchpad', href: 'https://peddles.xyz', note: 'peddles.xyz', icon: 'launch' },
  { label: 'PeddleSwap', href: 'https://peddleswap.xyz', note: 'peddleswap.xyz', icon: 'swap' },
  { label: 'PeddleQuest', href: 'https://peddlequest.xyz', note: 'peddlequest.xyz', icon: 'quest' },
  /* http, not https, as supplied. A page served over https that links to http
     is a downgrade: some browsers warn, some strip the referrer, and a few
     block it outright. Left exactly as given rather than silently "corrected"
     to https, because a guessed scheme that 404s is worse than an honest
     downgrade — but it is worth fixing at the source. */
  { label: 'Terminal', href: 'http://peddlex.xyz', note: 'peddlex.xyz', icon: 'terminal' },
]

/**
 * SCREENS.md § C: sidebar nav order, now in five blocks instead of one run.
 *
 * WHY GROUP AT ALL. Twelve equal rows is a list you read from the top every
 * time, because nothing in it tells you where to stop looking. The headings do
 * not add information about any single row — they tell you which four rows you
 * can ignore, which is the whole job of a nav column that no longer fits on one
 * glance. They are also what pays for the taller rows: a labelled block of
 * three scans faster than an unlabelled run of twelve, so the extra height buys
 * something rather than just spending the column.
 *
 * THE GROUPS, AND THE QUESTION EACH ONE ANSWERS.
 *
 *   (no heading)  Dashboard, Swap — where you land, and the one thing you came
 *                 to do. Deliberately above the first heading rather than
 *                 inside a "General" group: they are not a category, they are
 *                 the two rows that must never be hunted for.
 *   Latches       Which Latches exist, how to publish one, and who is shipping
 *                 them. The product noun, and everything about the artefact
 *                 itself rather than about a pool or an address.
 *   Liquidity     One pool's live state, and the positions the connected
 *                 address holds in pools. Both are "what is in the Vault".
 *   Revenue       What a RevShareHook has taken and what it owes an address.
 *                 Split from Liquidity because fees accrued are not a position
 *                 — claiming is a separate act with a separate contract.
 *   Protocol      Protocol-wide totals, who controls the contracts, and which
 *                 chain and endpoints this build is talking to. The three rows
 *                 nobody visits mid-task.
 *
 * Nothing is grouped alone. Ecosystem moved one row later (it now follows
 * Deploy rather than preceding it) because "browse, publish, then see who
 * else has" is the order a reader walks that block in; no other row moved.
 */
const navGroups: readonly NavGroup[] = [
  {
    heading: null,
    items: [
      { screen: 'dashboard', label: 'Dashboard', path: '', icon: 'dashboard' },
      /* Second, directly under the dashboard: it is the only row here that
         trades, and burying the one thing a visitor arrives wanting to do below
         eight read-only screens would be a strange way to present a DEX. */
      { screen: 'swap', label: 'Swap', path: 'swap', icon: 'swap' },
    ],
  },
  {
    heading: 'Latches',
    items: [
      { screen: 'marketplace', label: 'Latch Marketplace', path: 'marketplace', icon: 'explorer' },
      { screen: 'deploy', label: 'Deploy a Latch', path: 'deploy', icon: 'deploy' },
      { screen: 'ecosystem', label: 'Ecosystem', path: 'ecosystem', icon: 'ecosystem' },
    ],
  },
  {
    heading: 'Liquidity',
    items: [
      { screen: 'pool', label: 'Pool Detail', path: 'pool', icon: 'pool' },
      { screen: 'portfolio', label: 'Portfolio', path: 'portfolio', icon: 'portfolio' },
    ],
  },
  {
    heading: 'Revenue',
    items: [
      { screen: 'protocol', label: 'Revenue Share', path: 'protocol', icon: 'revenue' },
      { screen: 'claim', label: 'Claim', path: 'claim', icon: 'claim' },
    ],
  },
  {
    heading: 'Protocol',
    items: [
      { screen: 'analytics', label: 'Analytics', path: 'analytics', icon: 'analytics' },
      { screen: 'governance', label: 'Governance', path: 'governance', icon: 'governance' },
      { screen: 'settings', label: 'Settings', path: 'settings', icon: 'settings' },
    ],
  },
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
  return { navGroups, meta }
}
