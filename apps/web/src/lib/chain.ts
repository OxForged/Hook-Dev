import {
  createPublicClient,
  http,
  fallback,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'

import {
  LATCH_DEPLOYMENTS,
  isLatchChainId,
  resolveEndpoints,
  type LatchChainId,
} from '@latchprotocol/sdk'

/**
 * Live reader for the deployed Latch Protocol contracts.
 *
 * This is the real half of the dapp's mock/live seam. Everything here talks to
 * chain; nothing here invents a number. If a read fails it throws, and the caller
 * decides what to show — a screen must never render a fabricated figure as if it
 * came from chain.
 */

/* ============================================================================
   THE ADDRESS BOOK IS NOT DECLARED HERE ANY MORE.

   It lives in `@latchprotocol/sdk` (`packages/sdk/src/deployments/index.ts`)
   and this file RE-EXPORTS it. Forty-odd modules in this app import
   `DEPLOYMENTS`, `DeployedChainId` and `isDeployed` from here, and every one of
   them keeps working unchanged — the names, the fields and the values are
   identical. What changed is where the values come from.

   WHY IT MOVED. The table had already been copied: once into this file, once
   into `packages/create-latch-dex/template/src/config/deployments.ts`, and the
   two had quietly diverged (the template's copy knows nothing of the timelocks,
   the fee controller, the quoters or the descriptor). Meanwhile the published
   SDK — the package whose entire purpose is "install this and integrate" —
   shipped no addresses at all, so an integrator's first task was hand-typing
   twenty hex strings. One table serving all three consumers fixes both halves
   of that at once. The DefiLlama adapters in this repo show the alternative:
   two hand-maintained mirrors and a parity test to catch drift, which detects
   the problem instead of removing it.

   The SDK is MIT and carries only addresses and ABIs, which are facts about a
   public chain rather than derivative works — nothing GPL is pulled in by this
   import.

   WHAT DID NOT MOVE, AND WHY. `IS_TESTNET_BUILD` and `ACTIVE_CHAIN_ID` below
   stay here. They are not facts about a chain; they are this build's decision
   about which chain it serves, read from `import.meta.env` at build time. A
   library that answers "which network am I?" would be answering it for
   consumers who never asked, and every one of them has a different answer.

   REDEPLOYS ARE ONE EDIT, IN THE SDK. `LatchRegistry`, `RevShareHook` and the
   custody timelock are queued for replacement, and the launchpad contracts do
   not exist yet (they read `null`, never a zero address — a zero address is a
   value this app would happily call). Change them there; nothing here needs
   touching.
   ============================================================================ */

export const SEPOLIA_CHAIN_ID = 11155111
export const ROBINHOOD_CHAIN_ID = 4663

/**
 * Every deployed Latch contract, per chain. Re-exported from the SDK — see the
 * note above. The record carries more than this app reads (the pool-manager
 * owner wrappers, the two upstream fee controllers, the governance Safe, and a
 * token table with decimals), which is additive: nothing that used to be here
 * has changed name, type or value.
 */
export const DEPLOYMENTS = LATCH_DEPLOYMENTS

/* ============================================================================
   WHICH NETWORK THIS BUILD IS.

   One build serves one network. `VITE_NETWORK=testnet` produces the Sepolia
   site; anything else produces the mainnet site. Two deployments of the same
   codebase, not one site trying to be both.

   The alternative — shipping every chain everywhere and letting a switcher sort
   it out — is what we had, and it put Sepolia contracts on a page headed
   "mainnet". A testnet address rendered under a mainnet chrome is the same
   class of error as an invented number: it looks authoritative and is not.

   Everything downstream reads ACTIVE_CHAIN_ID. Nothing should import
   SEPOLIA_CHAIN_ID or ROBINHOOD_CHAIN_ID to decide what to READ — those two
   names are for identifying a chain, never for choosing one.
   ============================================================================ */

export const IS_TESTNET_BUILD = import.meta.env['VITE_NETWORK'] === 'testnet'

/** The one chain this build reads and writes. */
export const ACTIVE_CHAIN_ID = IS_TESTNET_BUILD ? SEPOLIA_CHAIN_ID : ROBINHOOD_CHAIN_ID

/** The chains Latch is deployed on. Same union as before, now named by the SDK. */
export type DeployedChainId = LatchChainId

export function isDeployed(chainId: number): chainId is DeployedChainId {
  return isLatchChainId(chainId)
}

/* ============================================================================
   RPC ENDPOINTS ARE ALSO NO LONGER RESTATED HERE.

   This file used to carry its own copy of the ten public endpoints with a
   comment saying it "mirrors" the SDK's probed list. It did mirror it, right up
   until one of them rotted — a mirror is a copy with a promise attached, and
   the promise is the part that fails silently.

   `resolveEndpoints` is the same function the SDK's own transport uses. It puts
   any keyed provider from the environment first and the probed public list
   behind it as a safety net, so nothing here has to know which is which. It is
   called per request rather than snapshotted, because the alternative is a
   build-time freeze of a list whose whole point is that it changes.
   ============================================================================ */

/**
 * One client per chain, cached by chain id.
 *
 * This used to be a single `let cached` with `if (cached) return cached`, which
 * silently IGNORED the `chainId` argument after the first call: ask for Base
 * having already asked for Sepolia and you got Sepolia's client, reading Sepolia
 * addresses, and nothing anywhere said so. That was invisible while exactly one
 * chain was deployed and becomes a wrong-chain read the moment a second is.
 */
const clients = new Map<number, PublicClient>()

/**
 * The endpoints configured for a chain, in the order the fallback tries them.
 *
 * Exposed so the Settings screen can show what the app is ACTUALLY talking to,
 * rather than describing it in prose that drifts from the array.
 */
export function rpcsFor(chainId: DeployedChainId): readonly string[] {
  return resolveEndpoints(chainId)
}

/**
 * The dapp's read client FOR ONE CHAIN.
 *
 * The retry shape is chosen for rate limits, not for flaky networks. `retryCount: 0`
 * per endpoint means a 429 falls straight through to the next provider instead of
 * being retried against the one that just refused; the retries sit on `fallback`, so
 * one pass asks all five before any is asked twice. `rank: false` keeps the measured
 * order and avoids viem's background re-ranking traffic, which would spend the same
 * per-minute budget we are trying to conserve.
 */
export function client(chainId: DeployedChainId = ACTIVE_CHAIN_ID): PublicClient {
  const hit = clients.get(chainId)
  if (hit) return hit

  const urls = resolveEndpoints(chainId)
  if (urls.length === 0) {
    // Louder than returning some other chain's client, which is what the old
    // single-cache version effectively did.
    throw new Error(
      `No RPC endpoints for chain ${chainId}. Add it to CHAIN_RPCS in ` +
        `packages/sdk/src/chains/endpoints.ts — after probing it, which is the ` +
        `standard every URL in that file was held to.`,
    )
  }

  const made = createPublicClient({
    transport: fallback(
      urls.map((u) => http(u, { timeout: 12_000, retryCount: 0 })),
      { rank: false, retryCount: 2 },
    ),
  })
  clients.set(chainId, made)
  return made
}

/* ---------------------------------------------------------------------------
   ABIs — only what is read. Human-readable so they stay auditable inline.
   --------------------------------------------------------------------------- */

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const VAULT = parseAbi([
  'function isAppRegistered(address) view returns (bool)',
  'function reservesOfApp(address, address) view returns (uint256)',
  'function owner() view returns (address)',
])

const FEE_CONTROLLER = parseAbi([
  'function DEFAULT_FEE_PIPS() view returns (uint16)',
  'function MAX_PROTOCOL_FEE() view returns (uint16)',
  'function defaultFee() view returns (bool isSet, uint16 zeroForOne, uint16 oneForZero)',
  'function feesDisabled() view returns (bool)',
  'function guardian() view returns (address)',
  'function owner() view returns (address)',
])

/* The pool manager, not the controller, decides whether the controller is in
   force at all. `protocolFeeController()` is the single slot that settles it,
   and it reads address(0) on Robinhood today. */
const POOL_MANAGER = parseAbi([
  'function protocolFeeController() view returns (address)',
])

/**
 * CL Swap. NOTE: several Latch events collide on topic0 because ProtocolFees is a
 * shared base — 34 declarations, 22 unique signatures. Always scope a log query by
 * the emitting contract address, never by topic0 alone, or CL and Bin activity merge.
 */
const CL_SWAP_EVENT = parseAbi([
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee, uint16 protocolFee)',
])

