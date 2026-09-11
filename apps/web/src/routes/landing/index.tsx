import { Activity } from './Activity'
import { Hero } from './Hero'
import { LiquidityFlow } from './LiquidityFlow'
import { Chains, CtaPanel, Features, HowItWorks, RevenueShare, UseCases } from './Sections'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { StatsStrip } from './StatsStrip'
import styles from './landing.module.css'

/**
 * Latch Protocol landing page.
 *
 * ORDER IS AN ARGUMENT, and this one runs: what is it → is it real → how does
 * the money move → what can I build → how do I start.
 *
 * `LiquidityFlow` sits third on purpose. Everything else on the page is a
 * consequence of the sentence it draws — a Latch takes a share of a swap and
 * splits it three ways — and prose was teaching that badly. A reader who
 * understands the diagram can skip the rest; one who does not will not be
 * persuaded by another feature grid.
 *
 * The old A1–A11 spec order put five explanatory sections (UseCases,
 * RevenueShare, Oracles, HowItWorks, Features) between the hero and anything
 * actionable, which is how a landing page ends up long and unread. Oracles and
 * Roadmap were cut from the page rather than rewritten: oracles are a detail of
 * one hook family and belong in the docs, and a roadmap is a promise, which is
 * the one kind of content this project has decided not to render.
 *
 * Figures are NOT placeholders — `StatsStrip` and `Activity` read whichever
 * chain this build serves (`ACTIVE_CHAIN_ID`, never a spelled-out name), and
 * `LiquidityFlow` is a calculator over the contracts' own constants and says so
 * in the panel. See CLAUDE.md § "No invented data in the UI. Ever."
 *
 * UNMOUNTED, NOT DELETED: `Oracles`, `Roadmap` and `Team` still exist in
 * ./Sections.tsx and each goes back into the list below in one line.
 *   · Team rendered four cards reading literally "Name Placeholder". Four
 *     placeholder humans on a landing page is worse than no team section, and
 *     it is the same failure as a placeholder number wearing a different hat.
 *     It returns the day there are names to put in ./data.ts.
 *   · Roadmap is a set of promises with indicative dates. Not dishonest, but it
 *     is the weakest thing on a page whose whole argument is "check the chain".
 *   · Oracles is a detail of one hook family and reads better in the docs.
 */
export default function LandingPage() {
  return (
    <div className={styles['page']}>
      <SiteHeader />
      <main>
        <Hero />
        <StatsStrip />
        <LiquidityFlow />
        <Activity />
        <UseCases />
        <RevenueShare />
        <HowItWorks />
        <Features />
        <Chains />
        <CtaPanel />
      </main>
      <SiteFooter />
    </div>
  )
}
