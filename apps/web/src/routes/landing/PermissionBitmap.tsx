/* ============================================================================
   PermissionBitmap — which callbacks a Latch asks the CL pool manager for.

   MOUNTED by index.tsx, directly before FourThings.

   CITATIONS RE-VERIFIED against packages/core on 2026-09-13: every offset
   (ICLHooks.sol:11-24), every `shouldCall` / `hasOffsetEnabled` line in
   CLHooks.sol, the conflict rules (CLHooks.sol:23-50), Hooks.sol:58-60 and
   ParametersHelper.sol:12/21-23 match. One was off by one and is corrected:
   the self-call exclusion is `address(hook) != msg.sender` at Hooks.sol:72
   (71 is the `shouldCall` signature).

   A CORRECTION TO THE BRIEF, AND IT MATTERS. The request was to show "the
   required low bits of the Latch address". That is Uniswap v4's scheme, and it
   is NOT how this protocol works. Infinity (and therefore Latch) never reads
   permissions from the hook's address. They live in a 16-bit bitmap:

     · the hook DECLARES it:  `IHooks.getHooksRegistrationBitmap()`
                              packages/core/src/interfaces/IHooks.sol:5
     · the pool key CARRIES it, in the low 16 bits of `poolKey.parameters`:
                              packages/core/src/libraries/math/ParametersHelper.sol:12 (OFFSET_HOOK = 0)
                              packages/core/src/libraries/math/ParametersHelper.sol:21-23
     · initialize REQUIRES they match, else `HookConfigValidationError`:
                              packages/core/src/libraries/Hooks.sol:58-60
                              called from packages/core/src/pool-cl/CLPoolManager.sol:104

   Rendering address bits here would have been an invented requirement that a
   developer could act on — mining a vanity address for nothing. Note that
   `ICLHooks.sol:26-28` still carries the upstream comment about "leading bits
   of the hooks contract address"; the code below it does not do that.

   THE FLAG TABLE, verbatim from packages/core/src/pool-cl/interfaces/ICLHooks.sol:11-24.
   Each callback's call site is the `shouldCall` in
   packages/core/src/pool-cl/libraries/CLHooks.sol at the line recorded per
   flag. The returns-delta rules are CLHooks.sol:23-50
   (`validatePermissionsConflict`, called from CLPoolManager.sol:105).

   CL POOLS ONLY. Bin pools use a different table
   (packages/core/src/pool-bin/interfaces/IBinHooks.sol — mint/burn, not
   add/remove liquidity), and this component does not describe them.

   NOTHING HERE IS READ FROM CHAIN, and nothing here describes a real Latch.
   It starts with every flag off, so no default configuration is implied.
   ========================================================================== */

import { useState } from 'react'

import page from './landing.module.css'
import styles from './permissionbitmap.module.css'
import { cx } from './ui'

interface Flag {
  /** Bit offset — `ICLHooks.sol` constant value. */
  readonly offset: number
  /** The Solidity constant, code voice. */
  readonly constant: string
  /** Short label for the diagram. */
  readonly label: string
  /** CLHooks.sol line of the `shouldCall` / `hasOffsetEnabled` that reads it. */
  readonly callSite: number
  /** For a returns-delta flag: the base flag it requires (CLHooks.sol:23-50). */
  readonly requires?: number
}

/* ICLHooks.sol:11-24. Offsets are the constants' values; nothing is renumbered. */
const FLAGS: readonly Flag[] = [
  { offset: 0, constant: 'HOOKS_BEFORE_INITIALIZE_OFFSET', label: 'beforeInitialize', callSite: 56 },
  { offset: 1, constant: 'HOOKS_AFTER_INITIALIZE_OFFSET', label: 'afterInitialize', callSite: 64 },
  { offset: 2, constant: 'HOOKS_BEFORE_ADD_LIQUIDITY_OFFSET', label: 'beforeAddLiquidity', callSite: 76 },
  { offset: 3, constant: 'HOOKS_AFTER_ADD_LIQUIDITY_OFFSET', label: 'afterAddLiquidity', callSite: 95 },
  { offset: 4, constant: 'HOOKS_BEFORE_REMOVE_LIQUIDITY_OFFSET', label: 'beforeRemoveLiquidity', callSite: 78 },
  { offset: 5, constant: 'HOOKS_AFTER_REMOVE_LIQUIDITY_OFFSET', label: 'afterRemoveLiquidity', callSite: 109 },
  { offset: 6, constant: 'HOOKS_BEFORE_SWAP_OFFSET', label: 'beforeSwap', callSite: 133 },
  { offset: 7, constant: 'HOOKS_AFTER_SWAP_OFFSET', label: 'afterSwap', callSite: 174 },
  { offset: 8, constant: 'HOOKS_BEFORE_DONATE_OFFSET', label: 'beforeDonate', callSite: 199 },
  { offset: 9, constant: 'HOOKS_AFTER_DONATE_OFFSET', label: 'afterDonate', callSite: 206 },
  {
    offset: 10,
    constant: 'HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET',
    label: 'returns delta',
    callSite: 150,
    requires: 6,
  },
  {
    offset: 11,
    constant: 'HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET',
    label: 'returns delta',
    callSite: 178,
    requires: 7,
  },
  {
    /* Spelled LIQUIDIY in core. Kept verbatim: it is the real identifier. */
    offset: 12,
    constant: 'HOOKS_AFTER_ADD_LIQUIDIY_RETURNS_DELTA_OFFSET',
    label: 'returns delta',
    callSite: 102,
    requires: 3,
  },
  {
    offset: 13,
    constant: 'HOOKS_AFTER_REMOVE_LIQUIDIY_RETURNS_DELTA_OFFSET',
    label: 'returns delta',
    callSite: 116,
    requires: 5,
  },
]

