/* ============================================================================
   Ecosystem directory — the data half.

   A directory of THIRD-PARTY projects building on Latch: teams and products,
   not contracts. The contracts are on the Marketplace, read from LatchRegistry.
   Nothing here can be read from chain, so this file is the source of truth and
   the submission path is a GitHub issue (see `listingIssueUrl`). There is no
   backend, no database and no form POST anywhere.

   WHY A TS MODULE AND NOT JSON. Three reasons, in order of weight:

     1. `uses` is a closed union (`LatchKind`) and `chains` is a number list.
        JSON would need a runtime validator or an unchecked cast to get those
        types back; a `.ts` file gets them checked by `tsc -b`, which CI already
        runs, and a typo in a kind key fails the build instead of rendering a
        blank badge.
     2. The invariant that matters most on this surface is a comment, and it
        has to sit exactly where somebody would add an entry. JSON has no
        comments.
     3. `tsconfig.app.json` does not enable `resolveJsonModule`, and turning it
        on for one file widens what the whole app can import.

   THE RULE. Every entry names a real third party who asked to be listed by
   opening the listing issue. Do not seed this array with plausible examples,
   sample data, or "temporary" entries, and do not leave any commented out. A
   fabricated ecosystem misrepresents teams who never agreed to appear here,
   which is worse than the invented chart CLAUDE.md's no-invented-data rule was
   written against. An empty array renders an honest empty state; that is the
   correct output until somebody real submits.

   There is deliberately no `verified` field. Nothing in this repo can set it
   true, so it would always be false, and a field that is always false is a lie
   about what the field measures. "Submitted by the project, not verified" is a
   property of the whole surface (`LISTING_PROVENANCE`) and is rendered on every
   card and in the page header.
   ============================================================================ */

import { CHAIN_ROWS } from '../../../data/chains.ts'
import { ACTIVE_CHAIN_ID, DEPLOYMENTS } from '../../../lib/chain'
import { GITHUB_URL } from '../../landing/socials.ts'

/* ---- the Latch families a project can say it uses ------------------------- */

/**
 * Keyed to the Latch families this repository actually contains, plus `own`
 * for a project's own hook contract. A kind is a contract family, not a
 * marketing category — the label is prose, the `contract` is the ABI name.
 */
export type LatchKind =
  | 'launch-guard'
  | 'rev-share'
  | 'permissioned-pool'
  | 'market-hours'
  | 'stock-pair'
  | 'own'

export interface LatchKindInfo {
  readonly label: string
  /** Real contract name(s), in code voice. `null` for a project's own Latch. */
  readonly contract: string | null
  /** Where the source lives in this repository. `null` for `own`. */
  readonly source: string | null
  readonly meaning: string
}

export const LATCH_KINDS: Record<LatchKind, LatchKindInfo> = {
  'launch-guard': {
    label: 'Launch guard',
    contract: 'LaunchGuardHook · BinLaunchGuardHook',
    source: 'packages/hooks/src/launch',
    meaning: 'A decaying launch tax priced on time since pool creation. Sniper protection for launchpads.',
  },
  'rev-share': {
    label: 'Revenue share',
    contract: 'RevShareHook',
    source: 'packages/hooks-revshare/src',
    meaning: 'Routes a share of swap volume to a roster of beneficiaries or token holders, accrued and claimed.',
  },
  'permissioned-pool': {
    label: 'Permissioned pool',
    contract: 'PermissionedPoolHook',
    source: 'packages/hooks-rwa/src',
    meaning: 'Trading gated on a pluggable compliance oracle.',
  },
  'market-hours': {
    label: 'Market hours',
    contract: 'MarketHoursHook',
    source: 'packages/hooks-rwa/src',
    meaning: 'Session hours, holidays and issuer halts, so a pool does not trade when its underlying cannot.',
  },
  'stock-pair': {
    label: 'Stock pair',
    contract: 'StockPairHook',
    source: 'packages/hooks-rwa/src',
    meaning: 'Market hours plus an oracle price band around a reference price.',
  },
  own: {
    label: 'Their own Latch',
    contract: null,
    source: null,
    meaning:
      'A hook contract the project authored. If it is listed on chain, the Marketplace shows what its bytecode can do.',
  },
}

