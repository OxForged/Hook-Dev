/* ============================================================================
   Who is building on Latch — and how to get listed.

   WHY THIS IS ON THE LANDING PAGE AT ALL. It was only inside the dapp, at
   /app/ecosystem, which is the one place a visitor evaluating the protocol will
   not look: reaching it means launching an app you have not decided to trust
   yet. Every protocol that runs a directory puts it on the marketing site,
   because the directory IS the marketing — and because the submission form is
   worthless if the people who would submit never see it.

   ONE SOURCE OF TRUTH, NOT A COPY. Everything here is imported from
   routes/dapp/data/ecosystem.ts: the projects, the kind labels, the provenance
   string, the monogram fallback, and the issue-URL builder. A second hand-kept
   list on the landing page would drift within a week, and the two surfaces
   would disagree about who is in the ecosystem — which is a worse failure than
   not having the section, because a visitor cannot tell which one is stale.

   THIS IS A SUMMARY SURFACE, NOT A REPLACEMENT. No filters, no chain-count
   panel, no search. Those belong to the full directory, and the "see all" link
   goes there. The job here is: does anyone use this, and how do I join them.

   PROVENANCE IS NOT OPTIONAL AND NOT SHRINKABLE. `LISTING_PROVENANCE` renders
   on the section, exactly as it renders on every card in the dapp. Right now
   the directory carries three placeholder listings whose `uses` and `chains`
   fields were seeded rather than submitted — see the block comment above
   ECOSYSTEM_PROJECTS — so the "self-reported, unverified" stamp is doing real
   work, and it must not be softened into a footnote.
   ========================================================================== */

import { Link } from 'react-router-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  LATCH_KINDS,
  LISTING_PROVENANCE,
  hostOf,
  listingIssueUrl,
  monogramFor,
  sortedProjects,
} from '../dapp/data/ecosystem.ts'
import page from './landing.module.css'
import styles from './ecosystem.module.css'
import { cx } from './ui'

/**
 * How far one arrow press moves the track.
 *
 * A fraction of the visible width rather than a card count, because the number
 * of visible cards changes with the viewport and "one card" at 400px is a
 * different gesture from "one card" at 1600px. 0.9 leaves a sliver of the
 * outgoing card on screen, which is what tells a reader the row continues.
 */
const PAGE_FRACTION = 0.9

/**
 * A horizontally scrolling strip, with the emphasis on SCROLLING.
 *
 * This is not an auto-advancing carousel and must not become one. Content that
 * moves on a timer is a documented accessibility failure — it steals reading
 * position, it is unusable for anyone who reads slowly, and WCAG 2.2.2 requires
 * a pause control for it. Every mechanism here is reader-driven: swipe, wheel,
 * arrow keys, or the two buttons.
 *
 * It degrades in the right order. With no JS the track is still a native
 * scroller and every card is reachable; the arrow buttons simply never appear,
 * because their visibility is computed from a measured overflow. Nothing is
 * hidden behind a script.
 */
