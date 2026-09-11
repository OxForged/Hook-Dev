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
export const ROBINHOOD_CHAIN_ID = 4663

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
    /** Latch Marketplace backing contract. Permissions are read off each Latch on chain.
     *  Redeployed 2026-09-10 as LatchRegistry (was LatchHookRegistry). The old registry at
     *  0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE still answers `hookCount()` and still holds
     *  the original listing, but nothing reads it — it is retired, not migrated. */
    registry: '0xB504da43C6ED342a511f3e5849f53035F2C807d1',
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
    /** The hook the Sepolia exercise deployed and drove a full revenue cycle
        through. It PREDATES keyOf/hasKey/totalTaken and reverts on all three;
        the dapp reads none of them, summing RevShareTaken logs instead. */
    revShareHook: '0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28',
    /** Block the protocol was deployed at — log scans start here, not from genesis. */
    deployedAtBlock: 11672600n,
  },

  /* Robinhood Chain — the FIRST MAINNET. Deployed 2026-09-11; see
     ops/safe/robinhood-deployment.md for the full record and
     packages/core/script/config/latch-robinhood.json for the source config.
     All eighteen contracts are verified on Sourcify.

     Two differences from Sepolia that matter to anything reading this table:

     · GOVERNANCE IS REAL HERE. On Sepolia the deployer EOA still owns
       everything and the timelocks own nothing, so they can be shown as
       deployed-but-inert. Here every contract answers to the 2-of-3 Safe, and
       the handover to these timelocks is queued. A screen that says "owned by
       a timelock" must read owner() rather than assume it from this file.

     · THERE IS NO demoPool. Nothing has been initialised on mainnet yet, so
       any surface that reaches for one has to handle its absence rather than
       fall back to Sepolia's — showing a testnet pool under a mainnet chain
       header would be the worst kind of wrong. */
  [ROBINHOOD_CHAIN_ID]: {
    name: 'Robinhood Chain',
    explorer: 'https://robinhoodchain.blockscout.com',
    vault: '0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c',
    clPoolManager: '0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66',
    binPoolManager: '0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979',
    feeController: '0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c',
    create3Factory: '0x6ffdf9a3df7e9dd55bad2e60c7405cd181005633',
    registry: '0xE4395085De89365440A6Ee25cE24BE2bAD66AC86',
    /** 48h tier. Vault + both pool manager owners. */
    timelockCustody: '0x63F08A697Cc003d5eA61787712C34438559a7428',
    /** 6h tier. Fee controllers, descriptor, router. */
    timelockPolicy: '0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A',

    universalRouter: '0x2220dF8ec6CABC7f2074bC1e56DA092B765f736c',
    clPositionManager: '0x957cc13b24a563cc92253213d9d5e6954c8db6a7',
    binPositionManager: '0x990f395003c35a0ab390e10b003972407f882399',
    clQuoter: '0xdfd14247f87d1e4fc82f0f441fb43bc8aa466114',
    binQuoter: '0xbee22c7edf206b3f24fa0e86ccdd2f35738eb28c',
    clPositionDescriptor: '0x0af03bee134ce66ee12425ee05a50f32c72644eb',
    /** Canonical Permit2, confirmed by reading code at the address. */
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    /** Canonical per docs.robinhood.com/chain/contracts. The usual predeploys
        0x4200..06 and 0xC02aaA.. have NO CODE on this chain. */
    weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    /** RevShareHook. Owner is the Safe from the constructor — this contract is
        the one exception to the two-step pattern everywhere else here, because
        it passes owner_ straight to Ownable(). Guardian is the ops key and can
        only pause, never unpause. Takes nothing until a pool owner configures. */
    revShareHook: '0x23CE34E8199927DD270dddd8579c947542bDE446',
    demoPool: null,
    /** Block the first Latch contract landed — the two timelocks. */
    deployedAtBlock: 60111836n,
  },
} as const

export type DeployedChainId = keyof typeof DEPLOYMENTS

export function isDeployed(chainId: number): chainId is DeployedChainId {
  return chainId in DEPLOYMENTS
}

/**
 * Public RPCs verified by probe, fastest-first.
 *
 * Five independent operators, all of which answered `eth_chainId` and served
 * `eth_blockNumber` on 2026-09-10 — mirrors the Sepolia entry in
 * `packages/sdk/src/chains/endpoints.ts`, which carries the methodology and the
 * record of what was tried and failed. This used to be a single endpoint, so a
 * rate-limited publicnode meant the whole dapp read nothing.
 *
 * None of these carries an API key. Keyed providers belong in the environment.
 */
const RPCS: Record<DeployedChainId, readonly string[]> = {
  /* Ordered fastest-first from the SDK's live probe (packages/sdk/src/chains/
     endpoints.ts), not hand-picked. All five answer EIP-1153. */
  [ROBINHOOD_CHAIN_ID]: [
    'https://rpc.nodeflare.app/robinhood/public',
    'https://robinhood.rpc.blxrbdn.com',
    'https://rpc-robinhood.blockmachine.io',
    'https://rpc.ordofi.network',
    'https://rpc.mainnet.chain.robinhood.com',
  ],
  [SEPOLIA_CHAIN_ID]: [
    'https://11155111.rpc.thirdweb.com',
    'https://gateway.tenderly.co/public/sepolia',
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://1rpc.io/sepolia',
    'https://0xrpc.io/sep',
  ],
}

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
  return RPCS[chainId] ?? []
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
export function client(chainId: DeployedChainId = SEPOLIA_CHAIN_ID): PublicClient {
  const hit = clients.get(chainId)
  if (hit) return hit

  const urls = RPCS[chainId]
  if (!urls || urls.length === 0) {
    // Louder than returning some other chain's client, which is what the old
    // single-cache version effectively did.
    throw new Error(
      `No RPC endpoints for chain ${chainId}. Add it to RPCS, sourced from ` +
        `packages/sdk/src/chains/endpoints.ts where every URL was probed.`,
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
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
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
): Promise<bigint> {
  return client(chainId).getBlockNumber()
}