/** Display order for filters and legends. */
export const LATCH_KIND_ORDER: readonly LatchKind[] = [
  'launch-guard',
  'rev-share',
  'permissioned-pool',
  'market-hours',
  'stock-pair',
  'own',
]

/* ---- categories ------------------------------------------------------------ */

/**
 * What KIND OF PRODUCT a project is, in the words a trader browses by. This is
 * the axis the directory's category tabs filter on; `uses` (the Latch families)
 * is a different axis and drives the `Tags` menu.
 *
 * A closed union for the same reason `LatchKind` is one: a typo fails `tsc`
 * instead of rendering a tab nobody can match. The list is a VOCABULARY, not a
 * set of listings — the directory renders a tab only for a category at least
 * one real entry carries, so an unused member here never reaches the screen.
 * The submission form offers every member plus "Other"; a listing that picks
 * "Other" gets a new member added here when it is merged.
 */
export type EcosystemCategory =
  | 'DEX'
  | 'Launchpad'
  | 'Quests'
  | 'Lending'
  | 'RWA'
  | 'Analytics'
  | 'Wallet'
  | 'Infrastructure'

/** Display order for tabs and the submission form. */
export const ECOSYSTEM_CATEGORIES: readonly EcosystemCategory[] = [
  'DEX',
  'Launchpad',
  'Quests',
  'Lending',
  'RWA',
  'Analytics',
  'Wallet',
  'Infrastructure',
]

/** The form's escape hatch. Never a value an entry carries — see above. */
export const CATEGORY_OTHER = 'Other'

/* ---- the entry shape ------------------------------------------------------- */

export interface EcosystemProject {
  /** The project's own name, as written in its listing issue. */
  readonly name: string
  /** One line, as written by the project. Rendered as their words, never as a claim we make. */
  readonly tagline: string
  /** Project site. Anything that is not plain http(s) is rendered as inert text. */
  readonly url: string
  /** Public source repository, if the project gave one. */
  readonly source?: string
  /**
   * What kind of product this is. Taken from the project's own words — the
   * listing issue's category field, or for the seeded entries below, their own
   * tagline — never inferred from what the product looks like.
   */
  readonly category: EcosystemCategory
  /**
   * FEATURED IS AN EDITORIAL CHOICE BY LATCH, NOT A CLAIM ABOUT THE PROJECT.
   *
   * It means "Latch chose to put this card on the landing page", and nothing
   * else: not reviewed, not audited, not endorsed, not more used. The card's
   * badge reads "Featured" and its footer caption still carries
   * `LISTING_PROVENANCE`, so the badge cannot be read as verification. A
   * project cannot set this through the listing issue.
   */
  readonly featured?: boolean
  /** Which Latch families the project says it uses. At least one. */
  readonly uses: readonly LatchKind[]
  /** EIP-155 chain ids the project says the integration is live on. At least one. */
  readonly chains: readonly number[]
  /** ISO date (YYYY-MM-DD) the listing was merged. Not the project's launch date. */
  readonly addedAt: string
  /**
   * LOGO SLOT — intentionally empty on every entry until a real asset exists.
   *
   * Path under `public/project-logos/` to a mark supplied by the project itself,
   * taken as-is from its own site, CDN or GitHub org, with provenance recorded
   * the way `public/chains/SOURCES.md` records chain marks. Never drawn,
   * traced, recoloured or copied from an aggregator. While this is absent the
   * card shows a typographic monogram built from `name` — the same fallback
   * the chain list uses for a network with no sourceable mark.
   */
  readonly logo?: string
}

