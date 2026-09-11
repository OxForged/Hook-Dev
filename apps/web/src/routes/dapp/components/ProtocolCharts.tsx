import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { BarList } from './charts.tsx'
import { SeriesChart, type SeriesPoint } from './series-charts.tsx'
import { ACTIVE_CHAIN_ID, DEPLOYMENTS, readActivity, type ActivityEvent } from '../../../lib/chain'
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
 * WHAT REPLACED THE VOLUME CHART, and why it is not the same mistake. The axis is
 * BLOCK HEIGHT, and every point sits on a block a swap actually landed in. A
 * running count is a reading at each of those blocks rather than an estimate
 * between them, so the line never passes through a number nobody measured. It
 * still refuses to draw below two points — one swap is not a trend — and the
 * empty state states the count instead.
 *
 * What is deliberately NOT here: volume in a common unit. The two sides of a swap
 * are different tokens, nothing prices either, and a "total volume" line would
 * need an exchange rate that does not exist.
 */

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

const n = (v: number | bigint) => v.toLocaleString('en-US')

const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/* ---------------------------------------------------------------------------
   Methodology disclosure.

   WHY THIS EXISTS. Several notes on these screens ran to five sentences
   explaining how a number was counted. The count is what the reader came for;
   the counting method is what they need only when they doubt it. Collapsing the
   second behind a summary keeps it on the page — deleting a caveat that changes
   how a figure should be READ is not a copy edit, it is a different claim — while
   letting the figure be read in one line.

   THE STYLING LIVES IN `dapp.css` AS `.dapp-method`, not in inline styles here.
   This component was written with inline styles while that stylesheet was being
   edited elsewhere, which was correct at the time and wrong to keep: a second
   disclosure design in the same app is one that drifts from the first, and the
   two would be side by side on screens that mount both. One rule, one look.

   Native `<details>` on purpose — keyboard-operable, announced as a disclosure,
   and findable by browser find-in-page, none of which a div-and-state accordion
   gets without work.
   --------------------------------------------------------------------------- */

export function Methodology({
  label = 'How this is counted',
  children,
}: {
  readonly label?: string
  readonly children: ReactNode
}) {
  return (
    <details className="dapp-method">
      <summary>{label}</summary>
      <div className="dapp-method__body">{children}</div>
    </details>
  )
}

/* -------------------------------------------------------------------------- */

function mix(events: ActivityEvent[]): LabelledBar[] {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  const max = Math.max(1, ...counts.values())
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      value: String(count),
      pct: Math.round((count / max) * 100),
      color: COLORS[name] ?? 'primary',
    }))
}

/**
 * Swaps as a running total against the block they landed in.
 *
 * Deduplicated by block: two swaps in one block are one reading of "3 swaps by
 * block N", not two points at the same x. Plotting both would put a vertical
 * segment on the line that reads as a jump in the axis.
 */
function cumulativeSwaps(events: ActivityEvent[]): SeriesPoint[] {
  const blocks = events
    .filter((e) => e.kind === 'Swap')
    .map((e) => e.blockNumber)
    .sort((a, b) => Number(a - b))

  const out: SeriesPoint[] = []
  let total = 0
  for (const [i, b] of blocks.entries()) {
    total += 1
    if (blocks[i + 1] === b) continue
    out.push({
      x: Number(b),
      y: total,
      label: `Block #${n(b)}`,
      value: `${n(total)}`,
    })
  }
  return out
}

function useActivity(): State {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readActivity(ACTIVE_CHAIN_ID, 200)
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
  const events = state.k === 'ready' ? state.events : []
  const points = useMemo(() => cumulativeSwaps(events), [events])
  const swaps = events.filter((e) => e.kind === 'Swap').length

  return (
    <section className="dapp-card dapp-card--chart">
      <div className="dapp-card__bar">
        <h2 className="dapp-card__title">Swaps by block</h2>
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
      {state.k === 'ready' && (
        <>
          <SeriesChart
            points={points}
            area
            label={`Running total of swaps on ${CHAIN.name}, against the block each landed in`}
            valueLabel="swaps so far"
            empty={
              swaps === 0
                ? 'No swap has been recorded on this deployment.'
                : `${n(swaps)} swap${swaps === 1 ? '' : 's'} recorded, in one block. A line needs two readings; nothing is drawn rather than implying a shape from one.`
            }
          />
          {points.length >= 2 && (
            <div className="dapp-axis">
              <span>#{n(points[0]?.x ?? 0)}</span>
              <span>running total · block height</span>
              <span>#{n(points[points.length - 1]?.x ?? 0)}</span>
            </div>
          )}
          <p className="live-note">
            {n(swaps)} swap{swaps === 1 ? '' : 's'} on {CHAIN.name}, counted from{' '}
            <code>Swap</code> logs.
          </p>
          <Methodology label="Why blocks, and why no volume line">
            <p className="live-note">
              The axis is block height, not a clock: block times are neither exact nor constant, so a
              date axis would be an assumption rather than a reading. Volume is absent for a
              different reason — the two sides of a swap are different tokens, nothing prices either,
              and a combined line would need an exchange rate that does not exist.
            </p>
          </Methodology>
        </>
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
            valueLabel="recorded"
            shareLabel="of the most frequent event type"
          />
          <p className="live-note">
            Protocol events, not Latch callbacks — no Latch callback has ever fired here.
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
