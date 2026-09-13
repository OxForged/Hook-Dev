/* ============================================================================
   RevShareHook.getPendingConfig — two struct shapes on chain, one decoder.

     legacy   7 words  (uint48 effectiveBlock, ConfigParams{6})
              Robinhood 0x23CE34E8…E446 (the LTT1/LTT2 pool), Sepolia 0x1C86dc77…BE28
     current  8 words  (uint48 effectiveBlock, uint48 expiryBlock, ConfigParams{6})
              Robinhood 0xfC00485A…2aD2 and the current source

   Confirmed on Robinhood on 2026-09-13 with a raw `cast call` for pool
   0xcb1f…50e8: 224 bytes from the legacy hook, 256 from the current one, and an
   8-field decode of the legacy return failed outright.

   A TYPED ABI IS RIGHT ON EXACTLY ONE OF THEM, and wrong in two different ways:
     · the 7-word return through the 8-field ABI THROWS — so a screen reading the
       LTT1/LTT2 pool could never show its armed proposal, and one that caught
       the throw would drop it silently;
     · the 8-word return through the 7-field ABI decodes WITHOUT ERROR and puts
       `expiryBlock` into `feePips` — a block number printed as a fee.

   So the call is made raw and decoded by the LENGTH of what came back, exactly
   as `decodePendingConfig` in packages/keeper/src/decode.ts does. Any other
   length throws; nothing here guesses at a layout.

   `expiryBlock` is `null` on the legacy shape. That hook has NO expiry: a
   matured proposal stays armed, applicable by anyone, until the owner cancels
   or freezes. Never substitute a number for it — a made-up expiry that has
   passed would render an armed 10% proposal as dead (CLAUDE.md hazard item 5).
   ============================================================================ */

import { decodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from 'viem'

/**
 * Selector-only. The declared return type is never used to decode; it exists
 * so the selector is computed from a signature rather than pasted in.
 */
const GET_PENDING_CONFIG_SELECTOR_ABI = parseAbi([
  'function getPendingConfig(bytes32 poolId) view returns (bytes)',
])

export type PendingConfigShape = 'legacy' | 'current'

export interface DecodedPendingParams {
  feePips: number
  lpDonateBps: number
  beneficiaryBps: number
  distributorBps: number
  distributor: Address
  enabled: boolean
}

export interface DecodedPendingConfig {
  /** Which struct layout the hook returned. */
  shape: PendingConfigShape
  /** 0 means no proposal outstanding. */
  effectiveBlock: bigint
  /** Null on the legacy shape, which has no expiry at all. Never a default. */
  expiryBlock: bigint | null
  params: DecodedPendingParams
}

const WORD = 32
const LEGACY_WORDS = 7
const CURRENT_WORDS = 8

const PARAMS_COMPONENTS = [
  { name: 'feePips', type: 'uint24' },
  { name: 'lpDonateBps', type: 'uint16' },
  { name: 'beneficiaryBps', type: 'uint16' },
  { name: 'distributorBps', type: 'uint16' },
  { name: 'distributor', type: 'address' },
  { name: 'enabled', type: 'bool' },
] as const

const LEGACY_TYPES = [
  {
    type: 'tuple',
    components: [
      { name: 'effectiveBlock', type: 'uint48' },
      { name: 'params', type: 'tuple', components: PARAMS_COMPONENTS },
    ],
  },
] as const

const CURRENT_TYPES = [
  {
    type: 'tuple',
    components: [
      { name: 'effectiveBlock', type: 'uint48' },
      { name: 'expiryBlock', type: 'uint48' },
      { name: 'params', type: 'tuple', components: PARAMS_COMPONENTS },
    ],
  },
] as const

export class UnrecognisedPendingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnrecognisedPendingConfigError'
  }
}

function toParams(p: {
  feePips: number
  lpDonateBps: number
  beneficiaryBps: number
  distributorBps: number
  distributor: Address
  enabled: boolean
}): DecodedPendingParams {
  return {
    feePips: Number(p.feePips),
    lpDonateBps: Number(p.lpDonateBps),
    beneficiaryBps: Number(p.beneficiaryBps),
    distributorBps: Number(p.distributorBps),
    distributor: p.distributor,
    enabled: p.enabled,
  }
}

/** Decode by length. Throws `UnrecognisedPendingConfigError` on anything but 7 or 8 words. */
export function decodePendingConfig(data: Hex): DecodedPendingConfig {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) {
    throw new UnrecognisedPendingConfigError('getPendingConfig returned data that is not whole bytes of hex')
  }
  const bytes = (data.length - 2) / 2
  if (bytes % WORD !== 0) {
    throw new UnrecognisedPendingConfigError(
      `getPendingConfig returned ${bytes} bytes, which is not a whole number of words`,
    )
  }
  const words = bytes / WORD

  if (words === LEGACY_WORDS) {
    const [t] = decodeAbiParameters(LEGACY_TYPES, data)
    return { shape: 'legacy', effectiveBlock: BigInt(t.effectiveBlock), expiryBlock: null, params: toParams(t.params) }
  }
  if (words === CURRENT_WORDS) {
    const [t] = decodeAbiParameters(CURRENT_TYPES, data)
    return {
      shape: 'current',
      effectiveBlock: BigInt(t.effectiveBlock),
      expiryBlock: BigInt(t.expiryBlock),
      params: toParams(t.params),
    }
  }
  throw new UnrecognisedPendingConfigError(
    `getPendingConfig returned ${words} words; this build knows the 7-word (legacy) and 8-word (current) shapes only, and refuses to guess at another.`,
  )
}

/**
 * `getPendingConfig(poolId)`, called raw and decoded by length.
 *
 * Throws on a revert, on no return data, and on an unrecognised length. Callers
 * must surface a throw — catching it into "no proposal" is exactly the silent
 * drop this module exists to prevent.
 */
export async function readPendingConfig(
  c: Pick<PublicClient, 'call'>,
  hook: Address,
  poolId: Hex,
): Promise<DecodedPendingConfig> {
  const { data } = await c.call({
    to: hook,
    data: encodeFunctionData({ abi: GET_PENDING_CONFIG_SELECTOR_ABI, functionName: 'getPendingConfig', args: [poolId] }),
  })
  if (data === undefined || data === '0x') {
    throw new UnrecognisedPendingConfigError(`getPendingConfig on ${hook} returned no data`)
  }
  return decodePendingConfig(data)
}

/**
 * Where a proposal stands at `atBlock`, on either shape.
 *
 *   none      effectiveBlock == 0
 *   queued    effectiveBlock > atBlock
 *   armed     matured and applicable by anyone right now. On the legacy shape
 *             this is permanent until the owner cancels or freezes.
 *   expired   current shape only, atBlock > expiryBlock: `applyPendingConfig`
 *             reverts `PendingConfigExpired`, so it can never land as-is.
 */
export type ProposalStatus = 'none' | 'queued' | 'armed' | 'expired'

export function proposalStatus(p: Pick<DecodedPendingConfig, 'effectiveBlock' | 'expiryBlock'>, atBlock: bigint): ProposalStatus {
  if (p.effectiveBlock === 0n) return 'none'
  if (atBlock < p.effectiveBlock) return 'queued'
  if (p.expiryBlock !== null && atBlock > p.expiryBlock) return 'expired'
  return 'armed'
}