/**
 * The directory.
 *
 * ############################################################################
 * PLACEHOLDER LISTINGS — SEEDED 2026-09-13 AT THE PROJECT OWNER'S INSTRUCTION.
 *
 * The file header above says not to do this. It is being done anyway, as a
 * deliberate decision by the owner, and this block exists so that decision is
 * on the record rather than discovered later by somebody reading the array and
 * assuming these were real submissions.
 *
 * WHY THE HEADER'S OBJECTION DOES NOT FULLY APPLY. Its stated harm is
 * misrepresenting teams who never agreed to appear here. These three are the
 * owner's own properties — the dapp sidebar already groups them under "Other
 * Latch properties", confirmed by the owner — so consent is not the issue.
 *
 * WHAT IS STILL INVENTED, AND IT IS NOT NOTHING. Two fields per entry:
 *
 *   `uses`    — a claim that a specific Latch family is wired into a specific
 *               product. Not verified. Nothing on chain was checked, and no
 *               registry listing backs any of these.
 *   `chains`  — a claim that the integration is LIVE on that chain. Not
 *               verified either.
 *
 * Those two are technical claims other developers may act on, which is a
 * different kind of wrong from a placeholder name. `LISTING_PROVENANCE` is
 * rendered on every card and says "Submitted by the project · not verified by
 * Latch Protocol", so the surface does not overstate them — but the string says
 * the project submitted it, and for these three the project did not.
 *
 * REPLACE OR REMOVE BEFORE A PUBLIC LAUNCH. Everything else is real: names,
 * taglines and URLs were read from each site's own <title> and og: tags, and
 * the two logos were downloaded as-is from the sites' own brand paths with
 * provenance recorded in public/project-logos/SOURCES.md.
 * ############################################################################
 *
 * The normal path for a real entry is unchanged: merge a listing issue opened
 * by the project through `listingIssueUrl()`. An entry is not added because a
 * project looks like it belongs.
 */
export const ECOSYSTEM_PROJECTS: readonly EcosystemProject[] = [
  {
    name: 'Peddles',
    /* Their own <title> and og:title, verbatim. */
    tagline: 'Launch memecoins paired to stocks.',
    url: 'https://peddles.xyz',
    /* Derived from the tagline above and nothing else: "Launch memecoins" is
       a launchpad in the project's own words. */
    category: 'Launchpad',
    /* Editorial choice by Latch, not a claim about the project — see `featured`. */
    featured: true,
    /* PLACEHOLDER. A stock-paired launch is what the tagline describes, so
       these are the families it WOULD use — not families anything has
       confirmed it does use. */
    uses: ['launch-guard', 'stock-pair'],
    /* PLACEHOLDER. ACTIVE_CHAIN_ID rather than a literal, so a build that
       serves a different chain does not carry a stale claim about this one. */
    chains: [ACTIVE_CHAIN_ID],
    addedAt: '2026-09-13',
    logo: '/project-logos/peddles.svg',
  },
  {
    name: 'PeddleSwap',
    /* Their og:description. The <title> is "Coming soon · PeddleSwap", which
       is a state rather than a description of the product. */
    tagline: 'Trade, provide liquidity, and lock tokens across V2 and V3.',
    url: 'https://peddleswap.xyz',
    /* Derived from the tagline above and nothing else: "Trade, provide
       liquidity" is a DEX in the project's own words. */
    category: 'DEX',
    /* Editorial choice by Latch, not a claim about the project — see `featured`. */
    featured: true,
    /* PLACEHOLDER — see the block above. */
    uses: ['rev-share'],
    /* PLACEHOLDER. */
    chains: [ACTIVE_CHAIN_ID],
    addedAt: '2026-09-13',
    /* No `logo` KEY AT ALL, which is the correct output rather than an
       oversight: peddleswap.xyz answers 200 with its app-shell HTML for every
       asset path its own <head> declares, so there is no mark to take. The
       card renders the typographic monogram. See public/project-logos/SOURCES.md. */
  },
  {
    name: 'PeddlesQuest',
    /* Condensed from their og:description. Their <title> is a marketing
       sentence with an exclamation mark and does not fit a one-line slot. */
    tagline: 'Complete tasks, earn crypto rewards.',
    url: 'https://peddlequest.xyz',
    /* Derived from the tagline above and nothing else: "Complete tasks, earn
       rewards" is a quests product in the project's own words. */
    category: 'Quests',
    /* Editorial choice by Latch, not a claim about the project — see `featured`. */
    featured: true,
    /* PLACEHOLDER — see the block above. */
    uses: ['rev-share'],
    /* PLACEHOLDER. */
    chains: [ACTIVE_CHAIN_ID],
    addedAt: '2026-09-13',
    logo: '/project-logos/peddlequest.png',
  },
]

