/* ============================================================================
   Swap cost calculator — FeeChart's companion, directly beneath it.

   THE DIVISION OF LABOUR. FeeChart draws the RATE at every tier and compares
   splits. This panel answers the one question a rate cannot: "I am about to
   move this much — what comes off it, at each tier, and who receives it". So
   it carries no rate chart and no mode toggle of its own; it applies the same
   live rates to a size the reader chooses, in token units.

   EVERY RATE IS AN ON-CHAIN READ. The tier list and each tier's protocol fee
   are `feeForLpFee(lpFee)` on the live controller (`readFeeTiers`), and
   `readProtocolStatus` says whether that schedule is in force. `feeMath.ts`
   only composes the two fees and computes the cited PancakeSwap comparison —
   the same functions FeeChart uses, so the two panels cannot disagree.

   THE FEES COMPOSE, THEY DO NOT ADD. `allIn = lp + protocol - lp*protocol/1e6`
   (ProtocolFeeLibrary.calculateSwapFee). `lpAmount` is derived by subtraction
   from the all-in total, so the parts always sum to the total on screen.

   THE SIZE IS THE READER'S, AND IT SAYS SO. It is labelled a calculator input,
   is denominated in token units, and is never converted to dollars: nothing on
   this page prices a token (CLAUDE.md, "No dollar figures for unpriced tokens").
   The unit is "input token", not a symbol — the panel is about a trade the
   reader imagines, not a pool, and no pool is named or implied.

   WHY THERE IS NO FALLBACK TABLE. If the controller cannot be read, the panel
   renders the reason and NO figures.
   ========================================================================== */

import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'

import {
  ACTIVE_CHAIN_ID,
  DEPLOYMENTS,
  readFeeTiers,
  readProtocolStatus,
  type FeeTier,
} from '../../lib/chain'
import { useFirstView } from './chartMotion'
import { ONE, allInPips, pancakeFeeFor, pct } from './feeMath'
import page from './landing.module.css'
import styles from './swapcost.module.css'
import { cx } from './ui'

/** One build, one chain — the same rule the rest of the landing page follows. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * The unit. Generic on purpose: this used to borrow the symbol of the address
 * book's reference pool, a test token, which put a retired test pool's ticker on
 * the landing page. The calculator prices a size the reader types; it needs no
 * ticker to do that, and inventing one would imply a pool.
 */
const UNIT_LABEL = 'input token'

/**
 * A token amount, adaptive precision: this panel spans six orders of
 * magnitude, and a fixed 2 dp prints a small protocol cut as "0.00".
 */
function decimalsFor(v: number): number {
  const magnitude = Math.abs(v)
  if (magnitude === 0 || magnitude >= 1000) return 0
  if (magnitude >= 1) return 2
  return Math.min(6, 2 + Math.ceil(-Math.log10(magnitude)))
}

function tokens(v: number): string {
  if (v === 0) return '0'
  return v.toLocaleString('en-US', { maximumFractionDigits: decimalsFor(v) })
}

/**
 * ONE precision per table column. `tokens` drops trailing zeros per cell, so a
 * column read "0.8 less" beside "0.16 less" — the same unit at two apparent
 * precisions. The column takes the decimals its smallest non-zero value needs
 * and every cell is printed to exactly that many. Formatting only: the amounts
 * themselves are untouched.
 */
function columnDecimals(values: readonly number[]): number {
  return values.reduce((dp, v) => (v === 0 ? dp : Math.max(dp, decimalsFor(v))), 0)
}

function tokensFixed(v: number, dp: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

/* ---- the size input -------------------------------------------------------
   LOG-SCALE SLIDER plus a free number field. The slider's value is a position;
   the amount is derived from it, so arrow keys move by a constant proportion.
   The field accepts any positive amount, and the slider pins at its ends when
   the typed amount is outside 100 – 1,000,000. */

const SIZE_MIN_EXP = 2
const SIZE_MAX_EXP = 6
const SLIDER_STEPS = 400
/** 10,000 tokens. The reader's starting point, not a measurement of anything. */
const START_SIZE = 10_000
/** Upper bound on a typed size: past this, float token maths stops being exact. */
const SIZE_CEILING = 1e12

function roundSignificant(v: number, digits: number): number {
  const mag = 10 ** (Math.floor(Math.log10(v)) - digits + 1)
  return Math.round(v / mag) * mag
}

function sizeAt(pos: number): number {
  const exp = SIZE_MIN_EXP + ((SIZE_MAX_EXP - SIZE_MIN_EXP) * pos) / SLIDER_STEPS
  return roundSignificant(10 ** exp, 3)
}

function posFor(size: number): number {
  const exp = Math.log10(size)
  const pos = ((exp - SIZE_MIN_EXP) / (SIZE_MAX_EXP - SIZE_MIN_EXP)) * SLIDER_STEPS
  return Math.min(SLIDER_STEPS, Math.max(0, Math.round(pos)))
}

/** Accepts "10000", "10,000", " 1e4 ". Returns null for anything not a positive finite amount. */
function parseSize(text: string): number | null {
  const n = Number(text.replace(/[,\s_]/g, ''))
  if (!Number.isFinite(n) || n <= 0 || n > SIZE_CEILING) return null
  return n
}

/* -------------------------------------------------------------------------- */

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; tiers: FeeTier[]; wired: boolean; disabled: boolean }

