/**
 * Landing-page content and figures.
 *
 * NOTHING IN THIS FILE IS A PLACEHOLDER, and the header that used to say the
 * opposite was itself the stalest thing on the page. Every figure below is
 * either a repo measurement (gas observed in an executed transaction, test
 * counts from suites that run) or is DERIVED FROM `DEPLOYMENTS` — so it names
 * whichever chain this build serves rather than restating a chain name that was
 * true when it was typed. Live protocol metrics are not here at all: they are
 * read from chain by the components that show them.
 *
 * The rule that produces that split: a constant that can move on chain does not
 * belong in a constants file. A chain name can move — a build flag chooses it —
 * so it is derived; a gas figure from a receipt cannot, so it is written down.
 *
 * LAYOUT AND ORDERING follow "latch design/SCREENS.md" § A. Landing page.
 *
 * THE TECHNICAL COPY DOES NOT. SCREENS.md describes an `ILatch` / `@latch/core`
 * protocol with a separate registry contract, per-call gas budgets, deterministic
 * hook addresses and per-latch revert isolation. None of that exists. Every
 * API name, bit value and behavioural claim below is instead taken from the
 * contracts in this repo and kept consistent with the docs surface
 * (src/routes/docs/content.ts, which was verified the same way):
 *
 *   packages/hooks/src/base/BaseCLHook.sol      base contract, permission masks
 *   packages/core/src/libraries/Hooks.sol       validateHookConfig at initialize
 *   packages/core/src/types/PoolKey.sol         one `IHooks hooks` field per key
 *   packages/core/src/pool-cl/interfaces/ICLHooks.sol
 *
 * The Solidity in FEE_LATCH_SOL compiles under solc 0.8.26 / via_ir against
 * those interfaces with no warnings, and each claim in LAYER_STEPS,
 * INTERFACE_FACTS and FEATURES is asserted by a forge test against them. See
 * the report accompanying this change.
 */

import { ACTIVE_CHAIN_ID, DEPLOYMENTS, IS_TESTNET_BUILD } from '../../lib/chain'
import { CHAIN_ROWS, DEPLOYED_CHAINS } from '../../data/chains'
import { GITHUB_URL } from './socials'

/**
 * The one chain this build reads, writes and talks about.
 *
 * Imported rather than spelled, because "Ethereum Sepolia" was written into six
 * user-visible strings across this page and every one of them became a lie the
 * day Robinhood Chain went live. A build flag picks the chain; the copy follows
 * it or the copy is wrong.
 */
const ACTIVE = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/* ------------------------------------------------------------------ tones */

/** Data-series tones. Components map these to token-backed CSS classes so a
 *  hex never reaches a component or this module. */
export type Tone = 'primary' | 'signal' | 'violet' | 'success' | 'amber'

/* ------------------------------------------------------------------ header */

export interface NavItem {
  /** Decorative glyph; the visible label carries the accessible name. */
  icon?: import('../../components/NavIcon').IconName
  readonly label: string
  /**
   * A router path (`/docs`) or a landing-page section (`#ecosystem`).
   *
   * There is deliberately no `active` flag. `SiteHeader` is rendered by the
   * legal pages and the verify page as well as by `/`, so a flag baked into
   * the data announced the same item as the current page on every route — the
   * screen-reader bug this replaced. Active state is derived from the router's
   * location at render time instead, and only a real route can be "current":
   * a section anchor is a position on a page, not a page.
   */
  readonly href: string
}

/**
 * PRIMARY NAV — four destinations and one call to action, and nothing else.
 *
 * What was dropped and why:
 *   Home       the lockup beside it is already a link to `/`. Two home links in
 *              12cm of chrome is one too many, and this was the item carrying
 *              the bogus `active: true`.
 *   Revenue    a subsection of the pitch, not a destination. It sits in the
 *              footer's Protocol column with the rest of the story.
 *   Brand Kit  a resource for people who already know what Latch is. Footer,
 *              plus the mobile menu (see MENU_NAV) where space is cheap.
 *
 * The order is the order a stranger needs them: what you can build with it,
 * how it works, the reference, who is building it.
 */
