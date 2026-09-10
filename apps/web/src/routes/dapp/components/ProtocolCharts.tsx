import { useEffect, useState } from 'react'
import { BarList } from './charts.tsx'
import { SEPOLIA_CHAIN_ID, readActivity, type ActivityEvent } from '../../../lib/chain'
import type { LabelledBar } from '../data/types.ts'

/**
 * The two chart slots on the dashboard, driven by real logs.
 *
 * The spec had a volume area chart with 30D/90D/1Y ranges and a CALL MIX bar list
 * (beforeSwap 8.2M, afterSwap 6.4M…). Both were invented, and neither can be made
 * real by better plumbing:
 *
 *   - The call mix counted hook callbacks. Zero have ever fired — the live pool has
 *     no hook attached. A bar list of zeros is not more useful than saying so.
 *   - The volume chart spanned a year. This deployment is days old and holds a
 *     handful of swaps. Stretching those across a 1Y axis produces a chart that is
 *     technically sourced from real data and still communicates something false.
 *
 * So the mix shows what the protocol has actually done, and the time series states
 * plainly that there is not enough history yet. Both become real charts on their own
 * once the underlying activity exists — nothing here needs revisiting to "turn on".
 */

const MIN_POINTS_FOR_SERIES = 12

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; events: ActivityEvent[] }

const COLORS: Record<string, LabelledBar['color']> = {
  Swap: 'primary',
  'Add liquidity': 'signal',
  'Remove liquidity': 'violet',
  Donate: 'success',
  Initialize: 'success',
}

function mix(events: ActivityEvent[]): LabelledBar[] {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  const max = Math.max(1, ...counts.values())
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({
      name,
      value: String(n),
      pct: Math.round((n / max) * 100),
      color: COLORS[name] ?? 'primary',
    }))
}

function useActivity(): State {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readActivity(SEPOLIA_CHAIN_ID, 200)
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

  return state
}

/** Left column of the dashboard row. */
export function SwapVolumeCard() {
  const state = useActivity()
  const swaps = state.k === 'ready' ? state.events.filter((e) => e.kind === 'Swap') : []

  return (
    <section className="dapp-card dapp-card--chart">
        <div className="dapp-card__bar">
          <h2 className="dapp-card__title">Swap volume over time</h2>
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
            Could not read the chain: {state.message}.
          </p>
        )}
        {state.k === 'ready' && swaps.length < MIN_POINTS_FOR_SERIES && (
          <p className="live-note">
            Not enough history to plot. This deployment has recorded{' '}
            <strong>{swaps.length}</strong> {swaps.length === 1 ? 'swap' : 'swaps'}; a time series
            needs at least {MIN_POINTS_FOR_SERIES}. Spreading a handful of swaps across a 30-day
            axis would draw a chart that is technically real and still misleading, so the count is
            shown instead and the chart appears once the history exists.
          </p>
        )}
    </section>
  )
}

/** Sits inside the dashboard's right-hand stack, above the activity feed. */
export function ActivityMixCard() {
  const state = useActivity()

  return (
    <section className="dapp-card" style={{ animationDelay: '0.08s' }}>
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">ACTIVITY MIX</h2>
          <span className="lr-badge">
            <span className="lr-dot" aria-hidden="true" />
            LIVE
          </span>
        </div>

        {state.k === 'ready' && state.events.length > 0 ? (
          <>
            <BarList
              items={mix(state.events)}
              valueLabel="events"
              shareLabel="of the most frequent event type"
            />
            <p className="live-note">
              Protocol events, not Latch callbacks. No Latch callback has ever fired on this
              deployment — the live pool was initialized without a Latch.
            </p>
          </>
        ) : (
          <p className={`live-note${state.k === 'error' ? ' live-note--err' : ''}`}>
            {state.k === 'loading'
              ? 'Reading contract logs…'
              : state.k === 'error'
                ? `Could not read the chain: ${state.message}.`
                : 'No protocol events recorded yet.'}
          </p>
        )}
    </section>
  )
}
