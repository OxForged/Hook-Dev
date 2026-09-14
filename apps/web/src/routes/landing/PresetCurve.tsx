/* ============================================================================
   The launch presets, drawn from the hook's own decay function.

   WHAT THIS IS. `LaunchpadKit` sells four named launch shapes. Each one is a
   fee that starts high at the open and decays to a floor, and the difference
   between them is the only thing an operator has to choose. A table of eight
   numbers does not communicate that; a curve does.

   WHY THE CURVE IS COMPUTED, NOT DRAWN. Every point on this chart is
   `LaunchGuardHook._decayedFee` re-implemented literally, in integer
   arithmetic, from `packages/hooks/src/launch/LaunchGuardHook.sol:444`:

       if (elapsed >= decaySeconds) return finalFee;
       spread   = initialFee - finalFee;
       discount = (spread * elapsed) / decaySeconds;  // Solidity floor division
       return initialFee - discount;

   (The block-numbered hook still deployed on Robinhood runs the identical
   arithmetic with `decayBlocks` in place of `decaySeconds`.)

   It would have been faster to interpolate two endpoints with a bezier and
   call it a fee curve. That is exactly the thing CLAUDE.md's "No invented data
   in the UI" rule forbids: a smoothed shape is a claim about what a contract
   charges, made by a chart component rather than by the contract. So the
   discount is floored the way Solidity floors it, the fee rounds UP toward the
   LPs, and the boundary at `elapsed == window` is exact rather than
   asymptotic. If the drawn curve ever disagrees with a swap, this file is
   wrong and the Solidity is right.

   THE CURVE IS A STAIRCASE, NOT A LINE. The fee is a function of the hook's
   clock, so it is constant for the whole of one tick and steps at the
   boundary. A tick is one second of `block.timestamp` on a timestamp kit, and
   one contract block on the block-numbered kit. Where a window is short enough
   that every tick fits on the chart, the steps are drawn as steps; otherwise
   real ticks are sampled and joined — see `buildPath`.

   WHICH KIT, AND WHY IT DECIDES WHAT THIS CARD SAYS. `LatchDeployment.
   durationClocks.launchpadKit` in the SDK address book names the clock of the
   kit this chain actually has, and it moves in the same edit as the kit's
   address. It is never inferred here.

     timestamp       (Option B, 2026-09-13) the kit writes a preset's seconds
                     to the hook unconverted and the hook compares them with
                     `block.timestamp`. FairLaunch is five minutes, and the card
                     says so.
     contract-block  the kit still deployed on Robinhood converts seconds to
                     blocks at its declared 0.1 s, but inside the EVM
                     `block.number` is Ethereum's ~12 s block. Its "5 minute"
                     window is 3,000 contract blocks, about TEN HOURS. A card
                     that showed "5 minutes" there would be telling a launcher
                     something false about a deployed contract, so it shows both.

   WHY `doesNotProtectAgainst` IS NOT COLLAPSIBLE. It is the sentence that
   decides whether a preset is the right one, and it is the sentence a preset's
   NAME actively argues against — "AntiSniperAggressive" does not sound like
   something a sybil walks through. A disclosure widget is a way of shipping a
   caveat while ensuring nobody reads it. It renders at full weight, always,
   beside the numbers it qualifies.
   ========================================================================== */

/* `PointerEvent` is imported from React explicitly rather than reached for via
   a `React.` namespace: `verbatimModuleSyntax` is on, so there is no default
   React import to hang a namespace off, and the DOM's global `PointerEvent` is
   a different type that would silently not match the handler. */
import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  PRESET_NAMES,
  PRESET_PARAMS,
  formatPips,
  humanDuration,
  secondsToBlocks,
  type PresetName,
  type PresetParams,
} from '@latchprotocol/sdk'
import { DEPLOYMENTS, ROBINHOOD_CHAIN_ID, explorerAddress } from '../../lib/chain'
import { useFirstView, useMeasuredWidth } from './chartMotion'
import page from './landing.module.css'
import styles from './presetcurve.module.css'
import { cx } from './ui'