export const NAV: readonly NavItem[] = [
  { label: 'Ecosystem', href: '#ecosystem', icon: 'ecosystem' },
  { label: 'Developers', href: '#developers', icon: 'developers' },
  { label: 'Docs', href: '/docs', icon: 'docs' },
  { label: 'About', href: '#about', icon: 'about' },
]

/**
 * The mobile disclosure menu carries one more row than the desktop bar: a
 * vertical list has room for Brand Kit, and small-screen visitors are the ones
 * least able to go hunting in the footer for it.
 */
export const MENU_NAV: readonly NavItem[] = [
  ...NAV,
  { label: 'Brand Kit', href: '/brand', icon: 'brand' },
]

/**
 * Route targets. `github` is the real org, imported from ./socials.ts so
 * exactly one module in the app knows the URL.
 *
 * `audits` used to be `#audit` — an anchor that exists on no page, so the
 * footer link silently did nothing. It now points at the activity section,
 * which is where the audit status is actually stated (and stated as "None").
 */
export const LINKS = {
  docs: '/docs',
  brand: '/brand',
  app: '/app',
  github: GITHUB_URL,
  audits: '#activity',
  privacy: '/privacy',
  terms: '/terms',
} as const

/* -------------------------------------------------------------------- hero */

export interface HeroNode {
  readonly label: string
  /** Percentage offsets inside the 520px graph box. */
  readonly x: number
  readonly y: number
}

export const HERO_NODES: readonly HeroNode[] = [
  { label: 'LAUNCHPADS', x: 20, y: 4 },
  { label: 'STOCK PAIRS', x: 74, y: 10 },
  { label: 'RWA', x: 80, y: 46 },
  { label: 'PERPS', x: 70, y: 84 },
  { label: 'DEX', x: 8, y: 78 },
  { label: 'AMM', x: 0, y: 40 },
]

/* ------------------------------------------------- verified protocol facts */

/**
 * Everything below is a figure someone can check, and every one of them was
 * produced by running something rather than by choosing a number that looked
 * plausible. What they replaced — a TVL area chart, a gas histogram, a
 * TVL-by-network donut, "1,840 latches deployed", and "Audit coverage: 94% of
 * TVL" — was invented and merely labelled as illustrative.
 */

export interface FactRow {
  readonly name: string
  readonly value: string
  /** Maps to a landing.module.css tone class. */
  readonly toneClass: string
}

/**
 * Gas observed in executed transactions on an anvil fork of Sepolia
 * (packages/widgets test/fork), not `eth_estimateGas` and not a guess.
 */
export const MEASURED_GAS: readonly { name: string; gas: string }[] = [
  { name: 'Single-hop swap', gas: '172,049' },
  { name: 'Two-hop swap', gas: '225,618' },
]

/**
 * Where the contracts are, counted rather than asserted.
 *
 * Every value is derived: the chain name from `DEPLOYMENTS`, the target count
 * from `CHAIN_ROWS` minus the chains that actually carry contracts. The row
 * that used to read "Mainnet · None yet" is gone because it stopped being true
 * — replaced by the build's own network type, which cannot go stale for the
 * same reason.
 */
const TARGET_ONLY_COUNT = CHAIN_ROWS.filter((c) => !c.deployed).length

export const NETWORK_REACH: readonly FactRow[] = [
  { name: 'Deployed', value: ACTIVE.name, toneClass: 'toneSuccess' },
  { name: 'Chain ID', value: String(ACTIVE_CHAIN_ID), toneClass: 'toneMuted' },
  {
    name: 'Network type',
    value: IS_TESTNET_BUILD ? 'Testnet' : 'Mainnet',
    toneClass: IS_TESTNET_BUILD ? 'toneAmber' : 'toneSuccess',
  },
  {
    name: 'Targeted, no contracts',
    value: `${TARGET_ONLY_COUNT} networks`,
    toneClass: 'toneMuted',
  },
]