const REGISTRY = parseAbi([
  'function latchCount() view returns (uint256)',
  'function classify(uint16) pure returns (uint8)',
  'function takesSwapCut(uint16) pure returns (bool)',
  'function canBlockSwaps(uint16) pure returns (bool)',
  'function canTrapLiquidity(uint16) pure returns (bool)',
])

const TIMELOCK = parseAbi(['function getMinDelay() view returns (uint256)'])

/* ---------------------------------------------------------------------------
   Reads
   --------------------------------------------------------------------------- */

export interface ProtocolStatus {
  chainId: number
  chainName: string
  vault: Address
  vaultOwner: Address
  clRegistered: boolean
  binRegistered: boolean
  /**
   * `DEFAULT_FEE_PIPS`, the controller's compiled-in launch default.
   *
   * NOT what any pool charges. Kept because it is what the controller WOULD
   * apply, which is the number that matters the moment it is wired.
   */
  defaultFeePips: number
  /** The controller's live `defaultFee()` storage, which governance can move. */
  configuredFeePips: number
  maxFeePips: number
  feesDisabled: boolean
  /**
   * Whether `CLPoolManager.protocolFeeController()` actually points at our
   * controller. False means the controller is deployed and inert.
   */
  controllerWired: boolean
  /**
   * What a pool initialized right now would actually charge: zero unless the
   * controller is BOTH wired and not disabled.
   *
   * This field exists because the dashboard used to render `DEFAULT_FEE_PIPS`
   * as "the protocol fee" while the activity feed beside it read
   * "0 to protocol" on every swap — both true, flatly contradicting each
   * other, and only one of them answering the question a reader was asking.
   */
  effectiveFeePips: number
  guardian: Address
  blockNumber: bigint
}

