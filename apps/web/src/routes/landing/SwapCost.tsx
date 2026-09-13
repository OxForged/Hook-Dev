/* ============================================================================
   Swap cost simulator — what one trade costs, and who receives each part.

   WHAT THIS ANSWERS THAT NOTHING ELSE ON THE PAGE DOES.

   `FeeChart` plots the RATE across every tier: five bars, no trade, no amount.
   `LiquidityFlow` models the RevShareHook layer — a Latch's take on the
   unspecified currency and the three-way split that follows — over constants
   from this repository, and it reads nothing from chain.

   Neither one answers the question a trader actually asks, which is "I am about
   to move this much; what comes off it, and where does it land". That needs a
   size, the live rate for the tier, and the composition of the two fees. It is
   the CORE layer (pool LP fee + protocol fee), one step upstream of the hook
   layer LiquidityFlow draws, and every rate in it is an on-chain read.

   THE FEES COMPOSE, THEY DO NOT ADD — the single most misread thing here.

   The protocol fee is taken off the INPUT first; the LP fee then applies to
   what is left. So the all-in rate is

       allIn = lp + protocol - (lp * protocol) / 1e6

   and NOT `lp + protocol`. The subtracted term is the LP fee that is never
   charged on the slice the protocol already took. At a 0.30% pool the
   difference is two pips — small, and wrong is wrong: a panel that adds them
   overstates the cost, and the same error inverted is how a protocol
   accidentally double-charges. Core does it this way in
   `ProtocolFeeLibrary.calculateSwapFee`, and `chain.ts:splitFee` inverts the
   same formula to recover the LP slice from a real Swap event.

   THE PIP ARITHMETIC IS INTEGER, ON PURPOSE. `Math.floor` everywhere a pip
   value is derived, matching Solidity's truncating division, so the comparison
   against PancakeSwap's split is like for like rather than a float
   approximation that drifts by a pip and makes the delta unfalsifiable. The
   TOKEN column is float, because it applies those pips to a whole-token figure
   the reader typed rather than to a wei amount the chain settled — it is a
   proportion of their number, and it says so.

   WHY THERE IS NO FALLBACK TABLE. If the controller cannot be read, this panel
   renders the reason and NO figures. CLAUDE.md records that a previous
   `FeeChart` was deleted from this repo — not disabled — for being fed by
   sample data: "a chart component whose only input was fiction is a loaded
   gun". A tier schedule hardcoded here would look identical to a live one on
   the day it went stale, and a reader has no way to tell which numbers to
   discount.

   WHY THE SIZE IS IN TOKEN UNITS AND NEVER IN DOLLARS. The tokens on the
   chains Latch is deployed to are test tokens that nothing prices. Multiplying
   them by an invented price to produce a dollar headline is the exact failure
   CLAUDE.md's "No dollar figures for unpriced tokens" rule was written for. The
   symbol comes from the address book's reference pool; where a chain has no
   reference pool the unit is stated as "input token" with no symbol invented
   for it.

   PROVENANCE IS SPLIT ACROSS THE PANEL, VISIBLY. The rates are a measurement
   and carry a READ FROM CHAIN chip; the trade size is the reader's and carries
   a YOUR NUMBER chip. Nothing about the layout may suggest the size came from
   chain, because it did not.
   ========================================================================== */

import { useEffect, useMemo, useState } from 'react'

import {
  ACTIVE_CHAIN_ID,
  DEPLOYMENTS,
  readFeeTiers,
  readProtocolStatus,
  type FeeTier,
} from '../../lib/chain'
import styles from './swapcost.module.css'
import { cx } from './ui'

/** One build, one chain — the same rule the rest of the landing page follows. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * The unit everything on this panel is denominated in.
 *
 * `symbol0` of the chain's reference pool, which is a real ERC-20 this repo's
 * own exercise scripts created and swapped. `null` when the chain has no
 * reference pool: the honest output there is "input token", never a symbol
 * borrowed from some other chain's table.
 */
const UNIT: string | null = CHAIN.demoPool?.symbol0 ?? null
const UNIT_LABEL = UNIT ?? 'input token'

/**
 * Whether that token is one of this repo's throwaways.
 *
 * Read off the address book's own `isTestToken` flag rather than off the
 * chain's `isMainnet`, because they are different claims: a mainnet chain can
 * still carry a worthless test ERC-20, and it is the TOKEN's pricelessness
 * that forbids a dollar figure here.
 */
