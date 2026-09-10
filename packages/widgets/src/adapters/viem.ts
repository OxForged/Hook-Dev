// SPDX-License-Identifier: MIT
/**
 * Live protocol adapter, backed by viem.
 *
 * This is the implementation that produces **real calldata** and submits real
 * transactions. It is the swap and liquidity call paths from `src/callpath/`
 * wired to a viem `PublicClient` for reads and a wallet for writes.
 *
 * ## What it can and cannot do today
 *
 * No LatchProtocol deployment exists, so this adapter has never executed against
 * a chain. What it does is bounded honestly:
 *
 * - **Encoding** is complete and unit-tested. `buildSwap`, `buildAddLiquidity`
 *   and `buildRemoveLiquidity` produce the exact calldata the router and
 *   position managers decode, integrator fee step included.
 * - **Token, balance and allowance reads** are ordinary ERC-20 and Permit2
 *   calls and will work against any chain that has them.
 * - **Pool discovery** is not on-chain: the singleton has no pool enumeration.
 *   Pass the pools you support, or wire an indexer (`@latchprotocol/sdk/indexer`
 *   describes the schema).
 * - **Quoting** requires either a deployed quoter or a host-supplied function.
 *   Without one, `quoteSwap` throws {@link UnsupportedOperationError} rather
 *   than inventing a number - a fabricated quote is worse than no quote.
 */

import {
  encodeFunctionData,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ChainConfig } from "../config/chain.js";
import { requireContract } from "../config/chain.js";
import {
  ERC20_ABI,
  MAX_UINT160,
  MAX_UINT256,
  MAX_UINT48,
  PERMIT2_ABI,
} from "../callpath/constants.js";
import { buildSwapCall, type SwapHop } from "../callpath/swap.js";
import {
  buildBinAddCall,
  buildBinRemoveCall,
  buildCLDecreaseCall,
  buildCLMintCall,
} from "../callpath/liquidity.js";
import { buildLaunchBuyCall, LAUNCHPAD_ABI } from "../callpath/launch.js";
import {
  UnsupportedOperationError,
  WalletNotConnectedError,
  type AddLiquidityExecutionRequest,
  type AddLiquidityQuote,
  type AddLiquidityQuoteRequest,
  type ApprovalRequirement,
  type LaunchAccountState,
  type LaunchBuyExecutionRequest,
  type LaunchBuyQuote,
  type LaunchInfo,
  type PoolInfo,
  type PoolState,
  type PositionInfo,
  type ProtocolAdapter,
  type RemoveLiquidityExecutionRequest,
  type RemoveLiquidityQuote,
  type SwapExecutionRequest,
  type SwapQuoteRequest,
  type SwapQuoteResult,
  type TokenInfo,
  type TransactionOutcome,
  type WidgetTransactionRequest,
} from "./protocol.js";

const NATIVE: Address = "0x0000000000000000000000000000000000000000";

/** Minimal wallet surface. Any wallet stack that can sign satisfies this. */
export interface WidgetWallet {
  /** Currently selected account, or `null`. */
  getAccount(): Promise<Address | null>;
  /** Submits a transaction and returns its hash. */
  sendTransaction(request: {
    to: Address;
    data: Hex;
    value: bigint;
  }): Promise<Hex>;
}

/**
 * Host-supplied functions for the parts the protocol cannot answer on its own.
 *
 * Each one is optional. Omitting a function makes the corresponding widget
 * feature fail loudly with a named error instead of degrading to invented data.
 */
export interface ViemAdapterOverrides {
  quoteSwap?: (request: SwapQuoteRequest, pools: readonly PoolInfo[]) => Promise<SwapQuoteResult>;
  quoteAddLiquidity?: (request: AddLiquidityQuoteRequest) => Promise<AddLiquidityQuote>;
  quoteRemoveLiquidity?: (
    position: PositionInfo,
    percentBps: number,
  ) => Promise<RemoveLiquidityQuote>;
  listPositions?: (owner: Address, pool?: PoolInfo) => Promise<readonly PositionInfo[]>;
  getPoolState?: (pool: PoolInfo) => Promise<PoolState>;
  /** Resolves a route. Defaults to a direct pool match over `pools`. */
  findRoute?: (
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    pools: readonly PoolInfo[],
  ) => readonly SwapHop[];
}

/** Options for {@link createViemAdapter}. */
export interface ViemAdapterOptions {
  readonly chain: ChainConfig;
  readonly publicClient: PublicClient;
  readonly wallet?: WidgetWallet;
  /** Tokens offered in the picker. There is no on-chain token registry. */
  readonly tokens: readonly TokenInfo[];
  /** Pools this integrator supports. There is no on-chain pool enumeration. */
  readonly pools: readonly PoolInfo[];
  /** Launches this integrator surfaces, by launchpad address. */
  readonly launches?: readonly Address[];
  readonly overrides?: ViemAdapterOverrides;
}