/** Live protocol state. Every field is read from chain. */
export async function readProtocolStatus(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<ProtocolStatus> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  const [clReg, binReg, vaultOwner, defFee, configured, maxFee, disabled, wiredTo, guardian, blockNumber] =
    await Promise.all([
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'isAppRegistered', args: [d.clPoolManager] }),
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'isAppRegistered', args: [d.binPoolManager] }),
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'owner' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'DEFAULT_FEE_PIPS' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'defaultFee' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'MAX_PROTOCOL_FEE' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'feesDisabled' }),
      c.readContract({ address: d.clPoolManager, abi: POOL_MANAGER, functionName: 'protocolFeeController' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'guardian' }),
      c.getBlockNumber(),
    ])

  /* `defaultFee()` returns (isSet, zeroForOne, oneForZero). An unset config
     packs to zero regardless of the compiled default, so isSet is load-bearing
     rather than decorative. The two directions can differ; the UI shows one
     number, so take the larger — understating what a trader might pay is the
     worse of the two errors. */
  const [isSet, zeroForOne, oneForZero] = configured
  const configuredFeePips = isSet ? Math.max(zeroForOne, oneForZero) : 0

  const controllerWired = wiredTo.toLowerCase() === d.feeController.toLowerCase()
  const effectiveFeePips = controllerWired && !disabled ? configuredFeePips : 0

  return {
    chainId,
    chainName: d.name,
    vault: d.vault,
    vaultOwner,
    clRegistered: clReg,
    binRegistered: binReg,
    defaultFeePips: defFee,
    configuredFeePips,
    maxFeePips: maxFee,
    feesDisabled: disabled,
    controllerWired,
    effectiveFeePips,
    guardian,
    blockNumber,
  }
}

