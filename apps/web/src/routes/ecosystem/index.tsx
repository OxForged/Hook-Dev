/* ============================================================================
   /ecosystem — the public directory of projects building on Latch.

   Lazily loaded from routes/table.ts; never import this module statically.

   Rendered in the public site chrome (SiteHeader, SiteFooter, the landing
   `.page` ground and `.section` column), not in the dapp shell, and it pulls
   in nothing wallet-related: the directory is a curated file, not a chain
   read, and a visitor should be able to see who builds on Latch without
   launching an app. /app/ecosystem redirects here (routes/dapp/index.tsx).

   The header carries what the dapp's TopBar title, subtitle and head card
   used to: the name, the SELF-SUBMITTED · UNVERIFIED badge, and the caveat
   that a listing is a team's own words rather than an endorsement.
   ============================================================================ */

import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { dappPath } from '../dapp/paths.ts'
import landing from '../landing/landing.module.css'
import { SiteFooter } from '../landing/SiteFooter'
import { SiteHeader } from '../landing/SiteHeader'
import { cx } from '../landing/ui'
import { Directory } from './Directory.tsx'
import styles from './page.module.css'

export default function EcosystemPage() {
  // A single-page router: the tab title would otherwise keep the previous route's.
  useEffect(() => {
    const previous = document.title
    document.title = 'Ecosystem — Latch Protocol'
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className={landing['page']}>
      <SiteHeader />
      <main>
        <div className={cx(landing['section'], styles['wrap'])}>
          <header className={styles['head']}>
            <div className={styles['titleRow']}>
              <h1 className={styles['title']}>Ecosystem</h1>
              {/* Not a LIVE badge. Nothing on this page is read from chain, and
                  the badge that says so has to be the first thing after the title. */}
              <span className="dapp-badge dapp-badge--mute">SELF-SUBMITTED · UNVERIFIED</span>
            </div>
            <p className={styles['subtitle']}>Projects building on Latch · self-submitted, not verified</p>
            {/* The last sentence is the caveat, not padding: without it a
                directory of names reads as a directory of endorsements. */}
            <p className={styles['caveat']}>
              Teams and products, not contracts — those are on the{' '}
              <Link to={dappPath('marketplace')}>Marketplace</Link>, read from the registry. Every
              entry here was written by the project itself and merged as submitted, so a listing
              says a team asked to be listed. It does not say the integration works, is safe, or
              is still live.
            </p>
          </header>

          <Directory />
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
