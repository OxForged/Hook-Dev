/* ============================================================================
   Which `getPendingConfig` layout a hook uses — decided BEFORE decoding.

   Resolution order, first match wins:

     1. the target's explicit `pendingShape` in the keeper config;
     2. the built-in table of deployed hooks (`KNOWN_REVSHARE_HOOK_SHAPES`);
     3. a `CLOCK_MODE()` eth_call combined with the returned word count:
          "mode=timestamp" + 8 words   -> timestamp-with-expiry
          REVERTED         + 7 words   -> block-no-expiry
          REVERTED         + 8 words   -> block-with-expiry
          anything else                -> unknown: the target is SKIPPED.

   Two refusals are the point of this file:

   - A TRANSPORT failure on the probe (timeout, rate limit, HTTP 5xx) is not a
     revert. Reading it as one would classify a timestamp hook as
     `block-with-expiry` for exactly as long as the RPC was flaky — and nothing
     would throw. It skips the target for this tick instead.
   - An explicit config shape that CONTRADICTS the chain (the built-in table, the
     word count, or a conclusive probe on the ambiguous 8-word pair) is refused,
     not obeyed. Config wins over discovery; it does not win over evidence.

   Everything here except `probeClockMode` is pure over an injected probe, so the
   decision table is unit-tested without a chain.
   ============================================================================ */

import { BaseError, ExecutionRevertedError, encodeFunctionData, size, type Address, type Hex } from 'viem'
import { CLOCK_MODE_ABI } from './abi.js'
import {
  PENDING_CONFIG_WORDS,
  decodeClockModeReturn,
  inferPendingShape,
  knownHookShape,
  type PendingConfigShape,
} from './decode.js'

export type ClockModeProbe =
  /** The call succeeded and returned an ABI string. */
  | { readonly kind: 'mode'; readonly mode: string }
  /** The EVM reverted: the block-numbered builds have no `CLOCK_MODE()`. */
  | { readonly kind: 'reverted' }
  /** The call succeeded but returned no decodable string (no code, a fallback, garbage). Not a revert. */
  | { readonly kind: 'no-answer'; readonly detail: string }
  /** The RPC did not give an EVM answer at all. Never treated as a revert. */
  | { readonly kind: 'transport'; readonly detail: string }

export type ShapeSource = 'config' | 'built-in table' | 'CLOCK_MODE() probe'

export type ShapeResolution =
  | { readonly ok: true; readonly shape: PendingConfigShape; readonly source: ShapeSource }
  | { readonly ok: false; readonly reason: string }

/**
 * True only for an EVM revert. viem files a node's "execution reverted" (JSON-RPC
 * code 3, or -32000 with that message) under `ExecutionRevertedError`; it ALSO
 * files "gas required exceeds allowance" there, which is a node gas cap and says
 * nothing about whether the function exists, so that is excluded.
 */
export function isExecutionRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false
  if (/gas required exceeds allowance/i.test(e.message)) return false
  const found = e.walk((x) => x instanceof ExecutionRevertedError || (x as { code?: unknown } | null)?.code === 3)
  return found !== null && found !== undefined
}

function shortMessage(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage
  return e instanceof Error ? e.message.split('\n')[0] ?? e.message : String(e)
}

export interface CallClient {
  call(args: { to: Address; data: Hex }): Promise<{ data?: Hex | undefined }>
}

/** Raw `CLOCK_MODE()` eth_call, classified. Never throws. */
export async function probeClockMode(client: CallClient, hook: Address): Promise<ClockModeProbe> {
  let data: Hex | undefined
  try {
    ;({ data } = await client.call({
      to: hook,
      data: encodeFunctionData({ abi: CLOCK_MODE_ABI, functionName: 'CLOCK_MODE' }),
    }))
  } catch (e) {
    return isExecutionRevert(e) ? { kind: 'reverted' } : { kind: 'transport', detail: shortMessage(e) }
  }
  const mode = decodeClockModeReturn(data)
  if (mode !== undefined) return { kind: 'mode', mode }
  return {
    kind: 'no-answer',
    detail: data === undefined || data === '0x' ? 'empty return data' : `${size(data)} bytes that are not an ABI string`,
  }
}

