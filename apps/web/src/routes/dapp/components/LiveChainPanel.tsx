import { useEffect, useState } from 'react'
import {
  DEPLOYMENTS,
  SEPOLIA_CHAIN_ID,
  explorerAddress,
  explorerTx,
  formatUnits,
  readProtocolStatus,
  readRecentSwaps,
  readVaultHoldings,
  splitFee,
  type ProtocolStatus,
  type SwapRecord,
  type VaultHolding,
} from '../../../lib/chain'

/**
 * The only panel in the dapp showing REAL on-chain state.
 *
 * Every other surface runs on the typed mock modules in `data/`, which is why the
 * shell carries a SAMPLE DATA chip. This one reads the deployed Sepolia contracts
 * directly and is labelled LIVE so the distinction is never ambiguous.
 *
 * On failure it says so and shows nothing. A dashboard that silently falls back to
 * placeholder numbers when the chain is unreachable is worse than one that admits
 * it — the reader cannot tell the difference, and that is exactly when they would
 * most want to.
 */

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; status: ProtocolStatus; holdings: VaultHolding[]; swaps: SwapRecord[] }

export function LiveChainPanel() {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [status, holdings, swaps] = await Promise.all([
          readProtocolStatus(),
          readVaultHoldings(),
          readRecentSwaps(SEPOLIA_CHAIN_ID, 5),
        ])
        if (!cancelled) setState({ k: 'ready', status, holdings, swaps })
      } catch (e) {
        if (!cancelled) {
          setState({
            k: 'error',
            message: e instanceof Error ? e.message : 'Could not reach the chain.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const d = DEPLOYMENTS[SEPOLIA_CHAIN_ID]

  return (
    <section className="dk-card live-panel" aria-labelledby="live-h">
      <header className="live-head">
        <h2 id="live-h" className="live-title">
          Live on {d.name}
        </h2>
        <span className="live-badge">
          <span className="live-dot" aria-hidden="true" />
          ON CHAIN
        </span>
      </header>

      {state.k === 'loading' && (
        <p className="live-note" role="status">
          Reading contracts&hellip;
        </p>
      )}

      {state.k === 'error' && (
        <p className="live-note live-note--err" role="status">
          Could not read the chain: {state.message}. No figures shown rather than stale ones.
        </p>
      )}

      {state.k === 'ready' && (
        <>
          <dl className="live-grid">
            <div>
              <dt>Block</dt>
              <dd className="tabular">{state.status.blockNumber.toString()}</dd>
            </div>
            <div>
              <dt>Protocol fee</dt>
              <dd className="tabular">
                {(state.status.defaultFeePips / 10_000).toFixed(2)}%
                <span className="live-sub"> of {(state.status.maxFeePips / 10_000).toFixed(1)}% cap</span>
              </dd>
            </div>
            <div>
              <dt>Pool managers</dt>
              <dd>
                {state.status.clRegistered && state.status.binRegistered
                  ? 'CL + Bin registered'
                  : 'not registered'}
              </dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd>{state.status.feesDisabled ? 'DISABLED' : 'active'}</dd>
            </div>
          </dl>

          <h3 className="live-sub-h">Vault holdings</h3>
          <p className="live-note">
            The Vault custodies every token; pool managers hold nothing. These balances are the
            protocol&rsquo;s TVL.
          </p>
          <ul className="live-list">
            {state.holdings.map((h) => (
              <li key={h.token}>
                <a
                  href={explorerAddress(SEPOLIA_CHAIN_ID, h.token)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-hit
                >
                  {h.symbol}
                </a>
                <span className="tabular">{formatUnits(h.balance, h.decimals, 4)}</span>
              </li>
            ))}
          </ul>

          <h3 className="live-sub-h">Recent swaps</h3>
          {state.swaps.length === 0 ? (
            <p className="live-note">No swaps recorded on this deployment yet.</p>
          ) : (
            <ul className="live-list">
              {state.swaps.map((s) => {
                const { lpPips } = splitFee(s.feePips, s.protocolFeePips)
                return (
                  <li key={s.txHash}>
                    <a
                      href={explorerTx(SEPOLIA_CHAIN_ID, s.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-hit
                    >
                      block {s.blockNumber.toString()}
                    </a>
                    <span className="tabular live-fee">
                      {s.feePips} pips = {s.protocolFeePips} protocol + {lpPips} LP
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
