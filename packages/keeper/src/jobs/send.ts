/* ============================================================================
   The one path a transaction can take out of this process.

   Every job funnels its write through `sendGuarded`, so the three rules below
   are enforced in exactly one place rather than re-implemented per job:

     1. simulate first — a revert is "not due", never an exception;
     2. estimate second — a clean simulation that needs more than `maxGas` is
        refused and REPORTED, because a permissionless call in a contract the
        keeper does not control should be able to cost it one failed check,
        never a wallet;
     3. send last, and only when a wallet client exists — which it does only
        when BOTH `--execute` and `KEEPER_PRIVATE_KEY` were supplied.
   ============================================================================ */

import type { Abi, Address } from 'viem'
import { failed, notDue, type JobContext, type JobVerdict } from './types.js'

/* Viem revert-message shapes. Declared as constants so the helper below reads as intent. */
const NAMED_ERROR = /^Error:\s*[A-Za-z_]\w*\s*\(/
const ERROR_PREFIX = /^Error:\s*/
const SIG_HEADER = /reverted with the following signature/i
const SELECTOR = /^0x[0-9a-fA-F]{8}$/
const EXEC_PREFIX = /^ContractFunctionExecutionError:\s*/

/**
 * A one-line revert summary an operator can act on.
 *
 * Viem's messages run to several paragraphs, and the FIRST line is often the
 * least useful part: "reverted with the following signature:" with the
 * signature itself on the NEXT line. A keeper that logs only line one prints a
 * sentence that stops mid-thought, which is exactly what this did against the
 * live pool.
 *
 * Prefer the decoded custom-error name; fall back to the raw 4-byte selector,
 * which is still enough to look up; only then to the first line.
 */
export function revertReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean)

  const named = lines.find((l) => NAMED_ERROR.test(l))
  if (named) return named.replace(ERROR_PREFIX, '')

  const sigIdx = lines.findIndex((l) => SIG_HEADER.test(l))
  if (sigIdx >= 0) {
    const sig = lines[sigIdx + 1]
    if (sig && SELECTOR.test(sig)) return `reverted, undecoded selector ${sig}`
  }

  const first = lines[0] ?? msg
  return first.replace(EXEC_PREFIX, '').trim()
}

export interface GuardedCall {
  readonly address: Address
  readonly abi: Abi
  readonly functionName: string
  readonly args: readonly unknown[]
}

export async function sendGuarded(ctx: JobContext, call: GuardedCall, label: string): Promise<JobVerdict> {
  let request: unknown
  try {
    const sim = await ctx.publicClient.simulateContract({
      address: call.address,
      abi: call.abi,
      functionName: call.functionName,
      args: call.args as never,
      ...(ctx.account ? { account: ctx.account } : {}),
    })
    request = sim.request
  } catch (e) {
    // A revert here is the normal, expected outcome most of the time.
    return notDue(`${label}: not due — ${revertReason(e)}`)
  }

  if (ctx.maxGas !== undefined) {
    let gas: bigint
    try {
      gas = await ctx.publicClient.estimateContractGas({
        address: call.address,
        abi: call.abi,
        functionName: call.functionName,
        args: call.args as never,
        ...(ctx.account ? { account: ctx.account } : {}),
      })
    } catch (e) {
      return failed(`${label}: simulated clean but gas estimation failed — ${revertReason(e)}. Not sending.`)
    }
    if (gas > ctx.maxGas) {
      return failed(`${label}: simulated clean but needs ${gas} gas, over maxGas ${ctx.maxGas}. Refusing to send; raise maxGas only after reading why.`)
    }
  }

  if (!ctx.walletClient || !ctx.account) {
    return { due: true, reason: `${label}: DUE — simulated clean. Dry run, nothing sent.` }
  }

  try {
    const hash = await ctx.walletClient.writeContract(request as never)
    return { due: true, reason: `${label}: sent`, txHash: hash }
  } catch (e) {
    // Reaching here means the call was due and simulated, and the SEND failed
    // (nonce, gas price, RPC). That is an error, not "not due" — it must show
    // up in the failure count, or a broken sender looks like an idle keeper.
    return failed(`${label}: due, but sending failed — ${revertReason(e)}`)
  }
}
