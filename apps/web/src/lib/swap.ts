/* ============================================================================
   The swap path, read and encoded from the real contracts.

   WHY THIS FILE EXISTS AT ALL. Until now the dapp could read pools and could
   not trade through one. Everything needed was already deployed; what was
   missing was the calldata, and the calldata for an Infinity-style router is
   not guessable — it is a command byte selecting a dispatcher branch, whose
   input is an `abi.encode(bytes actions, bytes[] params)` plan, whose first
   action is a struct the router decodes by calldata pointer. Every layer here
   was read out of `packages/router` and `packages/periphery` and then verified
   against the live chain (see "PROVEN AGAINST CHAIN" below); nothing in it was
   inferred from how another AMM does it.

   THE THREE LAYERS, IN THE ORDER THE ROUTER UNWRAPS THEM
   -----------------------------------------------------
   1. `UniversalRouter.execute(bytes commands, bytes[] inputs, uint256
      deadline)`. One byte per command. Ours is a single byte, `0x10` —
      `Commands.INFI_SWAP` (packages/router/src/libraries/Commands.sol):

          uint256 constant INFI_SWAP = 0x10;

      Its branch in `Dispatcher.dispatch` does not decode the input at all:

          if (command == Commands.INFI_SWAP) {
              // pass the calldata provided to InfinitySwapRouter._executeActions
              _executeActions(inputs);

      so `inputs[0]` is handed whole to `BaseActionsRouter._executeActions`,
      which calls `vault.lock(data)`.

   2. Inside the lock, `_lockAcquired` runs `data.decodeActionsRouterParams()`,
      which is `abi.decode(data, (bytes, bytes[]))` under a strict-encoding
      check — the decoder asserts the first word is exactly `0x40`, so the plan
      MUST be the canonical ABI encoding of `(bytes actions, bytes[] params)`.
      One action byte, one params entry, positionally paired.

   3. Each action is dispatched by `InfinityRouter._handleAction`. We use three,
      in this order (values from `packages/periphery/src/libraries/Actions.sol`):

          CL_SWAP_EXACT_IN_SINGLE = 0x06   the swap
          SETTLE_ALL              = 0x0c   pay the input side
          TAKE_ALL                = 0x0f   collect the output side

      `SETTLE_ALL` pays from `msgSender()` and `TAKE_ALL` delivers to
      `msgSender()`, which under the UniversalRouter is the locker — the EOA
      that called `execute`. There is no recipient field to get wrong, and the
      router never holds the funds.

   THE PRICE LIMIT IS NOT OURS TO SET, AND THAT IS THE INTERESTING PART
   -------------------------------------------------------------------
   A raw `CLPoolManager.swap` takes a `sqrtPriceLimitX96`, and passing 0 there
   reverts `InvalidSqrtPriceLimit` — a mistake that has already cost this
   project a failed mainnet transaction. It cannot be made from here: BOTH the
   router and the quoter hardcode the bound and expose no parameter for it.

       // CLRouterBase._swapExactPrivate and CLQuoter._swap, identically:
       zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1

   The consequence for a trader is what matters and the UI says it: there is no
   price bound on the swap itself. `amountOutMinimum` is the ONLY protection,
   which is why it is enforced twice below.

   SLIPPAGE IS ENFORCED TWICE, ON PURPOSE
   --------------------------------------
   `amountOutMinimum` goes into the swap action, where `_swapExactInputSingle`
   checks it (`TooLittleReceived(min, got)`), and again as `TAKE_ALL`'s
   `minAmount`, which re-checks the credit actually standing on the vault. The
   first bounds the swap; the second bounds what leaves the vault. They are
   cheap and they fail in different places, so both are set.

   PAYMENT IS PERMIT2, NOT `approve(router)`
   -----------------------------------------
   `InfinitySwapRouter._pay` -> `Permit2Payments.payOrPermit2Transfer` ->
   `PERMIT2.transferFrom(from, to, amount, token)`. A trade therefore needs TWO
   approvals and an ERC-20 approval to the router alone does nothing:

       1. token.approve(PERMIT2, ...)                  ERC-20 -> Permit2
       2. PERMIT2.approve(token, router, amount, exp)  Permit2 -> router

   The router's `PERMIT2` is `internal immutable` with no getter, so the address
   cannot be read back off the router; it comes from `DEPLOYMENTS[…].permit2`,
   and simulation is what actually proves the pair agree.

   PROVEN AGAINST CHAIN, 2026-09-12, Robinhood Chain (4663)
   --------------------------------------------------------
   `execute(0x10, [plan], deadline)` simulated from an address holding LTT1 with
   no Permit2 allowance reverted `AllowanceExpired(uint256)` — Permit2's
   selector `0xd81b2f2e`. That is the deepest possible failure short of a funded
   allowance: the plan decoded, the swap ran inside the lock, and the only thing
   missing was the approval. An encoding mistake at any of the three layers
   above fails long before Permit2 is reached.

   NO INVENTED NUMBERS. Every figure this module returns is a chain read or is
   derived from one. `quoteExactIn` calls the deployed `CLQuoter`; there is no
   local constant-product fallback, and a failed quote is an error state, never
   a stale number left on screen.
   ============================================================================ */

