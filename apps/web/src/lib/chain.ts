import {
  createPublicClient,
  http,
  fallback,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'

/**
 * Live reader for the deployed Latch Protocol contracts.
 *
 * This is the real half of the dapp's mock/live seam. Everything here talks to
 * chain; nothing here invents a number. If a read fails it throws, and the caller
 * decides what to show — a screen must never render a fabricated figure as if it
 * came from chain.
 *
 * Only Sepolia has a deployment. Adding a chain means adding an entry to
 * DEPLOYMENTS, not changing any logic here.
 */

export const SEPOLIA_CHAIN_ID = 11155111

/** Verified on Etherscan. See packages/core/script/config/latch-sepolia.json. */
export const DEPLOYMENTS = {
  [SEPOLIA_CHAIN_ID]: {
    name: 'Ethereum Sepolia',
    explorer: 'https://sepolia.etherscan.io',
    vault: '0xCe3d133eb486b448A53437A5073619FbE424d01B',
    clPoolManager: '0xb7C8a11E0B359616eD06256783aF57114841F738',
    binPoolManager: '0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3',
    feeController: '0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9',
    create3Factory: '0x76473D174Aa17C23FBE49CAb50aAc4ED4d8c678F',
    /** Hook marketplace backing contract. Permissions are read off each hook on chain. */
    registry: '0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE',
    /** 48h tier. Owns Vault + pool managers on mainnet, because registerApp is irreversible. */
    timelockCustody: '0x35D72DbEeD5F2CE95a4DFb3917D2CD3c43e544CA',
    /** 6h tier. Owns fee policy, which is reversible. */
    timelockPolicy: '0x30897C9e7c1c336cDF68C7494f930C75A355d42F',

    // Periphery + router. Until these existed, a developer had to write their own
    // ILockCallback to add liquidity or swap; now there is a real path.
    universalRouter: '0xB647CEbd5b8d6bE38C198634828187F482f4874B',
    clPositionManager: '0xb3505d48A84651c104a02D41B2b9D8CB84dFEC33',
    binPositionManager: '0x965b1D98BB0cd4E0125D78AD17ea4d2D1d62AE6f',
    clQuoter: '0x4471e61fE697204908CA97CdF4810EeAf406e9C1',
    binQuoter: '0x3544C594f12F7c89aa1D8C596d793b661206Ab17',
    clPositionDescriptor: '0xFe386132bE4A3D85267488A1C64061ba691cfc7a',
    permit2: '0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768',
    weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    /**
     * The pool created by the live exercise in
     * packages/fees/script/ExerciseSepolia.s.sol. Real liquidity, real swaps.
     */
    demoPool: {
      id: '0x1373a1db3e21b471647422e89bd87e4e97c0a5d0d2af24194226a40a5a402b38',
      token0: '0x5c00ea81EedcED610c5174b9D20F83Ca245e269C',
      token1: '0xbEf6E0f94Fe1a96390Eb25D32759aad85fD1f067',
      symbol0: 'ltUSD',
      symbol1: 'ltETH',
      lpFee: 3000,
      tickSpacing: 60,
    },
    /** Block the protocol was deployed at — log scans start here, not from genesis. */
    deployedAtBlock: 11672600n,
  },
} as const

export type DeployedChainId = keyof typeof DEPLOYMENTS

export function isDeployed(chainId: number): chainId is DeployedChainId {
  return chainId in DEPLOYMENTS
}

/**
 * Public RPCs verified by probe. Sepolia has exactly ONE working public endpoint,
 * so there is no real failover here — see packages/sdk/src/chains/endpoints.ts.
 * `fallback` is still used so adding an endpoint is a one-line change.
 */
const RPCS: Record<DeployedChainId, readonly string[]> = {
  [SEPOLIA_CHAIN_ID]: ['https://ethereum-sepolia-rpc.publicnode.com'],
}

let cached: PublicClient | undefined

export function client(chainId: DeployedChainId = SEPOLIA_CHAIN_ID): PublicClient {
  if (cached) return cached
  cached = createPublicClient({
    transport: fallback(
      RPCS[chainId].map((u) => http(u, { timeout: 12_000, retryCount: 2 })),
      { rank: false },
    ),
  })
  return cached
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
  'function feesDisabled() view returns (bool)',
  'function guardian() view returns (address)',
  'function owner() view returns (address)',
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
  'function hookCount() view returns (uint256)',
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
  defaultFeePips: number
  maxFeePips: number
  feesDisabled: boolean
  guardian: Address
  blockNumber: bigint
}

/** Live protocol state. Every field is read from chain. */
export async function readProtocolStatus(
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
): Promise<ProtocolStatus> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  const [clReg, binReg, vaultOwner, defFee, maxFee, disabled, guardian, blockNumber] =
    await Promise.all([
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'isAppRegistered', args: [d.clPoolManager] }),
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'isAppRegistered', args: [d.binPoolManager] }),
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'owner' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'DEFAULT_FEE_PIPS' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'MAX_PROTOCOL_FEE' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'feesDisabled' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'guardian' }),
      c.getBlockNumber(),
    ])

  return {
    chainId,
    chainName: d.name,
    vault: d.vault,
    vaultOwner,
    clRegistered: clReg,
    binRegistered: binReg,
    defaultFeePips: defFee,
    maxFeePips: maxFee,
    feesDisabled: disabled,
    guardian,
    blockNumber,
  }
}

