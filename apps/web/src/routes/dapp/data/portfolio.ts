/* ============================================================================
   Portfolio data — what one address actually holds in Latch Protocol.

   This used to be a mock seam: five invented pairs, dollar values and a
   "FEES 30D" column for a wallet that did not exist. It is now a live reader,
   in the same shape as lib/chain.ts: every figure comes from the chain being
   browsed — `chainId` is a parameter here, never a literal — and if a read
   fails it THROWS. The screen decides what to show; it never substitutes a
   placeholder.

   What can genuinely be read for an address today:

     1. CL liquidity positions. CLPositionManager is a solmate ERC-721 — no
        `tokenOfOwnerByIndex` — so enumeration goes through its `Transfer` logs
        (indexed `to`) from the deployment block, confirmed by `ownerOf` so a
        token later sold or burned is not attributed to its previous holder.
        For each token: pool, ticks, liquidity, and — from the pool's slot0,
        tick info and fee-growth globals — the current token amounts and the
        fees earned since last touch, computed exactly as the pool credits them.
     2. Wallet balances of the protocol's known tokens (ltUSD, ltETH).
     3. Hooks the address has listed in LatchRegistry as submitter.

   What is NOT read, and is said so on screen rather than faked:
     - Bin (ERC-1155) positions from BinPositionManager.
     - Fees already collected — those left the protocol; only a full log
       replay of the address's own ModifyLiquidity calls could reconstruct
       them, and this screen does not pretend to.
     - Any USD value. Nothing prices these testnet tokens.
   ============================================================================ */

import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'

import {
  DEPLOYMENTS,
  ACTIVE_CHAIN_ID,
  client,
  readRegisteredLatches,
  type DeployedChainId,
  type RegisteredLatch,
} from '../../../lib/chain'
import {
  amountsForLiquidity,
  tickSpacingFromParameters,
  uncollectedFees,
} from '../lib/portfolioMath'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/* ---------------------------------------------------------------------------
   ABIs — only what is read, human-readable so they stay auditable inline.
   Signatures mirror packages/periphery ICLPositionManager and packages/core
   ICLPoolManager; a drift here fails loudly (revert / decode error), never
   silently.
   --------------------------------------------------------------------------- */

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const POSITION_MANAGER = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function positions(uint256) view returns ((address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters) poolKey, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, address subscriber)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed id)',
])

const CL_POOL_MANAGER = parseAbi([
  'function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getFeeGrowthGlobals(bytes32) view returns (uint256 feeGrowthGlobal0x128, uint256 feeGrowthGlobal1x128)',
  'function getPoolTickInfo(bytes32, int24) view returns ((uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128))',
])

const POOL_KEY_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'hooks', type: 'address' },
      { name: 'poolManager', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'parameters', type: 'bytes32' },
    ],
  },
] as const

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export interface TokenMeta {
  address: Address
  symbol: string
  decimals: number
  /** address(0) is the chain's native currency — no ERC-20 to query. */
  isNative: boolean
}

export interface LpPosition {
  tokenId: bigint
  poolId: Hex
  token0: TokenMeta
  token1: TokenMeta
  hooks: Address
  hasHook: boolean
  /** Registry name when the hook is listed; null when not listed or when there is no hook. */
  hookName: string | null
  lpFeePips: number
  tickSpacing: number
  tickLower: number
  tickUpper: number
  currentTick: number
  liquidity: bigint
  /** Token the position would return on full withdrawal, base units. */
  amount0: bigint
  amount1: bigint
  inRange: boolean
  /** Fees earned since the position was last touched, base units. */
  fees0: bigint
  fees1: bigint
}

export interface WalletBalance {
  token: TokenMeta
  balance: bigint
}

export interface Portfolio {
  chainId: DeployedChainId
  address: Address
  checkedAtBlock: bigint
  positions: LpPosition[]
  balances: WalletBalance[]
  submittedHooks: RegisteredLatch[]
}

/* ---------------------------------------------------------------------------
   Reads
   --------------------------------------------------------------------------- */

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function poolIdOf(key: {
  currency0: Address
  currency1: Address
  hooks: Address
  poolManager: Address
  fee: number
  parameters: Hex
}): Hex {
  return keccak256(encodeAbiParameters(POOL_KEY_ABI, [key]))
}

async function readTokenMeta(
  chainId: DeployedChainId,
  address: Address,
  cache: Map<string, Promise<TokenMeta>>,
): Promise<TokenMeta> {
  const k = address.toLowerCase()
  const hit = cache.get(k)
  if (hit) return hit
  const p = (async (): Promise<TokenMeta> => {
    if (address === ZERO_ADDRESS) {
      return { address, symbol: 'ETH', decimals: 18, isNative: true }
    }
    const c = client(chainId)
    const [symbol, decimals] = await Promise.all([
      c.readContract({ address, abi: ERC20, functionName: 'symbol' }),
      c.readContract({ address, abi: ERC20, functionName: 'decimals' }),
    ])
    return { address, symbol, decimals, isNative: false }
  })()
  cache.set(k, p)
  return p
}

/**
 * Token IDs the address currently owns on the CL position manager.
 *
 * Candidates come from `Transfer(to = address)` logs; each is then confirmed with
 * `ownerOf`, which reverts for a burned token and returns the new holder for a
 * transferred one. Both are dropped. The log scan is bounded by the wallet's own
 * activity, not by the total supply, so it stays cheap as the protocol grows.
 */