/* ----------------------------------------------------------------------------
   THE KIT'S CLOCK, from the deployment record.

   On a TIMESTAMP kit nothing below the next line matters: a tick is a second
   and the label is the behaviour.

   On the BLOCK-NUMBERED kit there are two block times, and they disagree by
   120x. Neither is read from chain at render time — this component makes no
   RPC call — so both are stated with their sources named.

   DECLARED is the divisor the deployed KIT uses to turn a preset's seconds
   into blocks. It is a constructor argument, `blockTimeCentis`, and reads 10
   (0.1 s) on the live LaunchpadKit 0x2a4C…bcA7 and LaunchGuardHook 0x8b4F…575c
   (read 2026-09-13). Every block count on this card is
   `secondsToBlocks(windowSeconds, 10)`, the arithmetic the kit performs.

   REAL is how often those blocks actually pass for the hook:
   `contractBlockTimeCentis` in the SDK address book, 1200 (12 s). Robinhood is
   Arbitrum Nitro, where `block.number` inside the EVM is Ethereum's block
   number. Proven against mined state on 2026-09-13 (an ERC20Votes checkpoint
   written in L2 block 62,356,430 is keyed at 25,971,883, that block's
   `l1BlockNumber`) and consistent with Arbitrum's documentation. The 0.102 s
   this card used to call "measured" is the L2 block time — the LOG clock — and
   says nothing about how fast `LaunchGuardHook`'s windows elapse.

   So every preset window on that kit runs 120x its label until the address
   book points at the timestamp kit. Shown, not smoothed: a launcher timing an
   announcement to the end of the tax is entitled to the truth.

   `LaunchpadKit` is deployed on Robinhood and nowhere else (`launchpadKit`
   reads null on Sepolia in the SDK address book), so this card describes that
   chain as a fact rather than a default.
   ---------------------------------------------------------------------------- */

/** The chain this card describes, named from the SDK address book. */
const CHAIN = DEPLOYMENTS[ROBINHOOD_CHAIN_ID]

/**
 * The clock of the kit this chain's address book points at. `null` would mean no
 * kit is deployed here; the card then describes the timestamp source presets and
 * says that nothing is deployed.
 */
const KIT_CLOCK = CHAIN.durationClocks.launchpadKit
const BLOCK_KIT = KIT_CLOCK === 'contract-block'

/**
 * `blockTimeCentis` as the block-numbered kit 0x2a4C…bcA7 and hook 0x8b4F…575c were
 * constructed with it (read 2026-09-13). Used ONLY while `KIT_CLOCK` is
 * `contract-block`; a timestamp kit has no such argument.
 */
const BLOCK_TIME_CENTIS_DECLARED = 10

/** Real cadence of the hook's `block.number` on this chain, from the SDK address book. */
const CONTRACT_BLOCK_TIME_CENTIS = CHAIN.contractBlockTimeCentis

/** How much longer every window really runs than its label. 120 on the block kit, 1 on a timestamp kit. */
const STRETCH = BLOCK_KIT ? CONTRACT_BLOCK_TIME_CENTIS / BLOCK_TIME_CENTIS_DECLARED : 1

/** One chart tick: a second of `block.timestamp`, or one contract block. */
const TICK = BLOCK_KIT ? 'block' : 'second'

/* ----------------------------------------------------------------------------
   Which presets are selectable.

   Order comes from `PRESET_NAMES`, which is the Solidity enum's declaration
   order and therefore the wire encoding.

   `Custom` is filtered out and NOT replaced with an entry of its own. It has no
   parameters — `LaunchPresets.params(Preset.Custom)` reverts
   `NoParametersForCustomPreset`, and `PRESET_PARAMS` has no key for it — so
   there is no curve to draw. Inventing one would mean inventing the numbers,
   and Custom is precisely the value whose numbers come from the caller. It is
   also the zero value, which is the trap `presets.ts` exists to close; a
   selector offering it as a shape would undo that work.
   ---------------------------------------------------------------------------- */

type LivePresetName = Exclude<PresetName, 'Custom'>

const SELECTABLE: readonly LivePresetName[] = PRESET_NAMES.filter(
  (n): n is LivePresetName => n !== 'Custom',
)

