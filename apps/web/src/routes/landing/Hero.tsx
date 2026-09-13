/* ============================================================================
   Hero — Option B, "Institutional Clarity".

   The design of record is C:\Users\Admin\Desktop\latch-design-options\b.html.
   Option C (c.html) was rejected by the owner on 2026-09-13. Structure and
   proportions come from b.html; every VALUE is a token from styles/tokens.css,
   so both themes work without a second palette here.

   SHAPE. Centred, no ornament: a live pill, one serif sentence with a single
   italic clause, a one-sentence lede, and a primary and a secondary action.
   B has no radial wash and no button sheen — both were removed rather than
   restyled, because a glow on a light ground is exactly the decoration
   B's argument ("a finance team could read this") rules out.

   EVERY CLAIM IN THE COPY IS CHECKABLE, which is the whole voice of this page.
   b.html's own pill figure ("25 contracts verified") is prototype fiction and
   was deliberately NOT copied, and the chain name is read from the address
   book, never typed.
   ========================================================================== */

import { Link } from 'react-router-dom'

import { ACTIVE_CHAIN_ID, DEPLOYMENTS } from '../../lib/chain'
import { LINKS } from './data'
import styles from './landing.module.css'
import { cx } from './ui'

/** The chain this build serves — the same address-book record LiveStrip reads. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

export function Hero() {
  return (
    <section id="home" className={styles['hero']}>
      <div className={styles['heroCopy']}>
        {/* "every LATCH contract", not "every contract". The address book also
            records the governance Safe proxy, created by Safe's canonical
            factory rather than deployed by us, and it is the one address that
            is not Sourcify-verified. No count is printed: a number here would
            be typed, not derived. */}
        <p className={cx(styles['heroPill'], styles['reveal'])}>
          <span className={styles['heroPillDot']} aria-hidden="true" />
          Live on {CHAIN.name} · every Latch contract verified
        </p>

        {/* One clause per line, the way b.html sets it. The break is structural
            (`.h1Clause` is a block) rather than a `ch` measure, because `ch`
            is the width of "0" in whichever serif the system falls back to.
            Measured from the font files at 60px: in Palatino Linotype (the
            Windows fallback) 17ch is 510px and "Launch infrastructure," is
            566px, so the heading wrapped onto three lines; in Georgia 17ch is
            626px and it did not. Blocks break in the same place in every
            face. At 400px the first clause is ~358-361px against a 360px
            column, so it may wrap inside itself there — the honest outcome at
            the 38px floor. */}
        <h1 className={cx(styles['h1'], styles['h1Hero'], styles['reveal'], styles['delay1'])}>
          <span className={styles['h1Clause']}>Launch infrastructure,</span>{' '}
          <em className={cx(styles['accent'], styles['h1Clause'])}>already deployed.</em>
        </h1>

        {/* ONE sentence, for the minimal cut. The three "no factory / no core /
            no address" claims left with it; FourThings, directly below the
            modules, evidences what the reader does not have to deploy. */}
        <p className={cx(styles['heroLede'], styles['reveal'], styles['delay2'])}>
          A singleton AMM with hooks, already live and verified — point your DEX or launchpad at it
          and keep your own router, interface and fee wallet.
        </p>

        <div className={cx(styles['heroActions'], styles['reveal'], styles['delay3'])}>
          <Link to={LINKS.app} className={styles['btnPrimary']}>
            Start integrating<span aria-hidden="true"> →</span>
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

        {/* The mono trust line moved to the footer's bottom row for the minimal
            cut. Its licensing half is load-bearing — a tenant has to know what
            they must open-source — so it was moved, not dropped. */}
      </div>
    </section>
  )
}
