/* ============================================================================
   The dapp's first WRITE path: registering a Latch with LatchHookRegistry.

   Everything a reader needs to trust about this module:

     1. NOTHING HERE INVENTS A RESULT. Every verdict below comes from an
        `eth_call` against a deployed contract. Where the chain cannot be
        reached, the caller gets a thrown error or a `null`, never a guess.

     2. THE PRE-FLIGHT IS THE CONTRACT'S OWN LOGIC, NOT A REIMPLEMENTATION.
        `LatchHookRegistry.register` rejects on six conditions, and re-deriving
        them in TypeScript is how the UI ends up disagreeing with the chain. So:
        the hook's bitmap is read off the hook, and every judgement about that
        bitmap (`isValidBitmap`, `classify`, `takesSwapCut`, `canBlockSwaps`,
        `canTrapLiquidity`, `decodePermissions`) is a call to the registry's own
        pure functions. The final authority is a full `eth_call` simulation of
        `register` itself, whose revert we decode by name.

     3. THE LOCAL CHECKS ARE A COURTESY, NOT A GATE. `validateDraft` mirrors
        `_validateMetadata` so a user is told about an empty name before a round
        trip. The byte limits it compares against are READ FROM THE CONTRACT
        (`MAX_NAME_BYTES` and friends), not hardcoded, so they cannot drift.

   Registration is permissionless, free and has no allowlist — see the NatSpec
   above `register` in packages/registry/src/LatchRegistry.sol. It is also
   IRREVERSIBLE: there is no `unregister`, by design. That is the reason this
   module works so hard to fail before the signature rather than after it.
   ============================================================================ */

import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  type Address,
} from 'viem'

import { registryAbi } from '../../../lib/abi/registry'
import {
  DEPLOYMENTS,
  SEPOLIA_CHAIN_ID,
  capabilityClaims,
  client,
  type RegisteredLatch,
  type RiskClass,
} from '../../../lib/chain'

export const REGISTRY_CHAIN_ID = SEPOLIA_CHAIN_ID
export const REGISTRY_ADDRESS: Address = DEPLOYMENTS[SEPOLIA_CHAIN_ID].registry
export const REGISTRY_CHAIN_NAME = DEPLOYMENTS[SEPOLIA_CHAIN_ID].name

/**
 * The one function on an untrusted hook that the registry calls. Declared here
 * rather than pulled from a build artifact because the hook being registered is
 * a stranger's contract — this is the only part of its ABI we ever assume.
 */
const HOOK_BITMAP_ABI = parseAbi(['function getHooksRegistrationBitmap() view returns (uint16)'])

/**
 * Field order of `ILatchHookRegistry.DecodedPermissions`. Used only to turn the
 * struct the chain returns into an ordered list of names — the booleans are the
 * chain's, never recomputed from the bitmap here.
 */
const CALLBACK_FIELDS = [
  'beforeInitialize',
  'afterInitialize',
  'beforeAddLiquidity',
  'afterAddLiquidity',
  'beforeRemoveLiquidity',
  'afterRemoveLiquidity',
  'beforeSwap',
  'afterSwap',
  'beforeDonate',
  'afterDonate',
  'beforeSwapReturnsDelta',
  'afterSwapReturnsDelta',
  'afterAddLiquidityReturnsDelta',
  'afterRemoveLiquidityReturnsDelta',
] as const

/* ---------------------------------------------------------------------------
   Metadata draft — what the form holds before it becomes calldata.
   --------------------------------------------------------------------------- */

export interface MetadataDraft {
  name: string
  description: string
  sourceURI: string
  auditURI: string
  /** Free text; parsed by `parseChainIds`. The struct field is `uint256[]`. */
  chainIdsText: string
}

export const EMPTY_DRAFT: MetadataDraft = {
  name: '',
  description: '',
  sourceURI: '',
  auditURI: '',
  /* Sepolia — the chain this registry is on and therefore the only claim we can
     make on the submitter's behalf without inventing one. Editable. */
  chainIdsText: String(SEPOLIA_CHAIN_ID),
}

/** The struct `register` takes. Field order matches `HookMetadata`. */
export interface HookMetadataArg {
  name: string
  description: string
  sourceURI: string
  auditURI: string
  chainIds: readonly bigint[]
}

/* ---------------------------------------------------------------------------
   Limits, read off the contract.
   --------------------------------------------------------------------------- */

export interface RegistryLimits {
  maxNameBytes: number
  maxDescriptionBytes: number
  maxUriBytes: number
  maxChains: number
  /** Gas ceiling the registry puts on the untrusted bitmap call. */
  probeGas: bigint
}