/** Presentation labels. Nothing numeric — every figure comes from the table. */
const LABELS: Readonly<Record<LivePresetName, string>> = {
  FairLaunch: 'Fair launch',
  AntiSniperAggressive: 'Anti-sniper',
  Stealth: 'Stealth',
  NoTax: 'No tax',
}

/* ----------------------------------------------------------------------------
   THE DECAY, transcribed.
   ---------------------------------------------------------------------------- */

/**
 * `LaunchGuardHook._decayedFee`, verbatim. `elapsed` and `window` are ticks:
 * seconds on the timestamp hook, contract blocks on the block-numbered one.
 *
 * Floor division is the whole point: Solidity's `/` truncates, so the
 * SUBTRACTED discount is floored and the resulting fee rounds UP — toward the
 * LPs and away from the sniper. `Math.floor` reproduces that. Using plain
 * division here would draw a curve that is systematically below the one the
 * pool charges, by up to one pip, at every block.
 *
 * Safe in doubles: the largest product this evaluates is
 * `spread(500_000) * elapsed(< 18_000)` = 9e9, well inside 2^53, so no bigint
 * is needed and none is used. That bound is a property of the presets, not of
 * the hook — a `Custom` launch with `MAX_DECAY_BLOCKS` blocks would need one.
 */
function decayedFeePips(initialFee: number, finalFee: number, elapsed: number, window: number): number {
  if (elapsed >= window) return finalFee
  const spread = initialFee - finalFee
  const discount = Math.floor((spread * elapsed) / window)
  return initialFee - discount
}

/**
 * `LaunchGuardHook.feeAt` for a configured launch.
 *
 * The `enabled` branch comes FIRST in the contract and is unconditional: a
 * disabled launch returns `finalFeeBips` at every tick, before any window
 * arithmetic happens. That is why `NoTax` draws flat rather than decaying over
 * its window — the window exists only because the hook validates every config
 * against its bounds, and it is never consulted.
 */
function feeAtTick(p: PresetParams, elapsed: number, window: number): number {
  if (!p.enabled) return p.finalFeeBips
  return decayedFeePips(p.initialFeeBips, p.finalFeeBips, elapsed, window)
}

/* ----------------------------------------------------------------------------
   Geometry — in REAL PIXELS at the measured width (see useMeasuredWidth).

   The card used to scale a fixed 760-wide viewBox, which put every axis tick
   at ~5px on a phone. Drawing at the container's width keeps ticks at
   `--b-axis`; below MIN_W the chart scrolls inside its own box.

   MIN_W is 280, not 520 (2026-09-13, mobile pass): a 360px phone gives the
   plot ~286px, and at 520 the right third of the curve — the window end and
   the floor plateau — sat off-screen behind a sideways scroll. At phone width
   presetcurve.module.css re-anchors the window label and clips the long
   axis sentence, whose facts the readout and the facts grid already state.
   ---------------------------------------------------------------------------- */

const H = 300
const PL = 62
const PR = 20
const PT = 24
const PB = 46
const IH = H - PT - PB
const MIN_W = 280

/**
 * Ceiling on plotted points. Above this the window has more blocks than the
 * chart has usable columns, so drawing every one is wasted work rather than
 * extra fidelity.
 */
const MAX_SAMPLES = 260

/**
 * A static id, deliberately not `useId()`: React's generated ids contain
 * characters invalid in an XML name, and a paint server is referenced by
 * fragment. One instance of this card exists on the page.
 */
const FILL_ID = 'latch-preset-curve-fill'

interface Frame {
  /** Plot-area width in px. */
  iw: number
  xMax: number
  yMax: number
}

interface Plot {
  line: string
  area: string
  /** True when every tick in the window is plotted, so the steps are real. */
  steppedPerTick: boolean
}

const xFor = (f: Frame, tick: number): number => PL + (tick / f.xMax) * f.iw
const yFor = (f: Frame, pips: number): number => PT + IH - (pips / f.yMax) * IH

