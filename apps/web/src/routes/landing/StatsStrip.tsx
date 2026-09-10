import { STATS, type Stat } from './data'
import styles from './landing.module.css'
import { useCountUp } from './useCountUp'

function StatCell({ stat }: { stat: Stat }) {
  const { ref, display } = useCountUp<HTMLDivElement>(stat.value)
  return (
    <div className={styles['statCell']}>
      <div ref={ref} className={styles['statValue']}>
        {display}
      </div>
      <div className={styles['statLabel']}>{stat.label}</div>
    </div>
  )
}

/**
 * A3. Stats strip — four cells that count up when scrolled into view.
 * The figures are placeholders (see data.ts); the section is labelled as an
 * illustrative target rather than a live protocol reading.
 */
export function StatsStrip() {
  return (
    <section className={styles['statsStrip']} aria-label="Protocol targets (illustrative)">
      <div className={styles['statsGrid']}>
        {STATS.map((stat) => (
          <StatCell key={stat.label} stat={stat} />
        ))}
      </div>
      <p className={styles['statsNote']}>
        ILLUSTRATIVE TARGETS · NOT LIVE METRICS · LATCH IS DEPLOYED TO SEPOLIA ONLY
      </p>
    </section>
  )
}