interface Row {
  lpFee: number
  protocolPips: number
  allIn: number
  total: number
  protocolAmount: number
  lpAmount: number
  /** Positive when Latch is cheaper. Token units. */
  saving: number
}

function compute(size: number, tier: FeeTier): Row {
  const allIn = allInPips(tier.lpFee, tier.protocolFeePips)
  const total = (size * allIn) / ONE
  const protocolAmount = (size * tier.protocolFeePips) / ONE
  const pancakeTotal = (size * allInPips(tier.lpFee, pancakeFeeFor(tier.lpFee))) / ONE
  return {
    lpFee: tier.lpFee,
    protocolPips: tier.protocolFeePips,
    allIn,
    total,
    protocolAmount,
    lpAmount: total - protocolAmount,
    saving: pancakeTotal - total,
  }
}

export function SwapCost() {
  /* The section is outside the body so the anchor exists on every branch. */
  return (
    <section id="swap-cost" className={page['section']} aria-label="Swap cost calculator">
      <SwapCostBody />
    </section>
  )
}

function SwapCostBody() {
  const [s, setS] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let off = false
    /* BOTH READS, OR NEITHER: the schedule, and whether it is in force. */
    Promise.all([readFeeTiers(), readProtocolStatus()])
      .then(([fees, status]) => {
        if (off) return
        setS({
          k: 'ready',
          tiers: fees.tiers,
          wired: status.controllerWired,
          disabled: status.feesDisabled,
        })
      })
      .catch((e: unknown) => {
        if (off) return
        setS({ k: 'error', message: e instanceof Error ? e.message : 'the chain was unreachable' })
      })
    return () => {
      off = true
    }
  }, [])

  if (s.k === 'loading') {
    return (
      <div className={cx(styles['card'], styles['stateCard'])} data-state="loading">
        <p className={styles['state']}>
          <i className={styles['stateDot']} aria-hidden="true" />
          Reading the fee controller on {CHAIN.name}…
        </p>
      </div>
    )
  }

  if (s.k === 'error') {
    return (
      <div className={cx(styles['card'], styles['stateCard'])} data-state="error">
        <p className={styles['state']}>
          The fee controller on {CHAIN.name} could not be read, so no trade is priced here.
        </p>
        <p className={styles['raw']}>{s.message}</p>
      </div>
    )
  }

  if (s.tiers.length === 0) {
    return (
      <div className={cx(styles['card'], styles['stateCard'])} data-state="empty">
        <p className={styles['state']}>
          The controller on {CHAIN.name} returned no fee tiers, so there is nothing to price a
          trade against.
        </p>
      </div>
    )
  }

  return <Calculator tiers={s.tiers} wired={s.wired} disabled={s.disabled} />
}

