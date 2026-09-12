/* ============================================================================
   RevShareHook jobs: settleBeneficiaries and applyPendingConfig.

   Both permissionless.

   `settleBeneficiaries` is the one job here that does NOT revert when it is
   pointless — it returns early on a zero pot AND on an empty roster. That makes
   it the easiest job to waste gas on, so the check reads BOTH guards
   (`pendingBeneficiary` and `totalWeight`) first and only simulates when there
   is genuinely something to settle and somebody to settle it to. A simulation
   that "succeeds" by doing nothing is not a reason to send.

   `applyPendingConfig` is the opposite shape and worth understanding: a config
   change sits behind CONFIG_DELAY_BLOCKS and then needs SOMEBODY to apply it.
   The pool owner can, but so can anyone — which is deliberate, so a proposal
   cannot be silently stranded by an owner who proposed it and walked away.
   ============================================================================ */

import { encodeFunctionData } from 'viem'
import { GET_PENDING_CONFIG_ABI, REV_SHARE_HOOK_ABI } from '../abi.js'
import type { PoolKeyConfig, WatchTarget } from '../config.js'
import { decodePendingConfig } from '../decode.js'
import { revertReason, sendGuarded } from './send.js'
import { failed, notDue, type Job, type JobVerdict } from './types.js'

/** viem wants the PoolKey struct as a positional tuple in this exact order. */
function tuple(k: PoolKeyConfig) {
  return [k.currency0, k.currency1, k.hooks, k.poolManager, k.fee, k.parameters] as const
}

export function settleBeneficiariesJob(targets: readonly WatchTarget[]): Job {
  return {
    id: 'settle-beneficiaries',
    describes: 'push accrued fees out to a pool’s beneficiary roster',
    async run(ctx) {
      const out: JobVerdict[] = []
      for (const t of targets) {
        // One read per target, not per currency: the roster is per pool.
        let totalWeight: bigint
        try {
          totalWeight = (await ctx.publicClient.readContract({
            address: t.hook,
            abi: REV_SHARE_HOOK_ABI,
            functionName: 'totalWeight',
            args: [t.poolId],
          })) as bigint
        } catch (e) {
          out.push(failed(`${t.label} settle: could not read totalWeight — ${revertReason(e)}`))
          continue
        }

        for (const currency of t.currencies) {
          const label = `${t.label} settle ${currency.slice(0, 8)}…`
          try {
            const pending = (await ctx.publicClient.readContract({
              address: t.hook,
              abi: REV_SHARE_HOOK_ABI,
              functionName: 'pendingBeneficiary',
              args: [t.poolId, currency],
            })) as bigint

            // The important check. `settleBeneficiaries` returns quietly on a
            // zero pot, so without this the keeper would happily pay gas to do
            // nothing, forever, on every tick.
            if (pending === 0n) {
              out.push(notDue(`${label}: nothing pending`))
              continue
            }

            // The SECOND early return. A pot with nobody on the roster is not
            // settleable and simulating it "succeeds". Nothing the keeper can
            // do fixes this — only the pool owner can set a roster — so say so
            // loudly instead of sending.
            if (totalWeight === 0n) {
              out.push(
                failed(
                  `${label}: ${pending} wei pending but the roster is EMPTY (totalWeight = 0). settleBeneficiaries would return without moving anything. Needs the pool owner to call setBeneficiaries; not something this keeper can or should do.`,
                ),
              )
              continue
            }

            out.push(
              await sendGuarded(
                ctx,
                { address: t.hook, abi: REV_SHARE_HOOK_ABI, functionName: 'settleBeneficiaries', args: [tuple(t.poolKey), currency] },
                `${label} (${pending} wei, roster weight ${totalWeight})`,
              ),
            )
          } catch (e) {
            out.push(failed(`${label}: read failed — ${revertReason(e)}`))
          }
        }
      }
      return out
    },
  }
}

export function applyPendingConfigJob(targets: readonly WatchTarget[]): Job {
  return {
    id: 'apply-pending-config',
    describes: 'apply a config change whose timelock delay has elapsed',
    async run(ctx) {
      const out: JobVerdict[] = []
      for (const t of targets) {
        const label = `${t.label} applyPendingConfig`
        try {
          // Called RAW and decoded by length. Two struct shapes exist on chain
          // and a typed ABI is right on exactly one of them; see decode.ts.
          const { data } = await ctx.publicClient.call({
            to: t.hook,
            data: encodeFunctionData({ abi: GET_PENDING_CONFIG_ABI, functionName: 'getPendingConfig', args: [t.poolId] }),
          })
          if (!data) {
            out.push(failed(`${label}: getPendingConfig returned no data — is ${t.hook} a RevShareHook on this chain?`))
            continue
          }
          const pending = decodePendingConfig(data)

          if (pending.effectiveBlock === 0n) {
            out.push(notDue(`${label}: no proposal outstanding`))
            continue
          }
          if (ctx.blockNumber < pending.effectiveBlock) {
            out.push(
              notDue(`${label}: proposal lands at block ${pending.effectiveBlock}, ${pending.effectiveBlock - ctx.blockNumber} to go`),
            )
            continue
          }
          // On the current hook a proposal has a WINDOW, not a deadline. Past
          // `expiryBlock` the call reverts `PendingConfigExpired`, so simulating
          // would still be safe - but it would be a permanent, pointless
          // simulation on every tick for a proposal nobody can ever apply.
          // The legacy hook has no expiry (expiryBlock === null): there a
          // matured proposal stays armed until applied or retracted.
          if (pending.expiryBlock !== null && pending.expiryBlock !== 0n && ctx.blockNumber > pending.expiryBlock) {
            out.push(
              notDue(`${label}: proposal expired at block ${pending.expiryBlock}; the owner has to propose again`),
            )
            continue
          }

          out.push(
            await sendGuarded(
              ctx,
              { address: t.hook, abi: REV_SHARE_HOOK_ABI, functionName: 'applyPendingConfig', args: [tuple(t.poolKey)] },
              `${label} (${pending.shape} hook)`,
            ),
          )
        } catch (e) {
          out.push(failed(`${label}: read failed — ${revertReason(e)}`))
        }
      }
      return out
    },
  }
}
