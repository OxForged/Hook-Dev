/* ============================================================================
   Epoch jobs: closeEpoch and rollover.

   Both are permissionless on both distributors. Between them they are the
   reason this keeper exists: without something calling them, an epoch never
   closes and unclaimed funds never return to the next epoch.

   A target whose `distributor` is `null` still gets a verdict from each job.
   "No distributor here" is a state the operator needs to see every tick, and
   the close-epoch job checks it against the hook's own `distributorOf` so a
   distributor added on chain but not in the config is reported, not skipped.
   ============================================================================ */

import { zeroAddress, type Address } from 'viem'
import {
  DISTRIBUTOR_ABI,
  EPOCH,
  MERKLE_EPOCH_ABI,
  REV_SHARE_HOOK_ABI,
  SNAPSHOT_EPOCH_ABI,
  type DistributorKind,
  type EpochTuple,
} from '../abi.js'
import type { WatchTarget } from '../config.js'
import { kindFromBytes32 } from '../decode.js'
import { revertReason, sendGuarded } from './send.js'
import { failed, notDue, type Job, type JobContext, type JobVerdict } from './types.js'

function fmtSeconds(s: bigint): string {
  const n = Number(s)
  if (n < 60) return `${n}s`
  if (n < 3600) return `${Math.round(n / 60)}m`
  if (n < 86400) return `${(n / 3600).toFixed(1)}h`
  return `${(n / 86400).toFixed(1)}d`
}

/**
 * Which distributor is this? Ask it. `kind()` returns one of two
 * domain-separated constants and nothing else is accepted: zero, a revert, an
 * unrecognised hash and empty return data are all `unknown`, and the caller
 * must stop rather than guess — a merkle epoch read through the snapshot ABI
 * decodes without error and returns nonsense.
 *
 * A distributor deployed before `kind()` existed answers `unknown` here too.
 * That is the honest outcome: this keeper does not probe `token()` any more,
 * because any contract with a `token()` getter passes that probe.
 */
async function readKind(ctx: JobContext, address: Address): Promise<{ kind: DistributorKind; detail: string }> {
  try {
    const raw = await ctx.publicClient.readContract({ address, abi: DISTRIBUTOR_ABI, functionName: 'kind' })
    const kind = kindFromBytes32(raw)
    return { kind, detail: kind === 'unknown' ? `kind() returned ${String(raw)}, which is neither constant this keeper knows` : `kind() = ${kind}` }
  } catch (e) {
    return { kind: 'unknown', detail: `kind() did not answer — ${revertReason(e).replace(/\.$/, '')}` }
  }
}

/**
 * Compare the config's idea of the distributor with the hook's. Returns a
 * verdict to report when they disagree, or null when they agree.
 */
async function crossCheckDistributor(ctx: JobContext, t: WatchTarget, label: string): Promise<JobVerdict | null> {
  const onChain = (await ctx.publicClient.readContract({
    address: t.hook,
    abi: REV_SHARE_HOOK_ABI,
    functionName: 'distributorOf',
    args: [t.poolId],
  })) as Address
  const routed = onChain.toLowerCase() !== zeroAddress

  if (t.distributor === null) {
    return routed
      ? failed(`${label}: config says this pool has NO distributor, but the hook routes it to ${onChain}. Epochs there will never close until it is added to the config.`)
      : notDue(`${label}: no distributor — config says none and the hook agrees (distributorOf = 0x0)`)
  }
  if (!routed) {
    return failed(`${label}: config names distributor ${t.distributor}, but the hook routes this pool nowhere (distributorOf = 0x0). Check the config; the keeper will still service the configured contract.`)
  }
  if (onChain.toLowerCase() !== t.distributor.toLowerCase()) {
    return failed(`${label}: config names distributor ${t.distributor}, but the hook now routes to ${onChain}. The configured one is still serviced (its epochs still need closing); add the new one.`)
  }
  return null
}

export function closeEpochJob(targets: readonly WatchTarget[]): Job {
  return {
    id: 'close-epoch',
    describes: 'close an epoch whose minimum duration has elapsed and which has a pot to distribute',
    async run(ctx) {
      const out: JobVerdict[] = []
      for (const t of targets) {
        const label = `${t.label} closeEpoch`
        try {
          const mismatch = await crossCheckDistributor(ctx, t, label)
          if (mismatch) out.push(mismatch)
          if (t.distributor === null) continue

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

          out.push(
            await sendGuarded(ctx, { address: t.distributor, abi: DISTRIBUTOR_ABI, functionName: 'closeEpoch', args: [] }, label),
          )
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
        if (t.distributor === null) {
          out.push(notDue(`${t.label} rollover: no distributor configured for this pool`))
          continue
        }
        const distributor = t.distributor
        try {
          const { kind, detail } = await readKind(ctx, distributor)
          if (kind === 'unknown') {
            out.push(
              failed(
                `${t.label} rollover: could not tell which distributor ${distributor} is — ${detail}. Refusing to guess, because a merkle epoch read through the snapshot ABI decodes silently into nonsense.`,
              ),
            )
            continue
          }
          const epochAbi = kind === 'snapshot' ? SNAPSHOT_EPOCH_ABI : MERKLE_EPOCH_ABI

          const count = (await ctx.publicClient.readContract({
            address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'epochCount',
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
              address: distributor, abi: epochAbi, functionName: 'getEpoch', args: [id],
            })) as EpochTuple

            if (epoch[EPOCH.rolledOver]) continue

            // WHICH CLOCK. On the snapshot distributor `expiresAt` is the only
            // deadline there is. On the merkle distributor an epoch with no
            // root has expiresAt == 0 and is governed by an abandonment
            // fallback that `cancelRoot` can push out — and nothing in
            // `getEpoch` records that it did. `rolloverEligibleAt` is the one
            // view that knows, so it is the only thing worth scheduling on.
            const expiresAt = epoch[EPOCH.expiresAt]
            let eligibleAt: bigint
            let clock: string
            if (kind === 'merkle') {
              eligibleAt = BigInt(
                (await ctx.publicClient.readContract({
                  address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'rolloverEligibleAt', args: [id],
                })) as bigint | number,
              )
              clock = expiresAt === 0n ? 'no root posted; abandonment fallback' : 'claim window'
            } else {
              eligibleAt = expiresAt
              clock = 'claim window'
            }

            if (ctx.now < eligibleAt) {
              out.push(notDue(`${label}: not eligible for another ${fmtSeconds(eligibleAt - ctx.now)} (${clock})`))
              continue
            }

            const unclaimed0 = epoch[EPOCH.amount0] - epoch[EPOCH.claimed0]
            const unclaimed1 = epoch[EPOCH.amount1] - epoch[EPOCH.claimed1]
            if (unclaimed0 === 0n && unclaimed1 === 0n) {
              out.push(notDue(`${label}: eligible but fully claimed — nothing to roll`))
              continue
            }

            out.push(
              await sendGuarded(ctx, { address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'rollover', args: [id] }, label),
            )
          }
        } catch (e) {
          out.push(failed(`${t.label} rollover: could not read distributor — ${revertReason(e)}`))
        }
      }
      return out
    },
  }
}
