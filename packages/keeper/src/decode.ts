/* ============================================================================
   Pure decoding helpers. No I/O, no clients — everything here is a function of
   its arguments, which is what makes it unit-testable without a chain.
   ============================================================================ */

import { encodeAbiParameters, hexToBigInt, keccak256, size, slice, type Address, type Hex } from 'viem'
import { DISTRIBUTOR_KIND, type DistributorKind } from './abi.js'

/* ------------------------------------------------------------------------- */
/*  Distributor identity                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Map a `kind()` return value onto a distributor. Exact match only. Zero, an
 * unrecognised hash, or a value of the wrong width are all `unknown`, and
 * `unknown` means the caller must refuse — never fall back to a guess.
 */
export function kindFromBytes32(value: unknown): DistributorKind {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) return 'unknown'
  const v = value.toLowerCase()
  if (v === DISTRIBUTOR_KIND.snapshot.toLowerCase()) return 'snapshot'
  if (v === DISTRIBUTOR_KIND.merkle.toLowerCase()) return 'merkle'
  return 'unknown'
}

/* ------------------------------------------------------------------------- */
/*  RevShareHook.getPendingConfig — two shapes in the wild                    */
/* ------------------------------------------------------------------------- */

export type PendingConfigShape = 'legacy' | 'current'

export interface PendingConfig {
  /** Which struct layout the hook returned. Logged so an operator can tell the hooks apart. */
  readonly shape: PendingConfigShape
  /** `0` means no proposal outstanding. */
  readonly effectiveBlock: bigint
  /** `null` on the legacy shape, which has no expiry: a matured proposal there stays armed forever. */
  readonly expiryBlock: bigint | null
}

const WORD = 32
/** (uint48 effectiveBlock, ConfigParams{uint24,uint16,uint16,uint16,address,bool}) — the hooks deployed before proposal expiry existed. */
const LEGACY_WORDS = 7
/** (uint48 effectiveBlock, uint48 expiryBlock, ConfigParams{…}) — current source. */
const CURRENT_WORDS = 8

/**
 * Decode `getPendingConfig` by the LENGTH of what came back, not by an ABI
 * chosen in advance.
 *
 * Decoding the 7-word legacy return through the 8-field ABI does not silently
 * misread — viem throws `PositionOutOfBoundsError` — but a throw on every tick
 * is a job that can never apply a matured proposal on that hook. Decoding the
 * 8-word return through the 7-field ABI WOULD silently misread (`expiryBlock`
 * lands in `feePips`). Switching on length is the only decode that is right on
 * both, and anything that is neither length is refused rather than guessed.
 */
export function decodePendingConfig(data: Hex): PendingConfig {
  const bytes = size(data)
  if (bytes % WORD !== 0) {
    throw new Error(`getPendingConfig returned ${bytes} bytes, which is not a whole number of words`)
  }
  const words = bytes / WORD
  const word = (i: number): bigint => hexToBigInt(slice(data, i * WORD, (i + 1) * WORD))
  if (words === LEGACY_WORDS) {
    return { shape: 'legacy', effectiveBlock: word(0), expiryBlock: null }
  }
  if (words === CURRENT_WORDS) {
    return { shape: 'current', effectiveBlock: word(0), expiryBlock: word(1) }
  }
  throw new Error(
    `getPendingConfig returned ${words} words; this keeper knows the 7-word (legacy) and 8-word (current) shapes only. Refusing to guess at a struct layout it has not seen.`,
  )
}

/* ------------------------------------------------------------------------- */
/*  PoolId                                                                    */
/* ------------------------------------------------------------------------- */

export interface PoolKeyLike {
  readonly currency0: Address
  readonly currency1: Address
  readonly hooks: Address
  readonly poolManager: Address
  readonly fee: number
  readonly parameters: Hex
}

/**
 * `PoolId = keccak256(abi.encode(PoolKey))` — six static words, exactly what
 * `PoolIdLibrary.toId` hashes in core. Computing it locally lets the config
 * loader refuse a target whose `poolId` and `poolKey` disagree, which is the
 * single most damaging config typo: every write takes the KEY, the hook derives
 * the id from it, and a wrong key settles a pool that does not exist — an early
 * return, gas spent, nothing moved, forever.
 */
export function derivePoolId(key: PoolKeyLike): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'bytes32' },
      ],
      [key.currency0, key.currency1, key.hooks, key.poolManager, key.fee, key.parameters],
    ),
  )
}