const UNIT_IS_TEST: boolean =
  CHAIN.demoPool !== null &&
  (CHAIN.tokens.find(
    (t) => t.address.toLowerCase() === CHAIN.demoPool?.token0.toLowerCase(),
  )?.isTestToken ??
    false)

/** Hundredths of a bip, matching `ProtocolFeeLibrary.PIPS_DENOMINATOR`. */
const ONE = 1_000_000

/**
 * PancakeSwap Infinity's split ratio, from their published source
 * (`ProtocolFeeController.sol:32`, `protocolFeeSplitRatio = 33 * 1e4`).
 *
 * A CITATION, not a measurement of their deployment — this repo has never
 * called their contracts and does not claim to have. It is restated here
 * rather than imported because `FeeChart.tsx` keeps it as a module-private
 * constant; if a third surface ever needs it, the right move is to hoist it and
 * `pancakeFeeFor` into one shared module rather than to make a third copy.
 */
const PANCAKE_SPLIT = 330_000

/** Core's `ProtocolFeeLibrary.MAX_PROTOCOL_FEE` — 4000 pips, a hard 0.4% cap. */
const MAX_PROTOCOL_FEE = 4000

/**
 * The protocol fee PancakeSwap's controller would stamp on a pool at this LP
 * fee, computed with their own formula and their own ratio.
 *
 * Solving `p / (p + l - p*l/ONE) == ratio` for `p`. Integer division
 * throughout, matching Solidity — the same arithmetic `FeeChart` uses, so the
 * two surfaces cannot disagree about the comparison column.
 */
function pancakeFeeFor(lpFee: number): number {
  const denominator = lpFee + Math.floor((ONE * ONE) / PANCAKE_SPLIT) - ONE
  if (denominator <= 0) return MAX_PROTOCOL_FEE
  return Math.min(Math.floor((lpFee * ONE) / denominator), MAX_PROTOCOL_FEE)
}

/**
 * The rate a trader actually pays. See the header: the two fees COMPOSE.
 *
 * `Math.floor` on the product term because Solidity's `/` truncates, and this
 * value is the basis of the comparison — a rounded version of it would make
 * Latch look a pip cheaper or dearer than it is, at random.
 */
function allInPips(lp: number, protocol: number): number {
  return lp + protocol - Math.floor((lp * protocol) / ONE)
}

/** A pip figure as a percentage. 3000 pips is 0.30%. */
function pct(pips: number, dp = 4): string {
  return `${(pips / 10_000).toFixed(dp)}%`
}

/**
 * A token amount, in units of the trade's own token.
 *
 * Adaptive precision, because this panel spans six orders of magnitude: a
 * fixed 2 dp prints the protocol's cut on a 100-token trade as "0.10" and its
 * saving against PancakeSwap as "0.00", which reads as nothing rather than as
 * a small number. Never a currency, never a dollar sign — see the header.
 */
function tokens(v: number): string {
  if (v === 0) return '0'
  const magnitude = Math.abs(v)
  const dp =
    magnitude >= 1000 ? 0 : magnitude >= 1 ? 2 : Math.min(6, 2 + Math.ceil(-Math.log10(magnitude)))
  return v.toLocaleString('en-US', { maximumFractionDigits: dp })
}

/* --------------------------------------------------------------------------
   The size slider.

   LOG SCALE, because the interesting range spans four orders of magnitude and
   a linear track spends 90% of its travel above 100,000 — a reader dragging
   for a realistic retail trade would be working in the leftmost few pixels.
   The slider's own value is a POSITION on the track; the token amount is
   derived from it, so `step` stays uniform and the keyboard arrows move by a
   constant proportion rather than a constant amount.
   -------------------------------------------------------------------------- */

const SIZE_MIN_EXP = 2 // 100 tokens
const SIZE_MAX_EXP = 6 // 1,000,000 tokens
const SLIDER_STEPS = 400
/** 10,000 tokens. The reader's starting point, not a measurement of anything. */
const START_POS = 200

/** Round to `digits` significant figures, so the slider lands on 4,700 rather
    than 4,712.891 — a number a reader can repeat back. */
function roundSignificant(v: number, digits: number): number {
  const mag = 10 ** (Math.floor(Math.log10(v)) - digits + 1)
  return Math.round(v / mag) * mag
}

