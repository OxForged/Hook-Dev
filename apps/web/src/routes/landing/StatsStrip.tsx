import styles from './landing.module.css'
import { useCountUp } from './useCountUp'
import { useProtocolMetrics, fmtToken } from '../../lib/useMetrics'
import { ACTIVE_CHAIN_ID, DEPLOYMENTS, IS_TESTNET_BUILD } from '../../lib/chain'
import type { ProtocolMetrics } from '../../lib/chain'

/** The chain this build serves. Never a spelled-out name: see landing/data.ts. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

function StatCell({ value, label }: { value: string; label: string }) {
  const { ref, display } = useCountUp<HTMLDivElement>(value)
  return (
    <div className={styles['statCell']}>
      <div ref={ref} className={styles['statValue']}>
        {display}
      </div>
      <div className={styles['statLabel']}>{label}</div>
    </div>
  )
}

/**
 * A3. Stats strip — read from the deployed contracts, whichever chain this
 * build serves.
 *
 * The design spec put placeholder figures here ($412M routed, 1,840 latches, 9
 * networks). Those are gone. What replaces them is small, because that is what
 * a young deployment actually contains — and a sparse honest number is worth
 * more than an impressive invented one to an audience that will check the chain.
 *
 * No USD figure anywhere. These pairs are unpriced test tokens; a fabricated
 * price to produce a dollar headline is the exact failure this replaced.
 */
function cells(m: ProtocolMetrics): { value: string; label: string }[] {
  const tvl0 = m.tvl[0]
  const tvlText = tvl0 ? fmtToken(tvl0.balance, tvl0.decimals, 0) : '0'
  return [
    { value: String(m.poolCount), label: 'POOLS INITIALIZED' },
    { value: String(m.swapCount), label: 'SWAPS EXECUTED' },
    { value: tvlText, label: `${tvl0?.symbol ?? 'TOKEN'} HELD BY THE VAULT` },
    { value: '1', label: `NETWORK LIVE · ${CHAIN.name.toUpperCase()}` },
  ]
}

export function StatsStrip() {
  const s = useProtocolMetrics()

  return (
    <section
      className={styles['statsStrip']}
      aria-label={`Live protocol metrics from ${CHAIN.name}`}
    >
      <div className={styles['statsGrid']}>
        {s.k === 'ready' ? (
          cells(s.m).map((c) => <StatCell key={c.label} value={c.value} label={c.label} />)
        ) : (
          <div className={styles['statCell']}>
            <div className={styles['statValue']}>{s.k === 'error' ? '—' : '·'}</div>
            <div className={styles['statLabel']}>
              {s.k === 'error' ? 'CHAIN UNREACHABLE' : 'READING CHAIN…'}
            </div>
          </div>
        )}
      </div>
      <p className={styles['statsNote']}>
        {s.k === 'ready'
          ? `LIVE FROM ${CHAIN.name.toUpperCase()} · BLOCK ${s.m.latestBlock.toString()}${
              IS_TESTNET_BUILD ? ' · TESTNET' : ''
            }`
          : s.k === 'error'
            ? 'COULD NOT READ THE CHAIN — NO FIGURES SHOWN RATHER THAN STALE ONES'
            : `READING LIVE CONTRACTS ON ${CHAIN.name.toUpperCase()}`}
      </p>
    </section>
  )
}
