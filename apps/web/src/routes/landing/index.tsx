import { Activity } from './Activity'
import { Audiences } from './Audiences'
import { ContractBook } from './ContractBook'
import { Ecosystem } from './Ecosystem'
import { FeeChart } from './FeeChart'
import { Hero } from './Hero'
import { LiveStrip } from './LiveStrip'
import { PresetCurve } from './PresetCurve'
import { SwapCost } from './SwapCost'
import { LiquidityFlow } from './LiquidityFlow'
import { CtaPanel } from './Sections'
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
      {/* CUT FROM TEN TO FIVE, 2026-09-12.
          
          What survives is what MOVES or what is READ FROM CHAIN: the hero's
          floating satellites, StatsStrip's counters, LiquidityFlow's split bar,
          Activity's series and gauge — plus the closing CtaPanel, which is not
          animated but is the only thing on the page asking for a decision.

          Removed: UseCases, RevenueShare, HowItWorks, Features, Chains. Four of
          the five were explanatory prose with a scroll-reveal fade and nothing
          else; Features and Chains had no motion at all. UseCases overlapped
          LiquidityFlow, which shows the same thing with real numbers instead of
          describing it.

          The components are NOT deleted — they are still exported from
          Sections.tsx and one line each puts them back. Deleting them would
          make this a decision somebody has to redo rather than reverse, and
          nothing here has been live long enough to be sure. Chains in
          particular carries real deployment facts; if the page needs them
          again, that is where they are. */}
      <main>
        <Hero />
        {/* Four O(1) reads that always answer, immediately under the hero: the
            chain, the head, the fee and the contract count. It sits ABOVE
            StatsStrip because StatsStrip's two headline counters need a
            full-history eth_getLogs that the public endpoints refuse, so they
            render em dashes — and a page whose first figures are dashes reads
            as broken rather than as honest. This strip answers first. */}
        <LiveStrip />
        <StatsStrip />
        {/* Directly under the stats: a reader who has just seen "what is live"
            is exactly the one asking "what does it cost". Before the mechanics
            in LiquidityFlow, because price is the question that decides whether
            they read the mechanics at all. */}
        <FeeChart />
        {/* Immediately after the rate chart, because it answers the question
            that chart leaves open. FeeChart gives the rate per tier; this
            applies a rate to an amount the reader chooses. Same subject, one
            step more concrete. */}
        <SwapCost />
        {/* After the mechanics, before the evidence. A reader who now knows
            what a swap costs is the one asking "so what would I build with
            it" — and Activity, which is the proof, is more persuasive once
            they have a reason to want the answer. */}
        <Audiences />
        {/* Directly under the launchpad column, which promises presets that
            admit their limits. This is that promise, drawn: the decay curve
            from the hook's own formula, with the limitation always on screen. */}
        <PresetCurve />
        {/* LiquidityFlow sits HERE rather than beside SwapCost on purpose.
            Both take a swap size, and two size sliders in adjacent sections
            reads as one control duplicated rather than two questions. Two
            sections apart, they are plainly about different layers: SwapCost
            is core (pool fee plus protocol fee, every rate read from chain),
            this is the hook layer (a Latch's cut, split three ways, modelled
            from constants and labelled a model). */}
        <LiquidityFlow />
        <Activity />
        {/* Last before the ask, because it is the page's strongest argument
            and the one a sceptic wants: every address, each independently
            checkable, with the code check run live. "Read them before you
            route a swap through them" is only a real invitation if reading
            them is easy. */}
        <ContractBook />
        {/* Social proof immediately before the ask, and the submission route
            beside it. This lived only at /app/ecosystem, which is the one place
            a visitor evaluating the protocol will not look — reaching it means
            launching an app you have not decided to trust yet. A directory
            nobody sees cannot recruit, and the "list your project" link is
            worthless to the people most likely to use it. */}
        <Ecosystem />
        <CtaPanel />
      </main>
      <SiteFooter />
    </div>
  )
}