export interface VaultHolding {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  token: Address
  symbol: string
  decimals: number
  /** Raw balance held by the Vault. */
  balance: bigint
  /** Portion attributed to the CL pool manager via reservesOfApp. */
  clReserve: bigint
}

/**
 * TVL. The Vault custodies every token for the whole protocol and the pool managers
 * hold nothing — verified on chain — so Vault balances ARE the protocol's TVL.
 * There is no per-pool contract to enumerate.
 */
export async function readVaultHoldings(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<VaultHolding[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  /* The demo pool is how this function knows WHICH tokens to ask about; there
     is no on-chain enumeration of "tokens the vault holds". A chain without one
     therefore has no known tokens, and an empty list is the truthful answer —
     not zero balances, which would assert the vault holds nothing. */
  if (d.demoPool === null) return []
  const tokens = [d.demoPool.token0, d.demoPool.token1] as const

  return Promise.all(
    tokens.map(async (token) => {
      // chainId is captured from the enclosing read, so a holding always knows
      // which chain's vault it came from.
      const [balance, symbol, decimals, clReserve] = await Promise.all([
        c.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [d.vault] }),
        c.readContract({ address: token, abi: ERC20, functionName: 'symbol' }),
        c.readContract({ address: token, abi: ERC20, functionName: 'decimals' }),
        c.readContract({ address: d.vault, abi: VAULT, functionName: 'reservesOfApp', args: [d.clPoolManager, token] }),
      ])
      return { chainId, token, symbol, decimals, balance, clReserve }
    }),
  )
}

export interface SwapRecord {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  txHash: Hex
  blockNumber: bigint
  poolId: Hex
  sender: Address
  amount0: bigint
  amount1: bigint
  /** Combined swap fee in pips (protocol + LP, composed). */
  feePips: number
  /** Protocol slice in pips. */
  protocolFeePips: number
}

/**
 * Real swaps from the CL pool manager.
 *
 * Scoped by emitting address deliberately — see the topic0 note above.
 */
export async function readRecentSwaps(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
  limit = 25,
): Promise<SwapRecord[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  const logs = await c.getLogs({
    address: d.clPoolManager,
    event: CL_SWAP_EVENT[0],
    fromBlock: d.deployedAtBlock,
    toBlock: 'latest',
  })

  return logs
    .slice(-limit)
    .reverse()
    .map((l) => ({
      txHash: l.transactionHash,
      chainId,
      blockNumber: l.blockNumber,
      poolId: l.args.id as Hex,
      sender: l.args.sender as Address,
      amount0: l.args.amount0 as bigint,
      amount1: l.args.amount1 as bigint,
      feePips: Number(l.args.fee),
      protocolFeePips: Number(l.args.protocolFee),
    }))
}

/**
 * Split a swap's fee into protocol and LP slices.
 *
 * Protocol fee comes off the INPUT first, LP fee applies to the remainder:
 *   total = protocolFee + lpFee - (protocolFee * lpFee / 1e6)
 * Confirmed against real Sepolia swaps: fee=3997, protocolFee=1000 => lpFee=3000.
 */
export function splitFee(feePips: number, protocolFeePips: number): { lpPips: number } {
  if (protocolFeePips === 0) return { lpPips: feePips }
  const lp = Math.round(((feePips - protocolFeePips) * 1_000_000) / (1_000_000 - protocolFeePips))
  return { lpPips: lp }
}

