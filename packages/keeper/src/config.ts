/* ============================================================================
   Configuration.

   Targets come from a JSON file, NOT from code, so adding a pool to watch does
   not require a release. The private key comes from the environment and is
   never read into anything that gets logged or serialised.
   ============================================================================ */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { isAddress, zeroAddress, type Address, type Hex } from 'viem'
import { derivePoolId } from './decode.js'

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
}

export interface KeeperConfig {
  readonly chainId: number
  readonly rpcUrls: readonly string[]
  readonly targets: readonly WatchTarget[]
  /** Job ids to skip. Lets an operator disable one job without a deploy. */
  readonly disabledJobs?: readonly string[]
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

    return {
      label: typeof t['label'] === 'string' ? t['label'] : `target-${i}`,
      poolId: poolId as Hex,
      hook,
      poolKey,
      currencies: parsedCurrencies,
      distributor,
    }
  })

  return {
    chainId,
    rpcUrls: rpcUrls as string[],
    targets,
    ...(Array.isArray(raw['disabledJobs']) ? { disabledJobs: raw['disabledJobs'] as string[] } : {}),
    ...(raw['maxGas'] === undefined ? {} : { maxGas: BigInt(String(raw['maxGas'])) }),
    ...(typeof raw['notes'] === 'string' ? { notes: raw['notes'] } : {}),
    ...(typeof raw['rpcBatch'] === 'boolean' ? { rpcBatch: raw['rpcBatch'] } : {}),
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