import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  concatHex,
  encodeAbiParameters,
  parseAbi,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem'

import {
  ACTIVE_CHAIN_ID,
  DEPLOYMENTS,
  client,
  type DeployedChainId,
} from './chain'
import { priceFromSqrtX96 } from './prices'
import { clQuoterAbi } from './abi/clQuoter'
import { permit2Abi } from './abi/permit2'
import { universalRouterAbi } from './abi/universalRouter'

/** One build, one chain — the same rule the rest of the dapp follows. */
export const SWAP_CHAIN_ID: DeployedChainId = ACTIVE_CHAIN_ID

const D = DEPLOYMENTS[SWAP_CHAIN_ID]

export const ROUTER: Address = D.universalRouter as Address
export const QUOTER: Address = D.clQuoter as Address
export const CL_POOL_MANAGER: Address = D.clPoolManager as Address
export const PERMIT2: Address = D.permit2 as Address

const ZERO = '0x0000000000000000000000000000000000000000' as const

/* ---------------------------------------------------------------------------
   Command and action bytes.

   Mirrored from the two libraries by hand because they are `internal constant`
   and so appear in no ABI. Each carries its source path so the pairing is
   checkable in one grep rather than remembered.
   --------------------------------------------------------------------------- */

/** packages/router/src/libraries/Commands.sol — `INFI_SWAP = 0x10`. */
const COMMAND_INFI_SWAP = '0x10' as const

/** packages/periphery/src/libraries/Actions.sol. */
const ACTION_CL_SWAP_EXACT_IN_SINGLE = '0x06' as const
const ACTION_SETTLE_ALL = '0x0c' as const
const ACTION_TAKE_ALL = '0x0f' as const

/* ---------------------------------------------------------------------------
   ABI fragments for the plan.

   These describe STRUCTS the router decodes with assembly, not functions, so
   they exist in no artifact and cannot be generated. They are transcribed from
   `PoolKey` (infinity-core/src/types/PoolKey.sol) and
   `ICLRouterBase.CLSwapExactInputSingleParams`, field for field and in
   declaration order — a reordering here would encode a valid-looking plan that
   swaps the wrong direction or reads the fee as a tick spacing.
   --------------------------------------------------------------------------- */

const POOL_KEY_PARAM = {
  name: 'poolKey',
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'hooks', type: 'address' },
    { name: 'poolManager', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'parameters', type: 'bytes32' },
  ],
} as const satisfies AbiParameter

const SWAP_EXACT_IN_SINGLE_PARAM = {
  name: 'params',
  type: 'tuple',
  components: [
    POOL_KEY_PARAM,
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountIn', type: 'uint128' },
    { name: 'amountOutMinimum', type: 'uint128' },
    { name: 'hookData', type: 'bytes' },
  ],
} as const satisfies AbiParameter

const CURRENCY_AND_UINT256 = [
  { name: 'currency', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const satisfies readonly AbiParameter[]

const PLAN = [
  { name: 'actions', type: 'bytes' },
  { name: 'params', type: 'bytes[]' },
] as const satisfies readonly AbiParameter[]

/* ---------------------------------------------------------------------------
   Small ABIs for reads that have no generated artifact in this app.
   --------------------------------------------------------------------------- */

const CL_MANAGER_ABI = parseAbi([
  /* slot0's `protocolFee` is the COMPOSITE of both directions and `lpFee` is
     the live fee, which for a dynamic-fee pool is not the fee in the key. Both
     are read per pool rather than taken from the Initialize log. */
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 id) view returns (uint128)',
  'function protocolFeeController() view returns (address)',
])

const CL_INITIALIZE_EVENT = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)',
])[0]

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
])

/**
 * The RevShareHook reads this surface needs, and nothing else.
 *
 * `getPendingConfig` is here because a trader is entitled to see it. `disable`
 * and `reduceFee` do NOT clear a matured proposal, so a pool can advertise a 0%
 * cut while a 10% proposal sits armed — and `applyPendingConfig` is
 * permissionless, so anyone can land it in the next block.
 */
const REV_SHARE_READ_ABI = parseAbi([
  'function getConfig(bytes32 poolId) view returns ((address owner, uint24 feePips, uint16 lpDonateBps, uint16 beneficiaryBps, uint16 distributorBps, bool enabled, bool frozen))',
  'function getPendingConfig(bytes32 poolId) view returns ((uint48 effectiveBlock, (uint24 feePips, uint16 lpDonateBps, uint16 beneficiaryBps, uint16 distributorBps, address distributor, bool enabled) params))',
  'function paused() view returns (bool)',
  'function CONFIG_DELAY_BLOCKS() view returns (uint256)',
])

