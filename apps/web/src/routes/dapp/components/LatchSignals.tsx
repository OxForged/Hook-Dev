/* ============================================================================
   The trust vocabulary of the Latch Marketplace — the components.

   Shared by the listing card (screens/Explorer) and the product page
   (screens/LatchDetail) so the two can never describe the same Latch two ways.
   The values they render come from latchModel.ts; this file exports components
   only.

   Everything rendered here traces to a value the REGISTRY holds — the three
   enums, the classifier booleans and the permission bitmap read off the Latch's
   own bytecode. Nothing here renders the submitter's name or prose; those are
   deliberately kept in the screens, styled as quotation, below these signals.

   The store grammar borrowed is specific: the App Store's info strip (the row
   of cells under a product's name) becomes `TrustStrip`, and its privacy
   "nutrition label" becomes `CapabilityLedger`. Both fit because both are
   tables of facts with a fixed row set — a NO is as informative as a YES, so
   every row is always present. What the store does not have and this does is
   `Ribbon`: a Latch that can take value, or that a guardian has flagged, wears
   a band across the top of its card that no verification badge can remove.
   ============================================================================ */

import { ChainTag } from '../../../components/ChainTag.tsx'
import { HOOK_CALLBACKS, HOOK_CALLBACK_BIT } from '../../../data/registry.generated.ts'
import {
  LISTING_LABEL,
  RISK_LABEL,
  VERIFICATION_LABEL,
  capabilityClaims,
  type RegisteredLatch,
} from '../../../lib/chain'
import {
  LEDGER_ROWS,
  LISTING_BADGE,
  LISTING_DEPRECATED,
  LISTING_MALICIOUS,
  LISTING_MEANING,
  RISK_BADGE,
  RISK_MEANING,
  RISK_VALUE_EXTRACTING,
  TOTAL_CALLBACKS,
  VERIFICATION_BADGE,
  VERIFICATION_MEANING,
  bitmapHex,
  callbackKind,
  latchTone,
} from './latchModel.ts'

/* ---- Ribbon ---------------------------------------------------------------- */

/**
 * The band across the top of a card or hero. Rendered for the tones that must
 * be unmissable at a glance; nothing for plain or caution, whose signal lives
 * in the ledger below. One band per Latch — the loudest reason wins, and the
 * alerts spell out the rest.
 */
export function Ribbon({ hook }: { hook: RegisteredLatch }) {
  if (hook.listing === LISTING_MALICIOUS) {
    return (
      <p className="lx-ribbon" data-level="danger">
        <span className="lx-ribbon__glyph" aria-hidden="true" />
        Flagged malicious by a guardian
      </p>
    )
  }
  if (!hook.permissionsReadable) {
    return (
      <p className="lx-ribbon" data-level="danger">
        <span className="lx-ribbon__glyph" aria-hidden="true" />
        Bitmap unreadable — capabilities may be stale
      </p>
    )
  }
  if (hook.risk === RISK_VALUE_EXTRACTING) {
    return (
      <p className="lx-ribbon" data-level="danger">
        <span className="lx-ribbon__glyph" aria-hidden="true" />
        Value-extracting — holds a returns-delta permission
      </p>
    )
  }
  if (hook.listing === LISTING_DEPRECATED) {
    return (
      <p className="lx-ribbon" data-level="mute">
        <span className="lx-ribbon__glyph" aria-hidden="true" />
        Deprecated by its steward
      </p>
    )
  }
  return null
}

/* ---- Alerts ---------------------------------------------------------------- */

/** The alert lines a Latch earns. Always visible, never behind a disclosure. */
export function LatchAlerts({ hook }: { hook: RegisteredLatch }) {
  return (
    <>
      {hook.listing === LISTING_MALICIOUS && (
        <p className="hx-alert hx-alert--danger">
          A guardian has flagged this Latch as known to harm users. Its verification has been
          reset. Do not route funds through a pool that uses it.
        </p>
      )}

      {hook.risk === RISK_VALUE_EXTRACTING && (
        <p className="hx-alert hx-alert--danger">
          Value-extracting. This Latch holds a permission that lets it take a cut of swaps or
          refuse liquidity withdrawals. Value routed through its pools moves at its discretion.
        </p>
      )}

      {!hook.permissionsReadable && (
        <p className="hx-alert hx-alert--danger">
          STALE — the registry can no longer read this contract&rsquo;s bitmap. The capabilities
          shown are the last values that were successfully read and may no longer be true.
        </p>
      )}

      {!hook.permissionsValid && (
        <p className="hx-alert">
          Malformed bitmap — it carries reserved bits, or a returns-delta bit without the
          callback that bit depends on. It cannot be attested to in this state.
        </p>
      )}

      {/* Deprecated is a status, not an accusation — marked, not alarmed. */}
      {hook.listing === LISTING_DEPRECATED && (
        <p className="hx-note">
          Deprecated — superseded or abandoned by its steward. Not an accusation; any
          verification it earned still stands.
        </p>
      )}
    </>
  )
}

/* ---- TrustStrip ------------------------------------------------------------ */

/**
 * The info strip: the three on-chain enums, always in the same order, always
 * all present. A missing cell would be read as "not applicable" when what it
 * really means is "we did not say".
 *
 * `extended` adds the chain, the callback count and the bitmap, and a caption
 * under each cell saying what the value means — the product-page version.
 */
