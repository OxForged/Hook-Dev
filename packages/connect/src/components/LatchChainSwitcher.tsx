/* ============================================================================
   <LatchChainSwitcher />

   A multi-chain menu over wagmi's `useSwitchChain`.

   ---------------------------------------------------------------------------
   WHY THIS IS NOT RAINBOWKIT'S CHAIN MODAL
   ---------------------------------------------------------------------------

   The Latch chain list carries a fact RainbowKit has no concept of: whether
   Latch contracts actually EXIST on a chain. Every chain in the list is an
   EIP-1153-verified deploy target; exactly one of them has a deployment. A
   switcher that presents them identically invites a user to switch to Linea and
   wonder why the app is empty.

   So the menu is grouped by the only question a user is actually asking —
   "can I use this right now":

       AVAILABLE      chains in LATCH_DEPLOYED_CHAIN_IDS
       COMING SOON    registered and endpoint-verified, no contracts yet

   Mainnet-vs-testnet is NOT a grouping here. It is a per-row `TEST` tag, which
   is the right weight for it: it qualifies a chain, it does not decide whether
   the app works.

   ---------------------------------------------------------------------------
   COMING-SOON ROWS ARE DISABLED, NOT SILENT
   ---------------------------------------------------------------------------

   A coming-soon row is rendered with `aria-disabled="true"` and carries its
   reason in the accessible name. It is NOT removed from the tab order — a user
   who arrows onto it hears why it cannot be picked, which is the whole point of
   listing it.

   The alternative — let the switch happen and let the app explain — was
   rejected because `switchChain` on a chain the wallet does not know triggers
   `wallet_addEthereumChain`. That is a permanent change to the user's wallet,
   requested so they can look at an app with no contracts on it. Asking for that
   is worse than a clearly labelled row that says "not yet".

   `aria-disabled` rather than the `disabled` attribute is deliberate: `disabled`
   removes the control from the accessibility tree in several screen readers, so
   the reason for the disablement becomes unreachable by the users who most need
   it.

   ---------------------------------------------------------------------------
   ICONS: A RENDER PROP, NOT AN ASSET DEPENDENCY
   ---------------------------------------------------------------------------

   This package is published standalone under MIT and must not reach into a
   host application's `public/` directory or hardcode asset paths. It therefore
   ships NO chain logos. Pass `renderIcon` to supply them; omit it and every row
   falls back to a typographic monogram drawn from the design tokens. The
   switcher is fully functional either way — an integrator with no assets gets a
   working, legible menu, not a row of broken images.

   See the `renderIcon` prop docs below for the exact contract.
   ============================================================================ */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { Chain } from 'viem'
import { useAccount, useChains, useSwitchChain } from 'wagmi'

import { isLatchDeployedChain } from '../chains/index.js'

export interface LatchChainSwitcherProps {
  /**
   * Render the mark for one chain.
   *
   * Called once per row and once for the trigger. Return any node — an `<img>`,
   * an inline `<svg>`, a styled `<span>`. The switcher wraps whatever comes back
   * in `.latch-chain__icon` and sizes that box in CSS, so a 16px-square asset is
   * the natural thing to return.
   *
   * OMIT IT and the switcher renders a monogram built from the chain's own name
   * in the host's type and tokens. That fallback is a deliberate placeholder,
   * not a bug: this package holds no chain logos and will not guess at asset
   * paths inside an application it does not own.
   *
   * Return `null` for a specific chain to fall back to the monogram for that
   * chain alone.
   *
   * ```tsx
   * <LatchChainSwitcher renderIcon={(chain) => <MyChainLogo chainId={chain.id} />} />
   * ```
   */
  readonly renderIcon?: (chain: Chain) => ReactNode

  /**
   * List only chains with live Latch contracts — i.e. drop the "Coming soon"
   * section entirely. Defaults to FALSE.
   *
   * The default flipped when the grouping changed. It used to be `true` because
   * a flat list mixing deployed and undeployed chains was misleading; the
   * Available / Coming soon split now says that out loud, and hiding the roadmap
   * is no longer the honest option — it is just less information.
   *
   * Set it true for a surface that must offer nothing but working chains.
   * When it would hide everything (an app configured with no deployed chain),
   * the full list is shown instead: an empty menu is a dead end, a labelled list
   * is not.
   */
  readonly onlyDeployed?: boolean