/** `PIPS_DENOMINATOR` in both core and the hook. */
export const PIPS_DENOMINATOR = 1_000_000
/** `SPLIT_DENOMINATOR` on RevShareHook. */
export const SPLIT_DENOMINATOR = 10_000

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export interface PoolKeyStruct {
  currency0: Address
  currency1: Address
  hooks: Address
  poolManager: Address
  fee: number
  parameters: Hex
}

export interface SwapToken {
  address: Address
  symbol: string
  /**
   * Null when `decimals()` could not be read.
   *
   * A pool with an unreadable decimals is NOT tradeable from this UI: every
   * amount the user types would have to be scaled by a guess, and a hardcoded
   * 18 against a 6-decimal token is a trade a million times the intended size.
   */
  decimals: number | null
}

export interface SwapPool {
  chainId: DeployedChainId
  poolId: Hex
  key: PoolKeyStruct
  token0: SwapToken
  token1: SwapToken
  /** `slot0.lpFee` — the fee in force now, which for a dynamic pool is not `key.fee`. */
  lpFeePips: number
  /** `slot0.protocolFee`, split per direction by ProtocolFeeLibrary's packing. */
  protocolFeeZeroForOnePips: number
  protocolFeeOneForZeroPips: number
  tickSpacing: number
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  hooks: Address
  hasHook: boolean
  createdAtBlock: bigint
}

/** What the attached hook takes, and what it is about to start taking. */
export interface HookTake {
  hook: Address
  /** False when the hook has no RevShareHook-shaped config for this pool. */
  readable: boolean
  /** `getConfig().owner == address(0)` means the pool was never claimed. */
  configured: boolean
  /** The hook's GLOBAL kill switch. True means every pool on it takes nothing. */
  globallyPaused: boolean
  enabled: boolean
  frozen: boolean
  feePips: number
  lpDonateBps: number
  beneficiaryBps: number
  distributorBps: number
  /** Null when `effectiveBlock == 0`, which is the hook's "no proposal" value. */
  pending: {
    effectiveBlock: bigint
    feePips: number
    lpDonateBps: number
    beneficiaryBps: number
    distributorBps: number
    enabled: boolean
    /** True once the delay has elapsed: anyone can land it in the next block. */
    applicable: boolean
    /** Blocks still to wait. Zero once applicable. */
    blocksRemaining: bigint
  } | null
  configDelayBlocks: bigint | null
}

export interface SwapContext {
  chainId: DeployedChainId
  chainName: string
  pools: SwapPool[]
  /** `CLPoolManager.protocolFeeController()`. `address(0)` means no fee, anywhere. */
  protocolFeeController: Address
  controllerWired: boolean
  /** `UniversalRouter.paused()` — a paused router refuses every swap. */
  routerPaused: boolean
  blockNumber: bigint
}

/* ---------------------------------------------------------------------------
   Reads
   --------------------------------------------------------------------------- */

const tokenCache = new Map<string, SwapToken>()

async function readSwapToken(address: Address): Promise<SwapToken> {
  const cached = tokenCache.get(address.toLowerCase())
  if (cached) return cached

  const c = client(SWAP_CHAIN_ID)
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
    c.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => null),
  ])

  const token: SwapToken = {
    address,
    symbol: typeof symbol === 'string' && symbol !== '' ? symbol : shortHex(address),
    decimals: typeof decimals === 'number' ? decimals : null,
  }
  tokenCache.set(address.toLowerCase(), token)
  return token
}

/** `parameters` bits [16,40) hold the tick spacing — CLPoolParametersHelper. */
function tickSpacingFromParameters(parameters: Hex): number {
  const raw = Number((BigInt(parameters) >> 16n) & 0xffffffn)
  // int24, so the top bit is a sign bit. A negative tick spacing is invalid on
  // chain, but decoding it correctly is how we would SEE that rather than
  // rendering 16777156 as a spacing.
  return raw >= 0x800000 ? raw - 0x1000000 : raw
}

/**
 * Every CL pool this chain has ever initialized, with the live state a trader
 * needs to judge it.
 *
 * Sourced from `Initialize` logs because there is no enumeration on chain. The
 * scan is scoped to the CL pool manager's own address — Latch declares 34
 * events across only 22 unique signatures, so a topic0-only filter would merge
 * CL and Bin pools into one list.
 *
 * A pool with zero liquidity is RETURNED, not filtered out. It is a real pool
 * and the reason it cannot be traded is worth saying; dropping it silently
 * would leave the reader wondering where their pool went.
 */
