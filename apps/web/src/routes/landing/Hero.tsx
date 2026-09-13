/* ============================================================================
   Hero — ported from the approved Option C prototype.

   WHAT CHANGED AND WHY. The previous hero was the earlier design's: a
   two-column split with the copy left and an animated node graph right, headed
   "Powerful Latches. Limitless Possibilities." That headline sells a category.
   Option C sells a decision, and its hero is a different shape entirely —
   centred, no ornament, one sentence that says the thing is already running and
   you can point at it today.

   The prototype is C:\Users\Admin\Desktop\latch-design-options\c.html and it is
   the design of record. Structure, copy and proportions come from there; every
   VALUE is translated into this repo's tokens rather than copied raw, so the
   brand palette stays the one in the brand kit.

   THE NODE GRAPH IS GONE, deliberately. Six floating satellites labelled AMM /
   DEX / RWA / PERPS naming markets we do not yet serve is a diagram of an
   ambition. Option C's argument is the opposite — here is what is deployed, go
   and read it — and the page keeps its motion in places where the movement is
   carrying real data: the ticker strip above, the fee chart, the decay curve.

   EVERY CLAIM IN THE COPY IS CHECKABLE, which is the whole voice of this page.
   "No factory to deploy, no core to audit and no address to mine" are the same
   three the Audiences section then evidences one by one.
   ========================================================================== */

import { Link } from 'react-router-dom'

import { LINKS } from './data'
import styles from './landing.module.css'
import { cx } from './ui'

export function Hero() {
  return (
    <section id="home" className={styles['hero']}>
      {/* The radial wash survives from the previous hero. It is the one piece
          of ornament Option C keeps, and it is what stops a centred column on a
          flat ground reading as an unstyled document. */}
      <div className={styles['heroGlow']} aria-hidden="true" />

      <div className={cx(styles['heroCopy'], styles['reveal'])}>
        <p className={styles['heroPill']}>
          <span className={styles['heroPillDot']} aria-hidden="true" />
          Live on Robinhood Chain · every contract verified
        </p>

        <h1 className={styles['h1']}>
          Launch infrastructure, <span className={styles['accent']}>already deployed.</span>
        </h1>

        <p className={styles['heroLede']}>
          A singleton AMM with hooks, live and verified. Point your DEX or launchpad at it and keep
          your own router, your own interface and your own fee wallet — with no factory to deploy,
          no core to audit and no address to mine.
        </p>

        <div className={styles['heroActions']}>
          <Link to={LINKS.app} className={styles['btnPrimary']}>
            Start integrating<span aria-hidden="true"> →</span>
            <span className={styles['sheen']} aria-hidden="true" />
          </Link>
          {/* Straight to the prompt, not to the repo root. A developer who
              clicks this wants the thing they paste into their agent, and one
              more hop to find it in a file tree loses most of them. */}
          <a
            className={styles['btnSecondary']}
            href={LINKS.promptDex}
            target="_blank"
            rel="noreferrer"
          >
            Read the integration prompt
          </a>
        </div>

        {/* Four facts, and the licensing half is the load-bearing one: a tenant
            has to know what they must open-source before they will start. */}
        <p className={styles['heroTrust']}>
          MIT SDK · GPL-2.0 core · no listing fees · integrate in an afternoon
        </p>
      </div>
    </section>
  )
}