function useCarousel() {
  const ref = useRef<HTMLDivElement | null>(null)
  /* Three separate facts, and `overflow` is deliberately NOT derived from the
     other two. Deriving it (`!(atStart && atEnd)`) conflates "the track fits"
     with "the reader happens to be at both ends", and a one-card track is
     legitimately at the start and the end at once — so the derived form
     answers false for a track that genuinely does overflow the moment those
     tolerances round together. Measure the thing you actually mean. */
  const [overflow, setOverflow] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const measure = useCallback(() => {
    const el = ref.current
    if (el === null) return
    /* A 1px tolerance: fractional layout means scrollLeft rarely lands exactly
       on the end, and a button that stays enabled at the end does nothing when
       pressed, which reads as broken. */
    setOverflow(el.scrollWidth - el.clientWidth > 1)
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
  }, [])

  /* useLayoutEffect for the FIRST measurement, so the buttons are correct in
     the same paint as the cards rather than flashing in a frame later. */
  useLayoutEffect(measure, [measure])

  useEffect(() => {
    const el = ref.current
    if (el === null) return

    el.addEventListener('scroll', measure, { passive: true })

    /* THREE listeners, because no one of them is reliable on its own.

       ResizeObserver is the right tool and it is not sufficient: it delivers
       before paint, so a THROTTLED OR BACKGROUND TAB does not run it at all —
       verified in this app, where an observer in a background tab never even
       received its guaranteed initial callback. That is the same class of
       failure that once blanked a whole section here, and the rule it produced
       is that nothing a reader needs may depend on a callback a throttled tab
       will not deliver.

       So: RO for container-only changes (a sidebar opening, a font landing),
       window resize as the coarse fallback that survives throttling, and the
       scroll listener for the end-stop states.

       The degradation matters more than any of them. If every listener stayed
       silent the buttons would simply never appear — and the track is a native
       scroller, so every card is still reachable by swipe, wheel and keyboard.
       The controls are an accelerator, never the only way through. */
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    /* The strip too, not just the track: RO fires on the observed element's own
       box, so watching only the container misses the case where the CONTENT
       grows — a listing added, an image finally loading — which is exactly when
       a non-overflowing track becomes an overflowing one. */
    const strip = el.firstElementChild
    if (strip !== null) ro.observe(strip)

    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [measure])

  const page = useCallback((dir: -1 | 1) => {
    const el = ref.current
    if (el === null) return
    /* Honour the OS setting. A smooth-scrolled carousel is exactly the kind of
       motion `prefers-reduced-motion` exists to suppress. */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({
      left: dir * el.clientWidth * PAGE_FRACTION,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [])

  return { ref, atStart, atEnd, page, scrollable: overflow }
}

export function Ecosystem() {
  const all = sortedProjects()
  const car = useCarousel()

  return (
    <section
      id="ecosystem"
      className={cx(page['section'], page['reveal'])}
      aria-labelledby="ecosystem-title"
    >
      <p className={page['eyebrow']}>ECOSYSTEM</p>
      <h2 id="ecosystem-title" className={cx(page['h2'], page['h2Small'])}>
        Who is <span className={page['accent']}>building on it</span>.
      </h2>
      <p className={cx(page['sectionLead'], page['sectionLeadStart'])}>
        Teams and products, not contracts — deployed Latches live in the{' '}
        <Link to="/app/marketplace">Marketplace</Link>, read from the registry.
      </p>

      {all.length === 0 ? (
        /* An honest empty state, which is the correct output until somebody
           real submits. Never a row of example logos: a fabricated ecosystem
           misrepresents teams who never agreed to appear, which the directory's
           own file header calls worse than an invented chart. */
        <div className={styles['empty']}>
          <p className={styles['emptyTitle']}>No projects are listed yet.</p>
          <p className={styles['emptyBody']}>
            The directory is open and free. Listing is a GitHub issue, merged as written — there is
            no application and nothing to pay.
          </p>
          <a className={styles['cta']} href={listingIssueUrl()} target="_blank" rel="noreferrer">
            Be the first to list
            <span aria-hidden="true"> ↗</span>
          </a>
        </div>
      ) : (
        <>
          <div className={styles['carousel']}>
            {/* tabindex on the scroller: a scrollable region that is not
                focusable cannot be scrolled by keyboard at all, which strands
                every card past the first screenful. The label tells a screen
                reader what the region is before they arrow through it. */}
            <div
              className={styles['track']}
              ref={car.ref}
              tabIndex={0}
              role="group"
              aria-label="Projects building on Latch — scroll for more"
            >
              <ul className={styles['strip']}>
                {all.map((p) => (
              <li key={p.name} className={styles['card']}>
                <a
                  className={styles['cardLink']}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  /* The whole card is the link, so the accessible name has to
                     say where it goes — "Peddles" alone, repeated six times in
                     a list, tells a screen-reader user nothing about the
                     destination being off-site. */
                  aria-label={`${p.name} — ${hostOf(p.url)} (opens in a new tab)`}
                >
                  <span className={styles['mark']} aria-hidden="true">
                    {p.logo === undefined ? (
                      /* The monogram is the honest fallback for a project with
                         no sourceable mark. public/ecosystem/SOURCES.md records
                         why each missing one is missing. */
                      <span className={styles['monogram']}>{monogramFor(p.name)}</span>
                    ) : (
                      <img src={p.logo} alt="" width={40} height={40} loading="lazy" />
                    )}
                  </span>

                  <span className={styles['cardBody']}>
                    <span className={styles['name']}>{p.name}</span>
                    <span className={styles['host']}>{hostOf(p.url)}</span>
                    <span className={styles['tagline']}>{p.tagline}</span>
                  </span>
                </a>

                <ul className={styles['kinds']} aria-label={`What ${p.name} says it uses`}>
                  {p.uses.map((k) => (
                    <li key={k} className={styles['kind']} title={LATCH_KINDS[k].meaning}>
                      {LATCH_KINDS[k].label}
                    </li>
                  ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>

            {/* Rendered only when the track actually overflows — measured, not
                guessed. Two buttons that do nothing is worse than no buttons. */}
            {car.scrollable ? (
              <div className={styles['nav']}>
                <button
                  type="button"
                  className={styles['navBtn']}
                  onClick={() => car.page(-1)}
                  disabled={car.atStart}
                  aria-label="Scroll to previous projects"
                >
                  <span aria-hidden="true">←</span>
                </button>
                <button
                  type="button"
                  className={styles['navBtn']}
                  onClick={() => car.page(1)}
                  disabled={car.atEnd}
                  aria-label="Scroll to more projects"
                >
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            ) : null}
          </div>

          <div className={styles['foot']}>
            {/* The same string the dapp stamps on every card, imported rather
                than retyped. It is the whole reason this section is allowed to
                exist without a verification pipeline behind it. */}
            <p className={styles['provenance']}>{LISTING_PROVENANCE}</p>

            <div className={styles['actions']}>
              <a className={styles['cta']} href={listingIssueUrl()} target="_blank" rel="noreferrer">
                List your project
                <span aria-hidden="true"> ↗</span>
              </a>
              <Link className={styles['secondary']} to="/app/ecosystem">
                Open the full directory
                <span aria-hidden="true"> →</span>
              </Link>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