export async function readSwapPools(): Promise<SwapPool[]> {
  const c = client(SWAP_CHAIN_ID)

  const logs = await c.getLogs({
    address: CL_POOL_MANAGER,
    event: CL_INITIALIZE_EVENT,
    fromBlock: D.deployedAtBlock,
    toBlock: 'latest',
  })

  return Promise.all(
    logs.map(async (log) => {
      const poolId = log.args.id as Hex
      const currency0 = log.args.currency0 as Address
      const currency1 = log.args.currency1 as Address
      const hooks = log.args.hooks as Address
      const parameters = log.args.parameters as Hex

      const [slot0, liquidity, token0, token1] = await Promise.all([
        c.readContract({ address: CL_POOL_MANAGER, abi: CL_MANAGER_ABI, functionName: 'getSlot0', args: [poolId] }),
        c.readContract({ address: CL_POOL_MANAGER, abi: CL_MANAGER_ABI, functionName: 'getLiquidity', args: [poolId] }),
        readSwapToken(currency0),
        readSwapToken(currency1),
      ])

      const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0

      return {
        chainId: SWAP_CHAIN_ID,
        poolId,
        key: {
          currency0,
          currency1,
          hooks,
          /* The event does not carry the manager; for a CL pool it IS the emitter. */
          poolManager: CL_POOL_MANAGER,
          fee: Number(log.args.fee),
          parameters,
        },
        token0,
        token1,
        lpFeePips: Number(lpFee),
        // ProtocolFeeLibrary: zeroForOne is the low 12 bits, oneForZero the high 12.
        protocolFeeZeroForOnePips: Number(protocolFee) & 0xfff,
        protocolFeeOneForZeroPips: Number(protocolFee) >> 12,
        tickSpacing: tickSpacingFromParameters(parameters),
        sqrtPriceX96,
        tick: Number(tick),
        liquidity,
        hooks,
        hasHook: hooks !== ZERO,
        createdAtBlock: log.blockNumber,
      } satisfies SwapPool
    }),
  )
}

/** Everything the swap surface needs in one pass, so one render is one round of reads. */
export async function readSwapContext(): Promise<SwapContext> {
  const c = client(SWAP_CHAIN_ID)

  const [pools, controller, routerPaused, blockNumber] = await Promise.all([
    readSwapPools(),
    c.readContract({ address: CL_POOL_MANAGER, abi: CL_MANAGER_ABI, functionName: 'protocolFeeController' }),
    c.readContract({ address: ROUTER, abi: universalRouterAbi as Abi, functionName: 'paused' }) as Promise<boolean>,
    c.getBlockNumber(),
  ])

  return {
    chainId: SWAP_CHAIN_ID,
    chainName: D.name,
    pools,
    protocolFeeController: controller,
    controllerWired: controller !== ZERO,
    routerPaused,
    blockNumber,
  }
}

/**
 * What the pool's hook takes from a swap, including a proposal not yet applied.
 *
 * `readable: false` is a real answer and must be rendered as one. A pool can
 * carry a hook that is not a RevShareHook at all, in which case none of these
 * functions exist and the honest statement is "there is a hook here and this UI
 * cannot read what it takes" — never "it takes nothing".
 */
export async function readHookTake(
  hook: Address,
  poolId: Hex,
  atBlock: bigint,
): Promise<HookTake> {
  const c = client(SWAP_CHAIN_ID)

  const blank: HookTake = {
    hook,
    readable: false,
    configured: false,
    globallyPaused: false,
    enabled: false,
    frozen: false,
    feePips: 0,
    lpDonateBps: 0,
    beneficiaryBps: 0,
    distributorBps: 0,
    pending: null,
    configDelayBlocks: null,
  }

  const [config, pending, paused, delay] = await Promise.all([
    c
      .readContract({ address: hook, abi: REV_SHARE_READ_ABI, functionName: 'getConfig', args: [poolId] })
      .catch(() => null),
    c
      .readContract({ address: hook, abi: REV_SHARE_READ_ABI, functionName: 'getPendingConfig', args: [poolId] })
      .catch(() => null),
    c.readContract({ address: hook, abi: REV_SHARE_READ_ABI, functionName: 'paused' }).catch(() => null),
    c.readContract({ address: hook, abi: REV_SHARE_READ_ABI, functionName: 'CONFIG_DELAY_BLOCKS' }).catch(() => null),
  ])

  if (config === null) return blank

  /* `getConfig` is a plain mapping read: an unclaimed pool returns a ZEROED
     struct rather than reverting, and a zeroed struct renders as "0% fee,
     disabled" — indistinguishable from a real, deliberately disabled config.
     `owner` is the discriminator, because `configure()` is its only writer and
     can never write zero. */
  const configured = config.owner !== ZERO

  const effectiveBlock = pending ? BigInt(pending.effectiveBlock) : 0n
  const hasPending = effectiveBlock !== 0n

  return {
    hook,
    readable: true,
    configured,
    globallyPaused: paused === true,
    enabled: config.enabled,
    frozen: config.frozen,
    feePips: Number(config.feePips),
    lpDonateBps: Number(config.lpDonateBps),
    beneficiaryBps: Number(config.beneficiaryBps),
    distributorBps: Number(config.distributorBps),
    pending:
      hasPending && pending
        ? {
            effectiveBlock,
            feePips: Number(pending.params.feePips),
            lpDonateBps: Number(pending.params.lpDonateBps),
            beneficiaryBps: Number(pending.params.beneficiaryBps),
            distributorBps: Number(pending.params.distributorBps),
            enabled: pending.params.enabled,
            applicable: atBlock >= effectiveBlock,
            blocksRemaining: atBlock >= effectiveBlock ? 0n : effectiveBlock - atBlock,
          }
        : null,
    configDelayBlocks: delay === null ? null : BigInt(delay),
  }
}

