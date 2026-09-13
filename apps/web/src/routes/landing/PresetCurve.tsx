/* ============================================================================
   The launch presets, drawn from the hook's own decay function.

   WHAT THIS IS. `LaunchpadKit` sells four named launch shapes. Each one is a
   fee that starts high at the open and decays to a floor, and the difference
   between them is the only thing an operator has to choose. A table of eight
   numbers does not communicate that; a curve does.

   WHY THE CURVE IS COMPUTED, NOT DRAWN. Every point on this chart is
   `LaunchGuardHook._decayedFee` re-implemented literally, in integer
   arithmetic, from `packages/hooks/src/launch/LaunchGuardHook.sol:444`:

       if (elapsed >= decayBlocks) return finalFee;
       spread   = initialFee - finalFee;
       discount = (spread * elapsed) / decayBlocks;   // Solidity floor division
       return initialFee - discount;

   It would have been faster to interpolate two endpoints with a bezier and
   call it a fee curve. That is exactly the thing CLAUDE.md's "No invented data
   in the UI" rule forbids: a smoothed shape is a claim about what a contract
   charges, made by a chart component rather than by the contract. So the
   discount is floored the way Solidity floors it, the fee rounds UP toward the
   LPs, and the boundary at `elapsed == decayBlocks` is exact rather than
   asymptotic. If the drawn curve ever disagrees with a swap, this file is
   wrong and the Solidity is right.

   THE CURVE IS A STAIRCASE, NOT A LINE. The fee is a function of the BLOCK
   NUMBER, so it is constant for the whole of a block and steps at the
   boundary. Where a preset's window is short enough that every block fits on
   the chart, the steps are drawn as steps. Where it is not, the plot samples
   real block numbers and joins them — see `buildPath`, which says which of the
   two it did and why the distinction matters.

   WHY BLOCKS ARE SHOWN BESIDE THE SECONDS. `PRESET_PARAMS.windowSeconds` is
   wall clock, but nothing on chain stores wall clock: the kit converts to a
   block count at deploy time and `LaunchGuardHook` compares block numbers
   forever after. CLAUDE.md records what happens when that conversion is left
   implicit — this codebase was written assuming 12-second blocks, and every
   duration expressed in blocks is 118x short on Robinhood Chain. A card that
   showed "5 minutes" and hid "3,000 blocks" would be reproducing the bug that
   made `MAX_DECAY_BLOCKS` a constructor argument.

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
import { useState, type PointerEvent } from 'react'
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
import page from './landing.module.css'
import styles from './presetcurve.module.css'

/* ----------------------------------------------------------------------------
   THE TWO BLOCK TIMES, AND WHY THERE ARE TWO.

   Neither is read from chain — this component makes no RPC call — so both are
   stated constants with their sources named, which is the standard CLAUDE.md
   sets for a number that cannot be measured at render time.

   DECLARED is the divisor the deployed contracts actually use. It is a
   constructor argument, `blockTimeCentis`, fixed at deployment:
     · packages/launchpad/script/DeployLaunchGuardHookMainnet.s.sol:68
         LAUNCH_BLOCK_TIME_CENTIS=10
     · packages/sdk/src/launchpad/presets.ts:180
         "Robinhood Chain's kit is configured at 10 (0.10s)"
   Every block count on this card is `secondsToBlocks(windowSeconds, 10)`,
   which is the arithmetic the kit performs, not an approximation of it.

   MEASURED is the chain's real block time, 0.102 s over 500,000 blocks
   (LaunchGuardHook.sol:161, restated in CLAUDE.md). The hook's constructor doc
   is explicit that the declared value must be rounded DOWN — "Robinhood
   measures 10.2 - declare 10, never 11" - because a smaller declared block
   time makes the deploy-time safety checks demand MORE blocks for the same
   window, which errs safe.

   The gap between them is not noise, it is a systematic 2% under-count of wall
   clock: a window declared as 300 s is 3,000 blocks, and 3,000 blocks take
   ~306 s to actually pass. Shown rather than smoothed away, because a launch
   operator timing an announcement to the end of the window is entitled to the
   difference.

   Both are Robinhood Chain's. `LaunchpadKit` is deployed there and nowhere
   else (`launchpadKit` reads null on Sepolia in the SDK address book), so
   labelling the block column with that chain is a fact rather than a default.
   ---------------------------------------------------------------------------- */

