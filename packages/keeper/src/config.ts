/* ============================================================================
   Configuration.

   Targets come from a JSON file, NOT from code, so adding a pool to watch does
   not require a release. The private key comes from the environment and is
   never read into anything that gets logged or serialised.
   ============================================================================ */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { isAddress, zeroAddress, type Address, type Hex } from 'viem'
import {
  PENDING_CONFIG_SHAPES,
  isPendingConfigShape,
  derivePoolId,
  type PendingConfigShape,
} from './decode.js'
/* Type-only, so this is erased at runtime and cannot create an import cycle with
   jobs/fees.ts, which imports nothing from here. */
import type { FeeSweepConfig, SweepTarget } from './jobs/fees.js'
import { LAUNCHPAD_DEFAULT_INTERVAL_SECONDS, type LaunchpadV2KeeperConfig } from './jobs/launchpad.js'

/** A PoolKey as core defines it. Needed in full because the writes take one. */
export interface PoolKeyConfig {
  readonly currency0: Address
  readonly currency1: Address
  readonly hooks: Address
  readonly poolManager: Address
  readonly fee: number
  readonly parameters: Hex
}

export interface WatchTarget {
  /** Free-text label used in logs so an operator can tell targets apart. */
  readonly label: string
  readonly poolId: Hex
  readonly poolKey: PoolKeyConfig
  /** The RevShareHook governing this pool. Must equal `poolKey.hooks`. */
  readonly hook: Address
  /**
   * The epoch distributor this pool routes to, or `null` when it has none.
   *
   * EXPLICIT on purpose. An absent key used to mean "skip the epoch jobs", which
   * reads identically to "somebody forgot", and the two produce the same log:
   * nothing. `null` is a statement — "this pool has no distributor and I know
   * it" — and the close-epoch job cross-checks it against `distributorOf` on
   * the hook every tick, so a distributor added on chain and not here is
   * reported rather than silently left to strand epochs.
   */
  readonly distributor: Address | null
  /** Currencies to settle. Must be drawn from the pool's own two. */
  readonly currencies: readonly Address[]
  /**
   * The hook's `getPendingConfig` layout, when the operator states it. Optional:
   * the three deployed hooks are in a built-in table, and an unknown hook is
   * identified by a `CLOCK_MODE()` probe. When given, it is CHECKED against both
   * and a contradiction skips the target rather than decoding. See pendingShape.ts.
   */
  readonly pendingShape?: PendingConfigShape
}

export interface KeeperConfig {
  readonly chainId: number
  readonly rpcUrls: readonly string[]
  readonly targets: readonly WatchTarget[]
  /** Job ids to skip. Lets an operator disable one job without a deploy. */
  readonly disabledJobs?: readonly string[]
  /**
   * Protocol fee sweeps. Absent means the job is not registered at all.
   *
   * `sweep` on the controller is permissionless and pays a stored treasury, so
   * this adds no privilege to the keeper. See jobs/fees.ts.
   */
  readonly feeSweep?: FeeSweepConfig
  /**
   * LaunchpadKitV2 fee plumbing. Absent means no kit v2 job is registered; a
   * `null` address inside it means that one job is not registered. Every call
   * these jobs make is permissionless and pays only fixed recipients - see
   * jobs/launchpad.ts.
   */
  readonly launchpadV2?: LaunchpadV2KeeperConfig
  /**
   * Refuse to send a transaction whose estimated gas exceeds this. A runaway
   * loop in a contract the keeper does not control should cost it one failed
   * check, not a wallet. Enforced in `jobs/send.ts` after a clean simulation.
   */
  readonly maxGas?: bigint
  /** Free text printed at startup. For the operator, never for the code. */
  readonly notes?: string
  /**
   * Fold near-simultaneous reads into one JSON-RPC batch request. Defaults to
   * on; set `false` for an RPC that rejects batch arrays. Rate limits on the
   * public Robinhood RPCs count requests, so this is what makes a tick fit.
   */
  readonly rpcBatch?: boolean
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/
const MAX_UINT24 = 0xffffff

function assertAddress(v: unknown, where: string): Address {
  if (typeof v !== 'string' || !isAddress(v)) {
    throw new Error(`${where}: not an address: ${String(v)}`)
  }
  return v
}

/** An address the keeper will CALL. Zero is a placeholder left in from the example, never a target. */
function assertContract(v: unknown, where: string): Address {
  const a = assertAddress(v, where)
  if (a.toLowerCase() === zeroAddress) {
    throw new Error(`${where}: is the zero address. The example ships with zeros so a copy-paste run fails here, at startup, instead of on every tick.`)
  }
  return a
}

function same(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Read and VALIDATE the target file.
 *
 * Validation is strict on purpose. A keeper runs unattended; a typo in an
 * address should stop it at startup with a clear message, not surface hours
 * later as a transaction sent somewhere unintended — or, worse for this
 * particular contract, as a transaction that succeeds and does nothing.
 */
export function loadConfig(path: string): KeeperConfig {
  const p = resolve(path)
  if (!existsSync(p)) throw new Error(`config not found: ${p}`)
  const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>

  const chainId = Number(raw['chainId'])
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('config: chainId must be a positive integer')

  const rpcUrls = raw['rpcUrls']
  if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) throw new Error('config: rpcUrls must be a non-empty array')
  for (const u of rpcUrls) {
    if (typeof u !== 'string' || !u.startsWith('https://')) {
      throw new Error(`config: rpcUrls must all be https, got: ${String(u)}`)
    }
  }

  const rawTargets = raw['targets']
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) throw new Error('config: targets must be a non-empty array')