/* ---------------------------------------------------------------------------
   Quoting
   --------------------------------------------------------------------------- */

export interface Quote {
  amountIn: bigint
  amountOut: bigint
  gasEstimate: bigint
  /** Head at the moment the quote was taken. A quote is only true for a block. */
  atBlock: bigint
  /** Wall clock, for "as of" — a stale quote must be visibly stale. */
  takenAt: number
}

/**
 * `CLQuoter.quoteExactInputSingle`, simulated.
 *
 * NOT a `view` call, and it must never be treated as one. The quoter takes the
 * vault lock, performs the real swap, and then THROWS the answer:
 *
 *     try vault.lock(abi.encodeCall(this._quoteExactInputSingle, (params))) {}
 *     catch (bytes memory reason) { amountOut = reason.parseQuoteAmount(); }
 *
 * so `eth_call` against a state-changing function is the only way to reach it.
 * viem's `simulateContract` does exactly that and hands back `result`.
 *
 * WHAT THE NUMBER INCLUDES. Everything. The delta the quoter reads back from
 * `poolManager.swap` is the swapper's own delta, already net of the LP fee, the
 * protocol fee and any `hookDelta` the pool's hook took in `afterSwap`.
 * Verified on the live LTT1/LTT2 pool: 0.001 LTT1 in quoted 0.000994009983…
 * LTT2 out, which is 0.997 (LP fee) x 0.997 (RevShareHook's 3000-pip cut on the
 * unspecified side) to the wei. There is nothing to add to this figure and
 * nothing to subtract from it.
 *
 * A pool without the liquidity to fill reverts `NotEnoughLiquidity(poolId)`
 * rather than quoting a partial fill; that surfaces as an error, not a number.
 */
export async function quoteExactIn(
  key: PoolKeyStruct,
  zeroForOne: boolean,
  amountIn: bigint,
): Promise<Quote> {
  const c = client(SWAP_CHAIN_ID)

  const [{ result }, atBlock] = await Promise.all([
    c.simulateContract({
      address: QUOTER,
      abi: clQuoterAbi as Abi,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
    }) as Promise<{ result: readonly [bigint, bigint] }>,
    c.getBlockNumber(),
  ])

  const amountOut = result[0]
  const gasEstimate = result[1]

  return { amountIn, amountOut, gasEstimate, atBlock, takenAt: Date.now() }
}

/* ---------------------------------------------------------------------------
   Encoding
   --------------------------------------------------------------------------- */

export interface ExactInSingleRequest {
  key: PoolKeyStruct
  zeroForOne: boolean
  amountIn: bigint
  amountOutMinimum: bigint
  /** Passed to the hook untouched. Empty for every pool this UI can build for. */
  hookData?: Hex
}

export interface RouterCall {
  commands: Hex
  inputs: readonly Hex[]
  /** The inner plan, exposed so the UI can show the exact bytes it will send. */
  plan: Hex
}

/**
 * Build `execute`'s `(commands, inputs)` for one exact-input single-hop swap.
 *
 * Pure, and deliberately so: it takes no wallet, reaches no network, and
 * returns bytes. Nothing here can send a transaction — that requires a separate,
 * explicit `writeContract` behind a button the user clicks.
 */
export function encodeExactInSingle(req: ExactInSingleRequest): RouterCall {
  const currencyIn = req.zeroForOne ? req.key.currency0 : req.key.currency1
  const currencyOut = req.zeroForOne ? req.key.currency1 : req.key.currency0

  const plan = encodeAbiParameters(PLAN, [
    concatHex([ACTION_CL_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL]),
    [
      encodeAbiParameters([SWAP_EXACT_IN_SINGLE_PARAM], [
        {
          poolKey: req.key,
          zeroForOne: req.zeroForOne,
          amountIn: req.amountIn,
          amountOutMinimum: req.amountOutMinimum,
          hookData: req.hookData ?? '0x',
        },
      ]),
      /* SETTLE_ALL's second word is a MAXIMUM, not the amount: the router pays
         whatever debt the swap actually opened and reverts TooMuchRequested
         above this. For an exact-input swap the debt is exactly `amountIn`, so
         a tighter cap than that would be a bug rather than caution. */
      encodeAbiParameters(CURRENCY_AND_UINT256, [currencyIn, req.amountIn]),
      /* TAKE_ALL's second word is the MINIMUM — the slippage bound, enforced a
         second time on the credit standing at the vault. */
      encodeAbiParameters(CURRENCY_AND_UINT256, [currencyOut, req.amountOutMinimum]),
    ],
  ])

  return { commands: COMMAND_INFI_SWAP, inputs: [plan], plan }
}