/**
 * The registry's own constants. Read rather than hardcoded so a redeploy with
 * different bounds cannot leave the form validating against stale numbers.
 */
export async function readRegistryLimits(): Promise<RegistryLimits> {
  const c = client()
  const call = <T,>(functionName: string) =>
    c.readContract({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: functionName as 'MAX_NAME_BYTES',
    }) as Promise<T>

  const [name, description, uri, chains, probeGas] = await Promise.all([
    call<bigint>('MAX_NAME_BYTES'),
    call<bigint>('MAX_DESCRIPTION_BYTES'),
    call<bigint>('MAX_URI_BYTES'),
    call<bigint>('MAX_CHAINS'),
    call<bigint>('PROBE_GAS'),
  ])

  return {
    maxNameBytes: Number(name),
    maxDescriptionBytes: Number(description),
    maxUriBytes: Number(uri),
    maxChains: Number(chains),
    probeGas,
  }
}

/* ---------------------------------------------------------------------------
   Probing an arbitrary address.
   --------------------------------------------------------------------------- */

export interface HookProbe {
  address: Address
  /** False for an EOA, a typo, or a contract that lives on some other chain. */
  hasCode: boolean
  /** Deployed bytecode length in bytes. 0 when there is no code. */
  codeSize: number
  /** `register` reverts `HookAlreadyRegistered` for these. */
  alreadyRegistered: boolean
  /**
   * False when `getHooksRegistrationBitmap()` reverted, returned nothing, or ran
   * past the registry's probe budget. The registry treats this as fatal, and so
   * must this screen: "permissions unknown" is the one thing it must not imply.
   */
  bitmapReadable: boolean
  /** Null exactly when `bitmapReadable` is false. Never defaulted to 0. */
  permissions: number | null
  /** The registry's `isValidBitmap` — reserved bits clear AND deps satisfied. */
  bitmapValid: boolean
  callbacks: readonly string[]
  risk: RiskClass | null
  takesSwapCut: boolean
  canBlockSwaps: boolean
  canTrapLiquidity: boolean
  claims: readonly string[]
}

/** `0x0003`, the way the registry and the explorer both render a bitmap. */
export function formatBitmap(permissions: number): string {
  return `0x${permissions.toString(16).padStart(4, '0')}`
}

/**
 * Read everything the registry would read, without spending gas.
 *
 * The bitmap call is capped at the registry's own `PROBE_GAS`, so a hook that is
 * a deliberate gas bomb fails here the same way it would fail on chain instead
 * of hanging the RPC — and a hook that only *looks* readable because the browser
 * gave it unlimited gas cannot slip through.
 *
 * Throws if the chain is unreachable. An unreachable RPC and a bad hook are
 * opposite answers and the caller must be able to tell them apart.
 */
export async function probeHook(raw: Address): Promise<HookProbe> {
  const address = getAddress(raw)
  const c = client()

  const [code, alreadyRegistered, probeGas] = await Promise.all([
    c.getCode({ address }),
    c.readContract({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'isRegistered',
      args: [address],
    }) as Promise<boolean>,
    c.readContract({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'PROBE_GAS',
    }) as Promise<bigint>,
  ])

  const hasCode = (code?.length ?? 0) > 2
  const codeSize = hasCode ? (code!.length - 2) / 2 : 0

  const blank: HookProbe = {
    address,
    hasCode,
    codeSize,
    alreadyRegistered,
    bitmapReadable: false,
    permissions: null,
    bitmapValid: false,
    callbacks: [],
    risk: null,
    takesSwapCut: false,
    canBlockSwaps: false,
    canTrapLiquidity: false,
    claims: [],
  }

  if (!hasCode) return blank

  /* Deliberately a raw `eth_call` rather than `readContract`, so the three
     acceptance rules of `_probePermissions` can be applied verbatim: the call
     is capped at the registry's own PROBE_GAS, the return must be exactly one
     32-byte word, and that word must fit in a uint16 — dirty high bits are a
     failure, not a small bitmap. A friendlier decoder here would accept hooks
     the chain rejects. */
  let permissions: number | null = null
  try {
    const returned = await c.call({
      to: address,
      data: encodeFunctionData({ abi: HOOK_BITMAP_ABI, functionName: 'getHooksRegistrationBitmap' }),
      gas: probeGas,
    })
    const word = returned.data
    if (!word || word.length !== 66) return blank
    const value = BigInt(word)
    if (value > 0xffffn) return blank
    permissions = Number(value)
  } catch {
    /* Unreadable is a legitimate verdict about the hook, and the registry
       records it as one. It is NOT reported as a zero bitmap. */
    return blank
  }

  const p = permissions
  const [bitmapValid, risk, cut, block, trap, decoded] = (await Promise.all([
    c.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'isValidBitmap', args: [p] }),
    c.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'classify', args: [p] }),
    c.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'takesSwapCut', args: [p] }),
    c.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'canBlockSwaps', args: [p] }),
    c.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'canTrapLiquidity', args: [p] }),
    c.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'decodePermissions', args: [p] }),
  ])) as [boolean, number, boolean, boolean, boolean, Record<string, boolean>]

  return {
    address,
    hasCode,
    codeSize,
    alreadyRegistered,
    bitmapReadable: true,
    permissions: p,
    bitmapValid,
    callbacks: CALLBACK_FIELDS.filter((f) => decoded?.[f]),
    risk: Number(risk) as RiskClass,
    takesSwapCut: cut,
    canBlockSwaps: block,
    canTrapLiquidity: trap,
    /* One vocabulary with the marketplace. Two components describing one bitmap
       two different ways is how a user ends up trusting a hook the chain would
       have warned them about — see Explorer.tsx. `capabilityClaims` reads only
       the three classifier flags, which is why the narrowing assertion is safe. */
    claims: capabilityClaims({
      takesSwapCut: cut,
      canBlockSwaps: block,
      canTrapLiquidity: trap,
    } as RegisteredLatch),
  }
}

