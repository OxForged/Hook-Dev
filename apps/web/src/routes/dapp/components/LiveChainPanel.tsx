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
  readGovernanceStatus,
  splitFee,
  type ProtocolStatus,
  type SwapRecord,
  type VaultHolding,
  type GovernanceStatus,
} from '../../../lib/chain'

/**
 * The only panel in the dapp showing REAL on-chain state.
 *
 * Every other surface runs on the typed mock modules in `data/`, which is why the
 * shell carried a SAMPLE DATA chip. There is no such chip any more, because there
 * is no sample data left. This one reads the deployed Sepolia contracts
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
  | { k: 'ready'; status: ProtocolStatus; holdings: VaultHolding[]; swaps: SwapRecord[]; gov: GovernanceStatus }

export function LiveChainPanel() {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [status, holdings, swaps, gov] = await Promise.all([
          readProtocolStatus(),
          readVaultHoldings(),
          readRecentSwaps(SEPOLIA_CHAIN_ID, 5),
          readGovernanceStatus(),
        ])
        if (!cancelled) setState({ k: 'ready', status, holdings, swaps, gov })
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

          <h3 className="live-sub-h">Registry &amp; governance</h3>
          <dl className="live-grid">
            <div>
              <dt>Latches listed</dt>
              <dd className="tabular">{state.gov.hookCount.toString()}</dd>
            </div>
            <div>
              <dt>Custody delay</dt>
              <dd className="tabular">{Number(state.gov.custodyDelaySec) / 3600}h</dd>
            </div>
            <div>
              <dt>Policy delay</dt>
              <dd className="tabular">{Number(state.gov.policyDelaySec) / 3600}h</dd>
            </div>
            <div>
              <dt>Registry</dt>
              <dd>
                <a
                  href={explorerAddress(SEPOLIA_CHAIN_ID, state.gov.registry)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-hit
                >
                  view
                </a>
              </dd>
            </div>
          </dl>
          <p className="live-note">
            {state.gov.hookCount === 0n
              ? 'The registry is deployed but nothing is listed yet, so this reads zero rather than showing example Latches. '
              : `Every one of these ${state.gov.hookCount} listings was read from the registry contract; none is an example. `}
            Timelocks are deployed and enforce their floors; on Sepolia the Vault is still owned by
            an EOA so it stays iterable.
          </p>

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