/**
 * The ABI to simulate and send `execute` against.
 *
 * The router's own ABI plus Permit2's three errors. Permit2 reverts INSIDE the
 * router call — `AllowanceExpired` is what an un-approved trade actually hits —
 * and viem can only put a name to a revert whose error is in the ABI it was
 * handed. Without this merge the most common failure on this surface renders as
 * an undecodable four-byte blob.
 */
export const ROUTER_CALL_ABI: Abi = [
  ...(universalRouterAbi as Abi),
  ...(permit2Abi as Abi).filter((entry) => entry.type === 'error'),
]

export { permit2Abi, universalRouterAbi, ERC20_ABI as SWAP_ERC20_ABI }

/* ---------------------------------------------------------------------------
   Allowances
   --------------------------------------------------------------------------- */

export interface AllowanceState {
  /** ERC-20 allowance from the trader to Permit2. Step 1 of 2. */
  erc20ToPermit2: bigint
  /** Permit2 allowance from the trader to the router. Step 2 of 2. */
  permit2ToRouter: bigint
  /** Permit2 expiration, unix seconds. An unexpired zero allowance is still zero. */
  permit2Expiration: number
  /** The trader's balance of the input token. */
  balance: bigint
}

export async function readAllowances(
  owner: Address,
  token: Address,
): Promise<AllowanceState> {
  const c = client(SWAP_CHAIN_ID)

  const [erc20, permit2, balance] = await Promise.all([
    c.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [owner, PERMIT2] }),
    c.readContract({
      address: PERMIT2,
      abi: permit2Abi as Abi,
      functionName: 'allowance',
      args: [owner, token, ROUTER],
    }) as Promise<readonly [bigint, number, number]>,
    c.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }),
  ])

  return {
    erc20ToPermit2: erc20,
    permit2ToRouter: permit2[0],
    permit2Expiration: Number(permit2[1]),
    balance,
  }
}

/**
 * Whether the Permit2 leg covers this trade RIGHT NOW.
 *
 * Both halves matter. Permit2 stores an amount and an expiration, and an
 * allowance whose expiration has passed transfers nothing — that is the
 * `AllowanceExpired` revert, and it is what a fresh wallet hits.
 */
export function permit2Covers(
  state: AllowanceState,
  amount: bigint,
  nowSeconds: number,
): boolean {
  return state.permit2ToRouter >= amount && state.permit2Expiration > nowSeconds
}

/** `uint160` max — Permit2's "unlimited", and the largest value its type holds. */
export const PERMIT2_MAX_AMOUNT = (1n << 160n) - 1n
/** `uint48` max — Permit2 reads this expiration as "never expires". */
export const PERMIT2_MAX_EXPIRATION = Number((1n << 48n) - 1n)

/* ---------------------------------------------------------------------------
   Slippage, amounts, and the arithmetic the UI shows
   --------------------------------------------------------------------------- */

/** Slippage choices, in basis points. 50 bps = 0.5%. */
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100, 300] as const
export const DEFAULT_SLIPPAGE_BPS = 50

/**
 * `amountOutMinimum` from a quote and a tolerance.
 *
 * Floors, so the bound is never LOOSER than the tolerance asked for by a
 * rounding wei. A tolerance of 0 yields the quote itself, which will revert on
 * any movement at all — that is the correct behaviour for a 0% tolerance and
 * the UI says so rather than silently adding headroom.
 */
export function minimumOut(amountOut: bigint, slippageBps: number): bigint {
  if (slippageBps <= 0) return amountOut
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n
}

/** Parse a typed decimal string into base units. Null for anything unparseable. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const text = input.trim()
  if (text === '') return null
  if (!/^\d*\.?\d*$/.test(text)) return null
  const [wholeRaw = '', fracRaw = ''] = text.split('.')
  if (wholeRaw === '' && fracRaw === '') return null
  // Truncate rather than round: a user typing more precision than the token has
  // should not have their amount silently increased.
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, '0')
  try {
    return BigInt(`${wholeRaw === '' ? '0' : wholeRaw}${frac}`)
  } catch {
    return null
  }
}

/**
 * The largest value the router's `amountIn` / `amountOutMinimum` fields hold.
 *
 * `CLSwapExactInputSingleParams` types both as `uint128`, and the quoter's
 * `exactAmount` likewise. An amount above this cannot be encoded at all —
 * `encodeAbiParameters` throws — so it has to be caught as INPUT VALIDATION,
 * before it reaches an encoder in a render path, not as an exception.
 */
export const MAX_UINT128 = (1n << 128n) - 1n

/**
 * Base units as a plain decimal string: no separators, no truncation.
 *
 * Exists specifically for writing back into the amount input. `formatAmount`
 * groups thousands, and a grouped number pasted into the field is rejected by
 * `parseAmount` — which is how a "max" button silently produces an unparseable
 * amount.
 */