/**
 * Build the path for one preset.
 *
 * TWO RENDERINGS, AND THE CHOICE IS ABOUT HONESTY RATHER THAN LOOKS. When the
 * whole window fits inside `MAX_SAMPLES`, every block is evaluated and drawn
 * as literal steps — the fee does not move within a block. When it does not
 * fit, real block numbers are sampled and joined with straight segments; a
 * step spanning sixty blocks would assert a plateau the contract does not
 * have. The vertices are always real `_decayedFee` evaluations.
 *
 * At the declared 0.10s block time no preset takes the step branch (Stealth's
 * two minutes is 1,200 blocks). On a 12-second chain FairLaunch's five minutes
 * would be twenty-five blocks — a visibly coarse staircase.
 */
function buildPath(p: PresetParams, window: number, f: Frame): Plot {
  const baseline = PT + IH
  const parts: string[] = []
  const close = (line: string): string =>
    `${line} L ${xFor(f, f.xMax)} ${baseline} L ${xFor(f, 0)} ${baseline} Z`

  if (!p.enabled) {
    const y = yFor(f, p.finalFeeBips)
    const line = `M ${xFor(f, 0)} ${y} L ${xFor(f, f.xMax)} ${y}`
    return { line, area: close(line), steppedPerTick: false }
  }

  const steppedPerTick = window + 1 <= MAX_SAMPLES

  if (steppedPerTick) {
    parts.push(`M ${xFor(f, 0)} ${yFor(f, feeAtTick(p, 0, window))}`)
    for (let t = 0; t < window; t++) {
      parts.push(`H ${xFor(f, t + 1)}`)
      parts.push(`V ${yFor(f, feeAtTick(p, t + 1, window))}`)
    }
  } else {
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const t = Math.round((i / (MAX_SAMPLES - 1)) * window)
      parts.push(`${i === 0 ? 'M' : 'L'} ${xFor(f, t)} ${yFor(f, feeAtTick(p, t, window))}`)
    }
  }

  /* At and after the window end the fee is exactly `finalFeeBips`, forever. */
  parts.push(`L ${xFor(f, f.xMax)} ${yFor(f, p.finalFeeBips)}`)

  const line = parts.join(' ')
  return { line, area: close(line), steppedPerTick }
}

/** Seconds the label promises for `ticks`: the seconds themselves, or blocks at the kit's DECLARED time. */
const declaredSeconds = (ticks: number): number => (BLOCK_KIT ? (ticks * BLOCK_TIME_CENTIS_DECLARED) / 100 : ticks)

/** Seconds a wall clock reports for `ticks`: exact on a timestamp kit, the REAL block cadence on a block kit. */
const realSeconds = (ticks: number): number => (BLOCK_KIT ? (ticks * CONTRACT_BLOCK_TIME_CENTIS) / 100 : ticks)

const int = (n: number): string => Math.round(n).toLocaleString('en-US')

/* ----------------------------------------------------------------------------
   The component.
   ---------------------------------------------------------------------------- */

/**
 * There is no loading or error state here, and that is not an omission. Every
 * figure comes from `PRESET_PARAMS` — a compile-time mirror of
 * `LaunchPresets.sol`, held to it by `packages/sdk/test/launchpadPresets.test.ts`
 * — and from the hook's decay function transcribed above. Nothing is fetched.
 *
 * INTERACTION. The cursor is persistent: drag or click anywhere on the plot,
 * or focus the chart and use the arrow keys (Shift for 10x, Home/End for the
 * ends). It is exposed as a `slider`, so assistive tech hears the fee at the
 * cursor as the value text.
 *
 * MOTION. The curve draws itself once, on first view; choosing another preset
 * draws the new curve. Under `prefers-reduced-motion` both render complete.
 */
