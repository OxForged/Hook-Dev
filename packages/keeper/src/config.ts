/* ============================================================================
   Configuration.

   Targets come from a JSON file, NOT from code, so adding a pool to watch does
   not require a release. The private key comes from the environment and is
   never read into anything that gets logged or serialised - see `log.ts`.
   ============================================================================ */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { isAddress, type Address, type Hex } from 'viem'

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
  /** The RevShareHook governing this pool. */
  readonly hook: Address
  /** Optional: the epoch distributor, if this pool routes to one. */
  readonly distributor?: Address
  /** Currencies to settle. Normally the pool's two, but kept explicit. */
  readonly currencies: readonly Address[]
}

export interface KeeperConfig {
  readonly chainId: number
  readonly rpcUrls: readonly string[]
  readonly targets: readonly WatchTarget[]
  /** Job ids to skip. Lets an operator disable one job without a deploy. */
  readonly disabledJobs?: readonly string[]
  /**
   * Refuse to send a transaction whose simulated gas exceeds this. A runaway
   * loop in a contract the keeper does not control should cost it one failed
   * check, not a wallet.
   */
  readonly maxGas?: bigint
}

function assertAddress(v: unknown, where: string): Address {
  if (typeof v !== 'string' || !isAddress(v)) {
    throw new Error(`${where}: not an address: ${String(v)}`)
  }
  return v
}

/**
 * Read and VALIDATE the target file.
 *
 * Validation is strict on purpose. A keeper runs unattended; a typo in an
 * address should stop it at startup with a clear message, not surface hours
 * later as a transaction sent somewhere unintended.
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
    if (typeof poolId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(poolId)) {
      throw new Error(`${where}: poolId must be a 32-byte hex string`)
    }
    const currencies = t['currencies']
    if (!Array.isArray(currencies) || currencies.length === 0) {
      throw new Error(`${where}: currencies must be a non-empty array`)
    }
    const target: WatchTarget = {
      label: typeof t['label'] === 'string' ? t['label'] : `target-${i}`,
      poolId: poolId as Hex,
      hook: assertAddress(t['hook'], `${where}.hook`),
      poolKey: {
        currency0: assertAddress(key['currency0'], `${where}.poolKey.currency0`),
        currency1: assertAddress(key['currency1'], `${where}.poolKey.currency1`),
        hooks: assertAddress(key['hooks'], `${where}.poolKey.hooks`),
        poolManager: assertAddress(key['poolManager'], `${where}.poolKey.poolManager`),
        fee: Number(key['fee']),
        parameters: key['parameters'] as Hex,
      },
      currencies: currencies.map((c, j) => assertAddress(c, `${where}.currencies[${j}]`)),
      ...(t['distributor'] === undefined
        ? {}
        : { distributor: assertAddress(t['distributor'], `${where}.distributor`) }),
    }
    return target
  })

  return {
    chainId,
    rpcUrls: rpcUrls as string[],
    targets,
    ...(Array.isArray(raw['disabledJobs']) ? { disabledJobs: raw['disabledJobs'] as string[] } : {}),
    ...(raw['maxGas'] === undefined ? {} : { maxGas: BigInt(String(raw['maxGas'])) }),
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
