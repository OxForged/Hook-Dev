/**
 * Landing-page content and figures.
 *
 * EVERYTHING NUMERIC IN THIS FILE IS A PLACEHOLDER. Latch Protocol is not
 * deployed, so none of these are live protocol metrics — the UI labels the
 * activity section accordingly. This module is the seam: replace the bodies
 * below with registry / subgraph reads and the components need no changes.
 *
 * Copy and ordering follow "latch design/SCREENS.md" § A. Landing page.
 */

/* ------------------------------------------------------------------ tones */

/** Data-series tones. Components map these to token-backed CSS classes so a
 *  hex never reaches a component or this module. */
export type Tone = 'primary' | 'signal' | 'violet' | 'success' | 'amber'

/* ------------------------------------------------------------------ header */

export interface NavItem {
  readonly label: string
  /** Router path when internal, `#anchor` when it targets this page. */
  readonly href: string
  readonly active?: boolean
}

export const NAV: readonly NavItem[] = [
  { label: 'Home', href: '#home', active: true },
  { label: 'Developers', href: '#developers' },
  { label: 'Docs', href: '/docs' },
  { label: 'Ecosystem', href: '#ecosystem' },
  { label: 'About', href: '#about' },
  { label: 'Brand Kit', href: '/brand' },
]

/** Route targets. Placeholders until the real repo / audit pages exist. */
export const LINKS = {
  docs: '/docs',
  brand: '/brand',
  app: '/app',
  github: '#github',
  audits: '#audit',
} as const

/* -------------------------------------------------------------------- hero */

export interface HeroNode {
  readonly label: string
  /** Percentage offsets inside the 520px graph box. */
  readonly x: number
  readonly y: number
}

export const HERO_NODES: readonly HeroNode[] = [
  { label: 'LENDING', x: 20, y: 4 },
  { label: 'NFTs', x: 74, y: 10 },
  { label: 'GAMING', x: 80, y: 46 },
  { label: 'DeFi', x: 70, y: 84 },
  { label: 'RWA', x: 8, y: 78 },
  { label: 'AMM', x: 0, y: 40 },
]

/* ------------------------------------------------------------- stats strip */

export interface Stat {
  readonly value: string
  readonly label: string
}

/** Placeholder figures — see the file header. */
export const STATS: readonly Stat[] = [
  { value: '$412M', label: 'VALUE ROUTED THROUGH LATCHES' },
  { value: '1,840', label: 'LATCHES DEPLOYED' },
  { value: '9', label: 'NETWORKS LIVE' },
  { value: '27ms', label: 'MEDIAN HOOK OVERHEAD' },
]

/* ---------------------------------------------------------------- activity */

export type RangeKey = '30D' | '90D' | '1Y'

export const RANGES: readonly RangeKey[] = ['30D', '90D', '1Y']
export const DEFAULT_RANGE: RangeKey = '1Y'

export interface ActivitySeries {
  readonly labels: readonly string[]
  readonly pts: readonly number[]
  readonly headline: string
  readonly delta: string
}

export const ACTIVITY: Record<RangeKey, ActivitySeries> = {
  '30D': {
    labels: ['W1', 'W2', 'W3', 'W4'],
    pts: [352, 368, 381, 412],
    headline: '$412M',
    delta: '+17.0% / 30d',
  },
  '90D': {
    labels: ['Apr', 'May', 'Jun'],
    pts: [268, 301, 344, 362, 381, 412],
    headline: '$412M',
    delta: '+53.7% / 90d',
  },
  '1Y': {
    labels: ['Oct', 'Dec', 'Feb', 'Apr', 'Jun', 'Sep'],
    pts: [64, 88, 102, 141, 168, 205, 248, 262, 301, 344, 381, 412],
    headline: '$412M',
    delta: '+544% / 1y',
  },
}

export interface CategoryBar {
  readonly name: string
  readonly value: string
  /** Bar width, 0–100. */
  readonly pct: number
  readonly tone: Tone
}

export const CALL_CATEGORIES: readonly CategoryBar[] = [
  { name: 'AMM / swap hooks', value: '18.4M', pct: 100, tone: 'primary' },
  { name: 'Lending markets', value: '7.1M', pct: 39, tone: 'signal' },
  { name: 'NFT / assets', value: '3.6M', pct: 20, tone: 'violet' },
  { name: 'Gaming', value: '2.2M', pct: 12, tone: 'success' },
]

/** Gas overhead histogram, 14 buckets, values as a percentage of the peak. */
export const GAS_COLUMNS: readonly number[] = [8, 17, 34, 58, 92, 100, 84, 61, 44, 31, 22, 15, 10, 6]
export const GAS_AXIS = ['2k', 'median 8.4k', '40k'] as const

export interface NetworkShare {
  readonly name: string
  readonly pct: number
  readonly tone: Tone
}

export const TVL_BY_NETWORK: readonly NetworkShare[] = [
  { name: 'Ethereum', pct: 41, tone: 'primary' },
  { name: 'Base', pct: 27, tone: 'signal' },
  { name: 'Arbitrum', pct: 19, tone: 'violet' },
  { name: 'Others', pct: 13, tone: 'success' },
]