/* ---- provenance: a property of the surface, not a field ------------------- */

/**
 * Rendered on every card (`EcosystemCard`, landing and directory alike) and in
 * the directory's count line. One string so it cannot drift.
 */
export const LISTING_PROVENANCE = 'Submitted by the project · not verified by Latch Protocol'

/* ---- helpers --------------------------------------------------------------- */

/** Newest listing first; ties broken by name so the order is stable. */
export function sortedProjects(
  projects: readonly EcosystemProject[] = ECOSYSTEM_PROJECTS,
): EcosystemProject[] {
  return [...projects].sort(
    (a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name),
  )
}

/** Every chain id at least one listing names, ascending. Drives the chain filter. */
export function chainsListed(projects: readonly EcosystemProject[]): number[] {
  const ids = new Set<number>()
  for (const p of projects) for (const c of p.chains) ids.add(c)
  return [...ids].sort((a, b) => a - b)
}

/**
 * Every category at least one listing carries, in `ECOSYSTEM_CATEGORIES` order.
 * Drives the category tabs, so there is never a tab that matches nothing.
 */
export function categoriesListed(projects: readonly EcosystemProject[]): EcosystemCategory[] {
  const present = new Set(projects.map((p) => p.category))
  return ECOSYSTEM_CATEGORIES.filter((c) => present.has(c))
}

/** Every Latch family at least one listing names, in `LATCH_KIND_ORDER`. Drives the Tags menu. */
export function kindsListed(projects: readonly EcosystemProject[]): LatchKind[] {
  const present = new Set<LatchKind>()
  for (const p of projects) for (const k of p.uses) present.add(k)
  return LATCH_KIND_ORDER.filter((k) => present.has(k))
}

export interface ChainCount {
  readonly chainId: number
  readonly count: number
}

/**
 * How many listings name each chain, most first.
 *
 * A COUNT OF CLAIMS, NOT OF DEPLOYMENTS. A project appears against every chain
 * it listed, so the counts sum to more than `projects.length` whenever one
 * integration spans several networks — and none of them was checked against
 * that chain. The surface's provenance line (`LISTING_PROVENANCE`) is what
 * qualifies it, and any caller rendering these numbers has to carry that line
 * too.
 *
 * Only chains somebody actually named appear. There is no zero row for a chain
 * this repo happens to deploy to: nobody submitted it, and drawing it at zero
 * would put a reading where there is no submission.
 */
export function chainCounts(projects: readonly EcosystemProject[]): ChainCount[] {
  const counts = new Map<number, number>()
  for (const p of projects) {
    for (const id of p.chains) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([chainId, count]) => ({ chainId, count }))
    .sort((a, b) => b.count - a.count || a.chainId - b.chainId)
}

/**
 * A typographic monogram from the project's name — the equity-ticker
 * precedent: when no official asset is available, letters in the design
 * system's own type are an honest placeholder, and an approximated logo is not.
 *
 * Initials of the first three words, or the first two letters of a one-word
 * name. Always upper-case, never more than three characters.
 */
export function monogramFor(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_/.·]+/)
    .filter((w) => w.length > 0)
  const first = words[0]
  if (first === undefined) return '?'
  if (words.length === 1) return first.slice(0, 2).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
}

