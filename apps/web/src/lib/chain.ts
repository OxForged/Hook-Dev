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