export function TrustStrip({ hook, extended }: { hook: RegisteredLatch; extended?: boolean }) {
  const held = hook.callbacks.length
  return (
    <dl className={extended ? 'lx-strip lx-strip--lg' : 'lx-strip'}>
      <div className="lx-strip__cell">
        <dt className="dapp-microlabel dapp-microlabel--tight">VERIFICATION</dt>
        <dd>
          <span className={VERIFICATION_BADGE[hook.verification]}>
            {VERIFICATION_LABEL[hook.verification]}
          </span>
        </dd>
        {extended && <dd className="lx-strip__cap">{VERIFICATION_MEANING[hook.verification]}</dd>}
      </div>
      <div className="lx-strip__cell">
        <dt className="dapp-microlabel dapp-microlabel--tight">CAPABILITY</dt>
        <dd>
          <span className={RISK_BADGE[hook.risk]}>{RISK_LABEL[hook.risk]}</span>
        </dd>
        {extended && <dd className="lx-strip__cap">{RISK_MEANING[hook.risk]}</dd>}
      </div>
      <div className="lx-strip__cell">
        <dt className="dapp-microlabel dapp-microlabel--tight">LISTING</dt>
        <dd>
          <span className={LISTING_BADGE[hook.listing]}>{LISTING_LABEL[hook.listing]}</span>
        </dd>
        {extended && <dd className="lx-strip__cap">{LISTING_MEANING[hook.listing]}</dd>}
      </div>

      {extended && (
        <>
          <div className="lx-strip__cell">
            <dt className="dapp-microlabel dapp-microlabel--tight">CHAIN</dt>
            <dd className="lx-strip__val">
              <ChainTag chainId={hook.chainId} size={15} />
            </dd>
            <dd className="lx-strip__cap">Read from the record, not the page.</dd>
          </div>
          <div className="lx-strip__cell">
            <dt className="dapp-microlabel dapp-microlabel--tight">CALLBACKS</dt>
            <dd className="lx-strip__val tabular">
              {held}
              <span className="lx-strip__of"> / {TOTAL_CALLBACKS}</span>
            </dd>
            <dd className="lx-strip__cap">Held, of the {TOTAL_CALLBACKS} a Latch can declare.</dd>
          </div>
          <div className="lx-strip__cell">
            <dt className="dapp-microlabel dapp-microlabel--tight">BITMAP</dt>
            <dd className="lx-strip__val tabular">{bitmapHex(hook)}</dd>
            <dd className="lx-strip__cap">
              <code>getHooksRegistrationBitmap()</code> on the Latch itself.
            </dd>
          </div>
        </>
      )}
    </dl>
  )
}

/* ---- BitmapStrip ----------------------------------------------------------- */

/**
 * The permission bitmap as fourteen cells, bit 0 on the left so the order
 * matches the callback list. Filled cells are held; the fill colour is the
 * callback's kind, so a card with a red cell is a card with a returns-delta
 * bit, visible from across the grid.
 *
 * One `img` for screen readers rather than fourteen list items: the summary
 * names every held callback, and the detail page follows with the full matrix.
 */
export function BitmapStrip({ hook, size }: { hook: RegisteredLatch; size?: 'lg' }) {
  const held = new Set(hook.callbacks)
  const n = held.size
  const label =
    n === 0
      ? `Permission bitmap ${bitmapHex(hook)}: no callbacks held.`
      : `Permission bitmap ${bitmapHex(hook)}: ${n} of ${TOTAL_CALLBACKS} callbacks held — ${hook.callbacks.join(', ')}.`

  return (
    <span className={size === 'lg' ? 'lx-bits lx-bits--lg' : 'lx-bits'} role="img" aria-label={label}>
      {HOOK_CALLBACKS.map((name) => {
        const on = held.has(name)
        return (
          <i
            key={name}
            data-held={on ? 'yes' : 'no'}
            data-kind={callbackKind(name)}
            title={`${name} · bit ${HOOK_CALLBACK_BIT[name]} · ${on ? 'held' : 'not held'}`}
          />
        )
      })}
    </span>
  )
}

/* ---- CapabilityLedger ------------------------------------------------------ */

/**
 * The nutrition label. Three questions, each answered CAN or CANNOT by the
 * registry's own classifiers — never derived here, never writable by the
 * submitter. This is the un-fakeable half of every card, and it sits above the
 * submitter's prose because it is the half that decides whether the prose
 * matters.
 *
 * `detail` adds the one-line reason under each row and the larger bit strip.
 */
export function CapabilityLedger({ hook, detail }: { hook: RegisteredLatch; detail?: boolean }) {
  const tone = latchTone(hook)
  const none = !hook.takesSwapCut && !hook.canBlockSwaps && !hook.canTrapLiquidity
  const held = hook.callbacks.length

  return (
    <div className="lx-ledger" data-tone={tone}>
      <div className="lx-ledger__head">
        <p className="dapp-microlabel dapp-microlabel--tight">
          WHAT THIS LATCH CAN DO · FROM ITS OWN BYTECODE
        </p>
      </div>

      <ul className="lx-ledger__rows">
        {LEDGER_ROWS.map((row) => {
          const can = hook[row.key]
          return (
            <li
              key={row.key}
              className="lx-ledger__row"
              data-can={can ? 'yes' : 'no'}
              data-kind={row.kind}
            >
              <span className="lx-ledger__ask">
                {row.ask}
                {detail && <span className="lx-ledger__why">{row.why}</span>}
              </span>
              <span className="lx-ledger__verdict">{can ? 'CAN' : 'CANNOT'}</span>
            </li>
          )
        })}
      </ul>

      {none && <p className="lx-ledger__none">{capabilityClaims(hook)[0]}</p>}

      <div className="lx-ledger__foot">
        <BitmapStrip hook={hook} size={detail ? 'lg' : undefined} />
        <span className="lx-ledger__meter tabular">
          <span className="lx-ledger__hex">{bitmapHex(hook)}</span>
          <span className="lx-ledger__count">
            {' '}
            · {held} of {TOTAL_CALLBACKS} held
          </span>
        </span>
      </div>
    </div>
  )
}