/** The host of a project URL for the card's subline; the raw string if it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/* ---- submission: a prefilled GitHub issue ---------------------------------- */

/**
 * Where the listing issue is opened.
 *
 * `GITHUB_URL` is the confirmed org (see landing/socials.ts). The repository
 * slug is the one place to change if the site's source moves: today the org's
 * only repository with issues enabled is its `.github` repo, which is also
 * where GitHub reads an org's default issue templates from. The template that
 * pairs with this URL is `.github/ISSUE_TEMPLATE/project-listing.yml` in this
 * repository; it must be present in the target repo for the `template` param
 * to resolve. If it is not, GitHub falls back to a blank issue and the `body`
 * below carries the same fields, so the submission still works.
 */
export const ECOSYSTEM_ISSUES_REPO = `${GITHUB_URL}/.github`

export const LISTING_TEMPLATE = 'project-listing.yml'

/**
 * The issue form's field ids, keyed by what the submission form calls them.
 *
 * KEEP IN STEP WITH `.github/ISSUE_TEMPLATE/project-listing.yml`. Each value is
 * an `id:` in that file and is sent as a query parameter of the same name.
 *
 * GitHub prefills issue-form fields from the URL for TEXT fields only (`input`
 * and `textarea`). That is why category, Latch families and chains are text
 * inputs in the template rather than a dropdown and checkboxes: a checkbox the
 * submitter already ticked on this site would arrive unticked. The two
 * confirmation checkboxes are the deliberate exception — a person has to tick
 * those on GitHub themselves.
 */
export const LISTING_FIELDS = {
  name: 'project_name',
  description: 'tagline',
  url: 'url',
  source: 'source',
  category: 'category',
  uses: 'uses',
  ownLatch: 'own_latch',
  chains: 'chains',
  icon: 'icon',
  contact: 'contact',
} as const

/**
 * Character limits the form enforces. `name` and `description` are the limits
 * the issue template states to the submitter; the rest only keep one field from
 * eating the URL budget below.
 */
export const LISTING_LIMITS = {
  name: 80,
  description: 280,
  url: 300,
  source: 300,
  categoryOther: 40,
  ownLatch: 200,
  iconSource: 300,
  contact: 200,
} as const

/**
 * The longest prefilled issue URL we will hand to the browser.
 *
 * GitHub answers a request URL of roughly 8 KB with an error page instead of
 * the form, which loses everything the submitter typed. 7,500 leaves headroom
 * under that for proxies that count differently. When the URL would exceed it,
 * `buildListingIssue` shortens the DESCRIPTION — the one free-text field long
 * enough to matter — and reports that it did, so the form can say so.
 */
export const MAX_ISSUE_URL_LENGTH = 7_500

/** What the browser could read about a chosen icon file. Nothing is uploaded. */
export interface ListingIcon {
  readonly fileName: string
  readonly type: string
  readonly bytes: number
  readonly width?: number
  readonly height?: number
}

export interface ListingPrefill {
  readonly name?: string
  readonly url?: string
  readonly description?: string
  readonly category?: EcosystemCategory | typeof CATEGORY_OTHER | ''
  /** Free text, used only when `category` is "Other". */
  readonly categoryOther?: string
  readonly source?: string
  readonly uses?: readonly LatchKind[]
  /** Used only when `uses` includes `own`. */
  readonly ownLatch?: string
  readonly chains?: readonly number[]
  readonly icon?: ListingIcon | null
  /** Where the icon file is published on the project's own site. */
  readonly iconSource?: string
  readonly contact?: string
}

export interface ListingIssue {
  readonly url: string
  /** Characters of the description in the URL when it had to be cut; `null` when nothing was cut. */
  readonly descriptionKeptChars: number | null
  readonly descriptionTotalChars: number
  /**
   * True only when even an empty description could not fit, so the markdown
   * fallback `body` was dropped too. Unreachable within `LISTING_LIMITS` for
   * ASCII input; reported rather than assumed.
   */
  readonly bodyOmitted: boolean
  /** True when no combination fits. The URL is still returned; GitHub may reject it. */
  readonly overLimit: boolean
}

