/* ============================================================================
   What a swap costs, by pool tier — read from the deployed fee controller.

   THE COMMERCIAL ARGUMENT, DRAWN. Latch takes 25% of the total swap fee where
   PancakeSwap Infinity takes 33%, and that sentence does more work as a chart a
   reader can hover than as a paragraph they skim.

   EVERY LATCH NUMBER IS AN ON-CHAIN READ. `feeForLpFee(lpFee)` is called once
   per tier against the live controller, so the split arithmetic exists in
   exactly one place — the contract that actually charges people. This file
   deliberately does NOT reproduce the formula.

   That matters here more than usual. CLAUDE.md records that a previous
   `FeeChart` was DELETED from this repo, not disabled, for being fed by sample
   data: "a chart component whose only input was fiction is a loaded gun". A
   chart with this name earns its way back only by reading the chain, and by
   rendering nothing when it cannot.

   THE ONE NUMBER NOT READ FROM OUR CHAIN is PancakeSwap's 33%, which is a
   constant in their published source (`ProtocolFeeController.sol:32`,
   `protocolFeeSplitRatio = 33 * 1e4`). It is a citation, labelled as one, and
   the comparison curve is computed with their own formula rather than guessed.
   ========================================================================== */

import { useEffect, useState } from 'react'
import { ACTIVE_CHAIN_ID, DEPLOYMENTS, readFeeTiers, type FeeTier } from '../../lib/chain'
import styles from './landing.module.css'

const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/** Hundredths of a bip, matching the contract. 1e6 == 100%. */
const ONE = 1_000_000

/**
 * PancakeSwap Infinity's split, from their source. Used only to draw the
 * comparison column — never to describe Latch.
 */
const PANCAKE_SPLIT = 330_000

/**
 * Their formula, applied to their ratio.
 *
 * Solving `p / (p + l - p*l/ONE) == ratio` for `p`. Integer division
 * throughout, matching Solidity, so the comparison is like for like rather
 * than a float approximation of it.
 */
function pancakeFeeFor(lpFee: number): number {
  const denominator = lpFee + Math.floor((ONE * ONE) / PANCAKE_SPLIT) - ONE
  if (denominator <= 0) return 4000
  const fee = Math.floor((lpFee * ONE) / denominator)
  return Math.min(fee, 4000) // core's MAX_PROTOCOL_FEE
}

const pct = (pips: number, dp = 4): string => `${(pips / 10_000).toFixed(dp)}%`

/** The fee a trader actually pays: protocol and LP compose, they do not add. */
const allIn = (lp: number, protocol: number): number =>
  lp + protocol - Math.floor((lp * protocol) / ONE)

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; tiers: FeeTier[]; splitRatio: number }