/** `blockTimeCentis` as the deployed kit and hook were constructed with it. */
const BLOCK_TIME_CENTIS_DECLARED = 10

/** Measured block time, in hundredths of a second. Annotation only. */
const BLOCK_TIME_CENTIS_MEASURED = 10.2

/** The chain the two constants above describe, named from the SDK address book. */
const CHAIN = DEPLOYMENTS[ROBINHOOD_CHAIN_ID]

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
 * `LaunchGuardHook._decayedFee`, verbatim (LaunchGuardHook.sol:444).
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
function decayedFeePips(
  initialFee: number,
  finalFee: number,
  elapsedBlocks: number,
  decayBlocks: number,
): number {
  if (elapsedBlocks >= decayBlocks) return finalFee
  const spread = initialFee - finalFee
  const discount = Math.floor((spread * elapsedBlocks) / decayBlocks)
  return initialFee - discount
}

/**
 * `LaunchGuardHook.feeAt` for a configured launch (LaunchGuardHook.sol:405).
 *
 * The `enabled` branch comes FIRST in the contract and is unconditional: a
 * disabled launch returns `finalFeeBips` at every block, before any window
 * arithmetic happens. That is why `NoTax` draws flat rather than decaying over
 * its one-second window — the window exists only because the hook rejects
 * `decayBlocks == 0`, and it is never consulted.
 */
function feeAtBlock(p: PresetParams, elapsedBlocks: number, decayBlocks: number): number {
  if (!p.enabled) return p.finalFeeBips
  return decayedFeePips(p.initialFeeBips, p.finalFeeBips, elapsedBlocks, decayBlocks)
}

/* ----------------------------------------------------------------------------
   Geometry. A viewBox, never a fixed width — the card has to survive 400px.
   ---------------------------------------------------------------------------- */

const W = 760
const H = 300
const PL = 66
const PR = 20
const PT = 22
const PB = 46
const IW = W - PL - PR
const IH = H - PT - PB

/**
 * Ceiling on plotted points. Above this the window has more blocks than the
 * chart has usable columns, so drawing every one is wasted work rather than
 * extra fidelity.
 */
const MAX_SAMPLES = 260

/**
 * A static id, deliberately not `useId()`.
 *
 * React 19's generated ids contain characters that are not valid in an XML
 * name, and an SVG paint server is referenced by fragment (`url(#id)`), not by
 * selector. One instance of this card exists on the page, so a constant is
 * both correct and legible in the DOM.
 */
const FILL_ID = 'latch-preset-curve-fill'

interface Plot {
  /** The fee line. */
  line: string
  /** The same line, closed to the baseline. */
  area: string
  /** True when every block in the window is plotted, so the steps are real. */
  steppedPerBlock: boolean
}

const xFor = (block: number, xMax: number): number => PL + (block / xMax) * IW
const yFor = (pips: number, yMax: number): number => PT + IH - (pips / yMax) * IH

/**
 * Build the path for one preset.
 *
 * TWO RENDERINGS, AND THE CHOICE IS ABOUT HONESTY RATHER THAN LOOKS.
 *
 * When the whole window fits inside `MAX_SAMPLES`, every block is evaluated and
 * the path is drawn as literal steps: horizontal across the block, vertical at
 * the boundary. That is the true shape — the fee does not move within a block.
 *
 * When it does not fit, the path samples real block numbers and joins them with
 * straight segments. It does NOT draw steps in that case, because a step
 * spanning sixty blocks would assert a plateau the contract does not have. The
 * plotted vertices are still real `_decayedFee` evaluations at real block
 * numbers; only the joins between them are drawn rather than computed, and the
 * function is linear between samples up to the flooring, so the join is
 * accurate to within one pip at this scale.
 *
 * WHICH BRANCH RUNS DEPENDS ON THE CHAIN, which is the point the whole card is
 * making. At the declared 0.10s block time no preset takes the step branch: the
 * shortest window, Stealth's two minutes, is 1,200 blocks, so each step is one
 * pip tall and a fraction of a pixel wide and the sampled path draws what the
 * step path would have drawn anyway. Move the same preset to a 12-second chain
 * and FairLaunch's five minutes is TWENTY-FIVE blocks — a visibly coarse
 * staircase, and a materially different product from the one rendered here.
 * The presets are declared in seconds precisely so they port; the step branch
 * is what shows what porting them does to the shape.
 */