  const targets: WatchTarget[] = rawTargets.map((t: Record<string, unknown>, i) => {
    const where = `targets[${i}]`
    const key = t['poolKey'] as Record<string, unknown> | undefined
    if (!key) throw new Error(`${where}: poolKey is required`)

    const poolId = t['poolId']
    if (typeof poolId !== 'string' || !HEX32.test(poolId)) {
      throw new Error(`${where}: poolId must be a 32-byte hex string`)
    }

    const fee = Number(key['fee'])
    if (!Number.isInteger(fee) || fee < 0 || fee > MAX_UINT24) {
      throw new Error(`${where}.poolKey.fee: must be an integer in [0, ${MAX_UINT24}] (uint24)`)
    }
    const parameters = key['parameters']
    if (typeof parameters !== 'string' || !HEX32.test(parameters)) {
      throw new Error(`${where}.poolKey.parameters: must be a 32-byte hex string`)
    }

    const poolKey: PoolKeyConfig = {
      currency0: assertAddress(key['currency0'], `${where}.poolKey.currency0`),
      currency1: assertAddress(key['currency1'], `${where}.poolKey.currency1`),
      hooks: assertContract(key['hooks'], `${where}.poolKey.hooks`),
      poolManager: assertContract(key['poolManager'], `${where}.poolKey.poolManager`),
      fee,
      parameters: parameters as Hex,
    }

    const hook = assertContract(t['hook'], `${where}.hook`)
    if (!same(hook, poolKey.hooks)) {
      throw new Error(
        `${where}: hook (${hook}) differs from poolKey.hooks (${poolKey.hooks}). The hook derives the pool id from the KEY, so a settle sent to one hook with the other's key returns early having done nothing — and the keeper would pay for that on every tick.`,
      )
    }

    // The single most damaging typo, caught at load time. Every write takes the
    // key and the hook hashes it; a key that does not hash to `poolId` names a
    // pool that does not exist on that hook.
    const derived = derivePoolId(poolKey)
    if (derived.toLowerCase() !== poolId.toLowerCase()) {
      throw new Error(
        `${where}: poolId ${poolId} is not keccak256(abi.encode(poolKey)), which is ${derived}. One of the six key fields is wrong — check fee and parameters first, they are the two that are not addresses.`,
      )
    }

    const currencies = t['currencies']
    if (!Array.isArray(currencies) || currencies.length === 0) {
      throw new Error(`${where}: currencies must be a non-empty array`)
    }
    const parsedCurrencies = currencies.map((c, j) => {
      const a = assertAddress(c, `${where}.currencies[${j}]`)
      if (!same(a, poolKey.currency0) && !same(a, poolKey.currency1)) {
        throw new Error(
          `${where}.currencies[${j}]: ${a} is neither currency0 nor currency1 of the pool. pendingBeneficiary for a foreign currency is always zero, so this entry could never do anything.`,
        )
      }
      return a
    })

    // `null` is a decision; absence is not. See the comment on WatchTarget.distributor.
    if (!('distributor' in t)) {
      throw new Error(
        `${where}: distributor is required. Give the epoch distributor's address, or null if this pool has none — say so explicitly, so "none" and "forgotten" cannot look alike.`,
      )
    }
    const distributor = t['distributor'] === null ? null : assertContract(t['distributor'], `${where}.distributor`)

    let pendingShape: PendingConfigShape | undefined
    if ('pendingShape' in t) {
      if (!isPendingConfigShape(t['pendingShape'])) {
        throw new Error(
          `${where}.pendingShape: must be one of ${PENDING_CONFIG_SHAPES.join(', ')}, got ${String(t['pendingShape'])}. Omit it to let the keeper identify the hook.`,
        )
      }
      pendingShape = t['pendingShape']
    }

    return {
      label: typeof t['label'] === 'string' ? t['label'] : `target-${i}`,
      poolId: poolId as Hex,
      hook,
      poolKey,
      currencies: parsedCurrencies,
      distributor,
      ...(pendingShape === undefined ? {} : { pendingShape }),
    }
  })

