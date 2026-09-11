/* ============================================================================
   Ecosystem — the directory of third-party projects building on Latch.

   A Latch is a hook contract attached to a pool. The Marketplace lists those
   contracts, read from the on-chain registry. THIS page lists the teams and
   products that use them — and that is information no chain holds, so it comes
   from a curated file in the repo (data/ecosystem.ts) and is added to by a
   GitHub issue the project opens itself.

   The consequence, and the thing every part of this layout says out loud: a
   listing here is the project's own words, merged as written. Nobody has
   checked that the integration exists, works, or is safe. That status is a
   property of the whole surface — it is in the header badge and on every card —
   rather than a per-entry flag that nothing could ever set the other way.

   The layout is the Marketplace's, on purpose: the same rail, toolbar, grid and
   card grammar, so the two pages read as the same product. What is NOT copied
   is the trust strip and the capability ledger, because there is no on-chain
   fact here to put in them. Where the Marketplace card leads with what the
   registry decoded from bytecode, this card leads with a monogram and a name
   and says whose words the rest are.

   With zero entries — the state this ships in — the page is the empty state,
   the legend and the submission panel. There is no filter row over nothing.
   ============================================================================ */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ChainTag, chainNameFor } from '../../../components/ChainTag.tsx'
import { BarList } from '../components/charts.tsx'
import { safeHttpUrl } from '../components/latchModel.ts'
import {
  ECOSYSTEM_ISSUES_REPO,
  ECOSYSTEM_PROJECTS,
  LATCH_KINDS,
  LATCH_KIND_ORDER,
  LISTING_PROVENANCE,
  chainCounts,
  chainsListed,
  hostOf,
  listingIssueUrl,
  monogramFor,
  sortedProjects,
  type EcosystemProject,
  type LatchKind,
} from '../data/ecosystem.ts'
import type { LabelledBar, SeriesColor } from '../data/types.ts'
import { dappPath } from '../paths.ts'

/** A keystroke should not interrupt the previous announcement (see Explorer). */
const ANNOUNCE_DELAY_MS = 700

function resultSentence(matched: number): string {
  if (matched === 0) return 'No projects match.'
  return matched === 1 ? '1 project matches.' : `${matched} projects match.`
}

function matchesQuery(p: EcosystemProject, q: string): boolean {
  if (!q) return true
  return (
    p.name.toLowerCase().includes(q) ||
    p.tagline.toLowerCase().includes(q) ||
    hostOf(p.url).toLowerCase().includes(q) ||
    p.uses.some((k) => LATCH_KINDS[k].label.toLowerCase().includes(q))
  )
}

/* ---- the mark ---------------------------------------------------------------- */

/**
 * A supplied official asset, or a typographic monogram. Never an approximation
 * of the project's logo — see the `logo` slot on EcosystemProject.
 */
function ProjectMark({ project }: { project: EcosystemProject }) {
  if (project.logo) {
    return (
      <img
        className="eco-mark eco-mark--img"
        src={project.logo}
        alt=""
        width={48}
        height={48}
        loading="lazy"
        decoding="async"
      />
    )
  }
  const mono = monogramFor(project.name)
  return (
    <span
      className="eco-mark"
      data-len={mono.length}
      role="img"
      aria-label={`${project.name} — no logo supplied, shown as a monogram`}
    >
      <span aria-hidden="true">{mono}</span>
    </span>
  )
}

/* ---- one listing --------------------------------------------------------------- */

