import styles from './landing.module.css'
import { useCountUp } from './useCountUp'
import { useProtocolMetrics, fmtToken } from '../../lib/useMetrics'
import type { ProtocolMetrics } from '../../lib/chain'

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
 * A3. Stats strip — now REAL, read from the deployed Sepolia contracts.
 *
 * The design spec put placeholder figures here ($412M routed, 1,840 latches, 9
 * networks). Those are gone. What replaces them is small — one pool, a couple of
 * swaps — because that is what a fresh testnet actually contains.
 *
 * A sparse honest number is worth more than an impressive invented one: the
 * audience for this page is developers who will check the chain, and a headline
 * figure that does not reconcile with Etherscan costs more credibility than a
 * modest one ever could.
 *
 * There is deliberately no USD figure. ltUSD and ltETH are testnet tokens that
 * nothing prices, and a fabricated price to produce a dollar headline is exactly
 * the failure this replaces.
 */
function cells(m: ProtocolMetrics): { value: string; label: string }[] {
  const tvl0 = m.tvl[0]
  const tvlText = tvl0 ? fmtToken(tvl0.balance, tvl0.decimals, 0) : '0'
  return [
    { value: String(m.poolCount), label: 'POOLS INITIALIZED' },
    { value: String(m.swapCount), label: 'SWAPS EXECUTED' },
    { value: tvlText, label: `${tvl0?.symbol ?? 'TOKEN'} HELD BY THE VAULT` },
    { value: '1', label: 'NETWORK LIVE · SEPOLIA' },
  ]
}

export function StatsStrip() {
  const s = useProtocolMetrics()

  return (
    <section className={styles['statsStrip']} aria-label="Live protocol metrics from Ethereum Sepolia">
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
          ? `LIVE FROM ETHEREUM SEPOLIA · BLOCK ${s.m.latestBlock.toString()} · TESTNET ONLY, NO MAINNET DEPLOYMENT`
          : s.k === 'error'
            ? 'COULD NOT READ THE CHAIN — NO FIGURES SHOWN RATHER THAN STALE ONES'
            : 'READING LIVE CONTRACTS ON ETHEREUM SEPOLIA'}
      </p>
    </section>
  )
}