  /* ---- fee sweeps -------------------------------------------------------
     Optional. Validated as strictly as everything else: a mistyped controller
     or currency here would not fail loudly at runtime — `accrued` on a wrong
     address reverts and the job reports "could not read", which reads like an
     RPC blip rather than a config error. Catch it at startup instead. */
  let feeSweep: FeeSweepConfig | undefined
  const rawSweep = raw['feeSweep'] as Record<string, unknown> | undefined
  if (rawSweep !== undefined) {
    const controller = assertContract(rawSweep['controller'], 'feeSweep.controller')

    const rawTargets = rawSweep['targets']
    if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
      throw new Error('feeSweep.targets must be a non-empty array')
    }

    const sweepTargets: SweepTarget[] = rawTargets.map((t: Record<string, unknown>, i) => {
      const where = `feeSweep.targets[${i}]`
      const label = typeof t['label'] === 'string' && t['label'].length > 0 ? t['label'] : where
      const minRaw = t['minAmount']
      if (minRaw !== undefined && typeof minRaw !== 'string' && typeof minRaw !== 'number') {
        throw new Error(`${where}: minAmount must be a string or number of RAW units`)
      }
      return {
        label,
        poolManager: assertContract(t['poolManager'], `${where}.poolManager`),
        currency: assertAddress(t['currency'], `${where}.currency`),
        ...(minRaw === undefined ? {} : { minAmount: BigInt(String(minRaw)) }),
      }
    })

    /* A floor, not a default. Sweeping is correct at any cadence, but a short
       interval spends a day's revenue on gas — and the point of the job is to
       accumulate before paying. Anything under an hour is a configuration
       mistake worth refusing rather than honouring. */
    const rawInterval = rawSweep['intervalSeconds']
    let intervalSeconds: number | undefined
    if (rawInterval !== undefined) {
      intervalSeconds = Number(rawInterval)
      if (!Number.isFinite(intervalSeconds) || intervalSeconds < 3600) {
        throw new Error(
          `feeSweep.intervalSeconds must be at least 3600 (one hour); got ${String(rawInterval)}`,
        )
      }
    }

    feeSweep = {
      controller,
      targets: sweepTargets,
      ...(intervalSeconds === undefined ? {} : { intervalSeconds }),
    }
  }

  const launchpadV2 = parseLaunchpadV2(raw['launchpadV2'])

  return {
    chainId,
    rpcUrls: rpcUrls as string[],
    targets,
    ...(feeSweep ? { feeSweep } : {}),
    ...(launchpadV2 ? { launchpadV2 } : {}),
    ...(Array.isArray(raw['disabledJobs']) ? { disabledJobs: raw['disabledJobs'] as string[] } : {}),
    ...(raw['maxGas'] === undefined ? {} : { maxGas: BigInt(String(raw['maxGas'])) }),
    ...(typeof raw['notes'] === 'string' ? { notes: raw['notes'] } : {}),
    ...(typeof raw['rpcBatch'] === 'boolean' ? { rpcBatch: raw['rpcBatch'] } : {}),
  }
}

