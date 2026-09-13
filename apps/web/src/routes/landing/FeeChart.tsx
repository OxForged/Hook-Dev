/* ============================================================================
   What a swap costs, by pool tier — read from the deployed fee controller.

   THE COMMERCIAL ARGUMENT, DRAWN. The protocol's share of the swap fee against
   PancakeSwap Infinity's, as stacked columns a reader can hover, tap or tab
   through — Option B's flagship chart.

   EVERY LATCH NUMBER IS AN ON-CHAIN READ. `feeForLpFee(lpFee)` is called once
   per tier against the live controller, so the split arithmetic exists in
   exactly one place — the contract that actually charges people. This file
   deliberately does NOT reproduce that formula; `feeMath.ts` only composes the
   rates it is given into an all-in figure.

   CLAUDE.md records that a previous `FeeChart` was DELETED from this repo, not
   disabled, for being fed by sample data. A chart with this name earns its way
   back only by reading the chain, and by rendering nothing when it cannot.

   THE ONE NUMBER NOT READ FROM OUR CHAIN is PancakeSwap's 33%, a constant in
   their published source (`ProtocolFeeController.sol:32`). It is a citation,
   labelled as one on screen, and computed with their own formula.

   ONE Y-AXIS FOR BOTH MODES, ON PURPOSE. b.html rescales the axis when the
   toggle flips. That makes the columns jump to fill the frame in both modes and
   visually erases the very difference the toggle exists to show. Here the
   domain covers both splits, so the LP segment never moves, only the protocol
   segment changes height, and the transition between modes is a real
   comparison rather than a redraw.

   NO TIME AXIS. The x-axis is the tier list. Nothing on this chart, and no
   animation on it, suggests a series over time — the columns grow once, on
   first view, and that is decoration over a complete reading.
   ========================================================================== */

import { useEffect, useState, type CSSProperties } from 'react'

import { ACTIVE_CHAIN_ID, DEPLOYMENTS, readFeeTiers, type FeeTier } from '../../lib/chain'
import { useFirstView, useMeasuredWidth } from './chartMotion'
import styles from './feechart.module.css'
import page from './landing.module.css'
import { allInPips, pancakeFeeFor, pct } from './feeMath'
import { cx } from './ui'

const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

type Mode = 'latch' | 'pancake'

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; tiers: FeeTier[]; splitRatio: number }

/* ---- geometry, in real pixels (see useMeasuredWidth) --------------------- */

const H = 268
const PL = 58
const PR = 12
const PT = 26
const PB = 34
/** Below this the chart scrolls inside its own container, never the page. */
const MIN_W = 480
const TIP_W = 176

/**
 * A "nice" tick step in pips: 1, 2, 2.5 or 5 times a power of ten, so every
 * gridline lands on a figure a reader can say out loud.
 */
function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return f * mag
}

/**
 * The anchor lives on a wrapper every branch shares. `id="fees"` once sat on
 * the ready-state card, so the nav link did nothing during the read and never
 * worked if the read failed: an anchor target must be on EVERY return.
 */
export function FeeChart() {
  return (
    <section id="fees" className={page['section']} aria-label="What a swap costs">
      <FeeChartBody />
    </section>
  )
}