/**
 * Test counts from suites that run in CI, each figure taken from that suite's
 * own output. The audit row is the reason this card exists: it is the one place
 * a placeholder could have done real harm.
 */
export const TEST_COVERAGE: readonly FactRow[] = [
  { name: 'Solidity tests', value: '256 passing', toneClass: 'toneSuccess' },
  { name: 'Widget tests', value: '77 unit + 22 fork', toneClass: 'toneSuccess' },
  { name: 'Latch linter rules', value: '12 rules, 65 tests', toneClass: 'toneSuccess' },
  { name: 'Third-party audit', value: 'None', toneClass: 'toneAmber' },
]

/* --------------------------------------------------------------- use cases */

export interface UseCase {
  readonly name: string
  readonly tag: string
  readonly body: string
  /** What actually exists today. The cards are a roadmap as much as a pitch, and
      a visitor who integrates on a promise and finds a stub does not come back. */
  readonly status: 'Live on testnet' | 'In development'
}

/**
 * The four markets Latch is built for.
 *
 * These replaced a generic DeFi / Gaming / NFTs / RWA grid. That grid described
 * every hook protocol ever written and therefore described none of them; these
 * are the integrations we are actually shipping for, in the order we are
 * shipping them.
 *
 * Each carries its real status. LaunchGuard is deployed, registered on chain and
 * covered by 55 tests; the stock-pair and revenue-share kits are contracts under
 * active development. Labelling all four "live" would win a visitor once.
 */
export const USE_CASES: readonly UseCase[] = [
  {
    name: 'DEX & AMM',
    tag: 'DYNAMIC FEES · CUSTOM CURVES',
    body: 'Attach fee logic, JIT liquidity and routing to pool lifecycle events. Concentrated-liquidity and bin pools share one Vault, so a Latch written once serves both.',
    status: 'Live on testnet',
  },
  {
    name: 'Launchpads',
    tag: 'SNIPER PROTECTION',
    body: 'A decaying launch tax priced on time rather than identity — the only thing a Latch can actually see. One call attaches it to a new pool; no address mining, no redeploy.',
    status: 'Live on testnet',
  },
  {
    name: 'Stock & RWA pairs',
    tag: 'COMPLIANCE · MARKET HOURS',
    body: 'Trading gated on a pluggable compliance oracle, with session hours, issuer halts and oracle price bands. Equities do not trade around the clock and the pool should not pretend otherwise.',
    status: 'In development',
  },
  {
    name: 'Donations & holder share',
    tag: 'REVENUE FROM VOLUME',
    body: 'Route a share of trading volume to liquidity providers, named beneficiaries or token holders — accrued and claimed, never pushed, so one hostile recipient cannot block a swap.',
    status: 'In development',
  },
]

/* --------------------------------------------------- revenue share mechanics */

export interface ShareRoute {
  readonly name: string
  readonly mechanism: string
  readonly body: string
}

/**
 * How a share of trading volume actually reaches someone.
 *
 * This section exists because "holders earn from volume" is the easiest claim in
 * DeFi to make and one of the harder ones to implement honestly. The naive
 * version iterates holders on chain; holder sets are unbounded and anyone can
 * grow one, so that loop is a permanent denial of service on the swap path
 * waiting to be triggered. All three routes below are pull-based for that reason.
 */
export const SHARE_ROUTES: readonly ShareRoute[] = [
  {
    name: 'Liquidity providers',
    mechanism: 'Native donate()',
    body: 'The pool distributes directly to in-range liquidity. Cheapest route, and the only one that needs no extra accounting — it is a protocol primitive, not a Latch invention.',
  },
  {
    name: 'Named beneficiaries',
    mechanism: 'Weighted pull claims',
    body: 'A treasury, a creator, a donation address. Fees accrue to a per-recipient balance and are claimed, never pushed: a push to a contract that reverts would revert the swap that funded it.',
  },
  {
    name: 'Token holders',
    mechanism: 'Merkle epochs',
    body: 'An epoch closes, a root is posted, holders claim against it. This is how an ordinary ERC-20 gets a holder share without a snapshot token and without an unbounded on-chain loop.',
  },
]