  /**
   * Group the menu into Available / Coming soon sections. Defaults to true.
   *
   * Ungrouped, coming-soon rows are still unselectable and grow a visible `SOON`
   * tag, because without the section heading nothing else would say why.
   */
  readonly grouped?: boolean

  readonly className?: string

  /** Called after a successful switch. */
  readonly onSwitch?: (chainId: number) => void
}

function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Neutral fallback mark: the chain's own first letter.
 *
 * Not an approximation of anybody's logo. Drawing a lookalike of a network's
 * brand would misrepresent them; a letter in the host's own type does not
 * pretend to be anything.
 */
function monogram(chain: Chain): string {
  const first = chain.name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0)
  return (first || '?').toUpperCase()
}

interface Section {
  readonly key: string
  readonly label: string | null
  readonly chains: readonly Chain[]
}

export function LatchChainSwitcher({
  renderIcon,
  onlyDeployed = false,
  grouped = true,
  className,
  onSwitch,
}: LatchChainSwitcherProps) {
  const configured = useChains()
  const { chainId: activeChainId, isConnected } = useAccount()
  const { switchChain, isPending, error, reset } = useSwitchChain()

  const [open, setOpen] = useState(false)
  /** Roving-tabindex cursor: index into the flattened row list. */
  const [cursor, setCursor] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()
  const groupIdBase = useId()

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false)
      // A menu closed by keyboard must not drop the user's place in the tab
      // order. Closed by an outside click, it must not steal focus back.
      if (returnFocus) triggerRef.current?.focus()
    },
    [],
  )

  /* ------------------------------------------------------------------ rows */

  const deployed = useMemo(
    () => configured.filter((c) => isLatchDeployedChain(c.id)),
    [configured],
  )

  const listed: readonly Chain[] =
    onlyDeployed && deployed.length > 0 ? deployed : configured

  const sections: readonly Section[] = useMemo(() => {
    if (!grouped) return [{ key: 'all', label: null, chains: listed }]
    const soon = listed.filter((c) => !isLatchDeployedChain(c.id))
    const live = listed.filter((c) => isLatchDeployedChain(c.id))
    return [
      { key: 'available', label: 'Available', chains: live },
      { key: 'soon', label: 'Coming soon', chains: soon },
    ].filter((s) => s.chains.length > 0)
  }, [grouped, listed])

  /** Flattened in render order — the index space the roving tabindex walks. */
  const flat: readonly Chain[] = useMemo(
    () => sections.flatMap((s) => s.chains),
    [sections],
  )

  const active = configured.find((c) => c.id === activeChainId)
  // Connected to something outside the config — wagmi reports the id but has no
  // Chain for it. Say so rather than rendering a blank trigger.
  const unsupported = isConnected && activeChainId !== undefined && active === undefined

  /**
   * A row is selectable when Latch is deployed there, or when it is the chain
   * the wallet is already on (switching to where you already are is a no-op, but
   * the row must still read as the current one rather than as forbidden).
   */
  const selectable = useCallback(
    (chain: Chain) => isLatchDeployedChain(chain.id) || chain.id === activeChainId,
    [activeChainId],
  )

  /* --------------------------------------------------------- open / dismiss */

  // Close on outside pointerdown and on Escape. `pointerdown` rather than
  // `click` so the menu is gone before the click lands on whatever is beneath
  // it — otherwise the first click outside is swallowed by the close.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  // On open, put focus on the current chain's row so the menu opens "where you
  // are" rather than at the top of a list you have to read to orient in.
  useEffect(() => {
    if (!open) return
    const at = flat.findIndex((c) => c.id === activeChainId)
    const start = at >= 0 ? at : 0
    setCursor(start)
    // The rows mount in the same commit; focus after paint so the ref is set.
    const id = requestAnimationFrame(() => rowRefs.current[start]?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, flat, activeChainId])

  const focusAt = useCallback((index: number) => {
    setCursor(index)
    rowRefs.current[index]?.focus()
  }, [])

  const onMenuKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const last = flat.length - 1
      if (last < 0) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          focusAt(cursor >= last ? 0 : cursor + 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          focusAt(cursor <= 0 ? last : cursor - 1)
          break
        case 'Home':
          e.preventDefault()
          focusAt(0)
          break
        case 'End':
          e.preventDefault()
          focusAt(last)
          break
        case 'Tab':
          // Let Tab do its normal thing, but do not leave an orphaned menu open
          // behind the focus ring.
          close(false)
          break
        default:
          break
      }
    },
    [close, cursor, flat.length, focusAt],
  )

  /* ------------------------------------------------------------ the switch */

  const select = useCallback(
    (chain: Chain) => {
      if (!selectable(chain)) return
      close(true)
      if (chain.id === activeChainId) return
      reset()
      switchChain({ chainId: chain.id }, { onSuccess: () => onSwitch?.(chain.id) })
    },
    [activeChainId, close, onSwitch, reset, selectable, switchChain],
  )

  /* ---------------------------------------------------------------- render */

  const icon = (chain: Chain) => {
    const supplied = renderIcon?.(chain)
    return (
      <span className="latch-chain__icon" aria-hidden="true">
        {supplied ?? <span className="latch-chain__icon-mono">{monogram(chain)}</span>}
      </span>
    )
  }

  const renderRow = (chain: Chain, index: number) => {
    const isActive = chain.id === activeChainId
    const enabled = selectable(chain)
    return (
      <button
        key={chain.id}
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        {...(isActive ? { 'aria-current': 'true' as const } : {})}
        {...(enabled ? {} : { 'aria-disabled': true as const })}
        tabIndex={index === cursor ? 0 : -1}
        ref={(node) => {
          rowRefs.current[index] = node
        }}
        className={cx(
          'latch-chain__row',
          isActive && 'is-active',
          enabled ? undefined : 'is-unavailable',
        )}
        onClick={() => select(chain)}
        onFocus={() => setCursor(index)}
      >
        {icon(chain)}
        <span className="latch-chain__row-name">{chain.name}</span>

        {chain.testnet === true ? (
          <span className="latch-chain__row-tag" title="Test network">
            Test
          </span>
        ) : null}

        {/* Ungrouped, nothing else on screen says why this row is inert. */}
        {!enabled && !grouped ? (
          <span className="latch-chain__row-tag latch-chain__row-tag--soon">Soon</span>
        ) : null}

        {/* The reason, always available to assistive tech, whether or not a
            visible tag is shown. */}
        {enabled ? null : (
          <span className="latch-connect__sr">
            Not available yet — no Latch contracts on this chain.
          </span>
        )}

        {isActive ? <span className="latch-chain__check" aria-hidden="true" /> : null}
      </button>
    )
  }

  // Rows are indexed by render position; drop refs for rows that no longer
  // exist so the roving cursor can never focus a detached node.
  rowRefs.current.length = flat.length

  let index = -1

  const triggerLabel = !isConnected
    ? 'No wallet'
    : unsupported
      ? 'Unsupported network'
      : isPending
        ? 'Switching…'
        : (active?.name ?? 'Unknown network')

  return (
    <div ref={rootRef} className={cx('latch-chain', className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cx('latch-chain__trigger', unsupported && 'is-error')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        disabled={!isConnected}
      >
        {active && !unsupported ? (
          icon(active)
        ) : (
          <span
            className={cx('latch-dot', unsupported ? 'latch-dot--error' : 'latch-dot--warning')}
            aria-hidden="true"
          />
        )}
        <span className="latch-chain__trigger-label">{triggerLabel}</span>
        <span className="latch-chain__caret" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          className="latch-chain__menu"
          role="menu"
          aria-label="Switch network"
          onKeyDown={onMenuKeyDown}
        >
          {sections.map((section) => {
            const labelId = `${groupIdBase}-${section.key}`
            return (
              <div
                key={section.key}
                className="latch-chain__section"
                role="group"
                {...(section.label === null ? {} : { 'aria-labelledby': labelId })}
              >
                {section.label === null ? null : (
                  <p id={labelId} className="latch-chain__group">
                    {section.label}
                  </p>
                )}
                {section.chains.map((chain) => {
                  index += 1
                  return renderRow(chain, index)
                })}
              </div>
            )
          })}
        </div>
      ) : null}

      {error ? (
        <p className="latch-chain__error" role="alert">
          {/* Wallets phrase rejection a dozen ways; showing their message beats
              guessing, but the raw stack is never useful to a user. */}
          {error.message.split('\n')[0]}
        </p>
      ) : null}
    </div>
  )
}
