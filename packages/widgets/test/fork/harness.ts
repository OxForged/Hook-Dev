// SPDX-License-Identifier: MIT
/**
 * The fork harness.
 *
 * Boots one anvil forked from Sepolia, funds an account, and hands back a live
 * `createViemAdapter` wired to the **deployed** Latch stack. From there a fork
 * suite builds calldata with this package's ordinary public API and **sends it**.
 *
 * ## Nothing of the protocol is deployed by this harness
 *
 * Core, periphery and the universal router are all live on Sepolia and wired to
 * each other. {@link assertLiveStack} re-reads that wiring on the fork before any
 * test runs, rather than trusting the address list: PancakeSwap also has a
 * `UniversalRouter` on Sepolia (`0x19Dbcfc8…`, vault `0x4670F769…`), and calldata
 * sent to the wrong one fails in a way that reads like an encoding bug.
 *
 * The only contracts the harness ever deploys are a `MockERC20` third token and
 * a second pool, and only in the multi-hop suite, which needs a route Sepolia
 * does not have. Those are called out where they happen.
 *
 * ## Permit2 is the PancakeSwap fork
 *
 * `0x31c2F6fc…`, not the canonical `0x0000000000022D473…`. It is an immutable in
 * the router and the position managers, so approving the wrong one leaves the
 * real spender with no allowance. {@link assertLiveStack} checks it.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createViemAdapter, type ViemAdapterOverrides } from "../../src/adapters/viem.js";
import { ERC20_ABI, PERMIT2_ABI, MAX_UINT160, MAX_UINT48 } from "../../src/callpath/constants.js";
import type { ChainConfig } from "../../src/config/chain.js";
import type {
  PoolInfo,
  ProtocolAdapter,
  SwapQuoteRequest,
  SwapQuoteResult,
  TokenInfo,
} from "../../src/adapters/protocol.js";
import { startAnvilFork, type AnvilInstance } from "./anvil.js";
import { loadArtifact } from "./artifacts.js";
import {
  CANONICAL_PERMIT2,
  CL_POOL_MANAGER_ABI,
  DERIVED_POOL_ID,
  LATCH_PERIPHERY_SEPOLIA,
  LATCH_SEPOLIA,
  LIVE_POOL_ID,
  LIVE_POOL_KEY,
  LT_ETH,
  LT_USD,
  MOCK_ERC20_ABI,
  PERMIT2,
  POOL_LP_FEE_PIPS,
  POOL_TICK_SPACING,
  SEPOLIA_CHAIN_ID,
} from "./sepolia.js";

/** Anvil's first default account. Local fork only; never a real key. */
const ANVIL_KEY_0: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** Anvil's second default account, used as the integrator's referrer. */
const ANVIL_KEY_1: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/** Gas limit for a swap or a position mint on the fork. */
const FORK_GAS = 6_000_000n;