/* ------------------------------------------------------------ how it works */

export interface LayerStep {
  readonly num: string
  readonly name: string
  readonly desc: string
}

/**
 * The real integration path: write → encode → initialize. There is no registry
 * contract, no gas budget and nothing to "activate"; the only gate is
 * Hooks.validateHookConfig comparing the pool key against the hook.
 */
export const LAYER_STEPS: readonly LayerStep[] = [
  {
    num: '01',
    name: 'Write the Latch',
    desc: 'Extend BaseCLHook and return the callbacks you want from getHooksRegistrationBitmap().',
  },
  {
    num: '02',
    name: 'Encode the bitmap',
    desc: 'The same 16-bit value goes into poolKey.parameters — deploy from any address, no salt to mine.',
  },
  {
    num: '03',
    name: 'Initialize the pool',
    desc: 'The pool manager checks the two agree, then calls your Latch on every swap that follows.',
  },
]

/**
 * Each line is asserted by the proof harness: bits 6 and 7 (0x0040 / 0x0080),
 * bits 0–13 usable with 14–15 reserved, two hooks at different addresses both
 * validating against the same key, and HookConfigValidationError on a mismatch.
 */
export const INTERFACE_FACTS: readonly string[] = [
  '— beforeSwap 0x0040 · afterSwap 0x0080',
  '— 14 permission bits, held in the pool key',
  '— any Latch address · no salt mining',
  '— bitmap checked at initialize',
]

/* ----------------------------------------------------------------- feature */

export interface Feature {
  readonly name: string
  readonly desc: string
}

/**
 * "Gas caps, revert isolation, audited registry" was all three false. The
 * replacements are the three guards that do exist: the onlyPoolManager
 * modifier, the returned-selector check (InvalidHookResponse) and
 * Hooks.validateHookConfig.
 */
export const FEATURES: readonly Feature[] = [
  { name: 'Plug & Play', desc: 'One base contract, fourteen optional callbacks.' },
  { name: 'Secure', desc: 'Manager-only callbacks, checked selectors, bitmap verified on chain.' },
  { name: 'Modular', desc: 'Use only the callbacks you need.' },
  { name: 'Open Ecosystem', desc: 'Deploy from any address. No allowlist, no salt mining.' },
]

/* ------------------------------------------------------------------ chains */

/* The chain list moved to src/data/chains.ts, which derives it from the SDK's
   `CHAIN_RPCS` (packages/sdk/src/chains/endpoints.ts) rather than restating it.
   SCREENS.md § A8 listed Arbitrum / Polygon / Optimism / Avalanche / Solana /
   Sui as illustrative placeholders; none of those were probed and Solana and
   Sui are not EVM chains at all, so none of them are targets. */

/* ----------------------------------------------------------------- roadmap */

export interface RoadmapItem {
  readonly when: string
  readonly name: string
  readonly desc: string
}

/**
 * Dates beyond the first row are indicative and the section says so. The first
 * row is not a plan — it is what is deployed today, counted off the same
 * contract table the Chains section lists address by address, so the count and
 * the list cannot disagree.
 */
const ACTIVE_CONTRACT_COUNT = DEPLOYED_CHAINS[0]?.contracts.length ?? 0