export function formatAmountPlain(value: bigint, decimals: number): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = (abs / base).toString()
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

/** Base units to a readable decimal string. Never a "0" that hides a balance. */
export function formatAmount(value: bigint, decimals: number, places = 6): string {
  if (value === 0n) return '0'
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base

  const fracText = frac.toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '')
  const wholeText = whole.toLocaleString('en-US')
  if (wholeText === '0' && fracText === '') return `${negative ? '-' : ''}<0.${'0'.repeat(places - 1)}1`
  return `${negative ? '-' : ''}${wholeText}${fracText ? `.${fracText}` : ''}`
}

/** Pips as a percentage string. 3000 pips -> "0.3%". */
export function pipsPct(pips: number): string {
  return `${Number(((pips / PIPS_DENOMINATOR) * 100).toFixed(4))}%`
}

/** Basis points as a percentage string. 2000 bps -> "20%". */
export function bpsPct(bps: number): string {
  return `${Number(((bps / SPLIT_DENOMINATOR) * 100).toFixed(2))}%`
}

export function shortHex(value: string, lead = 6, tail = 4): string {
  return value.length > lead + tail + 2 ? `${value.slice(0, lead)}…${value.slice(-tail)}` : value
}

/**
 * How far the realised rate sits below the pool's current spot rate.
 *
 * DELIBERATELY NOT LABELLED "PRICE IMPACT" ANYWHERE IT IS SHOWN. Spot comes
 * from `sqrtPriceX96` and is fee-free; the quote is net of the LP fee, the
 * protocol fee and the hook's cut. The gap is therefore fees PLUS impact, and
 * the two cannot be separated from a single quote — the caller is given the
 * known fee total alongside so a reader can see which part is which, rather
 * than being handed one number that quietly means both.
 *
 * Returns null when spot cannot be computed (an uninitialized pool, or a token
 * whose decimals could not be read) rather than a zero, which would read as
 * "no impact".
 */
export function deviationFromSpot(
  pool: SwapPool,
  zeroForOne: boolean,
  amountIn: bigint,
  amountOut: bigint,
): number | null {
  const d0 = pool.token0.decimals
  const d1 = pool.token1.decimals
  if (d0 === null || d1 === null) return null
  if (amountIn === 0n || amountOut === 0n) return null

  const price1Per0 = priceFromSqrtX96(pool.sqrtPriceX96, d0, d1)
  if (price1Per0 === null || price1Per0 === 0) return null

  const decIn = zeroForOne ? d0 : d1
  const decOut = zeroForOne ? d1 : d0
  const inUnits = Number(amountIn) / 10 ** decIn
  const outUnits = Number(amountOut) / 10 ** decOut
  if (!Number.isFinite(inUnits) || !Number.isFinite(outUnits) || inUnits === 0) return null

  const spot = zeroForOne ? price1Per0 : 1 / price1Per0
  const realised = outUnits / inUnits
  if (spot === 0) return null

  return (spot - realised) / spot
}

/**
 * The fees a swap in this direction is known to pay, composed the way the pool
 * composes them.
 *
 * Core takes the protocol fee off the input first and the LP fee off what is
 * left (`ProtocolFeeLibrary.calculateSwapFee`), which is why this is not a sum.
 * The hook's cut is a THIRD, separate deduction — it comes off the unspecified
 * side in `afterSwap`, not out of the input — so it composes multiplicatively
 * with the pool fee rather than adding to it.
 *
 * Every input to this is a chain read. Nothing here is a default.
 */
export function knownFeeFraction(
  pool: SwapPool,
  zeroForOne: boolean,
  hook: HookTake | null,
): { poolFraction: number; hookFraction: number; totalFraction: number } {
  const protocolPips = zeroForOne ? pool.protocolFeeZeroForOnePips : pool.protocolFeeOneForZeroPips
  const swapFeePips =
    protocolPips + pool.lpFeePips - Math.floor((protocolPips * pool.lpFeePips) / PIPS_DENOMINATOR)
  const poolFraction = swapFeePips / PIPS_DENOMINATOR

  const hookTakes = hook !== null && hook.readable && hook.configured && hook.enabled && !hook.globallyPaused
  const hookFraction = hookTakes ? hook.feePips / PIPS_DENOMINATOR : 0

  return {
    poolFraction,
    hookFraction,
    totalFraction: 1 - (1 - poolFraction) * (1 - hookFraction),
  }
}

/* ---------------------------------------------------------------------------
   Failure decoding — the house pattern, matched to this surface's reverts.
   --------------------------------------------------------------------------- */

export type FailureKind = 'rejected' | 'contract' | 'chain'

export interface DecodedFailure {
  kind: FailureKind
  name: string | null
  message: string
  detail: string
}

/**
 * Plain-English copy for the reverts a swap can actually provoke.
 *
 * Only reverts this path can REACH are listed. Inventing copy for an error the
 * router cannot throw here would be its own small fiction, and it would crowd
 * out the ones a trader will really see.
 */