/** The CLQuoter surface the harness calls. */
const CL_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "hooks", type: "address" },
              { name: "poolManager", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "parameters", type: "bytes32" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/** ERC-721 surface used to approve the position manager's NFT. */
const ERC721_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * The deployed Latch stack, as verified on the fork.
 *
 * Named `deployments` because that is what they are - just not *ours*. Every
 * address here already exists on Sepolia.
 */
export interface ForkDeployments {
  readonly universalRouter: Address;
  readonly clPositionManager: Address;
  readonly binPositionManager: Address;
  readonly clPositionDescriptor: Address;
  readonly clQuoter: Address;
  readonly binQuoter: Address;
  readonly permit2: Address;
}

/** Everything a fork suite needs. */
export interface ForkContext {
  readonly anvil: AnvilInstance;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly user: Address;
  readonly referrer: Address;
  readonly deployments: ForkDeployments;
  readonly chain: ChainConfig;
  readonly pool: PoolInfo;
  readonly token0: TokenInfo;
  readonly token1: TokenInfo;
  readonly adapter: ProtocolAdapter;
  /** Quotes exact-in against the live pool through the deployed CLQuoter. */
  quoteExactInSingle(zeroForOne: boolean, amountIn: bigint): Promise<bigint>;
  /** Mints MockERC20 balance to an address. */
  fund(token: Address, to: Address, amount: bigint): Promise<void>;
  /** ERC-20 -> Permit2 -> spender, the two-step allowance the stack needs. */
  approveThrough(token: Address, spender: Address): Promise<void>;
  balanceOf(token: Address, owner: Address): Promise<bigint>;
  /**
   * Sends a transaction from the user account and waits for it.
   *
   * Throws when the transaction reverts. An explicit gas limit is supplied so
   * the node does not refuse to submit it, which means a failing transaction is
   * *mined* with `status: "reverted"` rather than rejected at estimation - and a
   * harness that only awaited the receipt would score a revert as a pass.
   */
  send(request: { to: Address; data: Hex; value?: bigint }): Promise<TransactionReceipt>;
  /** Same, but returns the receipt whatever its status. */
  sendAllowingRevert(request: {
    to: Address;
    data: Hex;
    value?: bigint;
  }): Promise<TransactionReceipt>;
  /** The `Swap` events the pool manager emitted in a receipt. */
  swapEvents(receipt: TransactionReceipt): readonly {
    amount0: bigint;
    amount1: bigint;
    fee: number;
    protocolFee: number;
  }[];
  teardown(): Promise<void>;
}

function token(address: Address, symbol: string, name: string): TokenInfo {
  return { address, symbol, name, decimals: 18 };
}

/**
 * Boots the fork and returns a ready context.
 *
 * The caller owns {@link ForkContext.teardown}; every suite must call it in
 * `afterAll`, or the anvil process outlives the run.
 */
export async function setupFork(): Promise<ForkContext> {
  if (DERIVED_POOL_ID.toLowerCase() !== LIVE_POOL_ID.toLowerCase()) {
    throw new Error(
      `[fork] LIVE_POOL_KEY hashes to ${DERIVED_POOL_ID}, not the published pool id ` +
        `${LIVE_POOL_ID}. The key is wrong; refusing to test against a pool that does not exist.`,
    );
  }

  const anvil = await startAnvilFork();
  try {
    return await buildContext(anvil);
  } catch (error) {
    await anvil.stop();
    throw error;
  }
}

async function buildContext(anvil: AnvilInstance): Promise<ForkContext> {
  const account = privateKeyToAccount(ANVIL_KEY_0);
  const referrerAccount = privateKeyToAccount(ANVIL_KEY_1);
  const transport = http(anvil.url);
  const publicClient = createPublicClient({ chain: foundry, transport }) as PublicClient;
  const walletClient = createWalletClient({ account, chain: foundry, transport });

  const chainId = await publicClient.getChainId();
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `[fork] anvil reports chain id ${chainId}, expected ${SEPOLIA_CHAIN_ID}. ` +
        "The fork did not attach to Sepolia.",
    );
  }

  const deployments = await assertLiveStack(publicClient);

  const chain: ChainConfig = {
    chainId: SEPOLIA_CHAIN_ID,
    name: "Sepolia (anvil fork)",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    contracts: {
      vault: LATCH_SEPOLIA.vault,
      clPoolManager: LATCH_SEPOLIA.clPoolManager,
      binPoolManager: LATCH_SEPOLIA.binPoolManager,
      universalRouter: deployments.universalRouter,
      clPositionManager: deployments.clPositionManager,
      binPositionManager: deployments.binPositionManager,
      permit2: deployments.permit2,
      quoter: deployments.clQuoter,
    },
    blockExplorerUrl: "https://sepolia.etherscan.io",
  };

  const token0 = token(LT_USD, "ltUSD", "Latch Test USD");
  const token1 = token(LT_ETH, "ltETH", "Latch Test ETH");

  const pool: PoolInfo = {
    id: LIVE_POOL_ID,
    key: LIVE_POOL_KEY,
    poolType: "CL",
    token0,
    token1,
    lpFeePips: POOL_LP_FEE_PIPS,
    tickSpacing: POOL_TICK_SPACING,
    hooks: ZERO_ADDRESS,
  };

  async function quoteExactInSingle(zeroForOne: boolean, amountIn: bigint): Promise<bigint> {
    const { result } = await publicClient.simulateContract({
      address: deployments.clQuoter,
      abi: CL_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: {
            currency0: LIVE_POOL_KEY.currency0,
            currency1: LIVE_POOL_KEY.currency1,
            hooks: LIVE_POOL_KEY.hooks,
            poolManager: LIVE_POOL_KEY.poolManager,
            fee: LIVE_POOL_KEY.fee,
            parameters: LIVE_POOL_KEY.parameters,
          },
          zeroForOne,
          exactAmount: amountIn,
          hookData: "0x",
        },
      ],
      account: account.address,
    });
    const [amountOut] = result;
    return amountOut;
  }

  const overrides: ViemAdapterOverrides = {
    async quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResult> {
      const zeroForOne =
        request.tokenIn.address.toLowerCase() === LIVE_POOL_KEY.currency0.toLowerCase();
      const grossAmountOut = await quoteExactInSingle(zeroForOne, request.amountIn);
      return {
        route: [
          {
            poolId: LIVE_POOL_ID,
            poolType: "CL",
            tokenIn: request.tokenIn,
            tokenOut: request.tokenOut,
            lpFeePips: POOL_LP_FEE_PIPS,
            hooks: ZERO_ADDRESS,
          },
        ],
        amountIn: request.amountIn,
        grossAmountOut,
        spotAmountOut: null,
        lpFeeAmount: (request.amountIn * BigInt(POOL_LP_FEE_PIPS)) / 1_000_000n,
        lpFeePips: POOL_LP_FEE_PIPS,
        estimatedGas: null,
        source: "live",
      };
    },
  };

  const adapter = createViemAdapter({
    chain,
    publicClient,
    wallet: {
      getAccount: async () => account.address,
      sendTransaction: async (tx) => {
        const hash = await walletClient.sendTransaction({
          account,
          chain: foundry,
          to: tx.to,
          data: tx.data,
          value: tx.value,
          gas: FORK_GAS,
        });
        return hash;
      },
    },
    tokens: [token0, token1],
    pools: [pool],
    overrides,
  });

  async function fund(tokenAddress: Address, to: Address, amount: bigint): Promise<void> {
    const hash = await walletClient.writeContract({
      account,
      chain: foundry,
      address: tokenAddress,
      abi: MOCK_ERC20_ABI,
      functionName: "mint",
      args: [to, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function approveThrough(tokenAddress: Address, spender: Address): Promise<void> {
    const permit2 = deployments.permit2;
    const erc20 = await walletClient.writeContract({
      account,
      chain: foundry,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [permit2, (1n << 256n) - 1n],
    });
    await publicClient.waitForTransactionReceipt({ hash: erc20 });
    const permit = await walletClient.writeContract({
      account,
      chain: foundry,
      address: permit2,
      abi: PERMIT2_ABI,
      functionName: "approve",
      args: [tokenAddress, spender, MAX_UINT160, Number(MAX_UINT48)],
    });
    await publicClient.waitForTransactionReceipt({ hash: permit });

    // Read it back. Approving the *wrong* Permit2 - the canonical one rather
    // than the fork this deployment is built against - succeeds silently and
    // only surfaces later as an opaque settle failure.
    const [allowance] = await publicClient.readContract({
      address: permit2,
      abi: PERMIT2_ABI,
      functionName: "allowance",
      args: [account.address, tokenAddress, spender],
    });
    if (allowance === 0n) {
      throw new Error(
        `[fork] Permit2 ${permit2} reports no allowance for ${spender} over ${tokenAddress} ` +
          "immediately after approving it",
      );
    }
  }

  async function balanceOf(tokenAddress: Address, owner: Address): Promise<bigint> {
    return publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    });
  }

  async function sendAllowingRevert(request: {
    to: Address;
    data: Hex;
    value?: bigint;
  }): Promise<TransactionReceipt> {
    const hash = await walletClient.sendTransaction({
      account,
      chain: foundry,
      to: request.to,
      data: request.data,
      value: request.value ?? 0n,
      gas: FORK_GAS,
    });
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function send(request: {
    to: Address;
    data: Hex;
    value?: bigint;
  }): Promise<TransactionReceipt> {
    const receipt = await sendAllowingRevert(request);
    if (receipt.status !== "success") {
      // Re-run as a call so the revert reason surfaces instead of "reverted".
      let reason = "no reason returned";
      try {
        await publicClient.call({
          account,
          to: request.to,
          data: request.data,
          value: request.value ?? 0n,
          blockNumber: receipt.blockNumber - 1n,
        });
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
      throw new Error(
        `[fork] transaction to ${request.to} reverted (${receipt.transactionHash}):\n${reason}`,
      );
    }
    return receipt;
  }

  function swapEvents(receipt: TransactionReceipt): readonly {
    amount0: bigint;
    amount1: bigint;
    fee: number;
    protocolFee: number;
  }[] {
    const logs = parseEventLogs({
      abi: CL_POOL_MANAGER_ABI,
      eventName: "Swap",
      logs: receipt.logs,
    });
    return logs.map((log) => ({
      amount0: log.args.amount0,
      amount1: log.args.amount1,
      fee: log.args.fee,
      protocolFee: log.args.protocolFee,
    }));
  }

  return {
    anvil,
    publicClient,
    walletClient,
    user: account.address,
    referrer: referrerAccount.address,
    deployments,
    chain,
    pool,
    token0,
    token1,
    adapter,
    quoteExactInSingle,
    fund,
    approveThrough,
    balanceOf,
    send,
    sendAllowingRevert,
    swapEvents,
    async teardown() {
      await anvil.stop();
    },
  };
}

/** Reads an `address` getter with no arguments. */
const ADDRESS_GETTER_ABI = [
  { type: "function", name: "vault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "clPoolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "binPoolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  { type: "function", name: "permit2", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "poolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Verifies the deployed stack on the fork before any test uses it.
 *
 * Every check here has a specific failure it prevents. The address list is a
 * claim; the chain is the authority, and a harness that trusts the list will
 * happily blame the encoder for a mis-wired deployment.
 */
async function assertLiveStack(publicClient: PublicClient): Promise<ForkDeployments> {
  const all: Record<string, Address> = { ...LATCH_SEPOLIA, ...LATCH_PERIPHERY_SEPOLIA, permit2: PERMIT2 };
  for (const [label, address] of Object.entries(all)) {
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") {
      throw new Error(`[fork] ${label} at ${address} has no code on the fork`);
    }
  }

  async function readAddress(
    address: Address,
    functionName: "vault" | "clPoolManager" | "binPoolManager" | "permit2" | "poolManager",
  ): Promise<Address> {
    return publicClient.readContract({ address, abi: ADDRESS_GETTER_ABI, functionName });
  }

  const router = LATCH_PERIPHERY_SEPOLIA.universalRouter;
  const routerVault = await readAddress(router, "vault");
  if (!sameAddress(routerVault, LATCH_SEPOLIA.vault)) {
    throw new Error(
      `[fork] UniversalRouter ${router} points at vault ${routerVault}, not Latch's ` +
        `${LATCH_SEPOLIA.vault}. This is the wrong router - PancakeSwap has one on Sepolia too.`,
    );
  }
  const routerClPm = await readAddress(router, "clPoolManager");
  if (!sameAddress(routerClPm, LATCH_SEPOLIA.clPoolManager)) {
    throw new Error(`[fork] router's clPoolManager is ${routerClPm}, not ${LATCH_SEPOLIA.clPoolManager}`);
  }
  const routerBinPm = await readAddress(router, "binPoolManager");
  if (!sameAddress(routerBinPm, LATCH_SEPOLIA.binPoolManager)) {
    throw new Error(
      `[fork] router's binPoolManager is ${routerBinPm}, not ${LATCH_SEPOLIA.binPoolManager}`,
    );
  }
  const paused = await publicClient.readContract({
    address: router,
    abi: ADDRESS_GETTER_ABI,
    functionName: "paused",
  });
  if (paused) throw new Error(`[fork] UniversalRouter ${router} is paused; no swap can execute`);

  // Permit2 is an immutable in both position managers. If it is not the fork
  // this deployment was built against, approvals go to a contract nobody reads.
  for (const [label, address] of [
    ["clPositionManager", LATCH_PERIPHERY_SEPOLIA.clPositionManager],
    ["binPositionManager", LATCH_PERIPHERY_SEPOLIA.binPositionManager],
  ] as const) {
    const permit2 = await readAddress(address, "permit2");
    if (!sameAddress(permit2, PERMIT2)) {
      const note = sameAddress(permit2, CANONICAL_PERMIT2)
        ? " (it is the canonical Permit2; this harness is configured for the PancakeSwap fork)"
        : "";
      throw new Error(`[fork] ${label} uses Permit2 ${permit2}, not ${PERMIT2}${note}`);
    }
    const vault = await readAddress(address, "vault");
    if (!sameAddress(vault, LATCH_SEPOLIA.vault)) {
      throw new Error(`[fork] ${label} points at vault ${vault}, not ${LATCH_SEPOLIA.vault}`);
    }
  }

  const quoterPm = await readAddress(LATCH_PERIPHERY_SEPOLIA.clQuoter, "poolManager");
  if (!sameAddress(quoterPm, LATCH_SEPOLIA.clPoolManager)) {
    throw new Error(`[fork] CLQuoter quotes pool manager ${quoterPm}, not ${LATCH_SEPOLIA.clPoolManager}`);
  }

  return { ...LATCH_PERIPHERY_SEPOLIA, permit2: PERMIT2 };
}

/**
 * Deploys a fresh `MockERC20` with a public `mint` onto the fork.
 *
 * Sepolia carries exactly one Latch pool, over exactly two tokens, so a
 * multi-hop route cannot be assembled from what is deployed. A third token and a
 * second pool have to be created locally - the *route* is synthetic, but the
 * singleton, the swap math and the periphery decoding it is tested against are
 * not.
 */
export async function deployMockErc20(
  context: Pick<ForkContext, "publicClient" | "walletClient">,
  name: string,
  symbol: string,
): Promise<Address> {
  const artifact = loadArtifact("core", "mocks/MockERC20.sol", "MockERC20");
  const account = context.walletClient.account;
  if (account === undefined) throw new Error("[fork] wallet client has no account");
  const hash = await context.walletClient.deployContract({
    account,
    chain: foundry,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [name, symbol, 18],
    gas: 3_000_000n,
  } as never);
  const receipt = await context.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || receipt.contractAddress == null) {
    throw new Error(`[fork] deploying MockERC20 ${symbol} failed`);
  }
  return receipt.contractAddress;
}

/** `BinPoolManager.initialize(key, activeId)`. */
export const BIN_POOL_MANAGER_INIT_ABI = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "hooks", type: "address" },
          { name: "poolManager", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "parameters", type: "bytes32" },
        ],
      },
      { name: "activeId", type: "uint24" },
    ],
    outputs: [],
  },
] as const;

