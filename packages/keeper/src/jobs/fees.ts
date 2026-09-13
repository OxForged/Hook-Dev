/* ============================================================================
   Protocol fee sweeps, on a schedule.

   WHY THIS BELONGS IN THE KEEPER AND NOT IN A SAFE AUTOMATION. Accrued protocol
   fees sit in the Vault until somebody calls for them, and the obvious route —
   `LatchProtocolFeeControllerV2.collect`, which names its own recipient — is
   `onlyOwner`. Automating that would mean a scheduled process holding Safe
   signer keys, collapsing a 2-of-3 to a 1-of-1 for a key that can also queue
   `registerApp`. Nobody should trade that for a twice-daily sweep.

   `sweep` exists for exactly this reason and is PERMISSIONLESS. It takes no
   recipient argument: the destination is the controller's stored `treasury`,
   which only the owner can change. So this job keeps the property CLAUDE.md
   requires of everything in this package — "a stolen keeper key buys an
   attacker nothing they could not already do from any address" — because the
   worst a thief achieves here is paying gas to move Latch's revenue into
   Latch's own Safe.

   Do not replace `sweep` with `collect` in this file. That would put a
   privileged call in the keeper, which the package rules forbid.

   THE TWO GUARDS, and why the contract has one of them.

   `collectProtocolFees` on the pool manager returns ZERO rather than reverting
   when nothing has accrued. That is the `settleBeneficiaries` trap recorded in
   CLAUDE.md — a job that "does NOT revert when pointless... will pay gas to do
   nothing forever". `sweep` therefore reverts `NothingToCollect` on an empty
   balance, which turns the check into a free read for anything that simulates
   first, which `sendGuarded` always does.

   The second guard is here rather than on chain: a MINIMUM INTERVAL. Sweeping
   is correct at any cadence, but each sweep costs gas and pays out whatever has
   accumulated, so doing it every five minutes turns a day's revenue into a day
   of gas. Twelve hours is the default. It is tracked in memory, so a restart
   allows one early sweep — harmless, and better than a state file that can
   disagree with the chain.
   ============================================================================ */

import type { Address } from 'viem'

import { FEE_CONTROLLER_ABI } from '../abi.js'
import { sendGuarded } from './send.js'
import { failed, notDue, type Job, type JobContext, type JobVerdict } from './types.js'

/** One (manager, currency) pair to watch. Fees accrue per currency, so sweeps are per currency. */
export interface SweepTarget {
  readonly label: string
  readonly poolManager: Address
  readonly currency: Address
  /**
   * Skip a sweep below this many raw units. Absent means sweep anything.
   *
   * Denominated in the currency's own RAW units, so a 6-decimal token and an
   * 18-decimal one need different numbers — the usual trap. Set it from what
   * the gas costs, not from a round number.
   */
  readonly minAmount?: bigint
}

export interface FeeSweepConfig {
  /** `LatchProtocolFeeControllerV2`. The only address permitted to collect. */
  readonly controller: Address
  readonly targets: readonly SweepTarget[]
  /** Minimum seconds between sweeps of the SAME target. Default 43200 (12h). */
  readonly intervalSeconds?: number
}

const TWELVE_HOURS = 43_200

/**
 * Sweep accrued protocol fees to the treasury, at most once per interval.
 *
 * The keeper's own tick can stay short — every other job needs that — because
 * this one throttles itself per target.
 */
export function sweepProtocolFeesJob(config: FeeSweepConfig): Job {
  const interval = BigInt(config.intervalSeconds ?? TWELVE_HOURS)

  /* Last successful sweep per target, in memory. A restart permits one early
     sweep, which costs a little gas and breaks nothing. The alternative — a
     state file — can disagree with the chain, and a keeper that trusts a stale
     file over a live read is worse than one that occasionally repeats itself. */
  const lastSweptAt = new Map<string, bigint>()

  return {
    id: 'sweep-protocol-fees',
    describes: 'sweep accrued protocol fees to the treasury',

    async run(ctx: JobContext): Promise<JobVerdict[]> {
      const out: JobVerdict[] = []

      for (const target of config.targets) {
        const id = `${target.poolManager}:${target.currency}`
        const label = `${target.label} (${target.currency})`

        const last = lastSweptAt.get(id)
        if (last !== undefined && ctx.now - last < interval) {
          const wait = interval - (ctx.now - last)
          out.push(notDue(`${label}: not due — swept ${ctx.now - last}s ago, ${wait}s to go`))
          continue
        }

        /* Read before simulating. `sweep` would revert on an empty balance and
           `sendGuarded` reports that as "not due", which is correct but says
           nothing useful; reading first lets the log carry the actual number,
           and an operator asking "is this working" wants the number. */
        let accrued: bigint
        try {
          accrued = (await ctx.publicClient.readContract({
            address: config.controller,
            abi: FEE_CONTROLLER_ABI,
            functionName: 'accrued',
            args: [target.poolManager, target.currency],
          })) as bigint
        } catch (e) {
          out.push(failed(`${label}: could not read accrued — ${e instanceof Error ? e.message : String(e)}`))
          continue
        }

        if (accrued === 0n) {
          out.push(notDue(`${label}: not due — nothing accrued`))
          continue
        }

        if (target.minAmount !== undefined && accrued < target.minAmount) {
          out.push(notDue(`${label}: not due — ${accrued} accrued, below the ${target.minAmount} floor`))
          continue
        }

        const verdict = await sendGuarded(
          ctx,
          {
            address: config.controller,
            abi: FEE_CONTROLLER_ABI,
            functionName: 'sweep',
            args: [target.poolManager, target.currency],
          },
          `${label}: sweeping ${accrued}`,
        )

        /* Only a SENT transaction resets the clock. A dry run must not, or a
           keeper left in report-only mode would look throttled while never
           having swept anything. */
        if (verdict.due && verdict.txHash !== undefined) lastSweptAt.set(id, ctx.now)

        out.push(verdict)
      }

      return out
    },
  }
}
