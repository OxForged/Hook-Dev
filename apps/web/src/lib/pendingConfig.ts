/* ============================================================================
   RevShareHook.getPendingConfig — THREE struct shapes on chain, chosen by address.

     block-no-expiry        7 words  (uint48 effectiveBlock, ConfigParams{6})
                            Robinhood 0x23CE34E8…E446 (the LTT1/LTT2 pool), Sepolia 0x1C86dc77…BE28
     block-with-expiry      8 words  (uint48 effectiveBlock, uint48 expiryBlock, ConfigParams{6})
                            Robinhood 0xfC00485A…2aD2
     timestamp-with-expiry  8 words  (uint40 effectiveAt, uint40 expiresAt, ConfigParams{6})
                            the timestamp source (Option B, 2026-09-13), not yet deployed

   This file used to decode by LENGTH: 7 words legacy, 8 words current. That is
   no longer enough. The timestamp hook returns 8 words laid out exactly like
   0xfC00, and reading one through the other throws nothing — a contract block
   around 26 million becomes a 1970 date, a unix time around 1.79 billion
   becomes a block decades away, and an armed proposal renders as dead.

   So the SHAPE comes from the SDK address book (`revShareHookRecord`) by the
   hook's address. Only for a hook the address book does not know is it probed:
   `CLOCK_MODE()` answers "mode=timestamp" only on the timestamp build, and a
   REVERT means a block build — while a TRANSPORT failure means nothing and is
   thrown, never read as a revert. Anything that still matches no known build
   throws; nothing here guesses at a layout.

   `expiry` is `null` on the block-no-expiry shape. That hook has NO expiry: a
   matured proposal stays armed, applicable by anyone, until the owner cancels
   or freezes. Never substitute a number for it (CLAUDE.md hazard item 5).
   ============================================================================ */

import {
  BaseError,
  CallExecutionError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  decodeAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import {
  CLOCK_MODE_CALLDATA,
  contractBlocksToSeconds,
  getContractClock,
  humanDuration,
  decodeRevSharePendingConfig,
  encodeGetPendingConfig,
  inferRevSharePendingShape,
  revShareHookRecord,
  revShareProposalStatus,
  type DecodedRevSharePendingConfig,
  type DurationClock,
  type DurationNow,
  type RevSharePendingShape,
  type RevShareProposalStatus,
} from '@latchprotocol/sdk'

export type PendingConfigShape = RevSharePendingShape
export type DecodedPendingConfig = DecodedRevSharePendingConfig
export type ProposalStatus = RevShareProposalStatus
export type { DurationClock, DurationNow }

export class UnrecognisedPendingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnrecognisedPendingConfigError'
  }
}

/** A contract-level revert, as opposed to the endpoint failing to answer. */
function isExecutionRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false
  return (
    e.walk(
      (x) =>
        x instanceof ExecutionRevertedError ||
        x instanceof ContractFunctionRevertedError ||
        (x instanceof CallExecutionError && /revert/i.test(x.shortMessage)),
    ) !== null
  )
}

/**
 * `CLOCK_MODE()` on a hook the address book does not know. `null` means the call
 * REVERTED (a block-numbered build). Transport failures throw.
 */
async function readClockMode(c: Pick<PublicClient, 'call'>, hook: Address): Promise<string | null> {
  try {
    const { data } = await c.call({ to: hook, data: CLOCK_MODE_CALLDATA })
    if (data === undefined || data === '0x') return null
    const [mode] = decodeAbiParameters([{ type: 'string' }], data)
    return mode
  } catch (e) {
    if (isExecutionRevert(e)) return null
    throw e
  }
}

/**
 * The shape of `hook` on `chainId`: the address book first, a probe second.
 * Throws `UnrecognisedPendingConfigError` when neither identifies a known build.
 */
export async function resolvePendingShape(
  c: Pick<PublicClient, 'call'>,
  chainId: number,
  hook: Address,
  returnedWords: number,
): Promise<PendingConfigShape> {
  const known = revShareHookRecord(chainId, hook)
  if (known !== undefined) return known.pendingShape
  const shape = inferRevSharePendingShape(await readClockMode(c, hook), returnedWords)
  if (shape === undefined) {
    throw new UnrecognisedPendingConfigError(
      `${hook} is not in the address book and its CLOCK_MODE() and ${returnedWords}-word getPendingConfig ` +
        'match no known RevShareHook build. Refusing to guess a layout.',
    )
  }
  return shape
}

/**
 * `getPendingConfig(poolId)`, called raw and decoded as the hook's own shape.
 *
 * Throws on a revert, on no return data, on an unknown shape and on a length
 * that contradicts the shape. Callers must surface a throw — catching it into
 * "no proposal" is exactly the silent drop this module exists to prevent.
 */
export async function readPendingConfig(
  c: Pick<PublicClient, 'call'>,
  chainId: number,
  hook: Address,
  poolId: Hex,
): Promise<DecodedPendingConfig> {
  const { data } = await c.call({ to: hook, data: encodeGetPendingConfig(poolId) })
  if (data === undefined || data === '0x') {
    throw new UnrecognisedPendingConfigError(`getPendingConfig on ${hook} returned no data`)
  }
  const bytes = (data.length - 2) / 2
  const shape = await resolvePendingShape(c, chainId, hook, bytes / 32)
  return decodeRevSharePendingConfig(data, shape)
}

/**
 * Where a proposal stands, on the clock the hook stores:
 *
 *   none      effective == 0
 *   queued    not yet applicable
 *   armed     applicable by anyone right now. On block-no-expiry this is
 *             permanent until the owner cancels or freezes.
 *   expired   past `expiry`: `applyPendingConfig` reverts `PendingConfigExpired`.
 *
 * `now.timestamp` is `block.timestamp` of the latest block. `now.contractBlockNumber`
 * MUST be `block.number` as the hook sees it (`readContractBlockNumber`), never
 * `getBlockNumber()`: on Robinhood the block hooks store Ethereum block numbers
 * (~26M) while the RPC head is the L2 block (~62M).
 */
export function proposalStatus(
  p: Pick<DecodedPendingConfig, 'durationClock' | 'effective' | 'expiry'>,
  now: DurationNow,
): ProposalStatus {
  return revShareProposalStatus(p, now)
}

/**
 * True when `disable()` / `reduceFee()` leave this shape's proposal armed.
 * Only the first, no-expiry hook; both later builds clear it.
 */
export function reductionsLeaveProposalArmed(shape: PendingConfigShape): boolean {
  return shape === 'block-no-expiry'
}

/** A unit label for a stored `effective` / `expiry` value. */
export function clockUnit(clock: DurationClock): string {
  return clock === 'timestamp' ? 'block.timestamp' : 'contract block'
}

/**
 * A stored `effective` / `expiry` value, rendered in its own unit. A timestamp is
 * shown as a UTC date WITH the raw value; a block as a contract block number.
 */
export function formatClockPoint(clock: DurationClock, value: bigint): string {
  if (clock === 'timestamp') {
    const iso = new Date(Number(value) * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
    return `${iso} (block.timestamp ${value.toString()})`
  }
  return `contract block ${value.toString()}`
}

/**
 * A span of `units` on `clock`, in words. Exact for seconds. For contract blocks
 * an ESTIMATE at the chain's real contract cadence, marked with "~", or null
 * when the chain's cadence is not in the address book.
 */
export function formatClockSpan(clock: DurationClock, units: bigint, chainId: number): string | null {
  if (clock === 'timestamp') return humanDuration(Number(units))
  if (getContractClock(chainId) === undefined) return null
  return `~${humanDuration(contractBlocksToSeconds(units, chainId))}`
}