function buildPath(p: PresetParams, decayBlocks: number, xMax: number, yMax: number): Plot {
  const baseline = PT + IH
  const parts: string[] = []

  if (!p.enabled) {
    /* No gate: one flat line at the floor, across the whole domain. */
    const y = yFor(p.finalFeeBips, yMax)
    parts.push(`M ${xFor(0, xMax)} ${y} L ${xFor(xMax, xMax)} ${y}`)
    const line = parts.join(' ')
    return {
      line,
      area: `${line} L ${xFor(xMax, xMax)} ${baseline} L ${xFor(0, xMax)} ${baseline} Z`,
      steppedPerBlock: false,
    }
  }

  const steppedPerBlock = decayBlocks + 1 <= MAX_SAMPLES

  if (steppedPerBlock) {
    let y = yFor(feeAtBlock(p, 0, decayBlocks), yMax)
    parts.push(`M ${xFor(0, xMax)} ${y}`)
    for (let b = 0; b < decayBlocks; b++) {
      /* Horizontal across block b at block b's fee, then step down at the
         boundary to block b+1's fee. */
      parts.push(`H ${xFor(b + 1, xMax)}`)
      y = yFor(feeAtBlock(p, b + 1, decayBlocks), yMax)
      parts.push(`V ${y}`)
    }
  } else {
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const b = Math.round((i / (MAX_SAMPLES - 1)) * decayBlocks)
      const cmd = i === 0 ? 'M' : 'L'
      parts.push(`${cmd} ${xFor(b, xMax)} ${yFor(feeAtBlock(p, b, decayBlocks), yMax)}`)
    }
  }

  /* The tail: at and after `decayBlocks` the fee is exactly `finalFeeBips`,
     forever. Drawn so the floor is visibly a floor and not the end of data. */
  parts.push(`L ${xFor(xMax, xMax)} ${yFor(p.finalFeeBips, yMax)}`)

  const line = parts.join(' ')
  return {
    line,
    area: `${line} L ${xFor(xMax, xMax)} ${baseline} L ${xFor(0, xMax)} ${baseline} Z`,
    steppedPerBlock,
  }
}

/** Seconds, at the DECLARED block time — the one the contract divides by. */
const declaredSeconds = (blocks: number): number => (blocks * BLOCK_TIME_CENTIS_DECLARED) / 100

/** Seconds, at the MEASURED block time — the one a wall clock reports. */
const measuredSeconds = (blocks: number): number => (blocks * BLOCK_TIME_CENTIS_MEASURED) / 100

const int = (n: number): string => Math.round(n).toLocaleString('en-US')

/* ----------------------------------------------------------------------------
   The component.
   ---------------------------------------------------------------------------- */

/**
 * There is no loading or error state here, and that is not an omission.
 *
 * Every figure comes from `PRESET_PARAMS` — a compile-time mirror of
 * `LaunchPresets.sol`, held to it by `packages/sdk/test/launchpadPresets.test.ts`
 * — and from the hook's decay function transcribed above. Nothing is fetched,
 * so nothing can be pending or unreachable. The footnote says what this card
 * therefore cannot tell you.
 */
