/* ============================================================================
   Epoch jobs: closeEpoch and rollover.

   Both are permissionless on both distributors. Between them they are the
   reason this keeper exists: without something calling them, an epoch never
   closes and unclaimed funds never return to the next epoch. Today nothing
   calls them, so on a live deployment the revenue share simply stops moving
   until a human remembers.
   ============================================================================ */

import type { Address } from 'viem'
import { DISTRIBUTOR_ABI, EPOCH, type EpochTuple } from '../abi.js'
import type { WatchTarget } from '../config.js'
import { type Job, type JobContext, type JobVerdict, failed, notDue } from './types.js'

/** Short revert summary. Viem's messages are long; the first line is the useful part. */
function revertReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const first = msg.split('\n')[0] ?? msg
  return first.replace(/^ContractFunctionExecutionError:\s*/, '').trim()
}

function fmtSeconds(s: bigint): string {
  const n = Number(s)
  if (n < 60) return `${n}s`
  if (n < 3600) return `${Math.round(n / 60)}m`
  if (n < 86400) return `${(n / 3600).toFixed(1)}h`
  return `${(n / 86400).toFixed(1)}d`
}

async function simulateAndMaybeSend(
  ctx: JobContext,
  address: Address,
  functionName: 'closeEpoch' | 'rollover',
  args: readonly unknown[],
  label: string,
): Promise<JobVerdict> {
  try {
    // The guard rail. Every contract-side precondition becomes a free read here
    // rather than a failed transaction: EpochTooSoon, NothingToDistribute,
    // AlreadyRolledOver all surface as a simulation revert.
    const sim = await ctx.publicClient.simulateContract({
      address,
      abi: DISTRIBUTOR_ABI,
      functionName,
      args: args as never,
      ...(ctx.account ? { account: ctx.account } : {}),
    })

    if (!ctx.walletClient || !ctx.account) {
      return { due: true, reason: `${label}: DUE — simulated clean. Dry run, nothing sent.` }
    }

    const hash = await ctx.walletClient.writeContract(sim.request as never)
    return { due: true, reason: `${label}: sent`, txHash: hash }
  } catch (e) {
    // A revert here is the normal, expected outcome most of the time.
    return notDue(`${label}: not due — ${revertReason(e)}`)
  }
}

export function closeEpochJob(targets: readonly WatchTarget[]): Job {
  return {
    id: 'close-epoch',
    describes: 'close an epoch whose minimum duration has elapsed and which has a pot to distribute',
    async run(ctx) {
      const out: JobVerdict[] = []
      for (const t of targets) {
        if (!t.distributor) continue
        const label = `${t.label} closeEpoch`
        try {
          const [lastCloseAt, minDuration, epochCount] = await Promise.all([
            ctx.publicClient.readContract({
              address: t.distributor, abi: DISTRIBUTOR_ABI, functionName: 'lastCloseAt',
            }) as Promise<bigint>,
            ctx.publicClient.readContract({
              address: t.distributor, abi: DISTRIBUTOR_ABI, functionName: 'minEpochDuration',
            }) as Promise<bigint>,
            ctx.publicClient.readContract({
              address: t.distributor, abi: DISTRIBUTOR_ABI, functionName: 'epochCount',
            }) as Promise<bigint>,
          ])

          // Report the wait explicitly rather than letting the simulation say
          // it. "not due" is much more useful to an operator as "not due for 4h".
          if (epochCount > 0n) {
            const earliest = lastCloseAt + minDuration
            if (ctx.now < earliest) {
              out.push(notDue(`${label}: not due for ${fmtSeconds(earliest - ctx.now)} (min epoch duration)`))
              continue
            }
          }

          out.push(await simulateAndMaybeSend(ctx, t.distributor, 'closeEpoch', [], label))
        } catch (e) {
          out.push(failed(`${label}: could not read distributor — ${revertReason(e)}`))
        }
      }
      return out
    },
  }
}

export function rolloverJob(targets: readonly WatchTarget[]): Job {
  return {
    id: 'rollover',
    describes: 'roll an expired epoch’s unclaimed funds into the next one',
    async run(ctx) {
      const out: JobVerdict[] = []
      for (const t of targets) {
        if (!t.distributor) continue
        try {
          const count = (await ctx.publicClient.readContract({
            address: t.distributor, abi: DISTRIBUTOR_ABI, functionName: 'epochCount',
          })) as bigint

          if (count === 0n) {
            out.push(notDue(`${t.label} rollover: no epochs yet`))
            continue
          }

          // Walk from the oldest. An epoch that is already rolled over is
          // skipped without a simulation, so a long history costs reads, not
          // round trips.
          for (let id = 0n; id < count; id++) {
            const label = `${t.label} rollover#${id}`
            const epoch = (await ctx.publicClient.readContract({
              address: t.distributor, abi: DISTRIBUTOR_ABI, functionName: 'getEpoch', args: [id],
            })) as EpochTuple

            if (epoch[EPOCH.rolledOver]) continue

            const expiresAt = epoch[EPOCH.expiresAt]
            if (ctx.now < expiresAt) {
              out.push(notDue(`${label}: claim window open for another ${fmtSeconds(expiresAt - ctx.now)}`))
              continue
            }

            const unclaimed0 = epoch[EPOCH.amount0] - epoch[EPOCH.claimed0]
            const unclaimed1 = epoch[EPOCH.amount1] - epoch[EPOCH.claimed1]
            if (unclaimed0 === 0n && unclaimed1 === 0n) {
              out.push(notDue(`${label}: expired but fully claimed — nothing to roll`))
              continue
            }

            out.push(await simulateAndMaybeSend(ctx, t.distributor, 'rollover', [id], label))
          }
        } catch (e) {
          out.push(failed(`${t.label} rollover: could not read distributor — ${revertReason(e)}`))
        }
      }
      return out
    },
  }
}
