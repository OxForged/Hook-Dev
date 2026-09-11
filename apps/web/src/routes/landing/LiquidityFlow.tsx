/* ============================================================================
   A4. Liquidity flow — where a swap's value actually goes.

   This is the one thing the landing page has to teach, and prose was doing it
   badly: a Latch takes a share of a swap on the unspecified currency, and that
   share splits three ways. Everything else on this page is a consequence of
   that sentence.

   WHY THIS IS NOT INVENTED DATA, WHICH IS A FAIR THING TO ASK.

   Every other figure on this page is a measurement — read from whichever chain
   this build serves, or not shown at all. This panel is a MODEL, and it says so
   in the surface itself. The distinction that makes it legitimate:

     · The SHAPE of the flow is not a guess. It is the control flow of
       `RevShareHook._afterSwap` and `settleBeneficiaries`, which live in this
       repository.
     · The ARITHMETIC is the contract's own: `feePips / PIPS_DENOMINATOR` for
       the take, then `share * bps / SPLIT_DENOMINATOR` three ways.
     · The BOUNDS are the contract's real constants — `MAX_FEE_PIPS`,
       `SPLIT_DENOMINATOR`, `MAX_BENEFICIARIES` — not round numbers chosen to
       look good. A slider cannot be dragged somewhere the contract would
       reject, because the slider's ceiling IS the contract's ceiling.
     · The INPUT is the reader's, and it is theirs to change. Nothing here
       claims to be a volume, a TVL or a revenue figure.

   A calculator over published constants is a different object from a chart of
   fabricated history. The rule in CLAUDE.md exists so a reader can trust the
   numbers that claim to be observations; this one never makes that claim, and
   the caption says what it is in plain words rather than in a footnote.

   MOTION. The particles are a CSS animation on an SVG element, so the global
   `prefers-reduced-motion` block in tokens.css stops them. When motion is off
   the diagram is still complete — the edges keep their proportional widths and
   every number is printed — because the animation is decoration on top of a
   static reading, never the reading itself.
   ============================================================================ */

import { useId, useMemo, useState } from 'react'

import { ACTIVE_CHAIN_ID, DEPLOYMENTS } from '../../lib/chain'
import { StackedBar } from '../dapp/components/series-charts'
import type { StackSegment } from '../dapp/components/series-charts'
import styles from './landing.module.css'
import { cx } from './ui'

/** One build, one chain. The provenance line names it rather than spelling it. */
const ACTIVE_CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/* Contract constants. Named after the constant, and each one is the real value
   from the Solidity — a mirror, so a change is greppable from either side.
     RevShareHook.MAX_FEE_PIPS        100_000   (10% of PIPS_DENOMINATOR)
     RevShareHook.SPLIT_DENOMINATOR    10_000
     RevShareHook.MAX_BENEFICIARIES         8
     ProtocolFeeLibrary.PIPS_DENOMINATOR 1e6 */
const PIPS_DENOMINATOR = 1_000_000
const MAX_FEE_PIPS = 100_000
const SPLIT_DENOMINATOR = 10_000

interface Split {
  lp: number
  ben: number
  dist: number
}

/* The live demo pool's fee, as a starting point rather than a claim — 3,000
   pips is `demoPool.lpFee` on both deployments. The reader overwrites it by
   dragging anything. */
const START_FEE_PIPS = 3_000
const START_SPLIT: Split = { lp: 2_000, ben: 5_000, dist: 3_000 }

const SWAP_PRESETS = [1_000, 10_000, 100_000] as const

function pct(n: number, d: number): string {
  return `${Number(((n / d) * 100).toFixed(4))}%`
}