const UINT = /^[0-9]+$/

/** A non-negative integer from a JSON string or number, or a thrown error naming the field. */
function parseUint(v: unknown, where: string): bigint {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : v
  if (typeof s !== 'string' || !UINT.test(s)) throw new Error(`${where}: must be a non-negative integer (string or number), got ${String(v)}`)
  return BigInt(s)
}

/**
 * The optional `launchpadV2` block. Each address is REQUIRED to be present and
 * may be `null` - "not deployed / not watched" is stated, never implied by a
 * missing key (the same rule as `distributor`).
 */
export function parseLaunchpadV2(rawBlock: unknown): LaunchpadV2KeeperConfig | undefined {
  if (rawBlock === undefined) return undefined
  if (rawBlock === null || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) {
    throw new Error('launchpadV2 must be an object')
  }
  const b = rawBlock as Record<string, unknown>
  const addressOrNull = (key: string): Address | null => {
    if (!(key in b)) {
      throw new Error(`launchpadV2.${key} is required: give the address, or null when it is not deployed on this chain.`)
    }
    return b[key] === null ? null : assertContract(b[key], `launchpadV2.${key}`)
  }
  const kit = addressOrNull('kit')
  const clLocker = addressOrNull('clLocker')
  const binLocker = addressOrNull('binLocker')

  const rawIds = b['clTokenIds'] ?? []
  if (!Array.isArray(rawIds)) throw new Error('launchpadV2.clTokenIds must be an array of position token ids')
  const clTokenIds = rawIds.map((v, i) => parseUint(v, `launchpadV2.clTokenIds[${i}]`))

  const clDiscoverFromBlock =
    b['clDiscoverFromBlock'] === undefined ? undefined : parseUint(b['clDiscoverFromBlock'], 'launchpadV2.clDiscoverFromBlock')
  const logChunkBlocks = b['logChunkBlocks'] === undefined ? 10_000n : parseUint(b['logChunkBlocks'], 'launchpadV2.logChunkBlocks')
  if (logChunkBlocks === 0n) throw new Error('launchpadV2.logChunkBlocks must be at least 1')
  if (clLocker === null && (clTokenIds.length > 0 || clDiscoverFromBlock !== undefined)) {
    throw new Error('launchpadV2: clTokenIds / clDiscoverFromBlock are set but clLocker is null, so nothing would use them')
  }

  const intervalSeconds =
    b['intervalSeconds'] === undefined ? LAUNCHPAD_DEFAULT_INTERVAL_SECONDS : Number(b['intervalSeconds'])
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 3600) {
    throw new Error(`launchpadV2.intervalSeconds must be at least 3600 (one hour); got ${String(b['intervalSeconds'])}`)
  }
  const minFlushWei = b['minFlushWei'] === undefined ? undefined : parseUint(b['minFlushWei'], 'launchpadV2.minFlushWei')

  return {
    kit,
    clLocker,
    clTokenIds,
    ...(clDiscoverFromBlock === undefined ? {} : { clDiscoverFromBlock }),
    logChunkBlocks,
    binLocker,
    intervalSeconds,
    ...(minFlushWei === undefined ? {} : { minFlushWei }),
  }
}

/**
 * The signing key, from the environment only.
 *
 * Returns undefined when unset, which is a supported state: the keeper then
 * runs read-only and reports what it WOULD do. That is the default, and it is
 * the mode you want in CI and on a first run against a new config.
 *
 * This value is never logged, never included in an error message, and never
 * written to a file. See CLAUDE.md § Secrets.
 */
export function readPrivateKey(): Hex | undefined {
  const v = process.env['KEEPER_PRIVATE_KEY']
  if (!v) return undefined
  const trimmed = v.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    // Deliberately does not echo the value, not even a prefix.
    throw new Error('KEEPER_PRIVATE_KEY is set but is not a 32-byte hex key')
  }
  return trimmed as Hex
}