export function FeeChart() {
  const [s, setS] = useState<State>({ k: 'loading' })
  const [mode, setMode] = useState<'latch' | 'pancake'>('latch')
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    let off = false
    readFeeTiers()
      .then((r) => !off && setS({ k: 'ready', tiers: r.tiers, splitRatio: r.splitRatio }))
      .catch(
        (e) =>
          !off &&
          setS({ k: 'error', message: e instanceof Error ? e.message : 'unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])

  if (s.k === 'loading') {
    return (
      <div className={styles['feeChartCard']}>
        <p className={styles['feeChartNote']}>Reading the fee controller on {CHAIN.name}…</p>
      </div>
    )
  }

  /* No fallback table. If the controller cannot be read, the honest output is
     the reason — not a chart drawn from constants that might be stale. */
  if (s.k === 'error') {
    return (
      <div className={styles['feeChartCard']}>
        <p className={styles['feeChartNote']}>
          The fee controller on {CHAIN.name} could not be read, so no figures are shown.
          <br />
          <span className={styles['feeChartRaw']}>{s.message}</span>
        </p>
      </div>
    )
  }

  const rows = s.tiers.map((t) => ({
    lpFee: t.lpFee,
    protocol: mode === 'latch' ? t.protocolFeePips : pancakeFeeFor(t.lpFee),
  }))
  const max = Math.max(...rows.map((r) => allIn(r.lpFee, r.protocol))) * 1.12

  const W = 720
  const H = 250
  const PL = 54
  const PR = 16
  const PT = 12
  const PB = 32
  const iw = W - PL - PR
  const ih = H - PT - PB
  const y = (v: number) => PT + ih - (v / max) * ih
  const bw = iw / rows.length
  const cw = Math.min(62, bw * 0.5)

  const standard = s.tiers.find((t) => t.lpFee === 3000)

  return (
    <div className={styles['feeChartCard']}>
      <div className={styles['feeChartHead']}>
        <div>
          <h3 className={styles['feeChartTitle']}>What a swap costs, by pool tier</h3>
          <p className={styles['feeChartSub']}>
            The protocol takes {(s.splitRatio / 10_000).toFixed(0)}% of the total swap fee. Read
            from the controller on {CHAIN.name}.
          </p>
        </div>
        <div className={styles['feeChartToggle']} role="group" aria-label="Compare protocol fee">
          <button
            type="button"
            className={mode === 'latch' ? styles['feeChartTabOn'] : styles['feeChartTab']}
            onClick={() => setMode('latch')}
            aria-pressed={mode === 'latch'}
          >
            Latch · {(s.splitRatio / 10_000).toFixed(0)}%
          </button>
          <button
            type="button"
            className={mode === 'pancake' ? styles['feeChartTabOn'] : styles['feeChartTab']}
            onClick={() => setMode('pancake')}
            aria-pressed={mode === 'pancake'}
          >
            PancakeSwap · 33%
          </button>
        </div>
      </div>

      <div className={styles['feeChartWrap']}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles['feeChartSvg']}
          role="img"
          aria-label={`Protocol fee by pool tier under the ${mode === 'latch' ? 'Latch' : 'PancakeSwap'} split`}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const v = (max / 4) * i
            return (
              <g key={i}>
                <line className={styles['feeChartGrid']} x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} />
                <text className={styles['feeChartAxis']} x={PL - 9} y={y(v) + 3.5} textAnchor="end">
                  {pct(v, 2)}
                </text>
              </g>
            )
          })}

          {rows.map((r, i) => {
            const cx = PL + bw * i + bw / 2
            const x = cx - cw / 2
            const hLP = (r.lpFee / max) * ih
            const hPR = (r.protocol / max) * ih
            const yLP = PT + ih - hLP
            return (
              <g
                key={r.lpFee}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={styles['feeChartCol']}
              >
                <rect x={cx - bw / 2} y={PT} width={bw} height={ih} fill="transparent" />
                <rect x={x} y={yLP} width={cw} height={hLP} rx={3} className={styles['feeChartLp']} />
                <rect
                  x={x}
                  y={yLP - hPR}
                  width={cw}
                  height={hPR}
                  rx={3}
                  className={styles['feeChartProtocol']}
                />
                <text className={styles['feeChartAxis']} x={cx} y={H - PB + 17} textAnchor="middle">
                  {pct(r.lpFee, 2)}
                </text>
              </g>
            )
          })}
        </svg>

        {hover !== null && rows[hover] ? (
          <div className={styles['feeChartTip']} style={{ left: `${((hover + 0.5) / rows.length) * 100}%` }}>
            <strong>{pct(rows[hover].lpFee, 2)} pool</strong>
            <span>LP {pct(rows[hover].lpFee, 2)}</span>
            <span>Protocol {pct(rows[hover].protocol)}</span>
            <span>All-in {pct(allIn(rows[hover].lpFee, rows[hover].protocol))}</span>
          </div>
        ) : null}
      </div>

      <div className={styles['feeChartFoot']}>
        <span className={styles['feeChartLegend']}>
          <i className={styles['feeChartSwatchLp']} /> LP fee
          <i className={styles['feeChartSwatchProtocol']} /> Protocol fee
        </span>
        {standard ? (
          <span>
            Standard 0.30% pool:{' '}
            <b>
              {pct(mode === 'latch' ? standard.protocolFeePips : pancakeFeeFor(3000))}
            </b>{' '}
            protocol, {pct(allIn(3000, mode === 'latch' ? standard.protocolFeePips : pancakeFeeFor(3000)))} all-in
          </span>
        ) : null}
      </div>

      <p className={styles['feeChartNote']}>
        Latch figures are <code>feeForLpFee</code> on the live controller. PancakeSwap&rsquo;s 33%
        is a constant in their published source and is computed with their own formula — it is a
        citation, not a measurement of their deployment.
      </p>
    </div>
  )
}