export function explorerTx(chainId: DeployedChainId, hash: Hex): string {
  return `${DEPLOYMENTS[chainId].explorer}/tx/${hash}`
}

export function explorerAddress(chainId: DeployedChainId, addr: Address | string): string {
  return `${DEPLOYMENTS[chainId].explorer}/address/${addr}`
}

export function formatUnits(v: bigint, decimals: number, places = 4): string {
  const neg = v < 0n
  const abs = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = ((abs % base) * 10n ** BigInt(places)) / base
  const s = `${whole}.${frac.toString().padStart(places, '0')}`
  return neg ? `-${s}` : s
}

export interface GovernanceStatus {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  registry: Address
  hookCount: bigint
  custodyDelaySec: bigint
  policyDelaySec: bigint
}

/**
 * Registry and governance state, read live.
 *
 * hookCount is genuinely 0 today - the registry is deployed but nothing has been
 * listed. That is shown as zero, not padded with examples.
 */
export async function readGovernanceStatus(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<GovernanceStatus> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const [hookCount, custodyDelaySec, policyDelaySec] = await Promise.all([
    c.readContract({ address: d.registry, abi: REGISTRY, functionName: 'latchCount' }),
    c.readContract({ address: d.timelockCustody, abi: TIMELOCK, functionName: 'getMinDelay' }),
    c.readContract({ address: d.timelockPolicy, abi: TIMELOCK, functionName: 'getMinDelay' }),
  ])
  return { chainId, registry: d.registry, hookCount, custodyDelaySec, policyDelaySec }
}

/* ---------------------------------------------------------------------------
   Aggregations for the dapp screens.

   These replace the mock `data/*.ts` modules. Every figure is derived from chain.
   The numbers are SMALL because this is a testnet with one pool and a handful of
   swaps — that is the honest picture, and showing it beats showing invented
   millions. A dashboard is only useful if its numbers mean something.
   --------------------------------------------------------------------------- */

const CL_INITIALIZE_EVENT = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)',
])

export interface PoolRecord {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  id: Hex
  currency0: Address
  currency1: Address
  hooks: Address
  /** true when the pool has a hook attached. */
  hasHook: boolean
  lpFeePips: number
  createdAtBlock: bigint
}