interface NormalisedListing {
  readonly name: string
  readonly url: string
  readonly description: string
  readonly category: string
  readonly source: string
  readonly uses: readonly LatchKind[]
  readonly ownLatch: string
  readonly chains: readonly number[]
  readonly icon: ListingIcon | null
  readonly iconSource: string
  readonly contact: string
}

function normalise(prefill: ListingPrefill): NormalisedListing {
  const t = (s: string | undefined) => s?.trim() ?? ''
  const uses = LATCH_KIND_ORDER.filter((k) => prefill.uses?.includes(k) ?? false)
  const other = t(prefill.categoryOther)
  const category =
    prefill.category === CATEGORY_OTHER
      ? other
        ? `${CATEGORY_OTHER}: ${other}`
        : CATEGORY_OTHER
      : (prefill.category ?? '')
  return {
    name: t(prefill.name),
    url: t(prefill.url),
    description: t(prefill.description),
    category,
    source: t(prefill.source),
    uses,
    ownLatch: uses.includes('own') ? t(prefill.ownLatch) : '',
    chains: [...new Set(prefill.chains ?? [])].sort((a, b) => a - b),
    icon: prefill.icon ?? null,
    iconSource: t(prefill.iconSource),
    contact: t(prefill.contact),
  }
}

function chainLabel(id: number): string {
  return CHAIN_ROWS.find((r) => r.chainId === id)?.name ?? `Chain ${id}`
}

/** `3.2 KB`. Decimal units, which is what GitHub and file managers show. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function iconText(v: NormalisedListing): string {
  const lines: string[] = []
  if (v.icon) {
    const dims =
      v.icon.width !== undefined && v.icon.height !== undefined
        ? `, ${v.icon.width}×${v.icon.height} px`
        : ''
    lines.push(
      `File chosen on the Latch site: ${v.icon.fileName} (${v.icon.type || 'unknown type'}${dims}, ${formatBytes(v.icon.bytes)})`,
      'It was NOT uploaded from there. Drag that file into this box to attach it.',
    )
  }
  if (v.iconSource) lines.push(`Published on our own site at: ${v.iconSource}`)
  return lines.join('\n')
}

/** Markdown mirror of the issue form — used only when the template is absent. */
function fallbackBody(v: NormalisedListing, description: string): string {
  const kinds = LATCH_KIND_ORDER.map((k) => {
    const info = LATCH_KINDS[k]
    const code = info.contract ? ` (\`${info.contract}\`)` : ''
    return `- [${v.uses.includes(k) ? 'x' : ' '}] ${info.label}${code}`
  }).join('\n')

  const chains = v.chains.map((id) => `${id} (${chainLabel(id)})`).join(', ')

  return [
    '## Project',
    `- **Name:** ${v.name}`,
    `- **Description (${LISTING_LIMITS.description} characters or fewer):** ${description}`,
    `- **Category:** ${v.category}`,
    `- **Website:** ${v.url}`,
    `- **Public source repository (optional):** ${v.source}`,
    '',
    '## Built with',
    'Tick every Latch the project uses:',
    kinds,
    `- If "Their own Latch": contract address or Marketplace link: ${v.ownLatch}`,
    '',
    '## Chains',
    /* The example is the chain this build actually reads from. It was pinned to
       Sepolia, which asked every submitter on a Robinhood Chain deployment to
       copy an id for a network the app was not talking to. */
    `EIP-155 chain ids the integration is live on (for example \`${ACTIVE_CHAIN_ID}\` for ${DEPLOYMENTS[ACTIVE_CHAIN_ID].name}): ${chains}`,
    '',
    '## Icon (optional)',
    'Your own official mark, attached to this issue, with the URL it is published at.',
    iconText(v),
    '',
    '## Contact (optional)',
    v.contact,
    '',
    '## Confirmations',
    '- [ ] I represent this project and am authorised to list it.',
    '- [ ] I understand the listing is rendered as self-submitted and not verified by Latch Protocol.',
    '- [ ] I understand an icon is shown only if it is our own official asset with its source; otherwise the card shows a monogram.',
    '',
    '_Opened from the Latch ecosystem submission form._',
  ].join('\n')
}