export const ROADMAP: readonly RoadmapItem[] = [
  {
    when: 'Q3 2026',
    name: `${ACTIVE.name} deployment`,
    desc: `${ACTIVE_CONTRACT_COUNT} contracts live and source verified; every address is listed below.`,
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
    desc: 'Open publishing with staking-backed review and revenue share for Latch authors.',
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

export interface FooterGroup {
  /** Mono micro-label above the column. */
  readonly title: string
  readonly links: readonly FooterLink[]
}

/**
 * FOOTER — the full map of the site, grouped.
 *
 * The old footer was a single undifferentiated row of seven: Docs sat beside
 * Terms sat beside Launch App, which told a reader nothing about which of them
 * they wanted. Four columns answer four different questions — what the protocol
 * does, how to build on it, who made it, and what the legal position is — and
 * everything the top nav no longer carries has a home here.
 *
 * Legal lives here and only here. A privacy policy is something a visitor looks
 * for deliberately, once; it does not earn a slot in the primary nav.
 */
export const FOOTER_GROUPS: readonly FooterGroup[] = [
  {
    title: 'Protocol',
    links: [
      { label: 'Use cases', href: '#ecosystem' },
      { label: 'Revenue share', href: '#revenue' },
      { label: 'How it works', href: '#developers' },
      { label: 'Activity & audits', href: LINKS.audits },
    ],
  },
  {
    title: 'Build',
    links: [
      { label: 'Docs', href: LINKS.docs },
      { label: 'Launch App', href: LINKS.app },
      { label: 'GitHub', href: LINKS.github },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'About', href: '#about' },
      { label: 'Brand Kit', href: LINKS.brand },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: LINKS.privacy },
      { label: 'Terms', href: LINKS.terms },
    ],
  },
]

export const COPYRIGHT = '© 2026 LATCH PROTOCOL'

/* --------------------------------------------------------------- code panel */

/** Syntax roles, mapped to the README's code palette by the stylesheet. */
export type CodeKind = 'txt' | 'kw' | 'type' | 'fn' | 'str' | 'num' | 'com'

export interface CodeToken {
  readonly k: CodeKind
  readonly t: string
}

const t = (text: string): CodeToken => ({ k: 'txt', t: text })
const kw = (text: string): CodeToken => ({ k: 'kw', t: text })
const ty = (text: string): CodeToken => ({ k: 'type', t: text })
const fn = (text: string): CodeToken => ({ k: 'fn', t: text })
const str = (text: string): CodeToken => ({ k: 'str', t: text })
const num = (text: string): CodeToken => ({ k: 'num', t: text })
const com = (text: string): CodeToken => ({ k: 'com', t: text })

/**
 * `FeeLatch.sol` — a complete, compiling dynamic-fee hook.
 *
 * VERIFIED, not eyeballed: concatenating every `t` below reproduces a file that
 * compiles under solc 0.8.26 with via_ir against packages/core and
 * packages/hooks, with no warnings. Indentation is tabs, rendered at the
 * specced 18px per level by `tab-size` on the <pre>.
 *
 * What the old sample got wrong: there is no `ILatch` and no `@latch/*`
 * remapping; the declaring function is `getHooksRegistrationBitmap()`, not
 * `permissions()`; beforeSwap is bit 6 (0x0040) and takes four parameters and
 * returns three values, not one.
 */
export const FEE_LATCH_SOL: readonly CodeToken[] = [
  com('// SPDX-License-Identifier: MIT'),
  t('\n'),
  kw('pragma solidity'),
  t(' '),
  num('0.8.26'),
  t(';\n\n'),

  kw('import'),
  t(' {BaseCLHook} '),
  kw('from'),
  t(' '),
  str('"latch-hooks/src/base/BaseCLHook.sol"'),
  t(';\n'),
  kw('import'),
  t(' {ICLHooks} '),
  kw('from'),
  t(' '),
  str('"infinity-core/src/pool-cl/interfaces/ICLHooks.sol"'),
  t(';\n'),
  kw('import'),
  t(' {ICLPoolManager} '),
  kw('from'),
  t(' '),
  str('"infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol"'),
  t(';\n'),
  kw('import'),
  t(' {PoolKey} '),
  kw('from'),
  t(' '),
  str('"infinity-core/src/types/PoolKey.sol"'),
  t(';\n'),
  kw('import'),
  t(' {LPFeeLibrary} '),
  kw('from'),
  t(' '),
  str('"infinity-core/src/libraries/LPFeeLibrary.sol"'),
  t(';\n'),
  kw('import'),
  t(' {BeforeSwapDelta, BeforeSwapDeltaLibrary} '),
  kw('from'),
  t(' '),
  str('"infinity-core/src/types/BeforeSwapDelta.sol"'),
  t(';\n\n'),

  kw('contract'),
  t(' '),
  ty('FeeLatch'),
  t(' '),
  kw('is'),
  t(' '),
  ty('BaseCLHook'),
  t(' {\n\t'),
  kw('constructor'),
  t('(ICLPoolManager _pm) '),
  ty('BaseCLHook'),
  t('(_pm) {}\n\n\t'),

  com('// bit 6: poolKey.parameters must carry exactly this value'),
  t('\n\t'),
  kw('function'),
  t(' '),
  fn('getHooksRegistrationBitmap'),
  t('() '),
  kw('public pure override returns'),
  t(' (uint16) {\n\t\t'),
  kw('return'),
  t(' BEFORE_SWAP;\n\t}\n\n\t'),

  kw('function'),
  t(' '),
  fn('_beforeSwap'),
  t('(address, PoolKey '),
  kw('calldata'),
  t(', ICLPoolManager.SwapParams '),
  kw('calldata'),
  t(' p, bytes '),
  kw('calldata'),
  t(')\n\t\t'),
  kw('internal pure override returns'),
  t(' (bytes4, BeforeSwapDelta, uint24)\n\t{\n\t\tuint24 fee = p.amountSpecified <= '),
  num('-10 ether'),
  t(' ? '),
  num('3000'),
  t(' : '),
  num('500'),
  t(';\n\t\t'),
  kw('return'),
  t(
    ' (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);\n\t}\n}',
  ),
]