/** Latches deployed per week, 20 buckets. Scaled against the last value. */
export const DEPLOY_COLUMNS: readonly number[] = [
  12, 18, 15, 24, 31, 27, 38, 44, 36, 52, 48, 61, 57, 70, 66, 74, 81, 77, 88, 96,
]
export const DEPLOY_CAPTION = '1,840 total · 96 added this week'

export interface HealthRow {
  readonly name: string
  readonly value: string
  readonly tone: Tone
}

export const REGISTRY_HEALTH: readonly HealthRow[] = [
  { name: 'Verified latches', value: '1,612 / 1,840', tone: 'success' },
  { name: 'Reverts (24h)', value: '0.021%', tone: 'primary' },
  { name: 'Audit coverage', value: '94% of TVL', tone: 'amber' },
]

/* --------------------------------------------------------------- use cases */

export interface UseCase {
  readonly name: string
  readonly tag: string
  readonly body: string
}

export const USE_CASES: readonly UseCase[] = [
  {
    name: 'DeFi',
    tag: 'AMM · LENDING',
    body: 'Dynamic fees, custom curves, JIT liquidity and yield routing attached directly to pool lifecycle events.',
  },
  {
    name: 'Gaming',
    tag: 'ONCHAIN GAMES',
    body: 'Mint, burn and reward logic that reacts to in-game state without a custom AMM deployment per title.',
  },
  {
    name: 'NFTs',
    tag: 'PROGRAMMABLE ASSETS',
    body: 'Latches let collections mutate metadata, royalties and access rules from onchain conditions.',
  },
  {
    name: 'RWA',
    tag: 'COMPLIANCE',
    body: 'Transfer restrictions, KYC gating and oracle-driven settlement enforced at the hook layer.',
  },
]

/* ------------------------------------------------------------ how it works */

export interface LayerStep {
  readonly num: string
  readonly name: string
  readonly desc: string
}

export const LAYER_STEPS: readonly LayerStep[] = [
  {
    num: '01',
    name: 'Write the Latch',
    desc: 'Implement ILatch, declare a permission bitmap for the callbacks you need.',
  },
  {
    num: '02',
    name: 'Register it',
    desc: 'The registry validates the bitmap, deterministic address and gas budget before activation.',
  },
  {
    num: '03',
    name: 'Attach to pools',
    desc: 'Pools opt in. Callbacks run in declared order with revert isolation per latch.',
  },
]

export const INTERFACE_FACTS: readonly string[] = [
  '— beforeSwap / afterSwap callbacks',
  '— deterministic latch addresses',
  '— revert isolation per hook',
  '— on-chain permission bitmap',
]

/* ----------------------------------------------------------------- feature */

export interface Feature {
  readonly name: string
  readonly desc: string
}

export const FEATURES: readonly Feature[] = [
  { name: 'Plug & Play', desc: 'One interface, any integrating protocol.' },
  { name: 'Secure', desc: 'Gas caps, revert isolation, audited registry.' },
  { name: 'Modular', desc: 'Use only the callbacks you need.' },
  { name: 'Open Ecosystem', desc: 'Permissionless publishing for developers.' },
]

/* ------------------------------------------------------------------ chains */

/** Chain marks are placeholders — the tiles render a plain circle until the
 *  official logos are licensed (README § Asset caveats 4). */
export const CHAINS: readonly string[] = [
  'Ethereum',
  'BNB Chain',
  'Arbitrum',
  'Polygon',
  'Optimism',
  'Base',
  'Avalanche',
  'Solana',
  'Sui',
  'and more…',
]

/* ----------------------------------------------------------------- roadmap */

export interface RoadmapItem {
  readonly when: string
  readonly name: string
  readonly desc: string
}

/** Placeholder dates. */
export const ROADMAP: readonly RoadmapItem[] = [
  {
    when: 'Q3 2026',
    name: 'Core registry mainnet',
    desc: 'ILatch v1, registry and reference latches live on Ethereum and Base.',
  },
  {
    when: 'Q4 2026',
    name: 'Latch explorer',
    desc: 'Public catalogue with verified source, gas profiles and usage stats.',
  },
  {
    when: 'Q1 2027',
    name: 'Cross-chain latches',
    desc: 'Message-passing latches with shared state across supported networks.',
  },
  {
    when: 'Q2 2027',
    name: 'Permissionless publishing',
    desc: 'Open registry with staking-backed review and revenue share for authors.',
  },
]

/* -------------------------------------------------------------------- team */

export interface TeamMember {
  readonly name: string
  readonly role: string
  /** Headshot URL once photography exists; the striped placeholder shows until then. */
  readonly photo?: string
}

export const TEAM: readonly TeamMember[] = [
  { name: 'Name Placeholder', role: 'Protocol Engineering' },
  { name: 'Name Placeholder', role: 'Smart Contracts' },
  { name: 'Name Placeholder', role: 'Security' },
  { name: 'Name Placeholder', role: 'Developer Relations' },
]

/* ------------------------------------------------------------------ footer */

export interface FooterLink {
  readonly label: string
  readonly href: string
}

export const FOOTER_LINKS: readonly FooterLink[] = [
  { label: 'Docs', href: LINKS.docs },
  { label: 'GitHub', href: LINKS.github },
  { label: 'Audits', href: LINKS.audits },
  { label: 'Brand Kit', href: LINKS.brand },
  { label: 'Launch App', href: LINKS.app },
]

export const COPYRIGHT = '© 2026 LATCH PROTOCOL'