/** `BinPositionManager` is an ERC-6909-style share token keyed by bin. */
export const BIN_SHARES_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** `BinTokenLibrary.toTokenId`: `keccak256(abi.encode(poolId, binId))`. */
export function binShareTokenId(poolId: Hex, binId: number): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { name: "poolId", type: "bytes32" },
          { name: "binId", type: "uint256" },
        ],
        [poolId, BigInt(binId)],
      ),
    ),
  );
}

/**
 * `CLPoolManager.initialize`, used to create the second fork-only pool.
 *
 * Called on the pool manager directly rather than through
 * `CLPositionManager.initializePool`, which swallows the revert and returns
 * `type(int24).max` - a silent no-op that only shows up two transactions later
 * as `PoolNotInitialized`.
 */
export const CL_POOL_MANAGER_INIT_ABI = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "hooks", type: "address" },
          { name: "poolManager", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "parameters", type: "bytes32" },
        ],
      },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "", type: "int24" }],
  },
] as const;

/** Reads the id the position manager will assign to the next mint. */
export async function nextPositionTokenId(
  publicClient: PublicClient,
  positionManager: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: positionManager,
    abi: ERC721_ABI,
    functionName: "nextTokenId",
  });
}

/** Owner of a CL position NFT. */
export async function positionOwner(
  publicClient: PublicClient,
  positionManager: Address,
  tokenId: bigint,
): Promise<Address> {
  return publicClient.readContract({
    address: positionManager,
    abi: ERC721_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  });
}

/** Encoded `mint(address,uint256)`, exposed for tests that batch their funding. */
export function encodeMint(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: MOCK_ERC20_ABI, functionName: "mint", args: [to, amount] });
}