async function readOwnedTokenIds(
  chainId: DeployedChainId,
  owner: Address,
): Promise<bigint[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  const logs = await c.getLogs({
    address: d.clPositionManager,
    event: POSITION_MANAGER[2],
    args: { to: owner },
    fromBlock: d.deployedAtBlock,
    toBlock: 'latest',
  })

  const candidates = [...new Set(logs.map((l) => l.args.id as bigint))]

  const owned = await Promise.all(
    candidates.map(async (id) => {
      try {
        const holder = await c.readContract({
          address: d.clPositionManager,
          abi: POSITION_MANAGER,
          functionName: 'ownerOf',
          args: [id],
        })
        return same(holder, owner) ? id : null
      } catch {
        return null // burned
      }
    }),
  )

  return owned.filter((id): id is bigint => id !== null).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

async function readPosition(
  chainId: DeployedChainId,
  tokenId: bigint,
  tokenCache: Map<string, Promise<TokenMeta>>,
  hookNames: Map<string, string>,
): Promise<LpPosition> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  const [key, tickLower, tickUpper, liquidity, feeGrowthInside0Last, feeGrowthInside1Last] =
    await c.readContract({
      address: d.clPositionManager,
      abi: POSITION_MANAGER,
      functionName: 'positions',
      args: [tokenId],
    })

  const poolId = poolIdOf(key)

  const [slot0, globals, lowerInfo, upperInfo, token0, token1] = await Promise.all([
    c.readContract({ address: d.clPoolManager, abi: CL_POOL_MANAGER, functionName: 'getSlot0', args: [poolId] }),
    c.readContract({ address: d.clPoolManager, abi: CL_POOL_MANAGER, functionName: 'getFeeGrowthGlobals', args: [poolId] }),
    c.readContract({ address: d.clPoolManager, abi: CL_POOL_MANAGER, functionName: 'getPoolTickInfo', args: [poolId, tickLower] }),
    c.readContract({ address: d.clPoolManager, abi: CL_POOL_MANAGER, functionName: 'getPoolTickInfo', args: [poolId, tickUpper] }),
    readTokenMeta(chainId, key.currency0, tokenCache),
    readTokenMeta(chainId, key.currency1, tokenCache),
  ])

  const [sqrtPriceX96, currentTick] = slot0
  const [feeGrowthGlobal0, feeGrowthGlobal1] = globals

  const amounts = amountsForLiquidity(liquidity, tickLower, tickUpper, currentTick, sqrtPriceX96)
  const fees = uncollectedFees(
    liquidity,
    tickLower,
    tickUpper,
    currentTick,
    feeGrowthGlobal0,
    feeGrowthGlobal1,
    lowerInfo,
    upperInfo,
    feeGrowthInside0Last,
    feeGrowthInside1Last,
  )

  const hasHook = key.hooks !== ZERO_ADDRESS

  return {
    tokenId,
    poolId,
    token0,
    token1,
    hooks: key.hooks,
    hasHook,
    hookName: hasHook ? (hookNames.get(key.hooks.toLowerCase()) ?? null) : null,
    lpFeePips: key.fee,
    tickSpacing: tickSpacingFromParameters(key.parameters),
    tickLower,
    tickUpper,
    currentTick,
    liquidity,
    amount0: amounts.amount0,
    amount1: amounts.amount1,
    inRange: amounts.inRange,
    fees0: fees.fees0,
    fees1: fees.fees1,
  }
}

async function readWalletBalances(
  chainId: DeployedChainId,
  owner: Address,
  tokenCache: Map<string, Promise<TokenMeta>>,
): Promise<WalletBalance[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  /* Same reason as readVaultHoldings: the demo pool is the only source of
     "which tokens to check". No pool, no known tokens, empty list. */
  if (d.demoPool === null) return []
  const tokens = [d.demoPool.token0, d.demoPool.token1] as const
  return Promise.all(
    tokens.map(async (address) => {
      const [token, balance] = await Promise.all([
        readTokenMeta(chainId, address, tokenCache),
        c.readContract({ address, abi: ERC20, functionName: 'balanceOf', args: [owner] }),
      ])
      return { token, balance }
    }),
  )
}

/**
 * Everything the protocol knows about one address. Throws on any failed read —
 * a partially real portfolio is worse than an error, because the reader cannot
 * tell which half to trust.
 */
export async function readPortfolio(
  address: Address,
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<Portfolio> {
  const c = client(chainId)
  const tokenCache = new Map<string, Promise<TokenMeta>>()

  const [checkedAtBlock, tokenIds, balances, hooks] = await Promise.all([
    c.getBlockNumber(),
    readOwnedTokenIds(chainId, address),
    readWalletBalances(chainId, address, tokenCache),
    readRegisteredLatches(chainId),
  ])

  // Hook names for the position table come from the registry, never from the hook.
  const hookNames = new Map(hooks.map((h) => [h.address.toLowerCase(), h.name]))

  const positions = await Promise.all(
    tokenIds.map((id) => readPosition(chainId, id, tokenCache, hookNames)),
  )

  return {
    chainId,
    address,
    checkedAtBlock,
    positions,
    balances,
    submittedHooks: hooks.filter((h) => same(h.submitter, address)),
  }
}