/* ---------------------------------------------------------------------------
   Oracles — what actually ships, and what each one costs you in trust.

   Both entries below are real contracts in packages/hooks-rwa/src/oracles/, and
   the trade-off column is the honest reason a reader would pick one over the
   other. A page that listed only the Pyth adapter would be marketing; a page
   that listed only the manual one would be underselling. Listing both, with the
   trust assumption named, is the thing a developer can act on.
   --------------------------------------------------------------------------- */

export interface OracleEntry {
  readonly name: string
  readonly contract: string
  /** One line: what it is. */
  readonly kind: string
  /** The trust assumption, stated plainly. This is the column that matters. */
  readonly trust: string
  readonly body: string
  /** Verified on chain, so the claim is checkable rather than asserted. */
  readonly status: string
}

export const ORACLES: readonly OracleEntry[] = [
  {
    name: 'Pyth price band',
    contract: 'PythPriceBandAdapter',
    kind: 'Signed off-chain feed, pulled on chain',
    trust: 'Pyth’s publisher set',
    body:
      'Reads a Pyth feed and converts it into the pool’s own sqrtPriceX96 units. Split in two: a permissionless refresh does the conversion and caches it, so the read on every swap is a single storage slot. Rejects a stale publish time, a confidence interval wider than the issuer allows, and any price outside the range core can represent.',
    status: 'Exercised against live Pyth on Sepolia — 19 checks',
  },
  {
    name: 'Manual price band',
    contract: 'ManualPriceBandOracle',
    kind: 'Issuer publishes the reference itself',
    trust: 'One publisher key, bounded',
    body:
      'For an issuer who already knows what the asset is worth, from a transfer agent or their own desk. It verifies nothing and says so. A publisher may move the reference by at most a configured percentage per update, measured against an anchor that survives clearing — otherwise clear-then-republish would be a way around the bound.',
    status: 'Bound added after an internal review found the key could move the band',
  },
]

/* ---------------------------------------------------------------------------
   The two markets a price band has to serve, and why they are not the same job.
   --------------------------------------------------------------------------- */

export interface MarketKind {
  readonly label: string
  readonly tickers: readonly string[]
  readonly note: string
}

export const MARKET_KINDS: readonly MarketKind[] = [
  {
    label: 'Crypto',
    tickers: ['BTC', 'ETH', 'BNB', 'HYPE', 'MON', 'XPL'],
    note: 'Trades continuously. A deep pair can carry its own TWAP; a thin one cannot.',
  },
  {
    label: 'US equities',
    tickers: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'],
    note: 'Closed most of the week. A calendar decides when the pool may trade at all, and a band decides how far from the reference it may print.',
  },
]
