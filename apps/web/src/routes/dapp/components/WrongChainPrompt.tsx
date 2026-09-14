/* ============================================================================
   The wallet is on a different chain from the one this build reads.

   READS DO NOT FOLLOW THE WALLET (see state.tsx): every figure on every screen
   is read from ACTIVE_CHAIN_ID. What the wallet's chain decides is where a
   transaction would be SENT, so the mismatch is stated once, in the shell,
   with the one action that resolves it. Nothing renders while disconnected or
   already on the right chain.
   ============================================================================ */

import { useAccount, useSwitchChain } from 'wagmi'

import { CHAIN_ROWS } from '../../../data/chains.ts'
import { ACTIVE_CHAIN_ID, DEPLOYMENTS } from '../../../lib/chain'

export function WrongChainPrompt() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()

  if (!isConnected || chainId === undefined || chainId === ACTIVE_CHAIN_ID) return null

  const active = DEPLOYMENTS[ACTIVE_CHAIN_ID].name
  const walletName = CHAIN_ROWS.find((r) => r.chainId === chainId)?.name ?? `chain ${chainId}`

  return (
    <div className="dapp-content dapp-content--prompt" role="status">
      <section className="dapp-card dp-gate dp-gate--warn">
        <p className="dp-gate__title">Your wallet is on {walletName}; this site reads and writes {active}</p>
        <p className="dp-gate__body">
          Every figure here is read from {active} whatever your wallet is on. A transaction can only be
          sent from {active}, so switch before using any button that writes.
        </p>
        <button
          type="button"
          className="dapp-btn dapp-btn--primary dapp-btn--sm"
          onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID })}
          disabled={isPending}
        >
          {isPending ? 'Switching…' : `Switch wallet to ${active}`}
        </button>
        {error ? <p className="dp-hint dp-hint--err dapp-mt-2">{error.message.split('\n')[0]}</p> : null}
      </section>
    </div>
  )
}
