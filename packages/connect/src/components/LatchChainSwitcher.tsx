/* ============================================================================
   <LatchChainSwitcher />

   A multi-chain switcher over wagmi's `useSwitchChain`.

   Why not just RainbowKit's chain modal: the Latch chain list carries a fact
   RainbowKit has no concept of — whether Latch contracts actually EXIST on a
   chain. Ten of the eleven target chains are EIP-1153-verified deploy targets
   with no deployment yet. A switcher that presents them identically invites a
   user to switch to Monad and wonder why the app is empty, so a chain with no
   deployment is labelled as such and, by default, is not offered at all.

   `onlyDeployed` defaults to TRUE for that reason. Flip it for an explorer-style
   surface that genuinely reads several chains.
   ============================================================================ */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Chain } from 'viem'
import { useAccount, useChains, useSwitchChain } from 'wagmi'

import { isLatchDeployedChain } from '../chains/index.js'

export interface LatchChainSwitcherProps {
  /**
   * Only list chains with live Latch contracts. Defaults to true.
   *
   * When it hides everything (an app configured with no deployed chain), the
   * full list is shown instead — an empty menu is a dead end, a labelled list is
   * not.
   */
  readonly onlyDeployed?: boolean
  /** Group the menu into Mainnet / Testnet sections. Defaults to true. */
  readonly grouped?: boolean
  readonly className?: string
  /** Called after a successful switch. */
  readonly onSwitch?: (chainId: number) => void
}

function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function shortLabel(chain: Chain): string {
  return chain.name
}

export function LatchChainSwitcher({
  onlyDeployed = true,
  grouped = true,
  className,
  onSwitch,
}: LatchChainSwitcherProps) {
  const configured = useChains()
  const { chainId: activeChainId, isConnected } = useAccount()
  const { switchChain, isPending, variables, error, reset } = useSwitchChain()

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback(() => setOpen(false), [])

  // Close on outside pointerdown and on Escape. `pointerdown` rather than
  // `click` so the menu is gone before the click lands on whatever is beneath
  // it — otherwise the first click outside is swallowed by the close.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        // Return focus to the trigger; a menu closed by Escape must not drop
        // the user's place in the tab order.
        rootRef.current?.querySelector<HTMLButtonElement>('.latch-chain__trigger')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  const deployed = configured.filter((c) => isLatchDeployedChain(c.id))
  const listed: readonly Chain[] = onlyDeployed && deployed.length > 0 ? deployed : configured

  const active = configured.find((c) => c.id === activeChainId)
  // Connected to something outside the config — wagmi reports the id but has no
  // Chain for it. Say so rather than rendering a blank trigger.
  const unsupported = isConnected && activeChainId !== undefined && active === undefined

  const select = useCallback(
    (chain: Chain) => {
      close()
      if (chain.id === activeChainId) return
      reset()
      switchChain(
        { chainId: chain.id },
        {
          onSuccess: () => onSwitch?.(chain.id),
        },
      )
    },
    [activeChainId, close, onSwitch, reset, switchChain],
  )

  const renderRow = (chain: Chain) => {
    const isActive = chain.id === activeChainId
    const live = isLatchDeployedChain(chain.id)
    const switching = isPending && variables?.chainId === chain.id
    return (
      <li key={chain.id} role="none">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={isActive}
          className={cx('latch-chain__row', isActive && 'is-active')}
          onClick={() => select(chain)}
          disabled={isPending}
        >
          <span className="latch-chain__row-name">{shortLabel(chain)}</span>
          <span className="latch-chain__row-id">{chain.id}</span>
          {live ? null : (
            <span className="latch-chain__row-tag" title="No Latch contracts on this chain yet">
              target
            </span>
          )}
          {switching ? <span className="latch-chain__row-state">switching…</span> : null}
        </button>
      </li>
    )
  }

  const mainnets = listed.filter((c) => c.testnet !== true)
  const testnets = listed.filter((c) => c.testnet === true)

  return (
    <div ref={rootRef} className={cx('latch-chain', className)}>
      <button
        type="button"
        className={cx('latch-chain__trigger', unsupported && 'is-error')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        disabled={!isConnected}
      >
        <span
          className={cx(
            'latch-dot',
            unsupported ? 'latch-dot--error' : active && isLatchDeployedChain(active.id)
              ? 'latch-dot--success'
              : 'latch-dot--warning',
          )}
          aria-hidden="true"
        />
        <span className="latch-chain__trigger-label">
          {!isConnected
            ? 'No wallet'
            : unsupported
              ? 'Unsupported network'
              : (active?.name ?? 'Unknown network')}
        </span>
        <span className="latch-chain__caret" aria-hidden="true" />
      </button>

      {open ? (
        <ul id={menuId} className="latch-chain__menu" role="menu" aria-label="Switch network">
          {grouped ? (
            <>
              {mainnets.length > 0 ? (
                <li role="none" className="latch-chain__group">
                  Mainnet
                </li>
              ) : null}
              {mainnets.map(renderRow)}
              {testnets.length > 0 ? (
                <li role="none" className="latch-chain__group">
                  Testnet
                </li>
              ) : null}
              {testnets.map(renderRow)}
            </>
          ) : (
            listed.map(renderRow)
          )}
        </ul>
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
