import { useEffect, useState } from 'react'
import { ACTIVE_CHAIN_ID, explorerTx, readActivity, type ActivityEvent } from '../../../lib/chain'

/**
 * Real protocol activity, replacing the design spec's invented "LIVE HOOK FEED".
 *
 * The spec's rows were hook callbacks — DynamicFeeLatch · beforeSwap, JITLatch ·
 * afterSwap. Not one of those has ever fired: the only live pool was initialized
 * with no hook attached, so every callback row would have been fabricated. Worse,
 * a fabricated *success* feed is the specific lie that matters here — the amber dot
 * exists to say "this hook reverted", and a feed that has never seen a real revert
 * teaches the reader to trust a signal that was never tested.
 *
 * So this shows what genuinely happened on chain: pool initializations, swaps,
 * liquidity changes, donations. Every row links to its transaction, because a claim
 * a reader can check on Etherscan is worth more than one they have to take on faith.
 *
 * Rows carry block numbers rather than "2s ago". Deriving an age from block height
 * means assuming a block time, and Sepolia's is neither exactly 12s nor constant —
 * a wrong-but-precise "6s" is a worse answer than an exact block.
 */

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; events: ActivityEvent[] }

/** Swaps are the protocol working; initialize is structural; the rest is liquidity. */
const TONE: Record<ActivityEvent['kind'], string> = {
  Swap: 'dapp-dot--success',
  Initialize: 'dapp-dot--primary',
  'Add liquidity': 'dapp-dot--success',
  'Remove liquidity': 'dapp-dot--warning',
  Donate: 'dapp-dot--primary',
}

export function LiveActivityFeed() {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readActivity(ACTIVE_CHAIN_ID, 10)
      .then((events) => !off && setState({ k: 'ready', events }))
      .catch(
        (e) =>
          !off &&
          setState({ k: 'error', message: e instanceof Error ? e.message : 'chain unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])

  return (
    <section className="dapp-card" style={{ animationDelay: '0.16s' }}>
      <div className="dapp-card__bar">
        <h2 className="dapp-microlabel">PROTOCOL ACTIVITY</h2>
        <span className="lr-badge">
          <span className="lr-dot" aria-hidden="true" />
          LIVE
        </span>
      </div>

      {state.k === 'loading' && (
        <p className="live-note" role="status">
          Reading contract logs&hellip;
        </p>
      )}

      {state.k === 'error' && (
        <p className="live-note live-note--err" role="status">
          Could not read the chain: {state.message}. Nothing shown rather than invented rows.
        </p>
      )}

      {state.k === 'ready' && state.events.length === 0 && (
        <p className="live-note">
          Nothing has happened on this deployment yet. Shown empty rather than filled with
          examples.
        </p>
      )}

      {state.k === 'ready' && state.events.length > 0 && (
        <ul className="dapp-feed">
          {state.events.map((e, i) => (
            <li
              key={`${e.txHash}-${e.kind}-${i}`}
              className="dapp-feed__row"
              style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }}
            >
              <span className={`dapp-dot ${TONE[e.kind]} dapp-dot--sm`} aria-hidden="true" />
              <span className="dapp-feed__name">
                {e.kind} · {e.detail}
              </span>
              <a
                className="dapp-feed__ago"
                href={explorerTx(ACTIVE_CHAIN_ID, e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                data-hit
              >
                #{e.blockNumber.toString()}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