const BY_OFFSET: ReadonlyMap<number, Flag> = new Map(FLAGS.map((f) => [f.offset, f]))

/** Bits 14 and 15 sit inside the 16-bit field and have no CL offset defined. */
const BITMAP_BITS = 16

interface Stage {
  readonly op: string
  /** What triggers it, when that is narrower than the op name. */
  readonly note?: string
  readonly before: number
  readonly after: number
  readonly beforeDelta?: number
  readonly afterDelta?: number
}

/* The five CL operations and the callbacks around each. The liquidity split
   is CLHooks.sol:76-78: before-add fires for liquidityDelta > 0, before-remove
   otherwise. */
const STAGES: readonly Stage[] = [
  { op: 'initialize', before: 0, after: 1 },
  { op: 'add liquidity', note: 'liquidityDelta > 0', before: 2, after: 3, afterDelta: 12 },
  { op: 'remove liquidity', note: 'liquidityDelta ≤ 0', before: 4, after: 5, afterDelta: 13 },
  { op: 'swap', before: 6, after: 7, beforeDelta: 10, afterDelta: 11 },
  { op: 'donate', before: 8, after: 9 },
]

const has = (bitmap: number, offset: number): boolean => ((bitmap >> offset) & 1) === 1

function hex16(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`
}

export function PermissionBitmap() {
  const [bitmap, setBitmap] = useState(0)

  const toggle = (offset: number): void => setBitmap((b) => b ^ (1 << offset))

  /* CLHooks.sol:23-50 — a returns-delta flag without its base flag makes
     `initialize` revert. Computed, so the warning appears exactly when core
     would reject the key. */
  const conflicts = FLAGS.filter(
    (f) => f.requires !== undefined && has(bitmap, f.offset) && !has(bitmap, f.requires),
  )

  const enabledCount = FLAGS.filter((f) => has(bitmap, f.offset)).length

  /* A render function, NOT a nested component: a component declared inside
     this one is a new type every render, so React would remount the button
     on each toggle and throw the keyboard user's focus away. */
  function flagButton(offset: number, kind: 'call' | 'delta') {
    const f = BY_OFFSET.get(offset)
    if (f === undefined) return null
    const on = has(bitmap, offset)
    const broken = conflicts.includes(f)
    return (
      <button
        type="button"
        className={cx(
          kind === 'call' ? styles['call'] : styles['delta'],
          on && styles['on'],
          broken && styles['broken'],
        )}
        aria-pressed={on}
        title={`${f.constant} = ${f.offset} · CLHooks.sol:${f.callSite}`}
        onClick={() => toggle(offset)}
      >
        {kind === 'delta' ? <span aria-hidden="true">Δ </span> : null}
        <span className={styles['callName']}>
          {f.label}
          {kind === 'delta' ? (
            <span className={styles['sr']}> for {BY_OFFSET.get(f.requires ?? -1)?.label}</span>
          ) : null}
        </span>
        <span className={styles['bit']}>bit {f.offset}</span>
      </button>
    )
  }

  return (
    <section
      id="permissions"
      className={cx(page['section'], page['reveal'])}
      aria-labelledby="permission-bitmap-title"
    >
      {/* The house section heading: eyebrow, serif H2, muted lead — the same
          three as FourThings directly below. */}
      <p className={page['eyebrow']}>PERMISSIONS</p>
      <h2 id="permission-bitmap-title" className={page['h2']}>
        Which callbacks a Latch <span className={page['accent']}>asks for</span>.
      </h2>
      <p className={page['sectionLead']}>
        A Latch is a hook contract attached to a pool, and it declares a 16-bit permission bitmap.
        Toggle a callback to see what the CL pool manager will invoke, and the bitmap the Latch
        must return.
      </p>

      <div className={styles['card']}>
        <div className={styles['head']}>
          <div className={styles['headText']}>
            <h3 className={styles['title']}>CL pool callbacks, by operation</h3>
            <p className={styles['caption']}>
              Each operation with the callback before it and the callback after it. Δ marks the
              flag that lets a callback return a delta.
            </p>
          </div>
          <button
            type="button"
            className={styles['reset']}
            onClick={() => setBitmap(0)}
            disabled={bitmap === 0}
          >
            Clear all
          </button>
        </div>

        {/* ---- the lifecycle: every button here IS a flag toggle ---------- */}
        <ol className={styles['stages']}>
          {STAGES.map((st) => {
            const live = has(bitmap, st.before) || has(bitmap, st.after)
            return (
              <li key={st.op} className={cx(styles['stage'], live && styles['stageLive'])}>
                <div className={styles['side']}>
                  {flagButton(st.before, 'call')}
                  {st.beforeDelta !== undefined ? flagButton(st.beforeDelta, 'delta') : null}
                </div>
                <div className={styles['op']} aria-hidden="true">
                  <span className={styles['arrow']} />
                  <span className={styles['opName']}>
                    {st.op}
                    {st.note !== undefined ? <span className={styles['opNote']}>{st.note}</span> : null}
                  </span>
                  <span className={styles['arrow']} />
                </div>
                <div className={styles['side']}>
                  {flagButton(st.after, 'call')}
                  {st.afterDelta !== undefined ? flagButton(st.afterDelta, 'delta') : null}
                </div>
              </li>
            )
          })}
        </ol>

        {/* ---- the bitmap ------------------------------------------------- */}
        <div className={styles['out']}>
          <div className={styles['bits']} aria-hidden="true">
            {Array.from({ length: BITMAP_BITS }, (_, i) => BITMAP_BITS - 1 - i).map((offset) => {
              const defined = BY_OFFSET.has(offset)
              const on = has(bitmap, offset)
              return (
                <span
                  key={offset}
                  className={cx(styles['cell'], on && styles['cellOn'], !defined && styles['cellNone'])}
                >
                  <span className={styles['cellVal']}>{defined ? (on ? '1' : '0') : '·'}</span>
                  <span className={styles['cellIdx']}>{offset}</span>
                </span>
              )
            })}
          </div>

          <dl className={styles['values']}>
            <div className={styles['value']}>
              <dt>
                <code>getHooksRegistrationBitmap()</code> returns
              </dt>
              <dd className={styles['hex']}>{hex16(bitmap)}</dd>
            </div>
            <div className={styles['value']}>
              <dt>
                low 16 bits of <code>poolKey.parameters</code>
              </dt>
              <dd className={styles['hex']}>{hex16(bitmap)}</dd>
            </div>
            <div className={styles['value']}>
              <dt>callbacks enabled</dt>
              <dd className={styles['hex']}>{enabledCount}</dd>
            </div>
          </dl>

          <p className={styles['sr']} aria-live="polite">
            Bitmap {hex16(bitmap)}, {enabledCount} flags enabled
            {conflicts.length > 0 ? `, ${conflicts.length} conflicting` : ''}.
          </p>

          {conflicts.length > 0 ? (
            <p className={styles['conflict']} role="status">
              <strong>initialize would revert</strong> <code>HookPermissionsValidationError</code>:{' '}
              {conflicts
                .map((f) => `bit ${f.offset} needs bit ${f.requires ?? ''}`)
                .join(', ')}
              .
            </p>
          ) : bitmap === 0 ? (
            <p className={styles['status']}>
              Bitmap zero: no callbacks fire. A pool with no Latch (<code>hooks = address(0)</code>)
              must use exactly this.
            </p>
          ) : null}
        </div>

        <p className={styles['provenance']}>
          From <code>packages/core</code>: offsets <code>ICLHooks.sol:11-24</code>; bitmap in the
          low 16 bits of <code>parameters</code> (<code>ParametersHelper.sol:21</code>); must match
          the Latch&rsquo;s own return or initialize reverts (<code>Hooks.sol:58</code>). Permissions
          are not encoded in the Latch&rsquo;s address. A Latch never receives its own calls
          (<code>Hooks.sol:72</code>). CL pools only.
        </p>
      </div>
    </section>
  )
}
