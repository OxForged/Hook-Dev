/* ============================================================================
   LaunchpadKitV2 fee plumbing: three permissionless calls, on a schedule.

   WHAT THEY DO, AND WHY A STOLEN KEEPER KEY STILL BUYS NOTHING

     flushProtocolFees()       kit  -> native launch fees owed to the protocol go
                                       to the kit's IMMUTABLE protocolFeeRecipient
     collectFees(tokenId)      CL locker  -> a locked position's LP fees are pulled
                                       into the locker and CREDITED to that lock's
                                       creator / integrator / protocol, split fixed
                                       at lock time
     collectFees(lockId)       Bin locker -> the same, burning only shares above
                                       each bin's principal

   None takes a recipient. None pays the caller. The worst a thief with this key
   does is pay gas to move launch fees into the Safe, or to credit LP fees to the
   parties they already belong to. Verified in the Solidity; see abi.ts.

   THE GUARDS, one per call, because the three behave differently when idle:

     flushProtocolFees   reverts NothingToClaim           -> read feesOwed first anyway, for the log
     CL collectFees      RETURNS (0, 0) - no revert        -> the settleBeneficiaries trap: simulate
                                                              for the amounts and skip on zero, or
                                                              the keeper pays to credit nothing forever
     Bin collectFees     reverts NothingToCollect          -> read previewCollect first, for the log

   A MINIMUM INTERVAL per target (default 12 h, floor 1 h) stops the keeper
   spending a day's fees on gas: fees are collectable at any cadence, and each
   collection costs the same whether it moves a lot or a little. In memory, like
   the sweep job; a restart permits one early collection.

   Every job here is a NO-OP when its address is not configured: the factory is
   given `null` and returns a job that reports nothing. Kit v2 is not deployed on
   any chain yet; these exist so switching them on is a config edit.
   ============================================================================ */

import type { Address } from 'viem'

import { BIN_LP_LOCKER_KEEPER_ABI, CL_LP_LOCKER_KEEPER_ABI, LAUNCHPAD_KIT_V2_KEEPER_ABI } from '../abi.js'
import { revertReason, sendGuarded } from './send.js'
import { failed, notDue, type Job, type JobContext, type JobVerdict } from './types.js'

export const LAUNCHPAD_DEFAULT_INTERVAL_SECONDS = 43_200
/**
 * `eth_getLogs` requests per tick during CL discovery. A first run from an old
 * block catches up over several ticks instead of spending the RPC's rate limit
 * in one burst; the cursor carries over.
 */
export const MAX_LOG_CHUNKS_PER_TICK = 20

export interface LaunchpadV2KeeperConfig {
  /** `LaunchpadKitV2`. `null`: the flush job is inert. */
  readonly kit: Address | null
  /** `LatchLPLocker`. `null`: the CL collection job is inert. */
  readonly clLocker: Address | null
  /** CL position token ids to collect for. The CL locker has no on-chain enumeration. */
  readonly clTokenIds: readonly bigint[]
  /**
   * L2 block (the LOG clock, `eth_getLogs`) to start discovering `PositionLocked`
   * events from. Absent: only `clTokenIds` are collected.
   */
  readonly clDiscoverFromBlock?: bigint
  /** Blocks per `eth_getLogs` request during discovery. */
  readonly logChunkBlocks: bigint
  /** `LatchBinLPLocker`. `null`: the Bin collection job is inert. Lock ids are `1..lockCount()`. */
  readonly binLocker: Address | null
  /** Minimum seconds between two collections of the same target. */
  readonly intervalSeconds: number
  /** Skip a flush below this many wei. */
  readonly minFlushWei?: bigint
}

/** Per-target throttle, advanced only by a transaction that was actually SENT. */
class Throttle {
  private readonly last = new Map<string, bigint>()
  constructor(private readonly interval: bigint) {}

  /** `null` when due, else the "not due" verdict. */
  check(id: string, label: string, now: bigint): JobVerdict | null {
    const at = this.last.get(id)
    if (at === undefined || now - at >= this.interval) return null
    return notDue(`${label}: not due — collected ${now - at}s ago, ${this.interval - (now - at)}s to go`)
  }