function Calculator({
  tiers,
  wired,
  disabled,
}: {
  tiers: FeeTier[]
  wired: boolean
  disabled: boolean
}) {
  const [size, setSize] = useState(START_SIZE)
  const [draft, setDraft] = useState(START_SIZE.toLocaleString('en-US'))
  const [announced, setAnnounced] = useState('')
  const fieldId = useId()
  const sliderId = useId()
  const hintId = useId()
  const { ref: tableRef, hidden: growHidden } = useFirstView<HTMLTableElement>()

  const invalid = parseSize(draft) === null
  const rows = useMemo(() => tiers.map((t) => compute(size, t)), [tiers, size])
  const maxTotal = Math.max(...rows.map((r) => r.total), Number.MIN_VALUE)
  const dp = {
    total: columnDecimals(rows.map((r) => r.total)),
    lp: columnDecimals(rows.map((r) => r.lpAmount)),
    protocol: columnDecimals(rows.map((r) => r.protocolAmount)),
    saving: columnDecimals(rows.map((r) => r.saving)),
  }

  /* THE LIVE REGION IS DEBOUNCED, the visible figures are not: a slider drag
     fires on every pixel, and one utterance per frame is noise. */
  const summary = `Fees recalculated for ${tokens(size)} ${UNIT_LABEL} at ${rows.length} pool tiers.`
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(summary), 600)
    return () => clearTimeout(id)
  }, [summary])

  return (
    <div className={styles['card']}>
      <div className={styles['head']}>
        <div className={styles['headText']}>
          <h2 className={styles['title']}>Price a trade at every tier</h2>
          <p className={styles['caption']}>
            Set a size. Each row applies that tier&rsquo;s live rate, from the chart above, to it.
          </p>
        </div>

        {/* ------------------------------------------------ the calculator input */}
        <div className={styles['input']}>
          <div className={styles['inputHead']}>
            <label className={styles['label']} htmlFor={fieldId}>
              Trade size
            </label>
            <span className={styles['chip']}>Calculator input</span>
          </div>
          <div className={styles['fieldRow']}>
            <input
              id={fieldId}
              className={styles['field']}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              aria-invalid={invalid}
              aria-describedby={hintId}
              onChange={(e) => {
                setDraft(e.target.value)
                const n = parseSize(e.target.value)
                if (n !== null) setSize(n)
              }}
              onBlur={() => {
                if (!invalid) setDraft(size.toLocaleString('en-US'))
              }}
            />
            <span className={styles['unit']}>{UNIT_LABEL}</span>
          </div>
          <input
            id={sliderId}
            type="range"
            className={styles['range']}
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={posFor(size)}
            aria-label="Trade size, logarithmic slider"
            aria-valuetext={`${tokens(size)} ${UNIT_LABEL}`}
            onChange={(e) => {
              const next = sizeAt(Number(e.target.value))
              setSize(next)
              setDraft(next.toLocaleString('en-US'))
            }}
          />
          <p id={hintId} className={cx(styles['hint'], invalid && styles['hintBad'])}>
            {invalid
              ? `Enter a positive amount up to ${SIZE_CEILING.toLocaleString('en-US')}.`
              : `Your number, not a measurement. Slider runs ${tokens(10 ** SIZE_MIN_EXP)} – ${tokens(10 ** SIZE_MAX_EXP)}.`}
          </p>
        </div>
      </div>

      {/* The schedule is not the same claim as the charge. */}
      {!wired || disabled ? (
        <p className={styles['notice']}>
          <strong>Scheduled, not yet charged.</strong>{' '}
          {disabled
            ? 'The controller’s fee switch is off, so a pool initialized now is stamped a zero protocol fee.'
            : `The pool manager on ${CHAIN.name} does not point at this controller yet, so a pool initialized now is stamped a zero protocol fee.`}{' '}
          The protocol column is the schedule; the LP fee is charged today either way.
        </p>
      ) : null}

      {/* Below 720px the table reflows into one card per tier (swapcost.module.css):
          the same cells, the same numbers and the same column precision, each
          value carrying its column's name from `data-label`. */}
      <div className={styles['scroller']}>
        <table className={styles['table']} ref={tableRef}>
          <caption className={styles['sr']}>
            Fee on a trade of {tokens(size)} {UNIT_LABEL}, at each pool tier read from the{' '}
            {CHAIN.name} fee controller.
          </caption>
          <thead>
            <tr>
              <th scope="col">Pool tier</th>
              <th scope="col" className={styles['colBar']}>
                All-in fee · {UNIT_LABEL}
              </th>
              <th scope="col" className={styles['num']}>
                To LPs
              </th>
              <th scope="col" className={styles['num']}>
                To protocol
              </th>
              <th scope="col" className={styles['num']}>
                vs PancakeSwap 33%
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const lpShare = r.total > 0 ? (r.lpAmount / r.total) * 100 : 0
              return (
                <tr key={r.lpFee}>
                  <th scope="row" className={styles['tier']}>
                    {pct(r.lpFee, 2)}
                    <span className={styles['tierSub']}>{pct(r.allIn)} all-in</span>
                  </th>
                  <td className={styles['colBar']} data-label={`All-in fee · ${UNIT_LABEL}`}>
                    <span className={styles['barCell']}>
                      {/* Length is this row's all-in amount against the largest
                          row's, split LP | protocol inside. Same two colours as
                          FeeChart. Decorative: the figures are in the cells. */}
                      <span className={styles['barTrack']} aria-hidden="true">
                        <span
                          className={cx(styles['bar'], growHidden && styles['barHidden'])}
                          style={
                            {
                              width: `${(r.total / maxTotal) * 100}%`,
                              '--stagger': `${i * 60}ms`,
                            } as CSSProperties
                          }
                        >
                          <span className={styles['segLp']} style={{ width: `${lpShare}%` }} />
                          <span className={styles['segProtocol']} />
                        </span>
                      </span>
                      <span className={styles['total']}>{tokensFixed(r.total, dp.total)}</span>
                    </span>
                  </td>
                  <td className={styles['num']} data-label="To LPs">
                    {tokensFixed(r.lpAmount, dp.lp)}
                  </td>
                  <td className={styles['num']} data-label="To protocol">
                    {tokensFixed(r.protocolAmount, dp.protocol)}
                    <span className={styles['numSub']}>{pct(r.protocolPips)}</span>
                  </td>
                  <td
                    className={cx(styles['num'], r.saving > 0 && styles['better'])}
                    data-label="vs PancakeSwap 33%"
                  >
                    {/* Direction is computed, not assumed. */}
                    {r.saving > 0
                      ? `${tokensFixed(r.saving, dp.saving)} less`
                      : r.saving < 0
                        ? `${tokensFixed(-r.saving, dp.saving)} more`
                        : 'same'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className={styles['sr']} aria-live="polite">
        {announced}
      </div>

      <p className={styles['provenance']}>
        Rates: <code>feeForLpFee</code> on the {CHAIN.name} controller, composed as{' '}
        <code>lp + protocol − lp·protocol/10⁶</code>. The size is yours, in units of the token
        you would pay in — nothing is priced here, so nothing is shown in dollars. PancakeSwap&rsquo;s 33% is cited from their source, not measured.
      </p>
    </div>
  )
}