/* ---------------------------------------------------------------------------
   Local validation — mirrors `_validateMetadata`, bounded by chain constants.
   --------------------------------------------------------------------------- */

export type DraftField = 'hook' | 'name' | 'description' | 'sourceURI' | 'auditURI' | 'chainIds'

export interface DraftIssue {
  field: DraftField
  message: string
}

/** The contract bounds BYTES, not characters. A 30-emoji name is not 30 bytes. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export interface ParsedChainIds {
  ids: bigint[]
  error: string | null
}

/** Comma / space separated decimal chain ids. Informational on chain. */
export function parseChainIds(text: string): ParsedChainIds {
  const parts = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const ids: bigint[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return { ids: [], error: `"${part}" is not a decimal chain id.` }
    }
    const value = BigInt(part)
    if (!ids.includes(value)) ids.push(value)
  }
  return { ids, error: null }
}

/** True for a syntactically valid address, checksum or not. */
export function isHookAddressValid(value: string): boolean {
  return isAddress(value.trim(), { strict: false })
}

/**
 * What the form can know without the chain. Never the last word — the
 * simulation is — but it saves a round trip on the obvious mistakes.
 *
 * `limits` is null until the constants have been read; while it is null the
 * length rules are simply not asserted rather than being guessed at.
 */
export function validateDraft(
  hookAddress: string,
  draft: MetadataDraft,
  limits: RegistryLimits | null,
): DraftIssue[] {
  const issues: DraftIssue[] = []
  const trimmed = hookAddress.trim()

  if (trimmed === '') {
    issues.push({ field: 'hook', message: 'Enter the address of the deployed Latch contract.' })
  } else if (!isAddress(trimmed, { strict: false })) {
    issues.push({ field: 'hook', message: 'Not a 20-byte hex address.' })
  } else if (/^0x0{40}$/i.test(trimmed)) {
    issues.push({ field: 'hook', message: 'The registry rejects the zero address.' })
  }

  if (draft.name.trim() === '') {
    issues.push({ field: 'name', message: 'A name is required — the registry reverts EmptyName.' })
  }

  if (limits) {
    const bound = (field: DraftField, label: string, value: string, max: number) => {
      const size = byteLength(value)
      if (size > max) {
        issues.push({
          field,
          message: `${label} is ${size} bytes; the registry's limit is ${max}.`,
        })
      }
    }
    bound('name', 'Name', draft.name, limits.maxNameBytes)
    bound('description', 'Description', draft.description, limits.maxDescriptionBytes)
    bound('sourceURI', 'Source URI', draft.sourceURI, limits.maxUriBytes)
    bound('auditURI', 'Audit URI', draft.auditURI, limits.maxUriBytes)
  }

  const chains = parseChainIds(draft.chainIdsText)
  if (chains.error) {
    issues.push({ field: 'chainIds', message: chains.error })
  } else if (limits && chains.ids.length > limits.maxChains) {
    issues.push({
      field: 'chainIds',
      message: `${chains.ids.length} chain ids; the registry accepts at most ${limits.maxChains}.`,
    })
  }

  return issues
}

