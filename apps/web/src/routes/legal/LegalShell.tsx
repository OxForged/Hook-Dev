import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import landing from '../landing/landing.module.css'
import { SiteFooter } from '../landing/SiteFooter'
import { SiteHeader } from '../landing/SiteHeader'
import styles from './legal.module.css'

/**
 * Shared chrome for /privacy and /terms.
 *
 * Same page ground, header and footer as the landing page — these are not a
 * separate product, and a legal page that looks like it came from a different
 * site reads as less trustworthy, not more. Only the running-copy styles are
 * new, because the landing page has no long-form prose to borrow.
 *
 * THE DRAFT NOTICE IS NOT OPTIONAL. Both documents are un-reviewed text
 * written from what the code actually does. Presenting them as a finalised,
 * binding policy would be the exact misrepresentation they are supposed to
 * avoid, so the notice renders above the content, in the flow, on every legal
 * page — never behind a disclosure, never in the footer.
 */
export function LegalShell({
  eyebrow,
  title,
  lastUpdated,
  intro,
  children,
  otherHref,
  otherLabel,
}: {
  eyebrow: string
  title: string
  /** ISO date. Rendered verbatim so there is no locale ambiguity. */
  lastUpdated: string
  intro: ReactNode
  children: ReactNode
  otherHref: string
  otherLabel: string
}) {
  // The app is a single-page router, so the tab title would otherwise keep
  // saying whatever the previous route set.
  useEffect(() => {
    const previous = document.title
    document.title = `${title} — Latch Protocol`
    return () => {
      document.title = previous
    }
  }, [title])

  return (
    <div className={landing['page']}>
      <SiteHeader />
      <main>
        <div className={styles['wrap']}>
          <p className={landing['eyebrow']}>{eyebrow}</p>
          <h1 className={landing['h1']}>{title}</h1>
          <p className={styles['meta']}>
            <span>Last updated: {lastUpdated}</span>
            <span>Status: draft, pending legal review</span>
          </p>

          <div className={styles['draft']} role="note">
            <span className={styles['draftDot']} aria-hidden="true" />
            <p className={styles['draftBody']}>
              <strong className={styles['draftLabel']}>Draft — not legal advice</strong>
              This document is a good-faith draft written from what this site&rsquo;s code
              actually does. It has <strong className={styles['strong']}>not</strong> been
              reviewed by qualified legal counsel, it is not legal advice, and it is not yet a
              finalised or binding agreement. It is published in this state so that it can be
              read and corrected in the open. Treat every statement below as a description of
              intent and of observed behaviour, pending review.
            </p>
          </div>

          <div className={styles['summary']}>{intro}</div>

          {children}

          <nav className={styles['jump']} aria-label="Other legal documents">
            <Link to={otherHref} className={styles['jumpLink']}>
              {otherLabel} &rarr;
            </Link>
            <Link to="/" className={styles['jumpLink']}>
              Back to Latch &rarr;
            </Link>
          </nav>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

/** One numbered section of a legal document. */
export function Section({
  id,
  heading,
  children,
}: {
  id: string
  heading: string
  children: ReactNode
}) {
  return (
    <section className={styles['section']} id={id}>
      <h2 className={styles['h2']}>{heading}</h2>
      {children}
    </section>
  )
}