const ERROR_COPY: Record<string, (args: readonly unknown[]) => string> = {
  /* Permit2. The single most common failure on a first trade. */
  /* Permit2 uses ONE error for "never approved" and "approved, then expired" —
     an unset allowance has expiration 0, which is in the past. Those are very
     different things to a reader, so they are told apart here rather than both
     being reported as an expiry. */
  AllowanceExpired: ([deadline]) =>
    String(deadline) === '0'
      ? 'Permit2 holds no allowance for the router on this token. The router pays the vault ' +
        'through Permit2, so an ERC-20 approval to the router alone does nothing — grant the ' +
        'Permit2 allowance and try again.'
      : `The Permit2 allowance for the router expired at unix ${String(deadline)}. ` +
        'Re-approve on Permit2 — the ERC-20 approval to Permit2 does not expire, but the ' +
        'Permit2 allowance to the router carries an expiry and this one has passed.',
  InsufficientAllowance: ([amount]) =>
    `Permit2 holds an allowance of ${String(amount)} for the router, which does not cover this trade. ` +
    'Approve the router on Permit2 for at least the input amount.',
  ExcessiveInvalidation: () => 'Permit2 rejected the nonce invalidation. Nothing was spent.',

  /* Slippage — the bound doing its job. */
  TooLittleReceived: (args) =>
    `The swap would have returned ${String(args[1])} base units against your minimum of ${String(args[0])}. ` +
    'The trade was refused rather than filled at a worse rate. Re-quote, or raise the slippage tolerance ' +
    'if you accept the difference.',
  TooMuchRequested: (args) =>
    `Settling the input needed ${String(args[1])} base units against a cap of ${String(args[0])}. ` +
    'Re-quote — the pool moved since this transaction was built.',
  ExactOutputUnfilled: (args) =>
    `The pool could only deliver ${String(args[1])} of the ${String(args[0])} requested.`,

  /* Liquidity and pool state. */
  NotEnoughLiquidity: ([poolId]) =>
    `Pool ${typeof poolId === 'string' ? shortHex(poolId, 10, 8) : String(poolId)} does not hold enough ` +
    'liquidity to fill this size. Try a smaller amount.',
  PoolNotInitialized: () => 'This pool has not been initialized, so it cannot be swapped through.',

  /* Router-level. */
  TransactionDeadlinePassed: () =>
    'The deadline on this transaction had already passed when it reached the router. Re-quote and send again.',
  EnforcedPause: () =>
    'The UniversalRouter is paused. No swap can be routed through it until its owner unpauses. ' +
    'The pools themselves are unaffected.',
  ExecutionFailed: (args) =>
    `Command ${String(args[0])} in the router plan failed. The inner reason is in the raw error below.`,
  LengthMismatch: () => 'The router was handed a different number of commands and inputs. This is a bug in the app.',
  InvalidCommandType: ([command]) =>
    `The router does not implement command ${String(command)}. This is a bug in the app.`,
  UnsupportedAction: ([action]) =>
    `The router does not implement action ${String(action)}. This is a bug in the app.`,
  SliceOutOfBounds: () =>
    'The router could not decode the plan it was handed. This is an encoding bug in the app, not a pool problem.',

  /* Vault accounting — reached when the plan settles or takes the wrong side. */
  DeltaNotPositive: ([currency]) =>
    `The plan tried to collect ${String(currency)} while owing it. This is a bug in the app.`,
  DeltaNotNegative: ([currency]) =>
    `The plan tried to pay ${String(currency)} while being owed it. This is a bug in the app.`,
  CurrencyNotSettled: () =>
    'The vault refused to close the lock with a currency unsettled. This is a bug in the app.',

  /* The hook's own guards, which run inside the swap. */
  PoolMustUseStaticFee: () =>
    'The pool’s hook refuses pools with a dynamic LP fee, so this swap cannot be routed.',
}

export function decodeSwapFailure(error: unknown): DecodedFailure | null {
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
      const copy = name ? ERROR_COPY[name] : undefined
      if (name && copy) return { kind: 'contract', name, message: copy(args), detail }
      if (name) {
        return {
          kind: 'contract',
          name,
          message: `The contract reverted with ${name}(${args.map(String).join(', ')}).`,
          detail,
        }
      }
      return {
        kind: 'contract',
        name: null,
        message:
          reverted.reason ??
          'The contract reverted without a reason this build can decode. The raw error is below — it is the ' +
            'chain’s answer verbatim, not a guess at what it meant.',
        detail,
      }
    }
  }

  return {
    kind: 'chain',
    name: null,
    message:
      `${D.name} could not be reached, or the call failed before it got to a contract. ` +
      'This is not a verdict on the trade — nothing was sent.',
    detail,
  }
}

export function explorerTxUrl(hash: Hex): string {
  return `${D.explorer}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${D.explorer}/address/${address}`
}
