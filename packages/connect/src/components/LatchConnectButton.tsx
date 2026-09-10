/* ============================================================================
   <LatchConnectButton />

   RainbowKit's `ConnectButton` with Latch chrome.

   Built on `ConnectButton.Custom` rather than styling `ConnectButton` through
   the theme, because the sidebar's wallet control is a specific shape from the
   design spec — 22px avatar, mono address, pulsing status dot — that no theme
   token reaches. `ConnectButton.Custom` is RainbowKit's supported render-prop
   escape hatch: we still get their connection state machine, modal wiring and
   ENS resolution, and only own the markup.

   Every state RainbowKit can be in is handled explicitly. The `unsupported`
   branch matters most: a user connected to a chain the config does not list must
   be sent to the chain modal, never allowed to fall through to a normal
   connected pill, or the app will happily build transactions for a chain with no
   Latch deployment on it.
   ============================================================================ */

import { ConnectButton } from '@rainbow-me/rainbowkit'

export interface LatchConnectButtonProps {
  /**
   * `sidebar` fills its container and matches the dapp sidebar's footer control.
   * `inline` is a compact pill for headers and toolbars.
   */
  readonly variant?: 'sidebar' | 'inline'
  /** Show the current network next to the account. Defaults to false. */
  readonly showChain?: boolean
  /** Show the native balance in the account pill. Defaults to false. */
  readonly showBalance?: boolean
  /** Label for the disconnected state. */
  readonly label?: string
  /** Extra class on the outer element. */
  readonly className?: string
}

function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function LatchConnectButton({
  variant = 'sidebar',
  showChain = false,
  showBalance = false,
  label = 'Connect wallet',
  className,
}: LatchConnectButtonProps) {
  const root = cx('latch-connect', `latch-connect--${variant}`, className)

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        // RainbowKit is not ready until the wagmi store has rehydrated from
        // storage. Rendering the connected state before that flashes
        // "Connect wallet" at an already-connected user on every reload, so the
        // whole tree is hidden — not unmounted — to keep layout stable.
        const ready = mounted && authenticationStatus !== 'loading'
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === 'authenticated')

        return (
          <div
            className={root}
            {...(!ready && {
              'aria-hidden': true,
              style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' },
            })}
          >
            {(() => {
              if (!connected) {
                return (
                  <button
                    type="button"
                    className="latch-connect__btn latch-connect__btn--cta"
                    onClick={openConnectModal}
                  >
                    <span className="latch-connect__plug" aria-hidden="true" />
                    <span className="latch-connect__label">{label}</span>
                  </button>
                )
              }

              if (chain.unsupported) {
                return (
                  <button
                    type="button"
                    className="latch-connect__btn latch-connect__btn--error"
                    onClick={openChainModal}
                  >
                    <span className="latch-dot latch-dot--error" aria-hidden="true" />
                    <span className="latch-connect__label">Wrong network</span>
                    <span className="latch-connect__sr">
                      Connected to an unsupported network. Activate to switch.
                    </span>
                  </button>
                )
              }

              return (
                <>
                  {showChain ? (
                    <button
                      type="button"
                      className="latch-connect__btn latch-connect__btn--chain"
                      onClick={openChainModal}
                    >
                      {chain.hasIcon && chain.iconUrl ? (
                        <img
                          className="latch-connect__chain-icon"
                          src={chain.iconUrl}
                          alt=""
                          style={
                            chain.iconBackground
                              ? { background: chain.iconBackground }
                              : undefined
                          }
                        />
                      ) : (
                        <span className="latch-connect__chain-icon" aria-hidden="true" />
                      )}
                      <span className="latch-connect__chain-name">{chain.name}</span>
                      <span className="latch-connect__sr">Switch network</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="latch-connect__btn latch-connect__btn--account"
                    onClick={openAccountModal}
                  >
                    {account.ensAvatar ? (
                      <img className="latch-connect__avatar" src={account.ensAvatar} alt="" />
                    ) : (
                      <span className="latch-connect__avatar" aria-hidden="true" />
                    )}
                    <span className="latch-connect__address">{account.displayName}</span>
                    {showBalance && account.displayBalance ? (
                      <span className="latch-connect__balance">{account.displayBalance}</span>
                    ) : null}
                    <span
                      className={cx(
                        'latch-dot',
                        account.hasPendingTransactions
                          ? 'latch-dot--pending'
                          : 'latch-dot--success',
                        'latch-dot--pulse',
                      )}
                      aria-hidden="true"
                    />
                    <span className="latch-connect__sr">
                      {account.hasPendingTransactions
                        ? 'Wallet connected, transaction pending. Activate for account details.'
                        : 'Wallet connected. Activate for account details.'}
                    </span>
                  </button>
                </>
              )
            })()}
          </div>
        )
      }}
    </ConnectButton.Custom>
  )
}