/** Every pool ever initialized on the CL manager, from logs. */
export async function readPools(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<PoolRecord[]> {
  const d = DEPLOYMENTS[chainId]
  const logs = await client(chainId).getLogs({
    address: d.clPoolManager,
    event: CL_INITIALIZE_EVENT[0],
    fromBlock: d.deployedAtBlock,
    toBlock: 'latest',
  })
  return logs.map((l) => {
    const hooks = l.args.hooks as Address
    return {
      id: l.args.id as Hex,
      chainId,
      currency0: l.args.currency0 as Address,
      currency1: l.args.currency1 as Address,
      hooks,
      hasHook: hooks !== '0x0000000000000000000000000000000000000000',
      lpFeePips: Number(l.args.fee),
      createdAtBlock: l.blockNumber,
    }
  })
}

export interface ProtocolMetrics {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  poolCount: number
  hookedPoolCount: number
  swapCount: number
  /** Sum of |amount0| across swaps, in token0 units. Testnet tokens have no price. */
  volume0: bigint
  volume1: bigint
  /** Fee taken by the protocol, in token units, derived from each swap's own pips. */
  protocolFees0: bigint
  protocolFees1: bigint
  lpFees0: bigint
  lpFees1: bigint
  tvl: VaultHolding[]
  latestBlock: bigint
}

const abs = (v: bigint) => (v < 0n ? -v : v)

/**
 * Protocol-wide metrics, computed from real logs and balances.
 *
 * Fees are apportioned per swap from that swap's OWN fee/protocolFee fields rather
 * than the controller's current default — a fee change would otherwise silently
 * rewrite history.
 *
 * NOTE: no USD anywhere. These are testnet tokens that nothing prices, and inventing
 * a price to make a dashboard look busy would be the exact failure this avoids.
 */
export async function readProtocolMetrics(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<ProtocolMetrics> {
  const [pools, swaps, tvl, latestBlock] = await Promise.all([
    readPools(chainId),
    readRecentSwaps(chainId, 1000),
    readVaultHoldings(chainId),
    client(chainId).getBlockNumber(),
  ])

  let volume0 = 0n
  let volume1 = 0n
  let protocolFees0 = 0n
  let protocolFees1 = 0n
  let lpFees0 = 0n
  let lpFees1 = 0n

  for (const s of swaps) {
    // The INPUT side is the positive delta: tokens flowing into the pool.
    const inIs0 = s.amount0 > 0n
    const gross = inIs0 ? abs(s.amount0) : abs(s.amount1)

    const total = (gross * BigInt(s.feePips)) / 1_000_000n
    const proto = (gross * BigInt(s.protocolFeePips)) / 1_000_000n
    const lp = total > proto ? total - proto : 0n

    if (inIs0) {
      volume0 += gross
      protocolFees0 += proto
      lpFees0 += lp
    } else {
      volume1 += gross
      protocolFees1 += proto
      lpFees1 += lp
    }
  }

  return {
    chainId,
    poolCount: pools.length,
    hookedPoolCount: pools.filter((p) => p.hasHook).length,
    swapCount: swaps.length,
    volume0,
    volume1,
    protocolFees0,
    protocolFees1,
    lpFees0,
    lpFees1,
    tvl,
    latestBlock,
  }
}

/* ---------------------------------------------------------------------------
   Hook registry — the marketplace's backing contract.
   --------------------------------------------------------------------------- */

import { registryAbi } from './abi/registry'

/** 0 Passive · 1 Restrictive · 2 ValueExtracting — computed on chain, uncheatable. */
export type RiskClass = 0 | 1 | 2
/** 0 Unverified · 1 SourceVerified · 2 Audited */
export type VerificationLevel = 0 | 1 | 2
/** 0 Active · 1 Deprecated · 2 Malicious */
export type ListingState = 0 | 1 | 2

export interface RegisteredLatch {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  address: Address
  name: string
  description: string
  sourceURI: string
  auditURI: string
  submitter: Address
  /** Read off the hook itself at registration — never supplied by the submitter. */
  permissions: number
  /** False when the hook's bitmap could not be read, or is malformed. Show it. */
  permissionsReadable: boolean
  permissionsValid: boolean
  risk: RiskClass
  takesSwapCut: boolean
  canBlockSwaps: boolean
  canTrapLiquidity: boolean
  verification: VerificationLevel
  listing: ListingState
  /**
   * The callbacks this hook holds, named. Expanded by the registry's own
   * `decodePermissions`, not by shifting the bitmap here — see the note on
   * readRegisteredLatches about why the UI must not re-derive capability.
   */
  callbacks: string[]
}

/**
 * The field order of ILatchHookRegistry.DecodedPermissions. Used only to turn the
 * struct the chain returns into a list; the truth values are the chain's.
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

/* One vocabulary for the on-chain enums, shared by every surface that renders them.
   Two screens holding two copies of these strings is how a hook ends up described as
   "Restrictive" on one page and "Passive" on the next. */
export const RISK_LABEL = ['Passive', 'Restrictive', 'Value-extracting'] as const
export const VERIFICATION_LABEL = ['Unverified', 'Source verified', 'Audited'] as const
export const LISTING_LABEL = ['Active', 'Deprecated', 'Flagged malicious'] as const

/**
 * Capability in plain language, straight off the registry's classifiers.
 *
 * Callers must render this whether or not it is comfortable — it is the sentence a
 * user needs before they route funds through a pool.
 */
export function capabilityClaims(hook: RegisteredLatch): string[] {
  const claims: string[] = []
  if (hook.takesSwapCut) claims.push('can take a share of every swap')
  if (hook.canBlockSwaps) claims.push('can block or price swaps')
  if (hook.canTrapLiquidity) claims.push('can refuse liquidity withdrawal')
  if (claims.length === 0) claims.push('observes only — cannot move funds or block trading')
  return claims
}

/**
 * Every hook listed in the registry.
 *
 * Capability flags come from the registry's own pure classifiers rather than being
 * re-derived here. Three components describing one bitmap three different ways is
 * how a user ends up trusting a hook the chain would have warned them about.
 */
export async function readRegisteredLatches(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<RegisteredLatch[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const abi = registryAbi

  const count = await c.readContract({ address: d.registry, abi, functionName: 'latchCount' }) as bigint
  if (count === 0n) return []

  const addrs = (await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      c.readContract({ address: d.registry, abi, functionName: 'latchAt', args: [BigInt(i)] }),
    ),
  )) as Address[]

  return Promise.all(addrs.map((a) => hydrateHook(chainId, c, d.registry, a)))
}

/**
 * Turn one registry address into a RegisteredLatch.
 *
 * Extracted so the list read and the single-address read below cannot drift: two
 * code paths hydrating the same record is how one screen ends up calling a hook
 * "Passive" while another calls it "Value-extracting".
 *
 * Throws if the hook is not registered — `getHook` reverts rather than returning a
 * zeroed struct, deliberately. Call `readRegisteredLatch` if you do not already know
 * the address is listed.
 */
async function hydrateHook(
  chainId: DeployedChainId,
  c: PublicClient,
  registry: Address,
  a: Address,
): Promise<RegisteredLatch> {
  const abi = registryAbi
  const r = (await c.readContract({
    address: registry, abi, functionName: 'getLatch', args: [a],
  })) as any
  const p = Number(r.permissions)
  const [risk, cut, block, trap, decoded] = (await Promise.all([
    c.readContract({ address: registry, abi, functionName: 'classify', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'takesSwapCut', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'canBlockSwaps', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'canTrapLiquidity', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'decodePermissions', args: [p] }),
  ])) as [number, boolean, boolean, boolean, Record<string, boolean>]

  return {
    chainId,
    address: a,
    name: r.metadata?.name ?? '',
    description: r.metadata?.description ?? '',
    sourceURI: r.metadata?.sourceURI ?? '',
    auditURI: r.metadata?.auditURI ?? '',
    submitter: r.submitter as Address,
    permissions: p,
    permissionsReadable: Boolean(r.permissionsReadable),
    permissionsValid: Boolean(r.permissionsValid),
    risk: Number(risk) as RiskClass,
    takesSwapCut: cut,
    canBlockSwaps: block,
    canTrapLiquidity: trap,
    verification: Number(r.verification) as VerificationLevel,
    listing: Number(r.listing) as ListingState,
    callbacks: CALLBACK_FIELDS.filter((f) => decoded?.[f]),
  }
}

/**
 * One hook, looked up by address.
 *
 * `found: false` is a RESULT, not an absence of one. The caller must render it as an
 * explicit "not in the registry" answer — never as a hook record with empty fields.
 * The registry itself takes this seriously enough that `getHook` reverts instead of
 * returning a zeroed struct, because a zeroed struct reads as "Unverified, Active,
 * no permissions", which is the most reassuring thing you could possibly say about a
 * contract nobody has ever looked at.
 *
 * `hasCode` separates the two ways an address can be absent — a contract that exists
 * but was never listed, versus an address with no code at all (a typo, an EOA, or a
 * contract on some other chain). Neither is a hook; saying which one it is saves the
 * reader from guessing.
 *
 * A chain that cannot be reached THROWS. It must never be reported as "not found":
 * an unreachable RPC and an unregistered hook are opposite answers.
 */
export type LatchLookup =
  | { found: true; latch: RegisteredLatch; checkedAtBlock: bigint }
  | { found: false; address: Address; hasCode: boolean; checkedAtBlock: bigint }

export async function readRegisteredLatch(
  address: Address,
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<LatchLookup> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  // Asked first, and on its own. `isRegistered` is the registry's own answer to
  // exactly this question, and it is the gate the rest of the read sits behind.
  const [registered, checkedAtBlock] = await Promise.all([
    c.readContract({
      address: d.registry, abi: registryAbi, functionName: 'isRegistered', args: [address],
    }) as Promise<boolean>,
    c.getBlockNumber(),
  ])

  if (!registered) {
    const code = await c.getCode({ address })
    return {
      found: false,
      address,
      hasCode: Boolean(code && code !== '0x'),
      checkedAtBlock,
    }
  }

  return { found: true, latch: await hydrateHook(chainId, c, d.registry, address), checkedAtBlock }
}

/* ---------------------------------------------------------------------------
   Activity feed — real protocol events.
   --------------------------------------------------------------------------- */

const CL_MODIFY_EVENT = parseAbi([
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
])
const CL_DONATE_EVENT = parseAbi([
  'event Donate(bytes32 indexed id, address indexed sender, uint256 amount0, uint256 amount1, int24 tick)',
])

export interface ActivityEvent {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  kind: 'Initialize' | 'Swap' | 'Add liquidity' | 'Remove liquidity' | 'Donate'
  blockNumber: bigint
  txHash: Hex
  detail: string
}

/**
 * Recent protocol activity, newest first.
 *
 * The design spec's feed listed hook callbacks (beforeSwap, afterDonate…). None have
 * ever fired: the only live pool has no hook attached, so a callback feed would be
 * entirely fabricated. These are the events that genuinely occurred instead.
 *
 * Every query is scoped by emitting address — Latch has 34 event declarations but
 * only 22 unique signatures, so a topic0-only filter merges CL and Bin activity.
 */
export async function readActivity(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
  limit = 12,
): Promise<ActivityEvent[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const range = { fromBlock: d.deployedAtBlock, toBlock: 'latest' } as const

  const [inits, swaps, mods, donates] = await Promise.all([
    c.getLogs({ address: d.clPoolManager, event: CL_INITIALIZE_EVENT[0], ...range }),
    c.getLogs({ address: d.clPoolManager, event: CL_SWAP_EVENT[0], ...range }),
    c.getLogs({ address: d.clPoolManager, event: CL_MODIFY_EVENT[0], ...range }),
    c.getLogs({ address: d.clPoolManager, event: CL_DONATE_EVENT[0], ...range }),
  ])

  const out: ActivityEvent[] = []

  for (const l of inits) {
    const hooks = l.args.hooks as Address
    const hooked = hooks !== '0x0000000000000000000000000000000000000000'
    out.push({
      chainId,
      kind: 'Initialize',
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      detail: `pool created · fee ${Number(l.args.fee)} pips · ${hooked ? 'hook attached' : 'no hook'}`,
    })
  }
  for (const l of swaps) {
    out.push({
      chainId,
      kind: 'Swap',
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      detail: `${Number(l.args.fee)} pips total · ${Number(l.args.protocolFee)} to protocol`,
    })
  }
  for (const l of mods) {
    const delta = l.args.liquidityDelta as bigint
    out.push({
      chainId,
      kind: delta >= 0n ? 'Add liquidity' : 'Remove liquidity',
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      detail: `ticks ${Number(l.args.tickLower)} to ${Number(l.args.tickUpper)}`,
    })
  }
  for (const l of donates) {
    out.push({
      chainId,
      kind: 'Donate',
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      detail: 'donated to in-range liquidity',
    })
  }

  return out.sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, limit)
}

/** Current head of the chain. Used by the dapp shell's block chip. */
export async function readBlockNumber(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<bigint> {
  return client(chainId).getBlockNumber()
}
