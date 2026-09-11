/* ============================================================================
   The one write path the revenue-share screens have.

   `<PermissionlessAction>` is the whole surface's only route to `sendTransaction`,
   and it can only ever call what its caller passes — every call site in these
   four screens passes one of five functions, all permissionless on chain:

     RevShareHook.settleBeneficiaries(key, currency)
     RevShareHook.applyPendingConfig(key)
     RevShareHook.claim(currency, to)
     *EpochDistributor.closeEpoch()
     *EpochDistributor.rollover(epochId)
     SnapshotEpochDistributor.claim(epochId, account)

   Owner-only functions (`configure`, `proposeConfig`, `setBeneficiaries`,
   `freezeConfig`, `postRoot`, `transferPoolOwnership`, …) are rendered as
   STATE by these screens and are deliberately not reachable from here.

   SIMULATE FIRST, ALWAYS — the keeper's rule, for the keeper's reason. Every
   one of these functions is callable by anyone, so each contract defends
   itself by reverting at the wrong moment: `EpochTooSoon`, `AlreadyRolledOver`,
   `NothingToClaim`, `PendingConfigNotDue`. Simulating turns every one of those
   guards into a free `eth_call` whose revert we decode by name, and "not due
   yet, because X" is shown as the ordinary state it is rather than as an
   error. The button is not enabled until the chain has said the call succeeds.

   The simulation runs whether or not a wallet is connected — the guards do not
   depend on the sender, and a visitor deserves to know the state before being
   asked to connect anything.
   ============================================================================ */