/** The draft as the struct `register` takes. Only call once `validateDraft` is clean. */
export function toMetadataArg(draft: MetadataDraft): HookMetadataArg {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    sourceURI: draft.sourceURI.trim(),
    auditURI: draft.auditURI.trim(),
    chainIds: parseChainIds(draft.chainIdsText).ids,
  }
}

/* ---------------------------------------------------------------------------
   Decoding what the chain said no to.
   --------------------------------------------------------------------------- */

export type FailureKind = 'rejected' | 'contract' | 'chain'

export interface DecodedFailure {
  kind: FailureKind
  /** The Solidity custom error name, when the revert carried one. */
  name: string | null
  /** One sentence a Latch author can act on. */
  message: string
  /** The raw error, kept so nothing the chain said is hidden from the reader. */
  detail: string
}

function hex4(value: unknown): string {
  return formatBitmap(Number(value))
}

/**
 * Every custom error `register` can revert with, in the order the function
 * checks them. Anything not listed falls through to the raw name, which is
 * shown verbatim rather than smoothed into a friendly lie.
 */
const ERROR_COPY: Record<string, (args: readonly unknown[]) => string> = {
  ZeroAddress: () =>
    'The registry rejects address(0). Enter the address of a deployed Latch contract.',
  HookAlreadyRegistered: ([hook]) =>
    `${String(hook)} is already listed. Registration happens once and there is deliberately no unregister; ` +
    'if you are its author, a curator can reassign the steward instead.',
  HookHasNoCode: ([hook]) =>
    `There is no contract code at ${String(hook)} on ${REGISTRY_CHAIN_NAME}. That address is an EOA, a typo, ` +
    'or a contract deployed on a different chain.',
  PermissionsUnreadable: ([hook]) =>
    `The registry could not read getHooksRegistrationBitmap() off ${String(hook)}: the call reverted, returned ` +
    'something other than one clean uint16, or ran past the probe gas budget. Core makes the same call when a ' +
    'pool is initialised, so a Latch it cannot read is a Latch it can never back a pool with.',
  ReservedBitsSet: ([permissions]) =>
    `The bitmap ${hex4(permissions)} sets reserved bits 14-15, which ICLHooks does not assign. Core rejects ` +
    'that bitmap at pool initialisation, so the registry will not list it either.',
  PermissionDependencyMissing: ([permissions]) =>
    `The bitmap ${hex4(permissions)} declares a returns-delta permission without the base callback that returns ` +
    'the delta. Add the base callback, or drop the delta bit.',
  InsufficientGasForProbe: ([available, required]) =>
    `Not enough gas remained to give the permission probe its full budget (${String(available)} available, ` +
    `${String(required)} required). Raise the gas limit and try again.`,
  EmptyName: () => 'The registry rejects an empty name.',
  StringTooLong: ([length, maximum]) =>
    `A metadata field is ${String(length)} bytes; the registry's limit for it is ${String(maximum)}.`,
  TooManyChains: ([count, maximum]) =>
    `${String(count)} chain ids were supplied; the registry accepts at most ${String(maximum)}.`,
}

/**
 * Turn a viem/wagmi error into something a Latch author can act on.
 *
 * A revert we can name is reported by name. A revert we cannot is reported as
 * unknown — never as a generic "something went wrong" that hides a real reason,
 * and never smoothed over into a state that looks like success.
 */
export function decodeRegistryFailure(error: unknown): DecodedFailure | null {
  if (!error) return null

  const detail = error instanceof BaseError ? error.shortMessage : String(error)

  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return {
        kind: 'rejected',
        name: 'UserRejectedRequest',
        message: 'You rejected the request in your wallet. Nothing was signed and nothing was submitted.',
        detail,
      }
    }

    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? null
      const args = reverted.data?.args ?? []
      if (name && ERROR_COPY[name]) {
        return { kind: 'contract', name, message: ERROR_COPY[name](args), detail }
      }
      if (name) {
        return {
          kind: 'contract',
          name,
          message: `The registry reverted with ${name}(${args.map(String).join(', ')}).`,
          detail,
        }
      }
      return {
        kind: 'contract',
        name: null,
        message:
          reverted.reason ??
          'The registry reverted without a reason this build can decode. The raw error is below.',
        detail,
      }
    }
  }

  return {
    kind: 'chain',
    name: null,
    message:
      'The simulation could not be completed — the RPC did not answer, or the call failed before it reached ' +
      'the registry. This is not a verdict on the Latch.',
    detail,
  }
}