class ViemProtocolAdapter implements ProtocolAdapter {
  readonly kind = "viem";
  readonly isMock = false;
  readonly chain: ChainConfig;

  readonly #options: ViemAdapterOptions;

  constructor(options: ViemAdapterOptions) {
    this.#options = options;
    this.chain = options.chain;
  }

  get #client(): PublicClient {
    return this.#options.publicClient;
  }

  get #overrides(): ViemAdapterOverrides {
    return this.#options.overrides ?? {};
  }

  async getAccount(): Promise<Address | null> {
    const wallet = this.#options.wallet;
    if (wallet === undefined) return null;
    return wallet.getAccount();
  }

  async listTokens(): Promise<readonly TokenInfo[]> {
    return this.#options.tokens;
  }

  async getToken(address: Address): Promise<TokenInfo | null> {
    const known = this.#options.tokens.find((token) => isAddressEqual(token.address, address));
    if (known !== undefined) return known;
    if (isAddressEqual(address, NATIVE)) {
      return {
        address: NATIVE,
        symbol: this.chain.nativeCurrency.symbol,
        name: this.chain.nativeCurrency.name,
        decimals: this.chain.nativeCurrency.decimals,
        isNative: true,
      };
    }
    const [symbol, name, decimals] = await Promise.all([
      this.#client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
      this.#client.readContract({ address, abi: ERC20_ABI, functionName: "name" }),
      this.#client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
    ]);
    return { address, symbol, name, decimals: Number(decimals) };
  }

  async getBalance(token: TokenInfo, owner: Address): Promise<bigint> {
    if (token.isNative === true || isAddressEqual(token.address, NATIVE)) {
      return this.#client.getBalance({ address: owner });
    }
    return this.#client.readContract({
      address: token.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    });
  }

  async listPools(): Promise<readonly PoolInfo[]> {
    return this.#options.pools;
  }

  async getPoolState(pool: PoolInfo): Promise<PoolState> {
    const override = this.#overrides.getPoolState;
    if (override !== undefined) return override(pool);
    throw new UnsupportedOperationError(
      "getPoolState",
      "reading pool state needs a pool-manager view call or an indexer. Supply " +
        "`overrides.getPoolState` in the adapter options.",
    );
  }

  async getApprovalRequirements(
    token: TokenInfo,
    owner: Address,
    amount: bigint,
  ): Promise<readonly ApprovalRequirement[]> {
    if (token.isNative === true || isAddressEqual(token.address, NATIVE)) return [];
    const permit2 = requireContract(this.chain, "permit2", "pull the input token for a swap");
    const router = requireContract(this.chain, "universalRouter", "execute a swap");

    const requirements: ApprovalRequirement[] = [];

    const erc20Allowance = await this.#client.readContract({
      address: token.address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, permit2],
    });
    if (erc20Allowance < amount) {
      requirements.push({
        kind: "erc20-to-permit2",
        token,
        spender: permit2,
        current: erc20Allowance,
        required: amount,
      });
    }

    const [permit2Amount, expiration] = await this.#client.readContract({
      address: permit2,
      abi: PERMIT2_ABI,
      functionName: "allowance",
      args: [owner, token.address, router],
    });
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const expired = BigInt(expiration) !== 0n && BigInt(expiration) <= nowSeconds;
    if (BigInt(permit2Amount) < amount || expired) {
      requirements.push({
        kind: "permit2-to-router",
        token,
        spender: router,
        current: expired ? 0n : BigInt(permit2Amount),
        required: amount,
      });
    }

    return requirements;
  }

  async buildApproval(requirement: ApprovalRequirement): Promise<WidgetTransactionRequest> {
    if (requirement.kind === "erc20-to-permit2") {
      return {
        to: requirement.token.address,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [requirement.spender, MAX_UINT256],
        }),
        value: 0n,
        summary: `Approve ${requirement.token.symbol} for Permit2`,
        source: "live",
      };
    }
    const permit2 = requireContract(this.chain, "permit2", "approve the router through Permit2");
    return {
      to: permit2,
      data: encodeFunctionData({
        abi: PERMIT2_ABI,
        functionName: "approve",
        args: [requirement.token.address, requirement.spender, MAX_UINT160, Number(MAX_UINT48)],
      }),
      value: 0n,
      summary: `Approve the router to spend ${requirement.token.symbol} via Permit2`,
      source: "live",
    };
  }

  async quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResult> {
    const override = this.#overrides.quoteSwap;
    if (override !== undefined) return override(request, this.#options.pools);
    throw new UnsupportedOperationError(
      "quoteSwap",
      "no quoter is configured for this chain. Set `contracts.quoter` and supply " +
        "`overrides.quoteSwap`, or point the widget at an indexer-backed quoter. " +
        "This adapter will not estimate a price it cannot verify.",
    );
  }

  async buildSwap(request: SwapExecutionRequest): Promise<WidgetTransactionRequest> {
    const router = requireContract(this.chain, "universalRouter", "execute a swap");
    const account = await this.getAccount();
    if (account === null) throw new WalletNotConnectedError("build a swap");

    const hops = this.#resolveHops(request);
    const call = buildSwapCall({
      router,
      hops,
      amountIn: request.amountIn,
      minAmountOutGross: request.minAmountOutGross,
      minAmountOutNet: request.minAmountOutNet,
      expectedAmountOutGross: request.quote.grossAmountOut,
      integrator: request.integrator,
      recipient: request.recipient,
      sender: account,
      deadline: request.deadline,
    });

    return {
      to: call.to,
      data: call.data,
      value: call.value,
      summary: `Swap ${request.tokenIn.symbol} for ${request.tokenOut.symbol}`,
      ...(call.integratorFee
        ? {
            integratorFee: {
              referrer: call.integratorFee.referrer,
              feeBps: call.integratorFee.feeBps,
              currency: call.integratorFee.currency,
              expectedAmount: call.integratorFee.expectedAmount,
            },
          }
        : {}),
      source: "live",
    };
  }

  #resolveHops(request: SwapExecutionRequest): readonly SwapHop[] {
    const override = this.#overrides.findRoute;
    if (override !== undefined) {
      return override(request.tokenIn, request.tokenOut, this.#options.pools);
    }
    const hops: SwapHop[] = [];
    for (const step of request.quote.route) {
      const pool = this.#options.pools.find((candidate) => candidate.id === step.poolId);
      if (pool === undefined) {
        throw new UnsupportedOperationError(
          "buildSwap",
          `the quote routes through pool ${step.poolId}, which is not in the configured pool list`,
        );
      }
      hops.push({
        poolKey: pool.key,
        poolType: pool.poolType,
        currencyIn: step.tokenIn.address,
        currencyOut: step.tokenOut.address,
        ...(request.hookData ? { hookData: request.hookData } : {}),
      });
    }
    return hops;
  }

  async quoteAddLiquidity(request: AddLiquidityQuoteRequest): Promise<AddLiquidityQuote> {
    const override = this.#overrides.quoteAddLiquidity;
    if (override !== undefined) return override(request);
    throw new UnsupportedOperationError(
      "quoteAddLiquidity",
      "converting desired amounts into a liquidity figure needs live pool state. " +
        "Supply `overrides.quoteAddLiquidity`.",
    );
  }

  async buildAddLiquidity(
    request: AddLiquidityExecutionRequest,
  ): Promise<WidgetTransactionRequest> {
    const account = await this.getAccount();
    if (account === null) throw new WalletNotConnectedError("add liquidity");
    const { quote } = request;
    const nativeValue = this.#nativeValueFor(quote.pool, request.amount0Max, request.amount1Max);

    if (quote.range.type === "CL") {
      const positionManager = requireContract(
        this.chain,
        "clPositionManager",
        "mint a concentrated-liquidity position",
      );
      const call = buildCLMintCall({
        positionManager,
        poolKey: quote.pool.key,
        tickLower: quote.range.tickLower,
        tickUpper: quote.range.tickUpper,
        liquidity: quote.liquidity,
        amount0Max: request.amount0Max,
        amount1Max: request.amount1Max,
        owner: request.recipient,
        deadline: request.deadline,
        value: nativeValue,
        ...(request.hookData ? { hookData: request.hookData } : {}),
      });
      return {
        to: call.to,
        data: call.data,
        value: call.value,
        summary: `Add liquidity to ${quote.pool.token0.symbol}/${quote.pool.token1.symbol}`,
        source: "live",
      };
    }

    const positionManager = requireContract(
      this.chain,
      "binPositionManager",
      "add liquidity to a bin pool",
    );
    const distribution = quote.binDistribution;
    if (distribution === undefined || distribution.length === 0) {
      throw new UnsupportedOperationError(
        "buildAddLiquidity",
        "a bin mint needs a per-bin distribution; the quote did not supply one",
      );
    }
    const call = buildBinAddCall({
      positionManager,
      poolKey: quote.pool.key,
      amount0: quote.amount0,
      amount1: quote.amount1,
      amount0Max: request.amount0Max,
      amount1Max: request.amount1Max,
      activeIdDesired: quote.range.activeIdDesired,
      idSlippage: quote.range.idSlippage,
      deltaIds: distribution.map((share) => share.deltaId),
      distributionX: distribution.map((share) => share.distributionX),
      distributionY: distribution.map((share) => share.distributionY),
      to: request.recipient,
      deadline: request.deadline,
      value: nativeValue,
      ...(request.hookData ? { hookData: request.hookData } : {}),
    });
    return {
      to: call.to,
      data: call.data,
      value: call.value,
      summary: `Add liquidity to ${quote.pool.token0.symbol}/${quote.pool.token1.symbol}`,
      source: "live",
    };
  }

  #nativeValueFor(pool: PoolInfo, amount0Max: bigint, amount1Max: bigint): bigint {
    if (isAddressEqual(pool.token0.address, NATIVE)) return amount0Max;
    if (isAddressEqual(pool.token1.address, NATIVE)) return amount1Max;
    return 0n;
  }

  async listPositions(owner: Address, pool?: PoolInfo): Promise<readonly PositionInfo[]> {
    const override = this.#overrides.listPositions;
    if (override !== undefined) return override(owner, pool);
    throw new UnsupportedOperationError(
      "listPositions",
      "position enumeration needs an indexer; the position managers expose no " +
        "owner-to-position index. Supply `overrides.listPositions`.",
    );
  }

  async quoteRemoveLiquidity(
    position: PositionInfo,
    percentBps: number,
  ): Promise<RemoveLiquidityQuote> {
    const override = this.#overrides.quoteRemoveLiquidity;
    if (override !== undefined) return override(position, percentBps);
    throw new UnsupportedOperationError(
      "quoteRemoveLiquidity",
      "computing withdrawal amounts needs live pool state. Supply " +
        "`overrides.quoteRemoveLiquidity`.",
    );
  }

  async buildRemoveLiquidity(
    request: RemoveLiquidityExecutionRequest,
  ): Promise<WidgetTransactionRequest> {
    const account = await this.getAccount();
    if (account === null) throw new WalletNotConnectedError("remove liquidity");
    const { position } = request;

    if (position.range.type === "CL") {
      const positionManager = requireContract(
        this.chain,
        "clPositionManager",
        "decrease a concentrated-liquidity position",
      );
      if (position.tokenId === undefined) {
        throw new UnsupportedOperationError(
          "buildRemoveLiquidity",
          "a CL position must carry its ERC-721 tokenId",
        );
      }
      const liquidity = (position.liquidity * BigInt(request.percentBps)) / 10_000n;
      const call = buildCLDecreaseCall({
        positionManager,
        poolKey: position.pool.key,
        tokenId: position.tokenId,
        liquidity,
        amount0Min: request.amount0Min,
        amount1Min: request.amount1Min,
        recipient: request.recipient,
        owner: account,
        deadline: request.deadline,
        ...(request.hookData ? { hookData: request.hookData } : {}),
      });
      return {
        to: call.to,
        data: call.data,
        value: call.value,
        summary: `Remove ${request.percentBps / 100}% of position #${position.tokenId}`,
        source: "live",
      };
    }

    const positionManager = requireContract(
      this.chain,
      "binPositionManager",
      "remove liquidity from a bin pool",
    );
    const binAmounts = position.binAmounts;
    if (binAmounts === undefined || binAmounts.length === 0) {
      throw new UnsupportedOperationError(
        "buildRemoveLiquidity",
        "a bin burn needs the per-bin share amounts held by the position",
      );
    }
    const call = buildBinRemoveCall({
      positionManager,
      poolKey: position.pool.key,
      amount0Min: request.amount0Min,
      amount1Min: request.amount1Min,
      ids: binAmounts.map((entry) => entry.binId),
      amounts: binAmounts.map(
        (entry) => (entry.amount * BigInt(request.percentBps)) / 10_000n,
      ),
      from: account,
      recipient: request.recipient,
      deadline: request.deadline,
      ...(request.hookData ? { hookData: request.hookData } : {}),
    });
    return {
      to: call.to,
      data: call.data,
      value: call.value,
      summary: `Remove ${request.percentBps / 100}% of a bin position`,
      source: "live",
    };
  }

  async listLaunches(): Promise<readonly LaunchInfo[]> {
    const ids = this.#options.launches ?? [];
    const launches = await Promise.all(ids.map((id) => this.getLaunch(id)));
    return launches.filter((launch): launch is LaunchInfo => launch !== null);
  }

  async getLaunch(id: Address): Promise<LaunchInfo | null> {
    const info = await this.#client.readContract({
      address: id,
      abi: LAUNCHPAD_ABI,
      functionName: "saleInfo",
    });
    const [
      tokenAddress,
      paymentTokenAddress,
      totalForSale,
      sold,
      raised,
      hardCap,
      softCap,
      startTime,
      endTime,
      perWalletCap,
      minPurchase,
    ] = info;

    const [token, paymentToken] = await Promise.all([
      this.getToken(tokenAddress),
      this.getToken(paymentTokenAddress),
    ]);
    if (token === null || paymentToken === null) return null;

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const status =
      nowSeconds < BigInt(startTime)
        ? "upcoming"
        : nowSeconds > BigInt(endTime)
          ? "ended"
          : sold >= totalForSale
            ? "sold-out"
            : "live";

    return {
      id,
      token,
      paymentToken,
      status,
      totalForSale,
      sold,
      raised,
      softCap: softCap === 0n ? null : softCap,
      hardCap,
      startTime: BigInt(startTime),
      endTime: BigInt(endTime),
      perWalletCap: perWalletCap === 0n ? null : perWalletCap,
      minPurchase,
      // The proposed launchpad interface does not expose curve parameters; a
      // real deployment should, and this is where they would be read.
      priceCurve: { kind: "fixed", price: sold === 0n ? 0n : raised / sold },
      source: "live",
    };
  }

  async getLaunchAccountState(id: Address, account: Address): Promise<LaunchAccountState> {
    const [spent, allocated] = await this.#client.readContract({
      address: id,
      abi: LAUNCHPAD_ABI,
      functionName: "accountState",
      args: [account],
    });
    const launch = await this.getLaunch(id);
    const capRemaining =
      launch === null || launch.perWalletCap === null ? null : launch.perWalletCap - spent;
    const ineligibleReason =
      launch === null
        ? "Sale not found"
        : launch.status !== "live"
          ? `Sale is ${launch.status}`
          : capRemaining !== null && capRemaining <= 0n
            ? "Per-wallet cap reached"
            : null;
    return {
      launchId: id,
      account,
      spent,
      allocated,
      capRemaining,
      eligible: ineligibleReason === null,
      ineligibleReason,
      source: "live",
    };
  }

  async quoteLaunchBuy(launch: LaunchInfo, amountIn: bigint): Promise<LaunchBuyQuote> {
    const tokensOut = await this.#client.readContract({
      address: launch.id,
      abi: LAUNCHPAD_ABI,
      functionName: "quote",
      args: [amountIn],
    });
    const effectivePrice =
      tokensOut === 0n ? 0n : (amountIn * 10n ** BigInt(launch.token.decimals)) / tokensOut;
    return { launch, amountIn, tokensOut, effectivePrice, source: "live" };
  }

  async buildLaunchBuy(request: LaunchBuyExecutionRequest): Promise<WidgetTransactionRequest> {
    const call = buildLaunchBuyCall({
      launchpad: request.quote.launch.id,
      paymentToken: request.quote.launch.paymentToken.address,
      amountIn: request.quote.amountIn,
      minTokensOut: request.minTokensOut,
      recipient: request.recipient,
      integrator: request.integrator,
      deadline: request.deadline,
    });
    return {
      to: call.to,
      data: call.data,
      value: call.value,
      summary: `Buy ${request.quote.launch.token.symbol}`,
      ...(call.integratorFee
        ? {
            integratorFee: {
              referrer: call.integratorFee.referrer,
              feeBps: call.integratorFee.feeBps,
              currency: request.quote.launch.paymentToken.address,
              expectedAmount:
                (request.quote.amountIn * BigInt(call.integratorFee.feeBps)) / 10_000n,
            },
          }
        : {}),
      source: "live",
    };
  }

  async sendTransaction(request: WidgetTransactionRequest): Promise<Hex> {
    const wallet = this.#options.wallet;
    if (wallet === undefined) throw new WalletNotConnectedError("send a transaction");
    return wallet.sendTransaction({
      to: request.to,
      data: request.data,
      value: request.value,
    });
  }

  async waitForTransaction(hash: Hex): Promise<TransactionOutcome> {
    const receipt = await this.#client.waitForTransactionReceipt({ hash });
    return {
      hash,
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: receipt.blockNumber,
      source: "live",
    };
  }
}

/** Creates the live, viem-backed adapter. */
export function createViemAdapter(options: ViemAdapterOptions): ProtocolAdapter {
  return new ViemProtocolAdapter(options);
}