function sizeAt(pos: number): number {
  const exp = SIZE_MIN_EXP + ((SIZE_MAX_EXP - SIZE_MIN_EXP) * pos) / SLIDER_STEPS
  return roundSignificant(10 ** exp, 3)
}

/* -------------------------------------------------------------------------- */

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | {
      k: 'ready'
      tiers: FeeTier[]
      splitRatio: number
      /** `CLPoolManager.protocolFeeController()` points at our controller. */
      wired: boolean
      /** The controller's guardian switch. */
      disabled: boolean
    }

export function SwapCost() {
  /* The section wrapper is outside the body so the anchor exists on every
     branch — a target that only mounts on the ready path is a dead link for
     the whole duration of the read, and forever if the read fails. That lesson
     is written up at the top of FeeChart.tsx; it generalises. */
  return (
    <section id="swap-cost" className={styles['section']} aria-label="What a swap costs">
      <SwapCostBody />
    </section>
  )
}

function SwapCostBody() {
  const [s, setS] = useState<State>({ k: 'loading' })
  const [pos, setPos] = useState(START_POS)
  const [tier, setTier] = useState<number | null>(null)
  /** Debounced copy of the summary, for the polite live region. See below. */
  const [announced, setAnnounced] = useState('')

  useEffect(() => {
    let off = false

    /* BOTH READS, OR NEITHER.
       `readFeeTiers` gives the schedule; `readProtocolStatus` gives whether
       that schedule is in force at all. Publishing the first without the
       second is the exact contradiction CLAUDE.md records from the dashboard —
       a controller default rendered as "the protocol fee" beside an activity
       feed reading "0 to protocol" on every swap. Both true, flatly
       inconsistent, and only one of them answering the reader's question. */
    Promise.all([readFeeTiers(), readProtocolStatus()])
      .then(([fees, status]) => {
        if (off) return
        setS({
          k: 'ready',
          tiers: fees.tiers,
          splitRatio: fees.splitRatio,
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

  const size = useMemo(() => sizeAt(pos), [pos])

  /* The active tier, resolved rather than stored, so a redeploy that changes
     the tier list cannot leave this pointing at a tier the controller no longer
     knows about. */
  const tiers = s.k === 'ready' ? s.tiers : []
  const active: FeeTier | undefined =
    tiers.find((t) => t.lpFee === tier) ?? preferredTier(tiers)

  const figures = active ? compute(size, active) : null

  const summary =
    figures && active
      ? `${tokens(size)} ${UNIT_LABEL} through a ${pct(active.lpFee, 2)} pool costs ` +
        `${tokens(figures.total)} ${UNIT_LABEL} all in, at ${pct(figures.allIn)}. ` +
        `${tokens(figures.lpAmount)} to liquidity providers, ` +
        `${tokens(figures.protocolAmount)} to the protocol.`
      : ''

  /* THE LIVE REGION IS DEBOUNCED, and the visible figures are not.
     A range input fires `change` on every pixel of a drag. Wiring the numbers
     straight into `aria-live` queues one utterance per frame, which a screen
     reader either reads for a minute or drops entirely. The sighted reader
     wants the number now; the listening reader wants it once the drag stops.
     Those are different requirements and this is the only place they diverge.

     The dependency is the SENTENCE, not the figures that produced it. A
     freshly-built object is a new identity on every render, which would re-arm
     the timer each time the timer itself fired — a string compares by value and
     settles after one pass. */
  useEffect(() => {
    if (summary === '') return
    const id = setTimeout(() => setAnnounced(summary), 600)
    return () => clearTimeout(id)
  }, [summary])

  if (s.k === 'loading') {
    return (
      <p className={styles['note']}>Reading the fee controller on {CHAIN.name}…</p>
    )
  }

  /* No fallback tiers, no default split, no example trade. The reason, and
     nothing that could be mistaken for a figure. */
  if (s.k === 'error') {
    return (
      <div className={styles['card']}>
        <p className={styles['note']}>
          The fee controller on {CHAIN.name} could not be read, so no figures are shown here.
          Nothing on this panel is computed from anything but that read.
          <br />
          <span className={styles['raw']}>{s.message}</span>
        </p>
      </div>
    )
  }

  if (!active || !figures) {
    return (
      <div className={styles['card']}>
        <p className={styles['note']}>
          The controller on {CHAIN.name} returned no fee tiers, so there is nothing to price a
          trade against.
        </p>
      </div>
    )
  }

  const lpShare = (figures.lpPips / figures.allIn) * 100
  const protocolShare = 100 - lpShare

  return (
    <div className={styles['card']}>
      <header className={styles['head']}>
        <div className={styles['headText']}>
          <p className={styles['eyebrow']}>SWAP COST</p>
          <h2 className={styles['title']}>
            What a trade costs, and who <span className={styles['accent']}>receives each part</span>
          </h2>
          <p className={styles['lead']}>
            Latch takes {(s.splitRatio / 10_000).toFixed(0)}% of the total swap fee. The rest stays
            with the pool. Set a size and a tier — every rate below is read from the controller on{' '}
            {CHAIN.name}.
          </p>
        </div>
      </header>

      {/* The schedule is not the same claim as the charge. Say which one is on
          screen whenever they differ, rather than letting a reader assume. */}
      {!s.wired || s.disabled ? (
        <p className={styles['notice']}>
          <strong>Scheduled, not yet charged.</strong>{' '}
          {s.disabled
            ? 'The controller’s fee switch is off, so a pool initialized right now is stamped a zero protocol fee.'
            : `The pool manager on ${CHAIN.name} does not point at this controller yet, so a pool initialized right now is stamped a zero protocol fee.`}{' '}
          The protocol figures below are the schedule the controller would apply once it is in
          force. The LP fee is charged today either way.
        </p>
      ) : null}

      <div className={styles['controls']}>
        {/* ------------------------------------------------------ TRADE SIZE */}
        <div className={styles['field']}>
          <div className={styles['fieldHead']}>
            <label className={styles['label']} htmlFor="swapcost-size">
              TRADE SIZE
            </label>
            <span className={cx(styles['chip'], styles['chipInput'])}>YOUR NUMBER</span>
          </div>

          <output className={styles['sizeOut']} htmlFor="swapcost-size">
            <span className={styles['sizeValue']}>{tokens(size)}</span>
            <span className={styles['sizeUnit']}>{UNIT_LABEL}</span>
          </output>

          <input
            id="swapcost-size"
            type="range"
            className={styles['range']}
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={pos}
            /* The track is logarithmic, so the raw value is a position and
               means nothing to a listener. `aria-valuetext` carries the amount
               the position stands for, which is the only number a reader
               cares about. */
            aria-valuetext={`${tokens(size)} ${UNIT_LABEL}`}
            onChange={(e) => setPos(Number(e.target.value))}
          />

          <p className={styles['hint']}>
            Logarithmic, {tokens(10 ** SIZE_MIN_EXP)} to {tokens(10 ** SIZE_MAX_EXP)}
            {UNIT === null ? null : <> {UNIT}</>}. This is a number you chose, not a measurement.
            It is denominated in token units because {UNIT_LABEL}{' '}
            {UNIT_IS_TEST ? 'is a test token and ' : ''}has no price this page can read — a dollar
            headline would have to invent one.
          </p>
        </div>

        {/* ------------------------------------------------------------ TIER */}
        <div className={styles['field']}>
          <div className={styles['fieldHead']}>
            <span className={styles['label']} id="swapcost-tier-label">
              POOL TIER
            </span>
            <span className={cx(styles['chip'], styles['chipChain'])}>READ FROM CHAIN</span>
          </div>

          <div className={styles['tiers']} role="group" aria-labelledby="swapcost-tier-label">
            {/* Whatever the controller returned, in the order it returned it.
                No tier is named in this file. */}
            {s.tiers.map((t) => (
              <button
                key={t.lpFee}
                type="button"
                className={cx(styles['tier'], t.lpFee === active.lpFee && styles['tierOn'])}
                aria-pressed={t.lpFee === active.lpFee}
                onClick={() => setTier(t.lpFee)}
              >
                <span className={styles['tierPct']}>{pct(t.lpFee, 2)}</span>
                <span className={styles['tierPips']}>{t.lpFee.toLocaleString('en-US')} pips</span>
              </button>
            ))}
          </div>

          <p className={styles['hint']}>
            The protocol fee for each tier is <code>feeForLpFee(lpFee)</code> on the live
            controller — derived on chain, never recomputed here, so the split arithmetic exists in
            exactly one place.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------- BREAKDOWN */}
      <div className={styles['breakdown']}>
        <Cell
          name="LP fee"
          who="to liquidity providers"
          rate={pct(figures.lpPips, 2)}
          amount={tokens(figures.lpAmount)}
        />
        <Cell
          name="Protocol fee"
          who="to the Latch treasury"
          rate={pct(figures.protocolPips)}
          amount={tokens(figures.protocolAmount)}
        />
        <Cell
          name="All-in"
          who="what leaves the trade"
          rate={pct(figures.allIn)}
          amount={tokens(figures.total)}
          strong
        />
      </div>

      <p className={styles['compose']}>
        The two <strong>compose, they do not add</strong>: the protocol fee comes off the input
        first and the LP fee applies to what is left, so the all-in rate is{' '}
        <code>
          {figures.lpPips.toLocaleString('en-US')} + {figures.protocolPips.toLocaleString('en-US')} −{' '}
          {Math.floor((figures.lpPips * figures.protocolPips) / ONE).toLocaleString('en-US')} ={' '}
          {figures.allIn.toLocaleString('en-US')}
        </code>{' '}
        pips, not {(figures.lpPips + figures.protocolPips).toLocaleString('en-US')}.
      </p>

      {/* -------------------------------------------------------- WHERE IT GOES */}
      <div className={styles['where']}>
        <div className={styles['whereHead']}>
          <span className={styles['label']}>WHERE THE {tokens(figures.total)} GOES</span>
        </div>

        {/* Proportional, animated by a CSS width transition only — the segments
            are laid out and painted with JS paused, and the transition merely
            interpolates between two states that are each complete on their own. */}
        <div
          className={styles['bar']}
          role="img"
          aria-label={
            `Of the ${tokens(figures.total)} ${UNIT_LABEL} fee, ` +
            `${lpShare.toFixed(1)} percent goes to liquidity providers and ` +
            `${protocolShare.toFixed(1)} percent to the protocol.`
          }
        >
          <span className={cx(styles['seg'], styles['segLp'])} style={{ width: `${lpShare}%` }} />
          <span
            className={cx(styles['seg'], styles['segProtocol'])}
            style={{ width: `${protocolShare}%` }}
          />
        </div>

        {/* The bar's text equivalent, visible rather than hidden: the same three
            facts, readable by anyone who cannot judge a length. */}
        <ul className={styles['legend']}>
          <li>
            <span className={cx(styles['swatch'], styles['swatchLp'])} aria-hidden="true" />
            <span className={styles['legendName']}>Liquidity providers</span>
            <strong className={styles['legendPct']}>{lpShare.toFixed(1)}%</strong>
            <span className={styles['legendAmt']}>
              {tokens(figures.lpAmount)} {UNIT_LABEL}
            </span>
          </li>
          <li>
            <span className={cx(styles['swatch'], styles['swatchProtocol'])} aria-hidden="true" />
            <span className={styles['legendName']}>Protocol</span>
            <strong className={styles['legendPct']}>{protocolShare.toFixed(1)}%</strong>
            <span className={styles['legendAmt']}>
              {tokens(figures.protocolAmount)} {UNIT_LABEL}
            </span>
          </li>
        </ul>
      </div>

      {/* ------------------------------------------------------- THE COMPARISON */}
      <div className={styles['compare']}>
        <div className={styles['compareRow']}>
          <span className={styles['compareName']}>
            Latch · {(s.splitRatio / 10_000).toFixed(0)}% split
          </span>
          <span className={styles['compareRate']}>{pct(figures.allIn)}</span>
          <span className={styles['compareAmt']}>
            {tokens(figures.total)} {UNIT_LABEL}
          </span>
        </div>
        <div className={cx(styles['compareRow'], styles['compareRowAlt'])}>
          <span className={styles['compareName']}>PancakeSwap Infinity · 33% split</span>
          <span className={styles['compareRate']}>{pct(figures.pancakeAllIn)}</span>
          <span className={styles['compareAmt']}>
            {tokens(figures.pancakeTotal)} {UNIT_LABEL}
          </span>
        </div>

        {/* Direction is computed, not assumed. If governance ever raised the
            split above 33% this line would say so rather than quietly printing
            a negative saving as a saving. */}
        <p className={styles['delta']}>
          {figures.saving > 0 ? (
            <>
              On this trade a trader keeps{' '}
              <strong>
                {tokens(figures.saving)} {UNIT_LABEL}
              </strong>{' '}
              more at the same pool tier — the LP fee is identical, and the whole difference is the
              protocol slice.
            </>
          ) : figures.saving < 0 ? (
            <>
              On this trade Latch costs{' '}
              <strong>
                {tokens(-figures.saving)} {UNIT_LABEL}
              </strong>{' '}
              more at the same pool tier. The LP fee is identical; the difference is the protocol
              slice.
            </>
          ) : (
            <>At this tier the two splits round to the same protocol fee, so the cost is identical.</>
          )}
        </p>
      </div>

      {/* The polite region. Visually hidden because the same words are already
          on screen for anyone reading them. */}
      <div className={styles['sr']} aria-live="polite">
        {announced}
      </div>

      <p className={styles['foot']}>
        <strong>Rates are read; the size is yours.</strong> Every Latch rate on this panel comes
        from the fee controller deployed on {CHAIN.name} — the tier list and each tier&rsquo;s
        protocol fee from <code>feeForLpFee</code>, the split from{' '}
        <code>protocolFeeSplitRatio</code>. The trade size is a number you chose with the slider
        and is not a measurement of any pool, volume or balance. PancakeSwap&rsquo;s 33% is a
        constant in their published source (<code>ProtocolFeeController.sol:32</code>) applied with
        their own formula — a citation, not a measurement of their deployment. No amount here is
        converted to a currency: {UNIT_LABEL} {UNIT_IS_TEST ? 'is a test token and ' : ''}has no
        price this page could read.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Which tier to show before the reader picks one.
 *
 * The chain's reference pool, when the controller happens to list that tier —
 * it is the pool this repo's own scripts created and swapped through, so it is
 * the tier a reader is most likely to meet. Otherwise the middle of whatever
 * came back. Neither branch names a tier: a hardcoded default would be a
 * silent claim about which tier matters, surviving any change to the list.
 */
function preferredTier(tiers: readonly FeeTier[]): FeeTier | undefined {
  const reference = CHAIN.demoPool
  if (reference) {
    const match = tiers.find((t) => t.lpFee === reference.lpFee)
    if (match) return match
  }
  return tiers[Math.floor(tiers.length / 2)] ?? tiers[0]
}

interface Figures {
  lpPips: number
  protocolPips: number
  allIn: number
  lpAmount: number
  protocolAmount: number
  total: number
  pancakeAllIn: number
  pancakeTotal: number
  /** Positive when Latch is cheaper. Token units of the trade. */
  saving: number
}

/**
 * Everything the panel prints, from one size and one tier.
 *
 * PIPS ARE INTEGERS AND AMOUNTS ARE NOT, deliberately. The pip layer mirrors
 * Solidity so the Latch/PancakeSwap comparison is exact; the token layer
 * applies those pips to a whole-token figure the reader typed, which is a
 * proportion of their number rather than a settlement the chain performed.
 *
 * `lpAmount` is derived by SUBTRACTION rather than by applying the LP rate a
 * second time. On chain the LP fee is charged on `size - protocolAmount`, so
 * `total - protocolAmount` is that same quantity exactly — and it guarantees
 * the two parts add up to the total on screen, which a second rounding pass
 * would not.
 */
function compute(size: number, tier: FeeTier): Figures {
  const lpPips = tier.lpFee
  const protocolPips = tier.protocolFeePips
  const allIn = allInPips(lpPips, protocolPips)

  const total = (size * allIn) / ONE
  const protocolAmount = (size * protocolPips) / ONE

  const pancakeAllIn = allInPips(lpPips, pancakeFeeFor(lpPips))
  const pancakeTotal = (size * pancakeAllIn) / ONE

  return {
    lpPips,
    protocolPips,
    allIn,
    total,
    protocolAmount,
    lpAmount: total - protocolAmount,
    pancakeAllIn,
    pancakeTotal,
    saving: pancakeTotal - total,
  }
}

function Cell({
  name,
  who,
  rate,
  amount,
  strong = false,
}: {
  name: string
  who: string
  rate: string
  amount: string
  strong?: boolean
}) {
  return (
    <div className={cx(styles['cell'], strong && styles['cellStrong'])}>
      <span className={styles['cellName']}>{name}</span>
      <span className={styles['cellRate']}>{rate}</span>
      <span className={styles['cellAmount']}>
        {amount} {UNIT_LABEL}
      </span>
      <span className={styles['cellWho']}>{who}</span>
    </div>
  )
}