function ProjectCard({ project, index }: { project: EcosystemProject; index: number }) {
  const site = safeHttpUrl(project.url)
  const source = project.source ? safeHttpUrl(project.source) : null

  return (
    <article className="dapp-card eco-card" style={{ animationDelay: `${(index * 0.05).toFixed(2)}s` }}>
      <header className="eco-card__top">
        <ProjectMark project={project} />
        <div className="eco-card__id">
          <h3 className="eco-card__name">
            {site ? (
              // The whole card is the hit target — this anchor's ::after covers
              // it; the source link below is lifted above the overlay.
              <a className="eco-card__go" href={site} target="_blank" rel="noopener noreferrer">
                {project.name}
              </a>
            ) : (
              project.name
            )}
          </h3>
          <p className="eco-card__sub">
            <span>{site ? hostOf(site) : 'No usable link'}</span>
            <span className="eco-card__dot" aria-hidden="true">
              ·
            </span>
            <span>
              listed <time dateTime={project.addedAt}>{project.addedAt}</time>
            </span>
          </p>
        </div>
        {site && (
          <span className="eco-card__cta" aria-hidden="true">
            Visit
          </span>
        )}
      </header>

      {/* Their words. Styled as prose and never as a claim this page makes. */}
      <p className="eco-card__tag">{project.tagline}</p>

      <dl className="eco-facts">
        <div className="eco-facts__row">
          <dt className="dapp-microlabel dapp-microlabel--tight">USES</dt>
          <dd>
            <ul className="eco-uses" aria-label="Latches this project says it uses">
              {project.uses.map((k) => (
                <li key={k}>
                  <span
                    className="dapp-badge dapp-badge--info"
                    title={LATCH_KINDS[k].contract ?? 'A hook contract the project authored'}
                  >
                    {LATCH_KINDS[k].label}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="eco-facts__row">
          <dt className="dapp-microlabel dapp-microlabel--tight">CHAINS</dt>
          <dd>
            <ul className="eco-chains" aria-label="Chains this project says it is live on">
              {project.chains.map((id) => (
                <li key={id}>
                  <ChainTag chainId={id} size={13} />
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <footer className="eco-card__foot">
        <span className="eco-card__by">{LISTING_PROVENANCE}</span>
        <span className="lx-links">
          {source ? (
            <a href={source} target="_blank" rel="noopener noreferrer">
              Source ↗
            </a>
          ) : (
            <span className="hx-muted">No source given</span>
          )}
        </span>
      </footer>
    </article>
  )
}

/* ---- the rail ------------------------------------------------------------------- */

/**
 * The submission panel. Two optional inputs that only shape the URL of the
 * issue — there is no submit handler, no fetch and nothing stored. The anchor
 * IS the submission; the inputs just save retyping the two fields that make a
 * listing identifiable.
 */
function SubmitPanel() {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const href = useMemo(() => listingIssueUrl({ name, url }), [name, url])

  return (
    <section className="dapp-card lx-rail__card eco-submit" aria-labelledby="eco-submit-h">
      <h2 id="eco-submit-h" className="dapp-card__title">
        Submit your project
      </h2>
      <p className="live-note">
        Free and open to any team building on Latch. It is a GitHub issue, merged as written.
      </p>

      <div className="eco-field">
        <label className="dapp-microlabel dapp-microlabel--tight" htmlFor="eco-name">
          PROJECT NAME
        </label>
        <input
          id="eco-name"
          className="eco-input"
          type="text"
          autoComplete="organization"
          spellCheck={false}
          maxLength={80}
          placeholder="Optional — prefills the issue"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="eco-field">
        <label className="dapp-microlabel dapp-microlabel--tight" htmlFor="eco-url">
          WEBSITE
        </label>
        <input
          id="eco-url"
          className="eco-input"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          maxLength={200}
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <a
        className="dapp-btn dapp-btn--primary dapp-btn--sm eco-submit__go"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open listing issue ↗
      </a>
      <p className="live-note eco-submit__note">
        Nothing is sent from this page — the issue is the submission.
      </p>
    </section>
  )
}

/* ============================================================================
   Where the listings say they are live.

   THE ONLY THING ON THIS PAGE THAT CAN BE COUNTED. Nothing here is a chain
   read — `chainCounts` counts the `chains` field of entries in
   `data/ecosystem.ts`, which each project wrote itself. So the bars are an
   honest count of CLAIMS, and the caption says exactly that rather than letting
   a chart borrow the authority the Marketplace's charts have.

   A project that named three chains is one listing on each of three bars, so
   the bars can sum past the listing count. The share is a share of listings,
   not of bars, which is why `shareLabel` names its denominator.

   Not rendered at all when the directory is empty: three chains at zero would
   be a chart about nothing, and the empty state already says it in a sentence.
   ============================================================================ */
const CHAIN_SERIES: readonly SeriesColor[] = ['primary', 'signal', 'violet', 'success', 'amber']

function ChainMix({ projects }: { projects: readonly EcosystemProject[] }) {
  const bars: LabelledBar[] = useMemo(
    () =>
      chainCounts(projects).map(({ chainId, count }, i) => ({
        name: chainNameFor(chainId),
        value: String(count),
        pct: (count / projects.length) * 100,
        color: CHAIN_SERIES[i % CHAIN_SERIES.length] as SeriesColor,
      })),
    [projects],
  )

  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="eco-mix-h">
      <h2 id="eco-mix-h" className="dapp-card__title">
        Chains claimed
      </h2>
      <BarList items={bars} valueLabel="listings" shareLabel="of the listings" />
      <p className="live-note">
        Counted from what each project wrote in its own listing. A project spanning several chains
        is counted on each.
      </p>
    </section>
  )
}

/** What the USES badges mean. Every row names a contract family in this repo. */
function KindLegend() {
  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="eco-kinds-h">
      <h2 id="eco-kinds-h" className="dapp-card__title">
        Reading the badges
      </h2>
      <p className="live-note">
        The badge is the project&rsquo;s claim; the contract name is what the family is called on
        chain.
      </p>
      <ul className="lx-legend">
        {LATCH_KIND_ORDER.map((k) => {
          const info = LATCH_KINDS[k]
          return (
            <li key={k}>
              <span className="dapp-badge dapp-badge--info">{info.label}</span>
              <span>
                {info.contract && <code className="eco-legend__code">{info.contract}</code>}
                {info.meaning}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="eco-how-h">
      <h2 id="eco-how-h" className="dapp-card__title">
        How listings work
      </h2>
      <dl className="live-grid eco-how">
        <div>
          <dt>Source</dt>
          <dd>
            A file in this site&rsquo;s repository, <code>data/ecosystem.ts</code>. Not a chain
            read.
          </dd>
        </div>
        <div>
          <dt>Added by</dt>
          <dd>
            The project itself, through a{' '}
            <a href={`${ECOSYSTEM_ISSUES_REPO}/issues`} target="_blank" rel="noopener noreferrer">
              GitHub issue ↗
            </a>
            .
          </dd>
        </div>
        <div>
          <dt>Verified</dt>
          <dd>
            No — for any entry. The label on each card is the status of the whole page, not a flag
            that could flip.
          </dd>
        </div>
      </dl>
      <p className="live-note lx-rail__note">
        Want the contracts rather than the teams? The <Link to={dappPath('marketplace')}>Marketplace</Link>{' '}
        reads every listed Latch from the registry and decodes what its bytecode can do.
      </p>
    </section>
  )
}

/* ---- the screen ------------------------------------------------------------------ */

export default function Ecosystem() {
  const all = useMemo(() => sortedProjects(ECOSYSTEM_PROJECTS), [])
  const chains = useMemo(() => chainsListed(all), [all])

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<LatchKind | 'all'>('all')
  const [chain, setChain] = useState<number | 'all'>('all')

  const q = query.trim().toLowerCase()
  const filtersOn = kind !== 'all' || chain !== 'all' || q !== ''

  const visible = useMemo(
    () =>
      all.filter(
        (p) =>
          matchesQuery(p, q) &&
          (kind === 'all' || p.uses.includes(kind)) &&
          (chain === 'all' || p.chains.includes(chain)),
      ),
    [all, q, kind, chain],
  )

  /* The count is announced once it has settled, not on every keystroke. */
  const summary = all.length > 0 ? resultSentence(visible.length) : ''
  const [settled, setSettled] = useState('')
  useEffect(() => {
    if (summary === '') return
    const t = window.setTimeout(() => setSettled(summary), ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [summary])

  const clear = () => {
    setQuery('')
    setKind('all')
    setChain('all')
  }

  return (
    <div className="lx-layout">
      <div className="lx-main">
        <section className="dapp-card hx-head eco-head" aria-labelledby="eco-h">
          <div className="dapp-card__head">
            <h2 id="eco-h" className="dapp-card__title dapp-card__title--lg">
              Projects building on Latch
            </h2>
            {/* Not a LIVE badge. Nothing on this page is read from chain, and
                the badge that says so has to be the first thing after the title. */}
            <span className="dapp-badge dapp-badge--mute">SELF-SUBMITTED · UNVERIFIED</span>
          </div>
          {/* The last sentence is the caveat, not padding: without it a
              directory of names reads as a directory of endorsements. */}
          <p className="live-note">
            Teams and products, not contracts — those are on the{' '}
            <Link to={dappPath('marketplace')}>Marketplace</Link>, read from the registry. Every
            entry here was written by the project itself and merged as submitted, so a listing says
            a team asked to be listed. It does not say the integration works, is safe, or is
            still live.
          </p>
        </section>

        {all.length > 0 && (
          <div className="lx-toolbar">
            <div className="dapp-search lx-search">
              <span className="dapp-search__ring" aria-hidden="true" />
              <input
                type="search"
                className="dapp-search__input"
                placeholder="Search projects by name, tagline or site…"
                aria-label="Search projects by name, tagline or site"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="hx-filters">
              <div className="hx-filterset">
                <p className="dapp-microlabel dapp-microlabel--tight" id="eco-f-kind">
                  USES
                </p>
                <div className="dapp-chips dapp-chips--tight" role="group" aria-labelledby="eco-f-kind">
                  <button
                    type="button"
                    className={kind === 'all' ? 'dapp-chip is-active' : 'dapp-chip'}
                    aria-pressed={kind === 'all'}
                    onClick={() => setKind('all')}
                  >
                    All
                    <span className="hx-count">{all.length}</span>
                  </button>
                  {LATCH_KIND_ORDER.map((k) => {
                    const n = all.filter((p) => p.uses.includes(k)).length
                    if (n === 0) return null
                    return (
                      <button
                        key={k}
                        type="button"
                        className={kind === k ? 'dapp-chip is-active' : 'dapp-chip'}
                        aria-pressed={kind === k}
                        onClick={() => setKind(k)}
                      >
                        {LATCH_KINDS[k].label}
                        <span className="hx-count">{n}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="hx-filterset">
                <p className="dapp-microlabel dapp-microlabel--tight" id="eco-f-chain">
                  CHAIN
                </p>
                <div className="dapp-chips dapp-chips--tight" role="group" aria-labelledby="eco-f-chain">
                  <button
                    type="button"
                    className={chain === 'all' ? 'dapp-chip is-active' : 'dapp-chip'}
                    aria-pressed={chain === 'all'}
                    onClick={() => setChain('all')}
                  >
                    All
                    <span className="hx-count">{all.length}</span>
                  </button>
                  {chains.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={chain === id ? 'dapp-chip is-active eco-chip' : 'dapp-chip eco-chip'}
                      aria-pressed={chain === id}
                      aria-label={chainNameFor(id)}
                      onClick={() => setChain(id)}
                    >
                      <ChainTag chainId={id} size={13} className="eco-chip__tag" />
                      <span className="hx-count">{all.filter((p) => p.chains.includes(id)).length}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <p className="dapp-sr" role="status" aria-live="polite">
          {summary === '' ? '' : settled}
        </p>

        {all.length === 0 && (
          <section className="dapp-card eco-empty" aria-labelledby="eco-empty-h">
            <span className="dapp-tile eco-empty__tile" aria-hidden="true">
              <span className="dapp-tile__diamond" />
            </span>
            <div className="eco-empty__body">
              <h3 id="eco-empty-h" className="eco-empty__title">
                No projects are listed yet.
              </h3>
              <p>
                Any team building on Latch can list itself with a GitHub issue — no review queue,
                no fee. It ships empty rather than seeded: every entry names a real third party
                that asked to be here, and none has yet.
              </p>
              <p className="eco-empty__aside">
                Looking for the Latches themselves? They are on the{' '}
                <Link to={dappPath('marketplace')}>Marketplace</Link>, read from the on-chain
                registry.
              </p>
              <a
                className="dapp-btn dapp-btn--primary dapp-btn--sm eco-empty__cta"
                href={listingIssueUrl()}
                target="_blank"
                rel="noopener noreferrer"
              >
                Be the first — open a listing issue ↗
              </a>
            </div>
          </section>
        )}

        {visible.length > 0 && (
          <>
            <p className="lx-count" role="presentation">
              <span>
                {visible.length === 1 ? '1 project' : `${visible.length} projects`}
                {filtersOn ? ' matching' : ' listed'}
              </span>
              <span className="lx-count__note">— {LISTING_PROVENANCE}.</span>
            </p>
            <div className="lx-grid">
              {visible.map((p, i) => (
                <ProjectCard key={`${p.name}|${p.url}`} project={p} index={i} />
              ))}
            </div>
          </>
        )}

        {all.length > 0 && visible.length === 0 && (
          <p className="dapp-empty hx-state">
            No project matches that {filtersOn ? 'search and filter' : 'view'}.{' '}
            <button type="button" className="hx-linkbtn" onClick={clear}>
              Clear filters
            </button>
          </p>
        )}
      </div>

      <aside className="lx-rail" aria-label="Submit a project and how to read this page">
        <SubmitPanel />
        {all.length > 0 && <ChainMix projects={all} />}
        <KindLegend />
        <HowItWorks />
      </aside>
    </div>
  )
}
