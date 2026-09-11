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
  /** Which Latch families the project says it uses. At least one. */
  readonly uses: readonly LatchKind[]
  /** EIP-155 chain ids the project says the integration is live on. At least one. */
  readonly chains: readonly number[]
  /** ISO date (YYYY-MM-DD) the listing was merged. Not the project's launch date. */
  readonly addedAt: string
  /**
   * LOGO SLOT — intentionally empty on every entry until a real asset exists.
   *
   * Path under `public/ecosystem/` to a mark supplied by the project itself,
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
 * EMPTY ON PURPOSE. Read the file header before adding anything. An entry is
 * added by merging a listing issue opened by the project through
 * `listingIssueUrl()`; it is not added because a project looks like it belongs.
 */
export const ECOSYSTEM_PROJECTS: readonly EcosystemProject[] = []

/* ---- provenance: a property of the surface, not a field ------------------- */

/** Rendered on every card and in the header. One string so it cannot drift. */
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

export interface ListingPrefill {
  readonly name?: string
  readonly url?: string
}

/** Markdown mirror of the issue form — used only when the template is absent. */
function fallbackBody(name: string, url: string): string {
  const kinds = LATCH_KIND_ORDER.map((k) => {
    const info = LATCH_KINDS[k]
    const code = info.contract ? ` (\`${info.contract}\`)` : ''
    return `- [ ] ${info.label}${code}`
  }).join('\n')

  return [
    '## Project',
    `- **Name:** ${name}`,
    '- **Tagline (one line, 120 characters or fewer):** ',
    `- **Website:** ${url}`,
    '- **Public source repository (optional):** ',
    '',
    '## Built with',
    'Tick every Latch the project uses:',
    kinds,
    '- If "Their own Latch": contract address or Marketplace link: ',
    '',
    '## Chains',
    'EIP-155 chain ids the integration is live on (for example `11155111` for Sepolia): ',
    '',
    '## Confirmations',
    '- [ ] I represent this project and am authorised to list it.',
    '- [ ] I understand the listing is rendered as self-submitted and not verified by Latch Protocol.',
    '- [ ] I understand there is no logo unless we later supply our own official asset with its source.',
    '',
    '_Opened from the Latch dapp ecosystem directory._',
  ].join('\n')
}

/**
 * The prefilled issue URL. Everything goes through `URLSearchParams`, so
 * project names with `&`, `#` or non-ASCII characters survive the round trip.
 *
 * Two prefill mechanisms are used at once, on purpose:
 *   - `project_name` and `url` match the issue form's field ids and prefill the
 *     form when the template resolves.
 *   - `title` and `body` prefill a blank issue if it does not.
 */
export function listingIssueUrl(prefill: ListingPrefill = {}): string {
  const name = prefill.name?.trim() ?? ''
  const url = prefill.url?.trim() ?? ''

  const p = new URLSearchParams()
  p.set('template', LISTING_TEMPLATE)
  p.set('labels', 'ecosystem')
  p.set('title', `Ecosystem listing: ${name || '[project name]'}`)
  if (name) p.set('project_name', name)
  if (url) p.set('url', url)
  p.set('body', fallbackBody(name, url))

  return `${ECOSYSTEM_ISSUES_REPO}/issues/new?${p.toString()}`
}
