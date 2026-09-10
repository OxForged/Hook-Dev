// SPDX-License-Identifier: MIT
/**
 * The fork harness.
 *
 * Boots one anvil forked from Sepolia, puts the missing pieces of the stack on
 * it, funds an account, and hands back a live `createViemAdapter` wired to the
 * result. From there a fork suite builds calldata with this package's ordinary
 * public API and **sends it**.
 *
 * ## What has to be deployed, and why
 *
 * Sepolia carries Latch's core only - `Vault`, `CLPoolManager`, `BinPoolManager`,
 * the fee controller. The periphery and the universal router are not there. A
 * `UniversalRouter` does exist at `0x19Dbcfc8…` on Sepolia, but it is
 * PancakeSwap's: its `vault()` is `0x4670F769…`, a different singleton entirely,
 * so it cannot reach the Latch pool. The harness therefore deploys, onto the
 * fork only:
 *
 * | Contract | From | Why |
 * | --- | --- | --- |
 * | `UniversalRouter` | `packages/router` | the swap entry point `buildSwapCall` targets |
 * | `CLPositionManager` | `packages/periphery` | the entry point `buildCLMintCall`/`buildCLDecreaseCall` target |
 * | `CLPositionDescriptorOffChain` | `packages/periphery` | non-optional constructor argument of the above |
 * | `CLQuoter` | `packages/periphery` | a *real* quote, so "matches the quote" means something |
 *
 * Everything the calldata actually touches - the singleton, the pool, its
 * liquidity, its protocol fee - is the live deployment, unmodified.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
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
  CL_POOL_MANAGER_ABI,
  DERIVED_POOL_ID,
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
  WETH9_SEPOLIA,
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

/** Contracts the harness put on the fork. */
export interface ForkDeployments {
  readonly universalRouter: Address;
  readonly clPositionManager: Address;
  readonly clPositionDescriptor: Address;
  readonly clQuoter: Address;
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

  // Fail early and specifically if the core we are testing against is not there.
  for (const [label, address] of Object.entries(LATCH_SEPOLIA)) {
    const code = await publicClient.getCode({ address: address as Address });
    if (code === undefined || code === "0x") {
      throw new Error(`[fork] ${label} at ${address} has no code on the fork`);
    }
  }

  const deployments = await deployMissingStack(publicClient, walletClient, account.address);

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
      permit2: PERMIT2,
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
    const erc20 = await walletClient.writeContract({
      account,
      chain: foundry,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PERMIT2, (1n << 256n) - 1n],
    });
    await publicClient.waitForTransactionReceipt({ hash: erc20 });
    const permit = await walletClient.writeContract({
      account,
      chain: foundry,
      address: PERMIT2,
      abi: PERMIT2_ABI,
      functionName: "approve",
      args: [tokenAddress, spender, MAX_UINT160, Number(MAX_UINT48)],
    });
    await publicClient.waitForTransactionReceipt({ hash: permit });
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

async function deployMissingStack(
  publicClient: PublicClient,
  walletClient: WalletClient,
  deployer: Address,
): Promise<ForkDeployments> {
  const routerArtifact = loadArtifact("router", "UniversalRouter.sol", "UniversalRouter");
  const posmArtifact = loadArtifact("periphery", "CLPositionManager.sol", "CLPositionManager");
  const descriptorArtifact = loadArtifact(
    "periphery",
    "CLPositionDescriptorOffChain.sol",
    "CLPositionDescriptorOffChain",
  );
  const quoterArtifact = loadArtifact("periphery", "CLQuoter.sol", "CLQuoter");

  async function deploy(
    label: string,
    artifact: { abi: typeof routerArtifact.abi; bytecode: Hex },
    args: readonly unknown[],
  ): Promise<Address> {
    const hash = await walletClient.deployContract({
      account: walletClient.account ?? deployer,
      chain: foundry,
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args: args as never,
      gas: 12_000_000n,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || receipt.contractAddress == null) {
      throw new Error(`[fork] deploying ${label} failed (status ${receipt.status})`);
    }
    return receipt.contractAddress;
  }

  const universalRouter = await deploy("UniversalRouter", routerArtifact, [
    {
      permit2: PERMIT2,
      weth9: WETH9_SEPOLIA,
      // The PCS v2/v3/stable legs are unreachable from every command this
      // package emits, so they are wired to the zero address rather than to
      // stubs that would only add ways for the harness to be wrong.
      v2Factory: ZERO_ADDRESS,
      v3Factory: ZERO_ADDRESS,
      v3Deployer: ZERO_ADDRESS,
      v2InitCodeHash: `0x${"00".repeat(32)}` as Hex,
      v3InitCodeHash: `0x${"00".repeat(32)}` as Hex,
      stableFactory: ZERO_ADDRESS,
      stableInfo: ZERO_ADDRESS,
      infiVault: LATCH_SEPOLIA.vault,
      infiClPoolManager: LATCH_SEPOLIA.clPoolManager,
      infiBinPoolManager: LATCH_SEPOLIA.binPoolManager,
    },
  ]);

  const clPositionDescriptor = await deploy("CLPositionDescriptorOffChain", descriptorArtifact, [
    "https://latch.invalid/positions/",
  ]);

  const clPositionManager = await deploy("CLPositionManager", posmArtifact, [
    LATCH_SEPOLIA.vault,
    LATCH_SEPOLIA.clPoolManager,
    PERMIT2,
    100_000n,
    clPositionDescriptor,
    WETH9_SEPOLIA,
  ]);

  const clQuoter = await deploy("CLQuoter", quoterArtifact, [LATCH_SEPOLIA.clPoolManager]);

  return { universalRouter, clPositionManager, clPositionDescriptor, clQuoter };
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

/** `CLPositionManager.initializePool`, used to create the second fork-only pool. */
export const POSITION_MANAGER_INIT_ABI = [
  {
    type: "function",
    name: "initializePool",
    stateMutability: "payable",
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