function amount(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return v.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/* --------------------------------------------------------------------------
   Geometry. One viewBox, four columns, hand-placed so the edges read as a
   flow rather than a tree. Coordinates are the layout — keeping them in one
   table means the diagram can be re-proportioned without touching the paths.
   -------------------------------------------------------------------------- */

const VB = { w: 760, h: 340 }
const COL = { swap: 64, pool: 250, take: 452, out: 690 }
const ROW = { lp: 96, take: 210, ben: 200, dist: 292, mid: 170 }

interface Edge {
  id: keyof Split | 'in' | 'lpfee' | 'take'
  d: string
  share: number
  label: string
  tone: string
}

export function LiquidityFlow() {
  const gradId = useId()
  const [feePips, setFeePips] = useState(START_FEE_PIPS)
  const [split, setSplit] = useState<Split>(START_SPLIT)
  const [swap, setSwap] = useState<number>(10_000)
  const [hovered, setHovered] = useState<string | null>(null)

  /* The contract requires the three shares to sum to SPLIT_DENOMINATOR exactly
     — `_validateParams` reverts `SplitMustSumToDenominator` otherwise. Rather
     than let the reader build an invalid split and then scold them, moving one
     slider rebalances the other two in proportion. The invariant is enforced by
     construction, which is also how it reads: this is a split, not three
     independent dials. */
  const setShare = (which: keyof Split, next: number) => {
    setSplit((prev) => {
      const clamped = Math.max(0, Math.min(SPLIT_DENOMINATOR, Math.round(next)))
      const others = (Object.keys(prev) as (keyof Split)[]).filter((k) => k !== which)
      const remaining = SPLIT_DENOMINATOR - clamped
      const otherTotal = others.reduce((a, k) => a + prev[k], 0)

      const out = { ...prev, [which]: clamped } as Split
      if (otherTotal === 0) {
        // Nothing to scale — hand the remainder to the first of the others.
        const first = others[0]
        if (first) out[first] = remaining
        return out
      }
      let assigned = 0
      others.forEach((k, i) => {
        const v =
          i === others.length - 1
            ? remaining - assigned // last one absorbs the rounding, so the sum is exact
            : Math.round((prev[k] / otherTotal) * remaining)
        out[k] = v
        assigned += v
      })
      return out
    })
  }

  const f = useMemo(() => {
    const take = (swap * feePips) / PIPS_DENOMINATOR
    const rest = swap - take
    return {
      take,
      rest,
      lp: (take * split.lp) / SPLIT_DENOMINATOR,
      ben: (take * split.ben) / SPLIT_DENOMINATOR,
      dist: (take * split.dist) / SPLIT_DENOMINATOR,
    }
  }, [swap, feePips, split])

  /* The split as stack segments. Amounts are the bps themselves rather than the
     token figures, so the bar reads as the SPLIT — which is what the contract
     constrains — and stays identical whatever swap size is selected. The token
     amount each share produces is on the tooltip, where a reader who wants it
     will look. */
  const splitSegments: StackSegment[] = [
    { name: 'Back to LPs', amount: split.lp, value: amount(f.lp), color: 'success' },
    { name: 'Beneficiary roster', amount: split.ben, value: amount(f.ben), color: 'violet' },
    { name: 'Epoch distributor', amount: split.dist, value: amount(f.dist), color: 'amber' },
  ]

  /* Edge width is proportional to share, floored so a 0% edge is still visible
     as a hairline — an edge that vanishes reads as "this path does not exist",
     which is a different statement from "nothing is routed here right now". */
  const w = (share: number) => Math.max(1.5, share * 26)
  const takeShare = feePips / MAX_FEE_PIPS

  const edges: Edge[] = [
    {
      id: 'in',
      d: `M ${COL.swap + 46} ${ROW.mid} C ${COL.swap + 120} ${ROW.mid}, ${COL.pool - 80} ${ROW.mid}, ${COL.pool - 34} ${ROW.mid}`,
      share: 1,
      label: 'the swap',
      tone: 'toneSignal',
    },
    {
      id: 'lpfee',
      d: `M ${COL.pool + 34} ${ROW.mid} C ${COL.pool + 110} ${ROW.mid}, ${COL.take - 90} ${ROW.lp}, ${COL.out - 76} ${ROW.lp}`,
      share: 1 - takeShare,
      label: 'stays with the pool',
      tone: 'toneSuccess',
    },
    {
      id: 'take',
      d: `M ${COL.pool + 34} ${ROW.mid} C ${COL.pool + 110} ${ROW.mid}, ${COL.take - 96} ${ROW.take}, ${COL.take - 40} ${ROW.take}`,
      share: Math.max(0.06, takeShare),
      label: 'the Latch take',
      tone: 'tonePrimary',
    },
    {
      id: 'lp',
      d: `M ${COL.take + 40} ${ROW.take} C ${COL.take + 100} ${ROW.take}, ${COL.out - 130} ${ROW.lp + 34}, ${COL.out - 76} ${ROW.lp + 34}`,
      share: split.lp / SPLIT_DENOMINATOR,
      label: 'donated back to LPs',
      tone: 'toneSuccess',
    },
    {
      id: 'ben',
      d: `M ${COL.take + 40} ${ROW.take} C ${COL.take + 100} ${ROW.take}, ${COL.out - 130} ${ROW.ben}, ${COL.out - 76} ${ROW.ben}`,
      share: split.ben / SPLIT_DENOMINATOR,
      label: 'to the beneficiary roster',
      tone: 'toneViolet',
    },
    {
      id: 'dist',
      d: `M ${COL.take + 40} ${ROW.take} C ${COL.take + 100} ${ROW.take}, ${COL.out - 130} ${ROW.dist}, ${COL.out - 76} ${ROW.dist}`,
      share: split.dist / SPLIT_DENOMINATOR,
      label: 'to the epoch distributor',
      tone: 'toneAmber',
    },
  ]

  const dim = (id: string) => hovered !== null && hovered !== id

  return (
    <section id="flow" className={styles['flowSection']}>
      <div className={styles['flowHead']}>
        <p className={styles['eyebrow']}>LIQUIDITY FLOW</p>
        <h2 className={styles['h2']}>
          Where a swap&rsquo;s value <span className={styles['accent']}>actually goes</span>
        </h2>
        <p className={styles['sectionLead']}>
          A Latch takes its share on the unspecified currency after the swap, then splits it three
          ways. Drag anything — the diagram is the contract&rsquo;s arithmetic, and the sliders stop
          exactly where <code>_validateParams</code> would start reverting.
        </p>
      </div>

      <div className={styles['flowGrid']}>
        {/* ------------------------------------------------------ DIAGRAM */}
        <div className={styles['flowCanvas']}>
          <svg
            viewBox={`0 0 ${VB.w} ${VB.h}`}
            className={styles['flowSvg']}
            role="img"
            aria-label={
              `Flow of a ${amount(swap)} token swap. ` +
              `${amount(f.rest)} stays with the pool and its liquidity providers. ` +
              `The Latch takes ${amount(f.take)} at ${pct(feePips, PIPS_DENOMINATOR)}, split into ` +
              `${amount(f.lp)} donated back to LPs, ${amount(f.ben)} to the beneficiary roster, and ` +
              `${amount(f.dist)} to the epoch distributor for holders.`
            }
          >
            <defs>
              <linearGradient id={`${gradId}-edge`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.85" />
              </linearGradient>
            </defs>

            {edges.map((e) => (
              <g
                key={e.id}
                className={cx(styles['flowEdge'], styles[e.tone])}
                data-dim={dim(e.id) ? 'true' : undefined}
                data-on={hovered === e.id ? 'true' : undefined}
              >
                <path d={e.d} strokeWidth={w(e.share)} className={styles['flowEdgeBase']} />
                {/* The moving part. `pathLength` normalises every edge to 100 so
                    one dash pattern reads identically on a short edge and a
                    long one. */}
                <path
                  d={e.d}
                  pathLength={100}
                  strokeWidth={Math.max(1, w(e.share) * 0.5)}
                  className={styles['flowEdgeFlow']}
                  style={{ animationDelay: `${(edges.indexOf(e) * 0.22).toFixed(2)}s` }}
                />
              </g>
            ))}

            <FlowNode x={COL.swap} y={ROW.mid} label="SWAP" value={amount(swap)} tone="toneSignal" />
            <FlowNode x={COL.pool} y={ROW.mid} label="POOL" value={`${amount(f.rest)} kept`} tone="toneSuccess" />
            <FlowNode
              x={COL.take}
              y={ROW.take}
              label="LATCH"
              value={amount(f.take)}
              tone="tonePrimary"
              emphasis
            />
            <FlowNode x={COL.out} y={ROW.lp} label="LPs" value={amount(f.rest + f.lp)} tone="toneSuccess" anchor="end" />
            <FlowNode x={COL.out} y={ROW.ben} label="ROSTER" value={amount(f.ben)} tone="toneViolet" anchor="end" />
            <FlowNode x={COL.out} y={ROW.dist} label="HOLDERS" value={amount(f.dist)} tone="toneAmber" anchor="end" />
          </svg>

          <ul className={styles['flowKey']}>
            {edges
              .filter((e) => e.id === 'lp' || e.id === 'ben' || e.id === 'dist')
              .map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={cx(styles['flowKeyBtn'], styles[e.tone])}
                    onMouseEnter={() => setHovered(e.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(e.id)}
                    onBlur={() => setHovered(null)}
                  >
                    <span className={styles['flowKeySwatch']} aria-hidden="true" />
                    <span>{e.label}</span>
                    <strong>{pct(e.share * SPLIT_DENOMINATOR, SPLIT_DENOMINATOR)}</strong>
                  </button>
                </li>
              ))}
          </ul>
        </div>

        {/* ------------------------------------------------------ CONTROLS */}
        <div className={styles['flowControls']}>
          <div className={styles['flowField']}>
            <span className={styles['flowLabel']}>SWAP SIZE</span>
            <div className={styles['flowPresets']}>
              {SWAP_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={cx(styles['flowPreset'], swap === p && styles['flowPresetOn'])}
                  aria-pressed={swap === p}
                  onClick={() => setSwap(p)}
                >
                  {amount(p)}
                </button>
              ))}
            </div>
          </div>

          <label className={styles['flowField']}>
            <span className={styles['flowLabel']}>
              LATCH FEE
              <strong>
                {feePips} pips · {pct(feePips, PIPS_DENOMINATOR)}
              </strong>
            </span>
            <input
              type="range"
              min={0}
              max={MAX_FEE_PIPS}
              step={100}
              value={feePips}
              className={styles['flowRange']}
              onChange={(e) => setFeePips(Number(e.target.value))}
            />
            <span className={styles['flowHint']}>
              Ceiling is <code>MAX_FEE_PIPS</code> = {MAX_FEE_PIPS.toLocaleString('en-US')} pips, a
              hard 10% constant. Raising a live pool&rsquo;s fee waits 3,600 blocks; lowering it is
              immediate.
            </span>
          </label>

          <div className={styles['flowSplit']}>
            <span className={styles['flowLabel']}>
              THE SPLIT<strong>sums to {SPLIT_DENOMINATOR}, exactly</strong>
            </span>

            <SplitSlider
              label="Back to LPs"
              tone="toneSuccess"
              value={split.lp}
              onChange={(v) => setShare('lp', v)}
            />
            <SplitSlider
              label="Beneficiary roster"
              tone="toneViolet"
              value={split.ben}
              onChange={(v) => setShare('ben', v)}
            />
            <SplitSlider
              label="Epoch distributor"
              tone="toneAmber"
              value={split.dist}
              onChange={(v) => setShare('dist', v)}
            />

            {/* The same three numbers as one bar, because the constraint is the
                point: `_validateParams` reverts unless they sum to exactly
                SPLIT_DENOMINATOR. Three sliders look like three independent
                dials; one track shows there is no slack. `total` is stated, so
                a split that failed to fill it would show a striped remainder
                rather than silently renormalising. */}
            <div className={styles['hostedStack']}>
              <StackedBar
                segments={splitSegments}
                total={SPLIT_DENOMINATOR}
                label="How the Latch take divides, three ways"
                unit="of the Latch take"
              />
            </div>

            <p className={styles['flowHint']}>
              Move one and the other two rebalance: <code>SplitMustSumToDenominator</code> is an
              exact check, not a ceiling.
            </p>
          </div>

          <p className={styles['flowProvenance']}>
            A MODEL, NOT A MEASUREMENT — the contract&rsquo;s own arithmetic over an amount you
            chose, not volume, TVL or revenue. Measured figures on this page are read from{' '}
            {ACTIVE_CHAIN.name} and labelled as such.
          </p>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function FlowNode({
  x,
  y,
  label,
  value,
  tone,
  anchor = 'middle',
  emphasis = false,
}: {
  x: number
  y: number
  label: string
  value: string
  tone: string
  anchor?: 'middle' | 'end'
  emphasis?: boolean
}) {
  const w = emphasis ? 80 : 68
  const h = emphasis ? 54 : 46
  const cx0 = anchor === 'end' ? x - w / 2 : x
  return (
    <g className={cx(styles['flowNode'], styles[tone])} transform={`translate(${cx0} ${y})`}>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={12}
        className={emphasis ? styles['flowNodeBoxOn'] : styles['flowNodeBox']}
      />
      <text y={-4} textAnchor="middle" className={styles['flowNodeLabel']}>
        {label}
      </text>
      <text y={13} textAnchor="middle" className={styles['flowNodeValue']}>
        {value}
      </text>
    </g>
  )
}

function SplitSlider({
  label,
  tone,
  value,
  onChange,
}: {
  label: string
  tone: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className={cx(styles['flowSplitRow'], styles[tone])}>
      <span className={styles['flowSplitName']}>
        <span className={styles['flowKeySwatch']} aria-hidden="true" />
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={SPLIT_DENOMINATOR}
        step={100}
        value={value}
        className={styles['flowRange']}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className={styles['flowSplitOut']}>{pct(value, SPLIT_DENOMINATOR)}</output>
    </label>
  )
}
