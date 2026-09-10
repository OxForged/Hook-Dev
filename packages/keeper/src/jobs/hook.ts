/* ============================================================================
   RevShareHook jobs: settleBeneficiaries and applyPendingConfig.

   Both permissionless.

   `settleBeneficiaries` is the one job here that does NOT revert when it is
   pointless — it returns early on a zero pot or an empty roster. That makes it
   the easiest job to waste gas on, so the check reads `pendingBeneficiary`
   first and only simulates when there is genuinely something to settle. A
   simulation that "succeeds" by doing nothing is not a reason to send.

   `applyPendingConfig` is the opposite shape and worth understanding: a config
   change sits behind CONFIG_DELAY_BLOCKS and then needs SOMEBODY to apply it.
   The pool owner can, but so can anyone — which is deliberate, so a proposal
   cannot be silently stranded by an owner who proposed it and walked away.
   ============================================================================ */

import type { Address, Hex } from 'viem'
import { REV_SHARE_HOOK_ABI } from '../abi.js'
import type { PoolKeyConfig, WatchTarget } from '../config.js'
import { type Job, type JobContext, type JobVerdict, failed, notDue } from './types.js'

function revertReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const first = msg.split('\n')[0] ?? msg
  return first.replace(/^ContractFunctionExecutionError:\s*/, '').trim()
}

/** viem wants the PoolKey struct as a positional tuple in this exact order. */
function tuple(k: PoolKeyConfig) {
  return [k.currency0, k.currency1, k.hooks, k.poolManager, k.fee, k.parameters] as const
}

async function send(
  ctx: JobContext,
  address: Address,
  functionName: 'settleBeneficiaries' | 'applyPendingConfig',
  args: readonly unknown[],
  label: string,
): Promise<JobVerdict> {
  try {
    const sim = await ctx.publicClient.simulateContract({
      address,
      abi: REV_SHARE_HOOK_ABI,
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
    return notDue(`${label}: not due — ${revertReason(e)}`)
  }
}

export function settleBeneficiariesJob(targets: readonly WatchTarget[]): Job {
  return {
    id: 'settle-beneficiaries',
    describes: 'push accrued fees out to a pool’s beneficiary roster',
    async run(ctx) {
      const out: JobVerdict[] = []
      for (const t of targets) {
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

            out.push(
              await send(ctx, t.hook, 'settleBeneficiaries', [tuple(t.poolKey), currency], `${label} (${pending} wei)`),
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
          const pending = (await ctx.publicClient.readContract({
            address: t.hook,
            abi: REV_SHARE_HOOK_ABI,
            functionName: 'getPendingConfig',
            args: [t.poolId],
          })) as readonly [readonly [number, unknown]] | readonly [number, unknown]

          // The struct is (uint48 effectiveBlock, ConfigParams params); viem
          // hands it back as a nested tuple. `0` means no proposal outstanding.
          const flat = Array.isArray(pending[0]) ? (pending[0] as readonly unknown[]) : (pending as readonly unknown[])
          const effectiveBlock = BigInt(String(flat[0] ?? 0))

          if (effectiveBlock === 0n) {
            out.push(notDue(`${label}: no proposal outstanding`))
            continue
          }
          if (ctx.blockNumber < effectiveBlock) {
            out.push(
              notDue(`${label}: proposal lands at block ${effectiveBlock}, ${effectiveBlock - ctx.blockNumber} to go`),
            )
            continue
          }

          out.push(await send(ctx, t.hook, 'applyPendingConfig', [tuple(t.poolKey)], label))
        } catch (e) {
          out.push(failed(`${label}: read failed — ${revertReason(e)}`))
        }
      }
      return out
    },
  }
}

export type { Hex }