function FeeChartBody() {
  const [s, setS] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readFeeTiers()
      .then((r) => !off && setS({ k: 'ready', tiers: r.tiers, splitRatio: r.splitRatio }))
      .catch(
        (e: unknown) =>
          !off && setS({ k: 'error', message: e instanceof Error ? e.message : 'unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])

  if (s.k === 'loading') {
    return (
      <div className={cx(styles['card'], styles['stateCard'])} data-state="loading" aria-busy="true">
        <p className={styles['state']}>
          <i className={styles['stateDot']} aria-hidden="true" />
          Reading the fee controller on {CHAIN.name}…
        </p>
      </div>
    )
  }

  /* No fallback table. If the controller cannot be read, the honest output is
     the reason — not a chart drawn from constants that might be stale. */
  if (s.k === 'error') {
    return (
      <div className={cx(styles['card'], styles['stateCard'])} data-state="error">
        <p className={styles['state']}>
          The fee controller on {CHAIN.name} could not be read, so no chart is drawn.
        </p>
        <p className={styles['raw']}>{s.message}</p>
      </div>
    )
  }

  if (s.tiers.length === 0) {
    return (
      <div className={cx(styles['card'], styles['stateCard'])} data-state="empty">
        <p className={styles['state']}>
          The controller on {CHAIN.name} returned no fee tiers, so there is nothing to plot.
        </p>
      </div>
    )
  }

  return <Chart tiers={s.tiers} splitRatio={s.splitRatio} />
}

function Chart({ tiers, splitRatio }: { tiers: FeeTier[]; splitRatio: number }) {
  const [mode, setMode] = useState<Mode>('latch')
  /* Three sources of "which column is showing its tooltip", kept apart so a
     mouse leaving cannot close a tooltip a keyboard user opened. */
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const active = hover ?? focus ?? pinned

  const { ref: plotRef, hidden: growHidden } = useFirstView<HTMLDivElement>()
  const { ref: scrollerRef, width: measuredWidth } = useMeasuredWidth<HTMLDivElement>(720)

  const splitPct = (splitRatio / 10_000).toFixed(0)
  const modeName = mode === 'latch' ? `Latch ${splitPct}%` : 'PancakeSwap Infinity 33%'

  const rows = tiers.map((t) => {
    const latch = t.protocolFeePips
    const pancake = pancakeFeeFor(t.lpFee)
    const protocol = mode === 'latch' ? latch : pancake
    return {
      lpFee: t.lpFee,
      latch,
      pancake,
      protocol,
      allIn: allInPips(t.lpFee, protocol),
    }
  })

  /* The domain covers BOTH splits — see the header. */
  /* Floored at one pip so an all-zero schedule still yields a finite axis
     rather than `log10(0)`. */
  const rawMax = Math.max(
    1,
    ...rows.map((r) => Math.max(allInPips(r.lpFee, r.latch), allInPips(r.lpFee, r.pancake))),
  )
  const step = niceStep((rawMax * 1.08) / 4)
  const yMax = Math.ceil((rawMax * 1.08) / step) * step
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)

  const W = Math.max(measuredWidth, MIN_W)
  const iw = W - PL - PR
  const ih = H - PT - PB
  const base = PT + ih
  const hOf = (pips: number): number => (pips / yMax) * ih
  const bw = iw / rows.length
  const cw = Math.min(64, bw * 0.52)

  const clear = (): void => {
    setHover(null)
    setFocus(null)
    setPinned(null)
  }

  const activeRow = active === null ? undefined : rows[active]
  let tipLeft = 0
  if (active !== null) {
    const cx0 = PL + bw * active + bw / 2
    /* Beside the column, never over it: the tooltip must not hide the bar it
       describes. Right of centre for the left half, left of it otherwise. */
    tipLeft = active < rows.length / 2 ? cx0 + cw / 2 + 10 : cx0 - cw / 2 - 10 - TIP_W
    tipLeft = Math.min(Math.max(tipLeft, 0), W - TIP_W)
  }

  return (
    <div className={styles['card']}>
      <div className={styles['head']}>
        <div className={styles['headText']}>
          {/* h2: a top-level section, first heading after the page's h1. */}
          <h2 className={styles['title']}>What a swap costs, by pool tier</h2>
          <p className={styles['caption']}>
            The protocol takes {splitPct}% of the total swap fee. Hover, tap or tab to a column for
            the split.
          </p>
        </div>
        <div className={styles['toggle']} role="group" aria-label="Protocol fee split to draw">
          <button
            type="button"
            className={cx(styles['tab'], mode === 'latch' && styles['tabOn'])}
            onClick={() => setMode('latch')}
            aria-pressed={mode === 'latch'}
          >
            Latch · {splitPct}%
          </button>
          <button
            type="button"
            className={cx(styles['tab'], mode === 'pancake' && styles['tabOn'])}
            onClick={() => setMode('pancake')}
            aria-pressed={mode === 'pancake'}
          >
            PancakeSwap · 33%
          </button>
        </div>
      </div>

      {/* The scroller exists for 400px: below MIN_W the chart scrolls inside
          this box and the page never does. */}
      <div className={styles['scroller']} ref={scrollerRef}>
        <div
          className={styles['plot']}
          style={{ width: W, height: H }}
          ref={plotRef}
          data-active={active === null ? undefined : ''}
          onMouseLeave={() => setHover(null)}
        >
          <svg
            className={styles['svg']}
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            aria-hidden="true"
          >
            {/* Anchored at the SVG's left edge, reading rightwards over the
                empty band above the top gridline. Right-anchored at the tick
                column it ran past x = 0 and the scroller clipped it to
                "F TRADE". */}
            <text className={styles['axisTitle']} x={0} y={12} textAnchor="start">
              % of trade
            </text>

            {ticks.map((v) => (
              <g key={v}>
                <line
                  className={v === 0 ? styles['baseline'] : styles['grid']}
                  x1={PL}
                  x2={W - PR}
                  y1={base - hOf(v)}
                  y2={base - hOf(v)}
                />
                <text className={styles['axis']} x={PL - 10} y={base - hOf(v) + 3.5} textAnchor="end">
                  {pct(v, 2)}
                </text>
              </g>
            ))}

            {rows.map((r, i) => {
              const cxi = PL + bw * i + bw / 2
              const x = cxi - cw / 2
              const hLP = hOf(r.lpFee)
              const yLP = base - hLP
              /* The protocol rect is laid out at the taller of the two modes
                 and SCALED to the current one, so flipping the toggle is a
                 transform transition — never a redraw. */
              const hLatch = hOf(r.latch)
              const hPancake = hOf(r.pancake)
              const hTall = Math.max(hLatch, hPancake)
              const hNow = mode === 'latch' ? hLatch : hPancake
              return (
                <g key={r.lpFee}>
                  <g
                    className={cx(
                      styles['bars'],
                      growHidden && styles['barsHidden'],
                      active === i && styles['barsOn'],
                    )}
                    /* The stagger is a custom property so it delays ONLY the
                       grow-in transform, never the hover dim. */
                    style={{ '--stagger': `${i * 60}ms` } as CSSProperties}
                  >
                    <rect className={styles['lp']} x={x} y={yLP} width={cw} height={hLP} />
                    {hTall > 0 ? (
                      <rect
                        className={styles['protocol']}
                        x={x}
                        y={yLP - hTall}
                        width={cw}
                        height={hTall}
                        style={{ transform: `scaleY(${hNow / hTall})` }}
                      />
                    ) : null}
                  </g>
                  <text className={styles['axis']} x={cxi} y={base + 20} textAnchor="middle">
                    {pct(r.lpFee, 2)}
                  </text>
                </g>
              )
            })}
          </svg>

          {/* Real buttons over each column, so the chart is reachable by Tab,
              announces its figures, and gets the native focus ring. Tap pins
              a tooltip on touch, where there is no hover. Escape dismisses. */}
          <div className={styles['hits']} role="group" aria-label={`Pool tiers, ${modeName} split`}>
            {rows.map((r, i) => (
              <button
                key={r.lpFee}
                type="button"
                className={styles['hit']}
                style={{ left: PL + bw * i, width: bw, top: PT, height: ih + PB }}
                aria-label={
                  `${pct(r.lpFee, 2)} pool, ${modeName} split: LP fee ${pct(r.lpFee, 2)}, ` +
                  `protocol fee ${pct(r.protocol)}, all-in ${pct(r.allIn)}`
                }
                onMouseEnter={() => setHover(i)}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus(null)}
                onClick={() => setPinned((p) => (p === i ? null : i))}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') clear()
                }}
              />
            ))}
          </div>

          {activeRow ? (
            /* aria-hidden: the focused button's own label already carries
               every figure here, so exposing both reads them twice. */
            <div
              aria-hidden="true"
              className={styles['tip']}
              style={{ left: tipLeft, top: PT, width: TIP_W }}
            >
              <b className={styles['tipHead']}>{pct(activeRow.lpFee, 2)} pool</b>
              <span className={styles['tipRow']}>
                <span className={styles['tipMut']}>LP</span> {pct(activeRow.lpFee, 2)}
              </span>
              <span className={styles['tipRow']}>
                <span className={styles['tipMut']}>Protocol</span> {pct(activeRow.protocol)}
              </span>
              <span className={styles['tipRow']}>
                <span className={styles['tipMut']}>All-in</span> {pct(activeRow.allIn)}
              </span>
              <span className={styles['tipFoot']}>{modeName} split</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles['foot']}>
        <span className={styles['legend']}>
          <i className={cx(styles['swatch'], styles['swatchLp'])} aria-hidden="true" /> LP fee
          <i className={cx(styles['swatch'], styles['swatchProtocol'])} aria-hidden="true" />{' '}
          Protocol fee
        </span>
        <p className={styles['provenance']}>
          Latch: <code>feeForLpFee</code> on the {CHAIN.name} controller. PancakeSwap: their
          published 33% (<code>ProtocolFeeController.sol:32</code>) through their own formula — a
          citation, not a measurement.
        </p>
      </div>
    </div>
  )
}
