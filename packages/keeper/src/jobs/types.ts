/* ============================================================================
   The job contract.

   Every keeper job is two halves that must stay honest about each other:

     check()    reads chain and decides whether the action is DUE. It may not
                send anything. It returns a reason either way, because "nothing
                happened" is only trustworthy if the keeper can say why.

     execute()  sends the transaction. It is only ever reached after check()
                said due AND the call simulated successfully.

   The simulate-first rule is the whole design. Every function this keeper calls
   is permissionless, which means anyone can call it, which means the contract
   has to defend itself against being called at the wrong moment - and it does,
   by reverting (`EpochTooSoon`, `NothingToDistribute`, `AlreadyRolledOver`).
   A keeper that just fires on a timer would spend gas discovering those guards.
   Simulating first turns every one of them into a free read.
   ============================================================================ */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'

/** Why a job did or did not act. Always populated - silence is not a report. */
export interface JobVerdict {
  /** True when the on-chain preconditions are met AND the call simulated clean. */
  readonly due: boolean
  /** Human sentence. Shown in the log verbatim, so write it for a person. */
  readonly reason: string
  /** Populated when `due` and the run is executing. */
  readonly txHash?: Hex
  /** Set when the job could not reach a verdict at all (RPC down, bad config). */
  readonly error?: string
}

export interface JobContext {
  readonly publicClient: PublicClient
  /** Absent in a dry run. A job MUST treat that as "report only". */
  readonly walletClient?: WalletClient
  /** The keeper's own address. Only ever used as `account` on a simulation. */
  readonly account?: Address
  readonly chainId: number
  readonly now: bigint
  readonly blockNumber: bigint
}

export interface Job {
  /** Stable id, used in logs and to disable a single job from config. */
  readonly id: string
  /** One line, present tense: "close an epoch whose minimum duration has passed". */
  readonly describes: string
  run(ctx: JobContext): Promise<JobVerdict[]>
}

/** A revert during simulation is expected and normal - it means "not due yet". */
export function notDue(reason: string): JobVerdict {
  return { due: false, reason }
}

export function failed(reason: string): JobVerdict {
  return { due: false, reason, error: reason }
}