export function PresetCurve() {
  const [selected, setSelected] = useState<LivePresetName>('FairLaunch')
  const [hoverBlock, setHoverBlock] = useState<number | null>(null)

  const params = PRESET_PARAMS[selected]

  /* The kit's own conversion, from the SDK, at the deployed block time. Rounds
     up and floors at 1, exactly as `LaunchPresets.secondsToBlocks` does. */
  const decayBlocks = Number(secondsToBlocks(params.windowSeconds, BLOCK_TIME_CENTIS_DECLARED))

  /* Domain. Enabled presets get ~18% past the window so the floor plateau is
     visible as a plateau; a disabled one has no window worth extending. */
  const xMaxBlocks = params.enabled ? Math.ceil(decayBlocks * 1.18) : decayBlocks
  const yMaxPips = params.initialFeeBips * 1.12

  const plot = buildPath(params, decayBlocks, xMaxBlocks, yMaxPips)

  /* Scrubbing a flat line reports the same number at every position while
     implying the position matters. Disabled presets are static instead. */
  const scrubbable = params.enabled

  const readBlock = hoverBlock === null ? null : hoverBlock
  const readFee = readBlock === null ? null : feeAtBlock(params, readBlock, decayBlocks)

  function onScrub(e: PointerEvent<SVGSVGElement>): void {
    if (!scrubbable) return
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width === 0) return
    /* The SVG scales uniformly from its viewBox, so client x maps linearly
       onto viewBox x. No getScreenCTM needed, and none of its edge cases. */
    const vbX = ((e.clientX - r.left) / r.width) * W
    const frac = (vbX - PL) / IW
    const block = Math.round(frac * xMaxBlocks)
    setHoverBlock(Math.min(Math.max(block, 0), xMaxBlocks))
  }

  const windowEndX = xFor(decayBlocks, xMaxBlocks)
  const floorY = yFor(params.finalFeeBips, yMaxPips)
  const openY = yFor(params.initialFeeBips, yMaxPips)

  const ariaLabel = params.enabled
    ? `${LABELS[selected]} preset: the LP fee decays from ${formatPips(params.initialFeeBips)} at the open ` +
      `to a floor of ${formatPips(params.finalFeeBips)} over ${humanDuration(params.windowSeconds)}, ` +
      `which is ${int(decayBlocks)} blocks on ${CHAIN.name}.`
    : `${LABELS[selected]} preset: the gate is off, so the LP fee is a flat ` +
      `${formatPips(params.finalFeeBips)} at every block.`

  return (
    /* The card is WRAPPED rather than made into the section, because those are
       two different boxes: the section carries the page's shared max-width,
       gutter and top rhythm, and the card carries the border, radius and
       shadow. Merging them is what put this component's content edge 15px left
       of every other section's. */
    <section className={page['section']} aria-labelledby="preset-curve-title">
      <div className={styles['card']}>
      <header className={styles['head']}>
        <div className={styles['headText']}>
          <p className={styles['eyebrow']}>Launchpad presets</p>
          {/* h2, not h3 — every peer section on this page heads with an h2,
              and an h3 here skips a level in the document outline. */}
          <h2 className={styles['title']} id="preset-curve-title">
            What the pool charges, block by block
          </h2>
          <p className={styles['sub']}>
            Four named launch shapes. Each is a decaying LP fee that
            <code> LaunchGuardHook</code> applies from the open — priced, never prohibited.
          </p>
        </div>

        <div className={styles['selector']} role="group" aria-label="Launch preset">
          {SELECTABLE.map((name) => (
            <button
              key={name}
              type="button"
              className={name === selected ? styles['tabOn'] : styles['tab']}
              aria-pressed={name === selected}
              onClick={() => {
                setSelected(name)
                setHoverBlock(null)
              }}
            >
              {LABELS[name]}
            </button>
          ))}
        </div>
      </header>

      <div className={styles['chartWrap']}>
        <svg
          /* Keyed on the preset so the draw-in keyframe restarts when the shape
             changes. The base styles are the FINISHED state, so a paused tab,
             a throttled frame budget or reduced motion all render the complete
             curve — the animation is never what makes it visible. */
          key={selected}
          viewBox={`0 0 ${W} ${H}`}
          className={styles['svg']}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={onScrub}
          onPointerDown={onScrub}
          onPointerLeave={() => setHoverBlock(null)}
        >
          <defs>
            <linearGradient id={FILL_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={styles['fillTop']} />
              <stop offset="100%" className={styles['fillBottom']} />
            </linearGradient>
          </defs>

          {/* Y grid at quarters of the OPENING fee, so every label is a round
              fraction of the number the preset actually starts at. */}
          <g aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => {
              const pips = (params.initialFeeBips / 4) * i
              const y = yFor(pips, yMaxPips)
              return (
                <g key={i}>
                  <line className={styles['grid']} x1={PL} x2={W - PR} y1={y} y2={y} />
                  <text className={styles['axis']} x={PL - 10} y={y + 3.5} textAnchor="end">
                    {formatPips(pips)}
                  </text>
                </g>
              )
            })}
          </g>

          <path className={styles['area']} d={plot.area} fill={`url(#${FILL_ID})`} aria-hidden="true" />
          {/* `pathLength="1"` normalises the dash so the draw-in keyframe is one
              rule regardless of how long the path is. */}
          <path className={styles['line']} d={plot.line} pathLength={1} aria-hidden="true" />

          {/* The floor. Dashed, because it is the value the curve approaches
              from above and then sits on forever. */}
          <g aria-hidden="true">
            <line className={styles['floorLine']} x1={PL} x2={W - PR} y1={floorY} y2={floorY} />
            <text className={styles['floorLabel']} x={W - PR} y={floorY - 8} textAnchor="end">
              floor {formatPips(params.finalFeeBips)}
            </text>
          </g>

          {params.enabled ? (
            <g aria-hidden="true">
              <circle className={styles['openDot']} cx={xFor(0, xMaxBlocks)} cy={openY} r={4.5} />
              <text className={styles['openLabel']} x={xFor(0, xMaxBlocks) + 10} y={openY + 4}>
                opens at {formatPips(params.initialFeeBips)}
              </text>

              <line className={styles['windowLine']} x1={windowEndX} x2={windowEndX} y1={PT} y2={PT + IH} />
              <text className={styles['windowLabel']} x={windowEndX + 8} y={PT + 12}>
                window ends
              </text>
              <text className={styles['windowSub']} x={windowEndX + 8} y={PT + 28}>
                {humanDuration(params.windowSeconds)} · {int(decayBlocks)} blocks
              </text>
            </g>
          ) : null}

          {/* X axis. A disabled preset's x position carries no information, so
              it gets a sentence instead of tick values it would be lying with. */}
          <g aria-hidden="true">
            {params.enabled ? (
              [0, 0.25, 0.5, 0.75, 1].map((f) => {
                const block = Math.round(f * xMaxBlocks)
                return (
                  <text
                    key={f}
                    className={styles['axis']}
                    x={xFor(block, xMaxBlocks)}
                    y={H - PB + 20}
                    textAnchor="middle"
                  >
                    {Math.round(declaredSeconds(block))}s
                  </text>
                )
              })
            ) : (
              <text className={styles['axisNote']} x={PL + IW / 2} y={H - PB + 20} textAnchor="middle">
                the fee does not vary with the block — the gate is off
              </text>
            )}
            {params.enabled ? (
              <text className={styles['axisNote']} x={PL + IW / 2} y={H - PB + 38} textAnchor="middle">
                seconds from the open, at the declared {BLOCK_TIME_CENTIS_DECLARED / 100}s block
              </text>
            ) : null}
          </g>

          {readBlock !== null && readFee !== null ? (
            <g aria-hidden="true">
              <line
                className={styles['crosshair']}
                x1={xFor(readBlock, xMaxBlocks)}
                x2={xFor(readBlock, xMaxBlocks)}
                y1={PT}
                y2={PT + IH}
              />
              <circle
                className={styles['crossDot']}
                cx={xFor(readBlock, xMaxBlocks)}
                cy={yFor(readFee, yMaxPips)}
                r={5}
              />
            </g>
          ) : null}
        </svg>
      </div>

      {/* The readout is a fixed row rather than a floating tooltip: at 400px a
          tooltip has nowhere to go, and a row that is always present cannot
          push the layout around when it appears.

          Deliberately NOT an `aria-live` region. It updates on every pointer
          move, which would fire dozens of announcements a second at a screen
          reader that cannot hover anyway. The same figures are in the `<dl>`
          below and in the SVG's `aria-label`, both of which change only when
          the preset does. */}
      <div className={styles['readout']}>
        {readBlock !== null && readFee !== null ? (
          <>
            <span className={styles['readFee']}>{formatPips(readFee)}</span>
            <span className={styles['readMeta']}>
              at block +{int(readBlock)} · {declaredSeconds(readBlock).toFixed(1)}s from the open
              {readBlock >= decayBlocks ? ' · past the window, at the floor' : ''}
            </span>
          </>
        ) : (
          <span className={styles['readIdle']}>
            {scrubbable
              ? 'Move along the curve to read the fee at any block.'
              : `Flat ${formatPips(params.finalFeeBips)} at every block. There is nothing to scrub.`}
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
          <dt>Window</dt>
          <dd>
            {params.enabled ? humanDuration(params.windowSeconds) : 'none'}
            <span className={styles['factSub']}>
              {params.enabled
                ? `${int(params.windowSeconds)}s declared`
                : 'the gate is off'}
            </span>
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>In blocks on {CHAIN.name}</dt>
          <dd>
            {int(decayBlocks)}
            <span className={styles['factSub']}>
              {params.enabled
                ? `~${int(measuredSeconds(decayBlocks))}s at the measured ${
                    BLOCK_TIME_CENTIS_MEASURED / 100
                  }s`
                : `${int(decayBlocks)} blocks exists only because zero is rejected`}
            </span>
          </dd>
        </div>
      </dl>

      {/* Not behind a disclosure. See the module header. */}
      <p className={styles['limit']}>
        <span className={styles['limitTag']}>Does not protect against</span>{' '}
        {params.doesNotProtectAgainst}
      </p>

      <p className={params.requiresMaxBuyPerTx ? styles['requireOn'] : styles['requireOff']}>
        {params.requiresMaxBuyPerTx ? (
          <>
            <strong>Requires a per-transaction cap.</strong> A launch that supplies no{' '}
            <code>maxBuyPerTx</code> reverts <code>MaxBuyRequiredByPreset</code>. A 50% tax a whale
            can pay once, in one enormous buy, is a worse outcome than one they have to pay in
            slices — so this preset refuses to be configured without the cap. Note the cap bounds
            ONE transaction; splitting across transactions or wallets defeats it.
          </>
        ) : (
          <>
            No per-transaction cap required. <code>maxBuyPerTx</code> is still available and still
            optional; this preset is coherent without it.
          </>
        )}
      </p>

      <footer className={styles['foot']}>
        <p>
          Every figure is <code>PRESET_PARAMS</code> from the MIT SDK, a mirror of{' '}
          <code>LaunchPresets.sol</code> held to it by a parity test. The curve is{' '}
          <code>LaunchGuardHook._decayedFee</code> transcribed with Solidity&rsquo;s floor division,
          not an interpolation between two endpoints
          {!params.enabled
            ? `. This preset decays nothing: with enabled = false the hook returns finalFeeBips at every block, before the window is ever consulted.`
            : plot.steppedPerBlock
              ? ' — every block in this window is plotted, so the steps you see are the real ones.'
              : `. The fee is constant within a block, so the true shape is a staircase; at ${int(
                  decayBlocks,
                )} blocks each step is one pip tall and finer than a pixel, so real blocks are sampled and joined — the vertices are computed, only the joins are drawn.`}
        </p>
        <p>
          Block counts use <code>blockTimeCentis = {BLOCK_TIME_CENTIS_DECLARED}</code>, the value
          the deployed kit was constructed with. The chain measures{' '}
          {BLOCK_TIME_CENTIS_MEASURED / 100}s per block, so a window runs about{' '}
          {(((BLOCK_TIME_CENTIS_MEASURED - BLOCK_TIME_CENTIS_DECLARED) /
            BLOCK_TIME_CENTIS_DECLARED) *
            100).toFixed(0)}
          % longer in wall clock than its declared seconds. Neither number is read from chain here.
        </p>
        <p>
          <strong>This card renders; it does not decide.</strong> The runtime authority is{' '}
          <code>previewSchedule(params)</code> on the deployed kit, which resolves the preset with
          the kit&rsquo;s own block time and returns the exact{' '}
          <code>LaunchConfig</code> your launch will get. Call it before broadcasting.
          {CHAIN.launchGuardHook !== null ? (
            <>
              {' '}
              The hook this draws is{' '}
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
      </footer>
      </div>
    </section>
  )
}
