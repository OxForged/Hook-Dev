/* ============================================================================
   Pure decoding helpers. No I/O, no clients — everything here is a function of
   its arguments, which is what makes it unit-testable without a chain.
   ============================================================================ */

import {
  decodeAbiParameters,
  encodeAbiParameters,
  hexToBigInt,
  keccak256,
  size,
  slice,
  type Address,
  type Hex,
} from 'viem'
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
/*  RevShareHook.getPendingConfig — THREE shapes, chosen by configuration     */
/* ------------------------------------------------------------------------- */

/*
   block-no-expiry        7 words  (uint48 effectiveBlock, ConfigParams{6})
                          Robinhood 0x23CE…E446 (LTT1/LTT2), Sepolia 0x1C86…BE28
   block-with-expiry      8 words  (uint48 effectiveBlock, uint48 expiryBlock, ConfigParams{6})
                          Robinhood 0xfC00…2aD2
   timestamp-with-expiry  8 words  (uint40 effectiveAt, uint40 expiresAt, ConfigParams{6})
                          the current source (Option B), not deployed yet

   WHY LENGTH IS NO LONGER ENOUGH. This keeper used to decode by the number of
   words that came back. The timestamp build returns 8 words laid out exactly
   like `0xfC00`, and nothing throws when one is read as the other: a unix time
   (~1.79e9) compared against a contract block (~26M) is "not due for decades",
   and a block number compared against a unix time is "expired since 1970".
   Either way a real proposal is never applied — or, worse, is reported wrong.

   So the SHAPE is decided first — by explicit config, by the built-in table
   below, or by a `CLOCK_MODE()` probe — and the word count is then a CHECK
   against that shape, never the thing that decides. Mirrors
   `packages/sdk/src/revshare/pendingConfig.ts`; if they disagree the SDK is the
   reference.
*/

export type PendingConfigShape = 'block-no-expiry' | 'block-with-expiry' | 'timestamp-with-expiry'

/** The unit a stored duration point is in. */
export type DurationClock = 'timestamp' | 'contract-block'

export const PENDING_CONFIG_SHAPES: readonly PendingConfigShape[] = [
  'block-no-expiry',
  'block-with-expiry',
  'timestamp-with-expiry',
]

export function isPendingConfigShape(v: unknown): v is PendingConfigShape {
  return typeof v === 'string' && (PENDING_CONFIG_SHAPES as readonly string[]).includes(v)
}

/** Words `getPendingConfig` returns for each shape. */
export const PENDING_CONFIG_WORDS: Readonly<Record<PendingConfigShape, number>> = {
  'block-no-expiry': 7,
  'block-with-expiry': 8,
  'timestamp-with-expiry': 8,
}

/** The clock each shape stores its points on. */
export const SHAPE_CLOCK: Readonly<Record<PendingConfigShape, DurationClock>> = {
  'block-no-expiry': 'contract-block',
  'block-with-expiry': 'contract-block',
  'timestamp-with-expiry': 'timestamp',
}

/**
 * Hooks whose shape is KNOWN, per chain, lowercase address. Deployed, immutable
 * contracts only — never an address for something not yet on chain. Mirrors
 * `revShareHooks` in the SDK's deployment records; `test/decode.test.mjs`
 * cross-checks the two when the SDK has been built.
 */
export const KNOWN_REVSHARE_HOOK_SHAPES: Readonly<Record<number, Readonly<Record<string, PendingConfigShape>>>> = {
  4663: {
    '0x23ce34e8199927dd270dddd8579c947542bde446': 'block-no-expiry',
    '0xfc00485afb2f9c73bd7f9f5e72d14709233e2ad2': 'block-with-expiry',
  },
  11155111: {
    '0x1c86dc775ff3fdadccf87f132de7a4eb60b6be28': 'block-no-expiry',
  },
}

/** The built-in table's shape for a hook, or `undefined` when this keeper does not know it. */
export function knownHookShape(chainId: number, hook: string): PendingConfigShape | undefined {
  return KNOWN_REVSHARE_HOOK_SHAPES[chainId]?.[hook.toLowerCase()]
}

export interface PendingConfig {
  /** Which struct layout the hook was decoded as. Logged so an operator can tell the hooks apart. */
  readonly shape: PendingConfigShape
  /** The clock `effective` and `expiry` are on. Compare them on THIS clock only. */
  readonly durationClock: DurationClock
  /** `effectiveBlock` or `effectiveAt`. `0` means no proposal outstanding. */
  readonly effective: bigint
  /**
   * `expiryBlock` or `expiresAt`, inclusive. `null` on `block-no-expiry`, which
   * has no expiry: a matured proposal there stays armed until applied or retracted.
   */
  readonly expiry: bigint | null
}

const WORD = 32

/** Number of whole 32-byte words in a return, or throws when it is not whole words. */
export function returnedWords(data: Hex): number {
  const bytes = size(data)
  if (bytes % WORD !== 0) {
    throw new Error(`getPendingConfig returned ${bytes} bytes, which is not a whole number of words`)
  }
  return bytes / WORD
}

/**
 * Decode a raw `getPendingConfig` return AS `shape`.
 *
 * Throws when the length is not what that shape returns. It never tries another
 * shape: a mismatch means the configuration and the chain disagree about this
 * hook, and that is an error worth surfacing, not a layout worth guessing.
 */
export function decodePendingConfig(data: Hex, shape: PendingConfigShape): PendingConfig {
  if (!isPendingConfigShape(shape)) {
    throw new Error(`unknown getPendingConfig shape "${String(shape)}"`)
  }
  const words = returnedWords(data)
  const expected = PENDING_CONFIG_WORDS[shape]
  if (words !== expected) {
    throw new Error(
      `getPendingConfig returned ${words} words but shape ${shape} returns ${expected}. The configured shape and the chain disagree about this hook; refusing to guess a layout.`,
    )
  }
  const word = (i: number): bigint => hexToBigInt(slice(data, i * WORD, (i + 1) * WORD))
  const durationClock = SHAPE_CLOCK[shape]
  if (shape === 'block-no-expiry') {
    return { shape, durationClock, effective: word(0), expiry: null }
  }
  return { shape, durationClock, effective: word(0), expiry: word(1) }
}

/** What a timestamp-clocked Latch contract returns from ERC-6372 `CLOCK_MODE()`. */
export const TIMESTAMP_CLOCK_MODE = 'mode=timestamp'

/**
 * The shape a `CLOCK_MODE()` probe and a return length imply, for a hook no
 * configuration names.
 *
 * @param clockMode the decoded string, or `null` when the call REVERTED (the
 *   block-numbered builds have no such function). A transport failure is
 *   neither and must never be passed as `null`.
 * @returns `undefined` when the combination matches no known build.
 */
export function inferPendingShape(clockMode: string | null, words: number): PendingConfigShape | undefined {
  if (clockMode === TIMESTAMP_CLOCK_MODE) return words === 8 ? 'timestamp-with-expiry' : undefined
  if (clockMode !== null) return undefined
  if (words === 7) return 'block-no-expiry'
  if (words === 8) return 'block-with-expiry'
  return undefined
}

/**
 * Decode a raw `CLOCK_MODE()` return as an ABI `string`, or `undefined` when it
 * is not one (empty, truncated, or garbage). `undefined` is NOT a revert.
 */
export function decodeClockModeReturn(data: Hex | undefined): string | undefined {
  if (data === undefined || data === '0x') return undefined
  try {
    const [s] = decodeAbiParameters([{ type: 'string' }], data)
    return s
  } catch {
    return undefined
  }
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