function describeProbe(p: ClockModeProbe): string {
  switch (p.kind) {
    case 'mode':
      return `CLOCK_MODE() = "${p.mode}"`
    case 'reverted':
      return 'CLOCK_MODE() reverted'
    case 'no-answer':
      return `CLOCK_MODE() gave no string (${p.detail})`
    case 'transport':
      return `CLOCK_MODE() probe failed in transport (${p.detail})`
  }
}

function inferFromProbe(p: ClockModeProbe, words: number): PendingConfigShape | undefined {
  if (p.kind === 'mode') return inferPendingShape(p.mode, words)
  if (p.kind === 'reverted') return inferPendingShape(null, words)
  return undefined
}

export interface ResolveShapeInput {
  readonly chainId: number
  readonly hook: Address
  /** The target's explicit `pendingShape`, if the config gives one. */
  readonly configured: PendingConfigShape | undefined
  /** Word count of the raw `getPendingConfig` return. */
  readonly words: number
  /** Called at most once, and only when the answer is needed. */
  readonly probe: () => Promise<ClockModeProbe>
}

export async function resolvePendingShape(input: ResolveShapeInput): Promise<ShapeResolution> {
  const { chainId, hook, configured, words } = input
  const book = knownHookShape(chainId, hook)

  if (configured !== undefined) {
    if (book !== undefined && book !== configured) {
      return {
        ok: false,
        reason: `config says pendingShape "${configured}" but ${hook} on chain ${chainId} is a deployed "${book}" hook. Fix the config; refusing to decode.`,
      }
    }
    const expected = PENDING_CONFIG_WORDS[configured]
    if (words !== expected) {
      return {
        ok: false,
        reason: `config says pendingShape "${configured}" (${expected} words) but getPendingConfig returned ${words} words. Fix the config; refusing to decode.`,
      }
    }
    // Only the 8-word pair is ambiguous by length. Unless the table already
    // vouches for this address, confirm which of the two it is.
    if (book === undefined && words === 8) {
      const p = await input.probe()
      if (p.kind === 'transport') {
        return { ok: false, reason: `could not confirm pendingShape "${configured}": ${describeProbe(p)}. Not read as a revert; retrying next tick.` }
      }
      const inferred = inferFromProbe(p, words)
      if (inferred !== configured) {
        return {
          ok: false,
          reason: `config says pendingShape "${configured}" but ${describeProbe(p)}, which implies ${inferred === undefined ? 'no known shape' : `"${inferred}"`}. Fix the config; refusing to decode.`,
        }
      }
    }
    return { ok: true, shape: configured, source: 'config' }
  }

  if (book !== undefined) {
    const expected = PENDING_CONFIG_WORDS[book]
    if (words !== expected) {
      return {
        ok: false,
        reason: `the built-in table records ${hook} as "${book}" (${expected} words) but getPendingConfig returned ${words} words. Refusing to decode.`,
      }
    }
    return { ok: true, shape: book, source: 'built-in table' }
  }

  const p = await input.probe()
  if (p.kind === 'transport') {
    return { ok: false, reason: `unknown hook ${hook}: ${describeProbe(p)}. Not read as a revert; skipping this tick.` }
  }
  const inferred = inferFromProbe(p, words)
  if (inferred === undefined) {
    return {
      ok: false,
      reason: `unknown hook ${hook}: ${describeProbe(p)} with a ${words}-word getPendingConfig matches no known build. Skipping — set "pendingShape" on the target once the layout is confirmed.`,
    }
  }
  return { ok: true, shape: inferred, source: 'CLOCK_MODE() probe' }
}
