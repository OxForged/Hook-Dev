/* ============================================================================
   One ecosystem listing, as a card. Shared by the landing page's "Built on
   Latch" section and the /app/ecosystem directory, so the two surfaces can
   never disagree about what a listing looks like or what it says.

   STRUCTURE from Ink's app directory (large logo tile, badges top-right, name,
   clamped description, category chips along the bottom, the whole card one
   link). VISUALS from Option B tokens. Nothing of Ink's is copied.

   WHAT THE CARD MAY SAY, and why each piece is allowed:
     · Logo — the project's own asset from `logo`, on a neutral tile, never
       tinted or cropped. Absent → the typographic monogram (`monogramFor`).
     · "Featured" — rendered only when `featured` is true, which is an
       editorial choice by Latch (see the field's doc comment). There is no
       other badge, because no other field exists to back one.
     · Category and Latch families — the project's own claims, as quiet chips.
     · Chains — through `ChainTag`, the one component allowed to name a chain.
     · `LISTING_PROVENANCE` — always, in the footer. It is what qualifies
       every other line on the card and must never be dropped.

   The whole card is the hit target via a stretched link: the anchor's ::after
   covers the card, so there is exactly one link, one tab stop, and an
   accessible name that says where it goes.
   ============================================================================ */

import { ChainTag } from '../../../components/ChainTag.tsx'
import { safeHttpUrl } from './latchModel.ts'
import {
  LATCH_KINDS,
  LISTING_PROVENANCE,
  hostOf,
  monogramFor,
  type EcosystemProject,
} from '../data/ecosystem.ts'
import './ecosystemCard.css'

/** A supplied official asset, or a monogram. Never an approximation of a logo. */
function LogoTile({ project }: { project: EcosystemProject }) {
  if (project.logo) {
    return (
      <span className="eco2-card__tile eco2-card__tile--img" aria-hidden="true">
        <img src={project.logo} alt="" width={72} height={72} loading="lazy" decoding="async" />
      </span>
    )
  }
  const mono = monogramFor(project.name)
  return (
    <span className="eco2-card__tile eco2-card__tile--mono" data-len={mono.length} aria-hidden="true">
      {mono}
    </span>
  )
}

interface EcosystemCardProps {
  readonly project: EcosystemProject
  /** Heading level for the name, so the card fits the outline it is placed in. */
  readonly headingLevel?: 3 | 4
}

export function EcosystemCard({ project, headingLevel = 3 }: EcosystemCardProps) {
  const site = safeHttpUrl(project.url)
  const Heading = headingLevel === 4 ? 'h4' : 'h3'

  return (
    <article className="eco2-card" data-linked={site ? 'true' : 'false'}>
      <div className="eco2-card__top">
        <LogoTile project={project} />
        {project.featured ? (
          <ul className="eco2-card__badges" aria-label="Badges">
            <li className="eco2-badge">Featured</li>
          </ul>
        ) : null}
      </div>

      <Heading className="eco2-card__name">
        {site ? (
          <a
            className="eco2-card__link"
            href={site}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${project.name}, ${hostOf(site)} (opens in a new tab)`}
          >
            {project.name}
          </a>
        ) : (
          project.name
        )}
      </Heading>
      <p className="eco2-card__host">{site ? hostOf(site) : 'No usable link'}</p>

      {/* Their words, never a claim this page makes. */}
      <p className="eco2-card__tagline">{project.tagline}</p>

      <ul className="eco2-card__chips" aria-label={`${project.name}: category and Latches it says it uses`}>
        <li className="eco2-chip eco2-chip--category">{project.category}</li>
        {project.uses.map((k) => (
          <li key={k} className="eco2-chip">
            {LATCH_KINDS[k].label}
          </li>
        ))}
      </ul>

      <footer className="eco2-card__foot">
        <ul className="eco2-card__chains" aria-label={`Chains ${project.name} says it is live on`}>
          {project.chains.map((id) => (
            <li key={id}>
              <ChainTag chainId={id} size={14} />
            </li>
          ))}
        </ul>
        <p className="eco2-card__prov">{LISTING_PROVENANCE}</p>
      </footer>
    </article>
  )
}
