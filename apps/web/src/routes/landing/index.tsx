import { Activity } from './Activity'
import { Hero } from './Hero'
import {
  Chains,
  CtaPanel,
  Features,
  HowItWorks,
  RevenueShare,
  Oracles,
  Roadmap,
  Team,
  UseCases,
} from './Sections'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { StatsStrip } from './StatsStrip'
import styles from './landing.module.css'

/**
 * Latch Protocol marketing landing page.
 *
 * Built to "latch design/README.md" § Screens 1 and "SCREENS.md" § A, with
 * design-references/Latch Landing.dc.html as the visual reference. Sections run
 * A1–A11 in DOM order. All figures are placeholders and live in ./data.ts.
 */
export default function LandingPage() {
  return (
    <div className={styles['page']}>
      <SiteHeader />
      <main>
        <Hero />
        <StatsStrip />
        <Activity />
        <UseCases />
        <RevenueShare />
        <Oracles />
        <HowItWorks />
        <Features />
        <Chains />
        <Roadmap />
        <Team />
        <CtaPanel />
      </main>
      <SiteFooter />
    </div>
  )
}
