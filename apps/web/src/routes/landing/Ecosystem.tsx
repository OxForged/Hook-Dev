/* ============================================================================
   Built on Latch — the landing page's featured apps, and how to get listed.

   STRUCTURE from Ink's "Featured apps" section: heading on the left, "View all
   apps" on the right, a grid of cards below. VISUALS are Option B tokens.

   WHY THIS IS ON THE LANDING PAGE AT ALL. The full directory is the public
   page /ecosystem; this section is its featured preview, for the visitor who
   never opens the header nav. The directory IS the marketing, and the
   submission form is worthless if the people who would submit never see it.

   ONE SOURCE OF TRUTH, NOT A COPY. The projects, the card and the form are all
   imported from routes/ecosystem/: data/ecosystem.ts, EcosystemCard.tsx and
   SubmitAppButton.tsx (which loads SubmitAppModal.tsx on demand, so the form
   is not part of this page's first paint). A second hand-kept list here would
   drift within a week, and a visitor cannot tell which surface is stale.

   WHICH CARDS. Only entries with `featured: true` — an editorial choice by
   Latch, documented on the field. Three states, each distinct:
     · no listings at all   → the honest empty state and the submit button
     · listings, none featured → a sentence and the link to the directory
     · featured listings    → the grid, exactly as many cards as there are
   Never padded out with examples to fill a row.

   PROVENANCE. `LISTING_PROVENANCE` renders in every card's footer. The
   placeholder `uses`/`chains` on the seeded entries (see the block above
   ECOSYSTEM_PROJECTS) are why that line has to stay on screen.
   ========================================================================== */

import { Link } from 'react-router-dom'

import { dappPath } from '../dapp/paths.ts'
import { sortedProjects } from '../ecosystem/data/ecosystem.ts'
import { EcosystemCard } from '../ecosystem/EcosystemCard.tsx'
import { SubmitAppButton } from '../ecosystem/SubmitAppButton.tsx'
import { LINKS } from './data'
import page from './landing.module.css'
import styles from './ecosystem.module.css'
import { cx } from './ui'

/** Ink shows two rows of three; more than that is the directory's job. */
const MAX_FEATURED = 6

export function Ecosystem() {
  const all = sortedProjects()
  const featured = all.filter((p) => p.featured === true).slice(0, MAX_FEATURED)

  return (
    <section
      id="ecosystem"
      className={cx(page['section'], page['reveal'])}
      aria-labelledby="ecosystem-title"
    >
      <div className={styles['head']}>
        <div className={styles['headText']}>
          <p className={page['eyebrow']}>ECOSYSTEM</p>
          <h2 id="ecosystem-title" className={page['h2']}>
            Built on Latch
          </h2>
        </div>
        <Link className={styles['viewAll']} to={LINKS.ecosystem}>
          View all apps <span aria-hidden="true">→</span>
        </Link>
      </div>
      <p className={cx(page['sectionLead'], page['sectionLeadStart'])}>
        Teams and products, not contracts — deployed Latches live in the{' '}
        <Link to={dappPath('marketplace')}>Marketplace</Link>, read from the registry.
      </p>

      {all.length === 0 ? (
        /* Never a row of example logos: a fabricated ecosystem misrepresents
           teams who never agreed to appear. */
        <div className={styles['empty']}>
          <p className={styles['emptyTitle']}>No apps are listed yet.</p>
          <p className={styles['emptyBody']}>
            The directory is open and free. Listing is a GitHub issue, merged as written — there is
            no application and nothing to pay.
          </p>
          <SubmitAppButton className="eco2-btn eco2-btn--primary">
            <span className="eco2-btn__plus" aria-hidden="true">
              +
            </span>
            Submit app
          </SubmitAppButton>
        </div>
      ) : (
        <>
          {featured.length === 0 ? (
            <p className={styles['none']}>
              No apps are featured right now.{' '}
              <Link to={LINKS.ecosystem}>
                Browse all {all.length === 1 ? '1 listed app' : `${all.length} listed apps`}
              </Link>
              .
            </p>
          ) : (
            <ul className={cx('eco2-grid', styles['grid'])} aria-label="Featured apps">
              {featured.map((p) => (
                <li key={`${p.name}|${p.url}`}>
                  <EcosystemCard project={p} />
                </li>
              ))}
            </ul>
          )}

          <div className={styles['foot']}>
            <p className={styles['footNote']}>
              Building on Latch? Listing is free — a prefilled GitHub issue, merged as written.
            </p>
            <SubmitAppButton className="eco2-btn">
              <span className="eco2-btn__plus" aria-hidden="true">
                +
              </span>
              Submit app
            </SubmitAppButton>
          </div>
        </>
      )}

    </section>
  )
}
