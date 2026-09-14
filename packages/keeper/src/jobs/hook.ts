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
   change sits behind the hook's delay (CONFIG_DELAY_BLOCKS on the deployed
   block-numbered hooks, CONFIG_DELAY_SECONDS on the timestamp build) and then
   needs SOMEBODY to apply it.
   The pool owner can, but so can anyone — which is deliberate, so a proposal
   cannot be silently stranded by an owner who proposed it and walked away.
   ============================================================================ */

import { encodeFunctionData } from 'viem'
import { GET_PENDING_CONFIG_ABI, REV_SHARE_HOOK_ABI } from '../abi.js'
import type { PoolKeyConfig, WatchTarget } from '../config.js'
import { pendingPhase } from '../clock.js'
import { decodePendingConfig, returnedWords, type PendingConfig } from '../decode.js'
import { probeClockMode, resolvePendingShape } from '../pendingShape.js'
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

/** A stored point, in its own unit, for a log line. */
function describePoint(p: PendingConfig, value: bigint): string {
  return p.durationClock === 'timestamp'
    ? `${new Date(Number(value) * 1000).toISOString()} (block.timestamp ${value})`
    : `contract block ${value}`
}

export function applyPendingConfigJob(targets: readonly WatchTarget[]): Job {
  return {
    id: 'apply-pending-config',
    describes: 'apply a config change whose delay has elapsed',
    async run(ctx) {
      const out: JobVerdict[] = []
      for (const t of targets) {
        const label = `${t.label} applyPendingConfig`
        try {
          // Called RAW. Three struct shapes exist on chain and two share a length,
          // so the shape is RESOLVED first and the bytes are decoded as that shape.
          const { data } = await ctx.publicClient.call({
            to: t.hook,
            data: encodeFunctionData({ abi: GET_PENDING_CONFIG_ABI, functionName: 'getPendingConfig', args: [t.poolId] }),
          })
          if (!data) {
            out.push(failed(`${label}: getPendingConfig returned no data — is ${t.hook} a RevShareHook on this chain?`))
            continue
          }
          const resolved = await resolvePendingShape({
            chainId: ctx.chainId,
            hook: t.hook,
            configured: t.pendingShape,
            words: returnedWords(data),
            probe: () => probeClockMode(ctx.publicClient, t.hook),
          })
          if (!resolved.ok) {
            // Never a guess: an unidentified layout is skipped and reported, every tick.
            out.push(failed(`${label}: ${resolved.reason}`))
            continue
          }
          const pending = decodePendingConfig(data, resolved.shape)

          // Judged on the clock the hook STORED: `block.timestamp` for the timestamp
          // build, the CONTRACT block number for the block builds. On Robinhood the
          // latter is Ethereum's (~26M) while `ctx.blockNumber` is the L2 head (~62M);
          // against the L2 number every live proposal read as expired. See clock.ts.
          const phase = pendingPhase(pending, { timestamp: ctx.now, contractBlockNumber: ctx.contractBlockNumber })
          if (phase === 'none') {
            out.push(notDue(`${label}: no proposal outstanding`))
            continue
          }
          if (phase === 'not-due') {
            const toGo =
              pending.durationClock === 'timestamp'
                ? `${pending.effective - ctx.now} second(s) to go`
                : `${pending.effective - ctx.contractBlockNumber} contract block(s) to go`
            out.push(notDue(`${label}: proposal lands at ${describePoint(pending, pending.effective)}, ${toGo}`))
            continue
          }
          // A proposal with an expiry has a WINDOW, not a deadline. Past it the call
          // reverts `PendingConfigExpired`: simulating every tick would be pointless.
          // The block-no-expiry hook has none (`expiry === null`): a matured proposal
          // there stays armed until applied or retracted.
          if (phase === 'expired') {
            out.push(
              notDue(`${label}: proposal expired at ${describePoint(pending, pending.expiry ?? 0n)}; the owner has to propose again`),
            )
            continue
          }

          out.push(
            await sendGuarded(
              ctx,
              { address: t.hook, abi: REV_SHARE_HOOK_ABI, functionName: 'applyPendingConfig', args: [tuple(t.poolKey)] },
              `${label} (${pending.shape} hook, shape from ${resolved.source})`,
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