export function PresetCurve() {
  const [selected, setSelected] = useState<LivePresetName>('FairLaunch')
  /** `null` = not yet moved; the cursor then rests mid-window. */
  const [cursor, setCursor] = useState<number | null>(null)
  /** Set once the reader picks a preset, so a redraw plays only on a change. */
  const [changed, setChanged] = useState(false)
  const [dragging, setDragging] = useState(false)

  const { ref: plotRef, hidden: drawHidden } = useFirstView<HTMLDivElement>()
  const { ref: scrollerRef, width: measuredWidth } = useMeasuredWidth<HTMLDivElement>(760)

  const params = PRESET_PARAMS[selected]

  /* The window in ticks. A timestamp kit writes the preset's seconds as-is; the
     block kit converts with its own arithmetic, from the SDK, at its declared time. */
  const window = BLOCK_KIT
    ? Number(secondsToBlocks(params.windowSeconds, BLOCK_TIME_CENTIS_DECLARED))
    : params.windowSeconds

  const W = Math.max(measuredWidth, MIN_W)
  const frame: Frame = {
    iw: W - PL - PR,
    /* ~18% past the window so the floor plateau reads as a plateau. */
    xMax: params.enabled ? Math.ceil(window * 1.18) : window,
    yMax: params.initialFeeBips * 1.12,
  }

  const plot = buildPath(params, window, frame)
  const scrubbable = params.enabled

  const tick = scrubbable
    ? Math.min(Math.max(cursor ?? Math.round(window / 2), 0), frame.xMax)
    : 0
  const fee = feeAtTick(params, tick, window)

  function tickAtClientX(e: PointerEvent<HTMLDivElement>): number | null {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width === 0) return null
    const x = e.clientX - r.left
    return Math.min(Math.max(Math.round(((x - PL) / frame.iw) * frame.xMax), 0), frame.xMax)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (!scrubbable) return
    const b = tickAtClientX(e)
    if (b === null) return
    /* Capture, so a drag that leaves the plot keeps steering the cursor. */
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setCursor(b)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (!scrubbable) return
    /* Hover previews on a mouse; on touch only a drag moves it, so a finger
       scrolling past the chart does not yank the cursor. */
    if (!dragging && e.pointerType !== 'mouse') return
    const b = tickAtClientX(e)
    if (b !== null) setCursor(b)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!scrubbable) return
    const unit = Math.max(1, Math.round(frame.xMax / 100))
    const step = e.shiftKey ? unit * 10 : unit
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = tick + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = tick - step
    else if (e.key === 'PageUp') next = tick + unit * 10
    else if (e.key === 'PageDown') next = tick - unit * 10
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = frame.xMax
    if (next === null) return
    e.preventDefault()
    setCursor(Math.min(Math.max(next, 0), frame.xMax))
  }

  const windowEndX = xFor(frame, window)
  const floorY = yFor(frame, params.finalFeeBips)
  const openY = yFor(frame, params.initialFeeBips)
  const cursorX = xFor(frame, tick)
  const cursorY = yFor(frame, fee)
  /* The value label flips to the left of the cursor in the right third, so it
     never runs off the plot. */
  const labelLeft = cursorX > PL + frame.iw * 0.66

  const valueText = BLOCK_KIT
    ? `${formatPips(fee)} at block +${int(tick)}, about ${humanDuration(realSeconds(tick))} from the open on ${CHAIN.name}` +
      (tick >= window ? ', past the window, at the floor' : '')
    : `${formatPips(fee)} at ${humanDuration(tick)} from the open` + (tick >= window ? ', past the window, at the floor' : '')

  const summary = !params.enabled
    ? `${LABELS[selected]} preset: the gate is off, so the LP fee is a flat ${formatPips(params.finalFeeBips)} throughout.`
    : BLOCK_KIT
      ? `${LABELS[selected]} preset: the LP fee decays from ${formatPips(params.initialFeeBips)} at the open ` +
        `to a floor of ${formatPips(params.finalFeeBips)} over ${int(window)} blocks. The preset is labelled ` +
        `${humanDuration(params.windowSeconds)}, but on the deployed ${CHAIN.name} kit those blocks really take ` +
        `about ${humanDuration(realSeconds(window))}.`
      : `${LABELS[selected]} preset: the LP fee decays from ${formatPips(params.initialFeeBips)} at the open ` +
        `to a floor of ${formatPips(params.finalFeeBips)} over ${humanDuration(params.windowSeconds)} of block.timestamp.`

  const lineClass = cx(
    styles['line'],
    drawHidden && styles['lineHidden'],
    !drawHidden && changed && styles['lineRedraw'],
  )

  return (
    <section className={page['section']} aria-labelledby="preset-curve-title">
      <div className={styles['card']}>
        <header className={styles['head']}>
          <div className={styles['headText']}>
            <h2 className={styles['title']} id="preset-curve-title">
              What the pool charges, {TICK} by {TICK}
            </h2>
            <p className={styles['sub']}>
              Four launch presets, each a decaying LP fee applied by{' '}
              <code>LaunchGuardHook</code>. Drag along the curve, or focus it and use the arrow
              keys.
            </p>
          </div>

          <div className={styles['selector']} role="group" aria-label="Launch preset">
            {SELECTABLE.map((name) => (
              <button
                key={name}
                type="button"
                className={cx(styles['tab'], name === selected && styles['tabOn'])}
                aria-pressed={name === selected}
                onClick={() => {
                  if (name === selected) return
                  setSelected(name)
                  setCursor(null)
                  setChanged(true)
                }}
              >
                {LABELS[name]}
              </button>
            ))}
          </div>
        </header>

        <div className={styles['scroller']} ref={scrollerRef}>
          <div
            ref={plotRef}
            className={cx(styles['plot'], scrubbable && styles['plotScrub'])}
            style={{ width: W, height: H }}
            /* A slider when there is something to scrub; a labelled image of
               a flat line when there is not. */
            role={scrubbable ? 'slider' : 'img'}
            tabIndex={scrubbable ? 0 : undefined}
            aria-label={scrubbable ? `Fee cursor. ${summary}` : summary}
            aria-valuemin={scrubbable ? 0 : undefined}
            aria-valuemax={scrubbable ? frame.xMax : undefined}
            aria-valuenow={scrubbable ? tick : undefined}
            aria-valuetext={scrubbable ? valueText : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onKeyDown={onKeyDown}
          >
            <svg
              /* Keyed on the preset so a changed curve mounts fresh and its
                 redraw keyframe runs from the start. */
              key={selected}
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className={styles['svg']}
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={FILL_ID} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" className={styles['fillTop']} />
                  <stop offset="100%" className={styles['fillBottom']} />
                </linearGradient>
              </defs>

              {/* Y grid at quarters of the OPENING fee. */}
              {[0, 1, 2, 3, 4].map((i) => {
                const pips = (params.initialFeeBips / 4) * i
                const y = yFor(frame, pips)
                return (
                  <g key={i}>
                    <line
                      className={i === 0 ? styles['baseline'] : styles['grid']}
                      x1={PL}
                      x2={W - PR}
                      y1={y}
                      y2={y}
                    />
                    <text className={styles['axis']} x={PL - 10} y={y + 3.5} textAnchor="end">
                      {formatPips(pips)}
                    </text>
                  </g>
                )
              })}

              <path
                className={cx(styles['area'], drawHidden && styles['areaHidden'])}
                d={plot.area}
                fill={`url(#${FILL_ID})`}
              />
              {/* `pathLength="1"` normalises the dash for the draw-in. */}
              <path className={lineClass} d={plot.line} pathLength={1} />

              <line className={styles['floorLine']} x1={PL} x2={W - PR} y1={floorY} y2={floorY} />
              <text className={styles['floorLabel']} x={W - PR} y={floorY - 8} textAnchor="end">
                floor {formatPips(params.finalFeeBips)}
              </text>

              {params.enabled ? (
                <g>
                  <circle className={styles['openDot']} cx={xFor(frame, 0)} cy={openY} r={4} />
                  <text className={styles['openLabel']} x={xFor(frame, 0) + 10} y={openY + 4}>
                    opens at {formatPips(params.initialFeeBips)}
                  </text>
                  <line
                    className={styles['windowLine']}
                    x1={windowEndX}
                    x2={windowEndX}
                    y1={PT}
                    y2={PT + IH}
                  />
                  <text className={styles['windowLabel']} x={windowEndX + 8} y={PT + 12}>
                    window ends · {BLOCK_KIT ? `${int(window)} blocks` : humanDuration(window)}
                  </text>
                </g>
              ) : null}

              {/* X axis: REAL time on the deployed contracts, at the hook's
                  actual block cadence. A disabled preset's x position carries
                  no information, so it gets a sentence. */}
              {params.enabled ? (
                <>
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                    const b = Math.round(t * frame.xMax)
                    return (
                      <text
                        key={t}
                        className={styles['axis']}
                        x={xFor(frame, b)}
                        y={H - PB + 20}
                        textAnchor="middle"
                      >
                        {humanDuration(realSeconds(b))}
                      </text>
                    )
                  })}
                  <text className={styles['axisNote']} x={PL + frame.iw / 2} y={H - PB + 38} textAnchor="middle">
                    {BLOCK_KIT
                      ? `real time from the open on ${CHAIN.name} · one hook block ≈ ${CONTRACT_BLOCK_TIME_CENTIS / 100}s`
                      : 'time from the open · block.timestamp seconds'}
                  </text>
                </>
              ) : (
                <text className={styles['axisNote']} x={PL + frame.iw / 2} y={H - PB + 20} textAnchor="middle">
                  the fee does not vary with time — the gate is off
                </text>
              )}

              {scrubbable ? (
                <g className={styles['cursor']}>
                  <line className={styles['crosshair']} x1={cursorX} x2={cursorX} y1={PT} y2={PT + IH} />
                  <circle className={styles['crossDot']} cx={cursorX} cy={cursorY} r={5.5} />
                  <rect
                    className={styles['handle']}
                    x={cursorX - 7}
                    y={PT + IH - 7}
                    width={14}
                    height={14}
                    rx={3}
                  />
                  <text
                    className={styles['cursorLabel']}
                    x={labelLeft ? cursorX - 12 : cursorX + 12}
                    y={Math.max(cursorY - 12, PT + 10)}
                    textAnchor={labelLeft ? 'end' : 'start'}
                  >
                    {formatPips(fee)}
                  </text>
                </g>
              ) : null}
            </svg>
          </div>
        </div>

        {/* The readout is a fixed row, not a floating tooltip: at 400px a
            tooltip has nowhere to go. Deliberately NOT a live region — it
            changes on every pointer move; the slider's value text is what
            assistive tech hears. */}
        <div className={styles['readout']} aria-hidden="true">
          {scrubbable ? (
            <>
              <span className={styles['readFee']}>{formatPips(fee)}</span>
              <span className={styles['readMeta']}>
                {BLOCK_KIT
                  ? `block +${int(tick)} · ~${humanDuration(realSeconds(tick))} real · labelled as ${declaredSeconds(tick).toFixed(1)}s`
                  : `+${humanDuration(tick)} from the open`}
                {tick >= window ? ' · past the window, at the floor' : ''}
              </span>
            </>
          ) : (
            <span className={styles['readMeta']}>
              Flat {formatPips(params.finalFeeBips)} throughout — nothing to scrub.
            </span>
          )}
        </div>

        <dl className={styles['facts']}>
          <div className={styles['fact']}>
            <dt>Opens at</dt>
            <dd>{formatPips(params.initialFeeBips)}</dd>
          </div>
          <div className={styles['fact']}>
            <dt>Decays to</dt>
            <dd>{formatPips(params.finalFeeBips)}</dd>
          </div>
          <div className={styles['fact']}>
            <dt>Window, really</dt>
            <dd>
              {!params.enabled
                ? 'none'
                : BLOCK_KIT
                  ? `~${humanDuration(realSeconds(window))}`
                  : humanDuration(params.windowSeconds)}
              <span className={styles['factSub']}>
                {!params.enabled
                  ? 'the gate is off'
                  : BLOCK_KIT
                    ? `labelled ${humanDuration(params.windowSeconds)} · ${STRETCH}x longer on the live kit`
                    : 'exactly as labelled · block.timestamp'}
              </span>
            </dd>
          </div>
          {BLOCK_KIT ? (
            <div className={styles['fact']}>
              <dt>In blocks on {CHAIN.name}</dt>
              <dd>
                {int(window)}
                <span className={styles['factSub']}>
                  {params.enabled
                    ? `converted at the kit's declared ${BLOCK_TIME_CENTIS_DECLARED / 100}s; elapsing every ~${CONTRACT_BLOCK_TIME_CENTIS / 100}s`
                    : 'exists only because zero is rejected'}
                </span>
              </dd>
            </div>
          ) : (
            <div className={styles['fact']}>
              <dt>Clock</dt>
              <dd>
                seconds
                <span className={styles['factSub']}>
                  {KIT_CLOCK === null
                    ? `no kit is deployed on ${CHAIN.name}; these are the source presets`
                    : 'the kit writes these seconds to the hook unconverted'}
                </span>
              </dd>
            </div>
          )}
        </dl>

        {/* Not behind a disclosure, for the same reason as the limit below: it
            is true of the deployed contracts today and it changes the decision. */}
        {BLOCK_KIT && STRETCH !== 1 ? (
          <p className={styles['requireOn']}>
            <strong>
              The deployed {CHAIN.name} kit runs every preset about {STRETCH}x longer than its label.
            </strong>{' '}
            <code>LaunchpadKit</code> converts seconds to blocks at {BLOCK_TIME_CENTIS_DECLARED / 100}s per
            block, but on this chain <code>LaunchGuardHook</code>&rsquo;s <code>block.number</code> is
            Ethereum&rsquo;s block number, which advances about every {CONTRACT_BLOCK_TIME_CENTIS / 100}s. A
            {' '}
            {humanDuration(params.windowSeconds)} preset therefore taxes for about{' '}
            {humanDuration(realSeconds(window))}, and a start delay waits {STRETCH}x as long as requested.
            Durations in the preset descriptions, including the sentence below, are the labels, not the live
            behaviour. This holds until the address book points at the timestamp kit, whose windows are
            seconds of <code>block.timestamp</code> and mean what they say.
          </p>
        ) : null}

        {/* Not behind a disclosure: it is the sentence that argues with the
            preset's own name, and it renders at full weight, always. */}
        <p className={styles['limit']}>
          <span className={styles['limitTag']}>Does not protect against</span>{' '}
          {params.doesNotProtectAgainst}
        </p>

        {params.requiresMaxBuyPerTx ? (
          <p className={styles['requireOn']}>
            <strong>Requires a per-transaction cap.</strong> A launch without{' '}
            <code>maxBuyPerTx</code> reverts <code>MaxBuyRequiredByPreset</code>. The cap bounds one
            transaction; splitting across transactions or wallets defeats it.
          </p>
        ) : null}

        <p className={styles['provenance']}>
          <code>PRESET_PARAMS</code> (MIT SDK, parity-tested against <code>LaunchPresets.sol</code>)
          through <code>LaunchGuardHook._decayedFee</code> with Solidity&rsquo;s floor division —{' '}
          {!params.enabled
            ? 'with enabled = false the hook returns finalFeeBips throughout'
            : plot.steppedPerTick
              ? `every ${TICK} plotted`
              : `real ${TICK}s sampled and joined`}
          .{' '}
          {BLOCK_KIT ? (
            <>
              Kit clock from the SDK address book: <code>contract-block</code>. Blocks at the deployed{' '}
              <code>blockTimeCentis = {BLOCK_TIME_CENTIS_DECLARED}</code>; wall clock at the hook&rsquo;s real{' '}
              <code>block.number</code> cadence of ~{CONTRACT_BLOCK_TIME_CENTIS / 100}s (SDK{' '}
              <code>contractBlockTimeCentis</code>, measured 2026-09-13).
            </>
          ) : (
            <>
              Kit clock from the SDK address book: <code>{KIT_CLOCK ?? 'none deployed'}</code>. Windows are
              seconds of <code>block.timestamp</code>, written to the hook unconverted.
            </>
          )}{' '}
          Nothing is read from chain — <code>previewSchedule(params)</code> on the kit is the runtime
          authority.
          {CHAIN.launchGuardHook !== null ? (
            <>
              {' '}
              Hook:{' '}
              <a
                href={explorerAddress(ROBINHOOD_CHAIN_ID, CHAIN.launchGuardHook)}
                target="_blank"
                rel="noreferrer"
              >
                {CHAIN.launchGuardHook}
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
    </section>
  )
}