export interface VaultHolding {
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
): Promise<VaultHolding[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const tokens = [d.demoPool.token0, d.demoPool.token1] as const

  return Promise.all(
    tokens.map(async (token) => {
      const [balance, symbol, decimals, clReserve] = await Promise.all([
        c.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [d.vault] }),
        c.readContract({ address: token, abi: ERC20, functionName: 'symbol' }),
        c.readContract({ address: token, abi: ERC20, functionName: 'decimals' }),
        c.readContract({ address: d.vault, abi: VAULT, functionName: 'reservesOfApp', args: [d.clPoolManager, token] }),
      ])
      return { token, symbol, decimals, balance, clReserve }
    }),
  )
}

export interface SwapRecord {
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
): Promise<GovernanceStatus> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const [hookCount, custodyDelaySec, policyDelaySec] = await Promise.all([
    c.readContract({ address: d.registry, abi: REGISTRY, functionName: 'hookCount' }),
    c.readContract({ address: d.timelockCustody, abi: TIMELOCK, functionName: 'getMinDelay' }),
    c.readContract({ address: d.timelockPolicy, abi: TIMELOCK, functionName: 'getMinDelay' }),
  ])
  return { registry: d.registry, hookCount, custodyDelaySec, policyDelaySec }
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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

export interface RegisteredHook {
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
}

/**
 * Every hook listed in the registry.
 *
 * Capability flags come from the registry's own pure classifiers rather than being
 * re-derived here. Three components describing one bitmap three different ways is
 * how a user ends up trusting a hook the chain would have warned them about.
 */
export async function readRegisteredHooks(
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
): Promise<RegisteredHook[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const abi = registryAbi

  const count = await c.readContract({ address: d.registry, abi, functionName: 'hookCount' }) as bigint
  if (count === 0n) return []

  const addrs = (await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      c.readContract({ address: d.registry, abi, functionName: 'hookAt', args: [BigInt(i)] }),
    ),
  )) as Address[]

  return Promise.all(
    addrs.map(async (a) => {
      const r = (await c.readContract({
        address: d.registry, abi, functionName: 'getHook', args: [a],
      })) as any
      const p = Number(r.permissions)
      const [risk, cut, block, trap] = (await Promise.all([
        c.readContract({ address: d.registry, abi, functionName: 'classify', args: [p] }),
        c.readContract({ address: d.registry, abi, functionName: 'takesSwapCut', args: [p] }),
        c.readContract({ address: d.registry, abi, functionName: 'canBlockSwaps', args: [p] }),
        c.readContract({ address: d.registry, abi, functionName: 'canTrapLiquidity', args: [p] }),
      ])) as [number, boolean, boolean, boolean]

      return {
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
      }
    }),
  )
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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
      kind: 'Initialize',
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      detail: `pool created · fee ${Number(l.args.fee)} pips · ${hooked ? 'hook attached' : 'no hook'}`,
    })
  }
  for (const l of swaps) {
    out.push({
      kind: 'Swap',
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      detail: `${Number(l.args.fee)} pips total · ${Number(l.args.protocolFee)} to protocol`,
    })
  }
  for (const l of mods) {
    const delta = l.args.liquidityDelta as bigint
    out.push({
      kind: delta >= 0n ? 'Add liquidity' : 'Remove liquidity',
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      detail: `ticks ${Number(l.args.tickLower)} to ${Number(l.args.tickUpper)}`,
    })
  }
  for (const l of donates) {
    out.push({
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
): Promise<bigint> {
  return client(chainId).getBlockNumber()
}