  record(id: string, verdict: JobVerdict, now: bigint): void {
    if (verdict.due && verdict.txHash !== undefined) this.last.set(id, now)
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message.split('\n')[0] ?? e.message : String(e))

/* ------------------------------------------------------------------------- */

export function flushLaunchFeesJob(cfg: Pick<LaunchpadV2KeeperConfig, 'kit' | 'intervalSeconds' | 'minFlushWei'>): Job {
  const throttle = new Throttle(BigInt(cfg.intervalSeconds))
  let recipient: Address | undefined

  return {
    id: 'flush-launch-fees',
    describes: 'send the kit v2 protocol launch fees to its immutable protocol fee recipient',

    async run(ctx: JobContext): Promise<JobVerdict[]> {
      const kit = cfg.kit
      if (kit === null) return []
      const label = `kit ${kit} flushProtocolFees`
      const throttled = throttle.check(kit, label, ctx.now)
      if (throttled) return [throttled]

      let owed: bigint
      try {
        recipient ??= (await ctx.publicClient.readContract({
          address: kit,
          abi: LAUNCHPAD_KIT_V2_KEEPER_ABI,
          functionName: 'protocolFeeRecipient',
        })) as Address
        owed = (await ctx.publicClient.readContract({
          address: kit,
          abi: LAUNCHPAD_KIT_V2_KEEPER_ABI,
          functionName: 'feesOwed',
          args: [recipient],
        })) as bigint
      } catch (e) {
        return [failed(`${label}: could not read feesOwed — ${errText(e)}`)]
      }
      if (owed === 0n) return [notDue(`${label}: not due — nothing owed to ${recipient}`)]
      if (cfg.minFlushWei !== undefined && owed < cfg.minFlushWei) {
        return [notDue(`${label}: not due — ${owed} wei owed, below the ${cfg.minFlushWei} floor`)]
      }

      const verdict = await sendGuarded(
        ctx,
        { address: kit, abi: LAUNCHPAD_KIT_V2_KEEPER_ABI, functionName: 'flushProtocolFees', args: [] },
        `${label}: flushing ${owed} wei to ${recipient}`,
      )
      throttle.record(kit, verdict, ctx.now)
      return [verdict]
    },
  }
}

/* ------------------------------------------------------------------------- */

export function collectCLLockerFeesJob(
  cfg: Pick<LaunchpadV2KeeperConfig, 'clLocker' | 'clTokenIds' | 'clDiscoverFromBlock' | 'logChunkBlocks' | 'intervalSeconds'>,
): Job {
  const throttle = new Throttle(BigInt(cfg.intervalSeconds))
  const tokenIds = new Set<bigint>(cfg.clTokenIds)
  /** Next L2 block to scan for PositionLocked. */
  let cursor = cfg.clDiscoverFromBlock

  return {
    id: 'collect-cl-locker-fees',
    describes: 'collect accrued LP fees of positions locked in LatchLPLocker into their fixed split',

    async run(ctx: JobContext): Promise<JobVerdict[]> {
      const locker = cfg.clLocker
      if (locker === null) return []
      const out: JobVerdict[] = []

      /* Discovery on the LOG clock (ctx.blockNumber = eth_blockNumber). A failed
         chunk leaves the cursor where it was, so nothing is skipped. */
      if (cursor !== undefined) {
        let from: bigint = cursor
        try {
          for (let chunk = 0; chunk < MAX_LOG_CHUNKS_PER_TICK && from <= ctx.blockNumber; chunk++) {
            const last: bigint = from + cfg.logChunkBlocks - 1n
            const to: bigint = last < ctx.blockNumber ? last : ctx.blockNumber
            const logs = await ctx.publicClient.getContractEvents({
              address: locker,
              abi: CL_LP_LOCKER_KEEPER_ABI,
              eventName: 'PositionLocked',
              fromBlock: from,
              toBlock: to,
            })
            for (const log of logs) {
              const id = (log.args as { tokenId?: bigint }).tokenId
              if (id !== undefined) tokenIds.add(id)
            }
            from = to + 1n
          }
        } catch (e) {
          out.push(failed(`CL locker ${locker}: PositionLocked discovery stopped at block ${from} — ${errText(e)}`))
        }
        cursor = from
      }

      if (tokenIds.size === 0) {
        out.push(notDue(`CL locker ${locker}: no locked positions known`))
        return out
      }

      for (const tokenId of [...tokenIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        const id = `${locker}:${tokenId}`
        const label = `CL locker ${locker} position ${tokenId}`
        const throttled = throttle.check(id, label, ctx.now)
        if (throttled) {
          out.push(throttled)
          continue
        }

        /* THE READ. collectFees returns (0, 0) rather than reverting when nothing
           accrued, so the simulation's RESULT is the guard, not its success. */
        let amounts: readonly [bigint, bigint]
        try {
          const sim = await ctx.publicClient.simulateContract({
            address: locker,
            abi: CL_LP_LOCKER_KEEPER_ABI,
            functionName: 'collectFees',
            args: [tokenId],
            ...(ctx.account ? { account: ctx.account } : {}),
          })
          amounts = sim.result as readonly [bigint, bigint]
        } catch (e) {
          out.push(notDue(`${label}: not due — ${revertReason(e)}`))
          continue
        }
        if (amounts[0] === 0n && amounts[1] === 0n) {
          out.push(notDue(`${label}: not due — nothing accrued`))
          continue
        }

        const verdict = await sendGuarded(
          ctx,
          { address: locker, abi: CL_LP_LOCKER_KEEPER_ABI, functionName: 'collectFees', args: [tokenId] },
          `${label}: collecting ${amounts[0]} / ${amounts[1]} (currency0 / currency1, raw units)`,
        )
        throttle.record(id, verdict, ctx.now)
        out.push(verdict)
      }
      return out
    },
  }
}

/* ------------------------------------------------------------------------- */

export function collectBinLockerFeesJob(cfg: Pick<LaunchpadV2KeeperConfig, 'binLocker' | 'intervalSeconds'>): Job {
  const throttle = new Throttle(BigInt(cfg.intervalSeconds))

  return {
    id: 'collect-bin-locker-fees',
    describes: 'harvest fee growth above principal of locks in LatchBinLPLocker into their fixed split',

    async run(ctx: JobContext): Promise<JobVerdict[]> {
      const locker = cfg.binLocker
      if (locker === null) return []

      let count: bigint
      try {
        count = (await ctx.publicClient.readContract({
          address: locker,
          abi: BIN_LP_LOCKER_KEEPER_ABI,
          functionName: 'lockCount',
        })) as bigint
      } catch (e) {
        return [failed(`Bin locker ${locker}: could not read lockCount — ${errText(e)}`)]
      }
      if (count === 0n) return [notDue(`Bin locker ${locker}: no locks yet`)]

      const out: JobVerdict[] = []
      for (let lockId = 1n; lockId <= count; lockId++) {
        const id = `${locker}:${lockId}`
        const label = `Bin locker ${locker} lock ${lockId}`
        const throttled = throttle.check(id, label, ctx.now)
        if (throttled) {
          out.push(throttled)
          continue
        }

        let burn: readonly bigint[]
        try {
          burn = (await ctx.publicClient.readContract({
            address: locker,
            abi: BIN_LP_LOCKER_KEEPER_ABI,
            functionName: 'previewCollect',
            args: [lockId],
          })) as readonly bigint[]
        } catch (e) {
          out.push(failed(`${label}: could not read previewCollect — ${errText(e)}`))
          continue
        }
        const bins = burn.filter((s) => s > 0n).length
        if (bins === 0) {
          out.push(notDue(`${label}: not due — no bin has fee growth above principal`))
          continue
        }

        const verdict = await sendGuarded(
          ctx,
          { address: locker, abi: BIN_LP_LOCKER_KEEPER_ABI, functionName: 'collectFees', args: [lockId] },
          `${label}: harvesting ${bins} bin(s)`,
        )
        throttle.record(id, verdict, ctx.now)
        out.push(verdict)
      }
      return out
    },
  }
}

/** The jobs a config enables. Empty when kit v2 is not configured at all. */
export function launchpadV2Jobs(cfg: LaunchpadV2KeeperConfig | undefined): Job[] {
  if (cfg === undefined) return []
  return [
    ...(cfg.kit !== null ? [flushLaunchFeesJob(cfg)] : []),
    ...(cfg.clLocker !== null ? [collectCLLockerFeesJob(cfg)] : []),
    ...(cfg.binLocker !== null ? [collectBinLockerFeesJob(cfg)] : []),
  ]
}