function assemble(v: NormalisedListing, description: string, withBody: boolean): string {
  const p = new URLSearchParams()
  p.set('template', LISTING_TEMPLATE)
  p.set('labels', 'ecosystem')
  p.set('title', `Ecosystem listing: ${v.name || '[project name]'}`)

  const put = (id: string, value: string) => {
    if (value) p.set(id, value)
  }
  put(LISTING_FIELDS.name, v.name)
  put(LISTING_FIELDS.description, description)
  put(LISTING_FIELDS.url, v.url)
  put(LISTING_FIELDS.source, v.source)
  put(LISTING_FIELDS.category, v.category)
  put(LISTING_FIELDS.uses, v.uses.map((k) => `${LATCH_KINDS[k].label} (${k})`).join(', '))
  put(LISTING_FIELDS.ownLatch, v.ownLatch)
  put(LISTING_FIELDS.chains, v.chains.join(', '))
  put(LISTING_FIELDS.icon, iconText(v))
  put(LISTING_FIELDS.contact, v.contact)

  if (withBody) p.set('body', fallbackBody(v, description))
  return `${ECOSYSTEM_ISSUES_REPO}/issues/new?${p.toString()}`
}

/**
 * The prefilled issue, and whether the description had to be shortened to fit.
 *
 * Everything goes through `URLSearchParams`, so names with `&`, `#` or
 * non-ASCII characters survive the round trip.
 *
 * Two prefill mechanisms are used at once, on purpose:
 *   - the `LISTING_FIELDS` ids prefill the issue form when the template resolves;
 *   - `title` and `body` prefill a blank issue if it does not.
 * That doubles the description's cost in the URL, which is why the cut below
 * measures the assembled URL rather than guessing from the field length.
 *
 * The cut is by code point (`Array.from`), so an emoji or a CJK character is
 * never split into a broken surrogate, and a cut description ends in "…" so
 * the maintainer can see it was cut.
 */
export function buildListingIssue(prefill: ListingPrefill = {}): ListingIssue {
  const v = normalise(prefill)
  const chars = Array.from(v.description)
  const total = chars.length
  const cut = (n: number) => (n >= total ? v.description : `${chars.slice(0, n).join('')}…`)

  const full = assemble(v, v.description, true)
  if (full.length <= MAX_ISSUE_URL_LENGTH) {
    return { url: full, descriptionKeptChars: null, descriptionTotalChars: total, bodyOmitted: false, overLimit: false }
  }

  for (const withBody of [true, false]) {
    if (assemble(v, cut(0), withBody).length > MAX_ISSUE_URL_LENGTH) continue
    /* Largest n whose URL fits. `lo` always fits; `hi` is the upper bound. */
    let lo = 0
    let hi = total
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (assemble(v, cut(mid), withBody).length <= MAX_ISSUE_URL_LENGTH) lo = mid
      else hi = mid - 1
    }
    return {
      url: assemble(v, cut(lo), withBody),
      descriptionKeptChars: lo >= total ? null : lo,
      descriptionTotalChars: total,
      bodyOmitted: !withBody,
      overLimit: false,
    }
  }

  return {
    url: assemble(v, cut(0), false),
    descriptionKeptChars: 0,
    descriptionTotalChars: total,
    bodyOmitted: true,
    overLimit: true,
  }
}

/** The prefilled issue URL. See `buildListingIssue` for the length guard. */
export function listingIssueUrl(prefill: ListingPrefill = {}): string {
  return buildListingIssue(prefill).url
}
