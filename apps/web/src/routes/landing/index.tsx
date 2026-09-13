import { useEffect, useRef, useState } from 'react'

import { ContractBook } from './ContractBook'
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

/** The hash that opens the contract book. Nav, footer and the CTA band link here. */
const CONTRACTS_HASH = '#contracts'

/**
 * `location.hash`, kept current.
 *
 * Read from `window` and `hashchange` rather than the router: a plain
 * `<a href="#contracts">` on `/` is an in-document fragment jump, and whether a
 * router re-renders on one is an implementation detail this should not rest on.
 */
function useHash(): string {
  const [hash, setHash] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash,
  )
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

/**
 * Latch Protocol landing page — THE MINIMAL CUT, 2026-09-13.
 *
 * Owner's brief: "make landing very minimal with charts graphs animations and
 * interactive". Design language is Option B (latch-design-options/b.html).
 *
 * ORDER
 *   1. SiteHeader        brand, four links, theme, Launch App
 *   2. Hero              pill, serif H1, one-sentence lede, two actions
 *   3. LiveStrip         the live KPI row, read from chain
 *   4. FeeChart          b.html's flagship: what a swap costs, by pool tier
 *      SwapCost          the same rates applied to a trade size you choose
 *      PresetCurve       the launch fee decay, from the hook's own formula
 *      PermissionBitmap  which callbacks a Latch asks for, from core's flags
 *   5. FourThings        what you do not have to deploy
 *   6. Ecosystem         who is building on it, and "List your project"
 *   ·  ContractBook      ONLY when the URL hash is #contracts (see below)
 *   7. CtaPanel          one-line closing band
 *   8. SiteFooter        minimal, and the map to everything that left the page
 *
 * UNMOUNTED, NOT DELETED — and where each one's content is reachable now:
 *   · Audiences     its two integration prompts are in the footer's Build
 *                   column; the hero's secondary action is the DEX prompt.
 *   · StatsStrip    pools, swaps and vault balances: /app/analytics (footer).
 *   · Activity      live state and event mix: /app/analytics (footer). Its
 *                   test-count and audit-status card has no other home yet.
 *   · LiquidityFlow the interactive revenue-share MODEL has no other home. The
 *                   docs' #revshare section covers the contract reads.
 *   · ContractBook  one click away at /#contracts — header nav, footer, and
 *                   the CTA band all link there, and the book mounts on demand.
 *   · CodePanel     was only ever mounted inside HowItWorks (Sections.tsx).
 * Each goes back in one import and one line.
 *
 * WHY THE CONTRACT BOOK IS BEHIND A HASH, not a route: no page other than this
 * one presents every deployed address (the docs name the registry only), and
 * adding a route is a change to App.tsx. A hash-gated section keeps the book
 * one click from every page — `/#contracts` from anywhere — without putting its
 * live `getCode` sweep on every landing visit.
 */
export default function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  useRevealOnScroll(pageRef)

  const hash = useHash()
  const showContracts = hash === CONTRACTS_HASH

  /* The browser's own fragment scroll ran before the book existed, so it found
     nothing. Scroll once the book has mounted. */
  useEffect(() => {
    if (!showContracts) return
    document.getElementById(CONTRACTS_HASH.slice(1))?.scrollIntoView({ block: 'start' })
  }, [showContracts])

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

        {showContracts ? <ContractBook /> : null}

        <CtaPanel />
      </main>
      <SiteFooter />
    </div>
  )
}