import { LatchConnectButton } from '@latchprotocol/connect'
import { useCallback } from 'react'
import type { Abi, Address } from 'viem'
import { useAccount, useSimulateContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import { DEPLOYMENTS } from '../../../lib/chain'
import { REVSHARE_CHAIN_ID, decodeRevShareFailure, explorer } from './revshare'

const CHAIN_NAME = DEPLOYMENTS[REVSHARE_CHAIN_ID].name

export interface PermissionlessActionProps {
  /** Button text. Name the function, not a euphemism for it. */
  label: string
  /** One sentence: what this call does on chain, and who may send it. */
  describes: string
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  /**
   * Set when the call cannot even be attempted — most often because the
   * `PoolKey` could not be resolved from the `PoolId`. The action renders the
   * reason INSTEAD of a button. A button that cannot work is worse than none.
   */
  blocked?: string | null
}

export function PermissionlessAction({
  label,
  describes,
  address,
  abi,
  functionName,
  args,
  blocked = null,
}: PermissionlessActionProps) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()

  const {
    writeContract,
    data: txHash,
    isPending: awaitingSignature,
    error: writeError,
  } = useWriteContract()

  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId: REVSHARE_CHAIN_ID })

  /* Stop simulating once a transaction exists: re-simulating a call that has
     just landed reverts (the epoch is closed, the pot is settled) and would
     paint a red error over a genuine success. */
  const simulationEnabled = blocked === null && !txHash

  const sim = useSimulateContract({
    address,
    abi,
    functionName,
    args: args as never,
    chainId: REVSHARE_CHAIN_ID,
    query: { enabled: simulationEnabled, retry: false, gcTime: 0 },
  })

  const simFailure = decodeRevShareFailure(sim.error)
  const writeFailure = decodeRevShareFailure(writeError)
  const onChain = chainId === REVSHARE_CHAIN_ID
  const ready = Boolean(sim.data) && simulationEnabled

  const submit = useCallback(() => {
    if (!sim.data) return
    writeContract(sim.data.request as never)
  }, [sim.data, writeContract])

  const confirmed = receipt.data?.status === 'success'
  const reverted = receipt.data?.status === 'reverted'

  return (
    <div style={{ marginTop: 12 }}>
      <p className="dapp-microlabel">{label}</p>
      <p className="live-note" style={{ marginTop: 4 }}>
        {describes}
      </p>

      {blocked !== null && (
        <div className="dp-gate dp-gate--warn" style={{ marginTop: 10 }}>
          <p className="dp-gate__title">Cannot be built from this screen</p>
          <p className="dp-gate__body">{blocked}</p>
        </div>
      )}

      {blocked === null && (
        <>
          {/* Pre-flight. One line, and it is a real eth_call every time. */}
          <p
            className={
              sim.isFetching
                ? 'dapp-console__line is-shown'
                : ready
                  ? 'dp-ok'
                  : 'dp-hint dp-hint--err'
            }
            style={{ marginTop: 8 }}
            aria-live="polite"
          >
            {sim.isFetching
              ? 'Simulating against the deployed contract…'
              : ready
                ? 'Simulated clean — the chain accepts this call right now.'
                : (simFailure?.message ??
                  'Not simulated yet.')}
          </p>

          {!ready && simFailure?.name && (
            <p className="dapp-microlabel" style={{ marginTop: 2 }}>
              REVERTED WITH {simFailure.name}
            </p>
          )}

          {!isConnected && (
            <div className="dp-gate" style={{ marginTop: 10 }}>
              <p className="dp-gate__title">Connect a wallet to send it</p>
              <p className="dp-gate__body">
                Anyone may send this transaction — it is permissionless. The simulation above ran
                without a wallet; sending needs one.
              </p>
              <LatchConnectButton variant="inline" label="Connect wallet" />
            </div>
          )}

          {isConnected && !onChain && (
            <div className="dp-gate dp-gate--warn" style={{ marginTop: 10 }}>
              <p className="dp-gate__title">Not deployed on this chain</p>
              <p className="dp-gate__body">
                RevShareHook is deployed on {CHAIN_NAME} and nowhere else — not because your wallet is on the wrong network, but because the hook has not been deployed to the chain you are on. Switching moves you to the only chain where these reads mean anything.
              </p>
              <button
                type="button"
                className="dapp-btn dapp-btn--sm"
                onClick={() => switchChain({ chainId: REVSHARE_CHAIN_ID })}
                disabled={switching}
              >
                {switching ? 'Switching…' : `Switch to ${CHAIN_NAME}`}
              </button>
            </div>
          )}

          {isConnected && onChain && !txHash && (
            <button
              type="button"
              className="dapp-btn dapp-btn--primary dapp-btn--sm"
              style={{ marginTop: 10 }}
              onClick={submit}
              disabled={!ready || awaitingSignature}
            >
              {awaitingSignature ? 'Confirm in your wallet…' : label}
            </button>
          )}

          {writeFailure && (
            <p className="dp-hint dp-hint--err" style={{ marginTop: 8 }}>
              {writeFailure.message}
            </p>
          )}

          {txHash && (
            <div className="dp-tx" style={{ marginTop: 10 }} aria-live="polite">
              <p className="dp-tx__row">
                <span
                  className={
                    confirmed
                      ? 'dapp-dot dapp-dot--success dapp-dot--lg'
                      : reverted
                        ? 'dapp-dot dapp-dot--error dapp-dot--lg'
                        : 'dapp-dot dapp-dot--primary dapp-dot--lg dapp-dot--pulse'
                  }
                  aria-hidden="true"
                />
                {confirmed
                  ? 'Confirmed on chain.'
                  : reverted
                    ? 'Mined, but the transaction reverted. Nothing changed.'
                    : 'Broadcast. Waiting for a receipt — this is not a success yet.'}
              </p>
              <p className="dp-tx__hash">
                <a href={explorer(`tx/${txHash}`)} target="_blank" rel="noopener noreferrer">
                  {txHash}
                </a>
              </p>
              {receipt.isError && (
                <p className="dp-hint dp-hint--err">
                  The receipt could not be fetched. The transaction may still be pending — trust the
                  explorer link above, not this screen.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
