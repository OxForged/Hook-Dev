import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ChainMarks } from './ChainMarks'
import { LINKS } from './data'
import { Ecosystem } from './Ecosystem'
import { FeeChart } from './FeeChart'
import { FourThings } from './FourThings'
import { Hero } from './Hero'
import { LiveStrip } from './LiveStrip'
import { PermissionBitmap } from './PermissionBitmap'
import { PresetCurve } from './PresetCurve'
import { SwapCost } from './SwapCost'
import { CtaPanel } from './Sections'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import styles from './landing.module.css'
import { useRevealOnScroll } from './ui'

/**
 * The retired landing anchor for the contract book.
 *
 * The book lived here behind `/#contracts` until 2026-09-13, when it moved to
 * the docs (owner: "contracts need to be on docs not on landing"). Links to
 * `/#contracts` are already out in the world — shared URLs, bookmarks, older
 * READMEs — so this page forwards them to `LINKS.contracts` (`/docs#contracts`)
 * rather than dropping the reader at the top of a page that no longer has the
 * table. `replace`, not push: the dead URL should not sit in history for Back
 * to bounce the reader into the redirect again.
 */
const RETIRED_CONTRACTS_HASH = '#contracts'

/**
 * Latch Protocol landing page — THE MINIMAL CUT, 2026-09-13.
 *
 * Owner's brief: "make landing very minimal with charts graphs animations and
 * interactive". Design language is Option B (latch-design-options/b.html).
 *
 * ORDER
 *   1. SiteHeader        brand, three links, theme, Launch App
 *   2. Hero              pill, serif H1, one-sentence lede, two actions
 *   3. LiveStrip         the live KPI row, read from chain
 *   4. FeeChart          b.html's flagship: what a swap costs, by pool tier
 *      SwapCost          the same rates applied to a trade size you choose
 *      PresetCurve       the launch fee decay, from the hook's own formula
 *      PermissionBitmap  which callbacks a Latch asks for, from core's flags
 *   5. FourThings        what you do not have to deploy
 *   6. Ecosystem         who is building on it, and "List your project"
 *   7. CtaPanel          one-line closing band
 *   8. SiteFooter        minimal, and the map to everything that left the page
 *
 * NO CONTRACT ADDRESSES ARE RENDERED ON THIS PAGE. The address book and its
 * live code check are the docs' "Deployed contracts" section at
 * `/docs#contracts`; FourThings, the footer and the CTA band link there.
 *
 * UNMOUNTED, NOT DELETED — and where each one's content is reachable now:
 *   · Audiences     its two integration prompts are in the footer's Build
 *                   column; the hero's secondary action is the DEX prompt.
 *   · StatsStrip    pools, swaps and vault balances: /app/analytics (footer).
 *   · Activity      live state and event mix: /app/analytics (footer). Its
 *                   test-count and audit-status card has no other home yet.
 *   · LiquidityFlow the interactive revenue-share MODEL has no other home. The
 *                   docs' #revshare section covers the contract reads.
 *   · CodePanel     was only ever mounted inside HowItWorks (Sections.tsx).
 * Each goes back in one import and one line.
 */
export default function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  useRevealOnScroll(pageRef)

  /* `useLocation` rather than `window.location`: it updates on a native
     fragment jump as well (that fires `popstate`), so a stale in-page
     `#contracts` link on `/` is forwarded too, not just a cold load. */
  const { hash } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (hash === RETIRED_CONTRACTS_HASH) navigate(LINKS.contracts, { replace: true })
  }, [hash, navigate])

  return (
    <div ref={pageRef} className={styles['page']}>
      <SiteHeader />
      <main>
        <Hero />

        {/* The live KPI row. `.kpiBand` is the column box only; the cells and
            their four states are LiveStrip's own. */}
        <div className={styles['kpiBand']}>
          <LiveStrip />
        </div>

        {/* Live chain vs target chains, as marks. No addresses: those are in the docs. */}
        <ChainMarks />

        {/* ONE VERTICAL RHYTHM. Every block from here down is a `.section` box
            (or composes it) and carries exactly `--b-section-pad` above it,
            and nothing else adds space between modules. A grid row-gap used
            to sit on top of that padding, which opened ~160px voids. */}
        <FeeChart />
        <SwapCost />
        <div id="presets" className={styles['anchor']}>
          <PresetCurve />
        </div>
        <PermissionBitmap />

        <FourThings />

        {/* Directly after the inventory of what is deployed: who is building
            on it, and how to be listed. */}
        <Ecosystem />

        <CtaPanel />
      </main>
      <SiteFooter />
    </div>
  )
}
