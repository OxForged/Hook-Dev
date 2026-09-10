// SPDX-License-Identifier: MIT
/**
 * The chain boundary.
 *
 * Every read and every write the widgets perform goes through
 * {@link ProtocolAdapter}. No component, hook or controller in this package
 * imports a viem client directly, which is what makes the whole library
 * runnable against a mock while the protocol is undeployed - and swappable to a
 * live implementation without touching a line of UI.
 *
 * Two implementations ship:
 *
 * - {@link ../adapters/mock.js | MockProtocolAdapter} - deterministic fake state
 *   for development. `isMock` is `true`; every value it returns is labelled.
 * - {@link ../adapters/viem.js | ViemProtocolAdapter} - real reads and writes
 *   through a viem transport.
 *
 * A host can also implement this interface itself, for example on top of wagmi
 * or its own backend quoter.
 */

import type { Address, Hex } from "viem";
import type { PoolKey, PoolId } from "@latchprotocol/sdk";
import type { ChainConfig } from "../config/chain.js";
import type { ResolvedIntegratorConfig } from "../config/integrator.js";

/** Which flavour of pool a key addresses. */
export type PoolType = "CL" | "BIN";

/** Where a piece of data came from. Rendered by the UI; never cosmetic. */
export type DataSource = "live" | "mock";

/** ERC-20 (or native) token metadata. */
export interface TokenInfo {
  readonly address: Address;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logoUrl?: string;
  /** True for the chain's native asset (the zero address). */
  readonly isNative?: boolean;
}

/** A pool the widgets can route through or provide liquidity to. */
export interface PoolInfo {
  readonly id: PoolId;
  readonly key: PoolKey;
  readonly poolType: PoolType;
  readonly token0: TokenInfo;
  readonly token1: TokenInfo;
  /** Static LP fee in pips, or the dynamic-fee marker. */
  readonly lpFeePips: number;
  /** Concentrated-liquidity pools only. */
  readonly tickSpacing?: number;
  /** Liquidity-book pools only. */
  readonly binStep?: number;
  /** Hook contract, or the zero address. */
  readonly hooks: Address;
}

/** Live-ish pool state needed to render ranges and prices. */
export interface PoolState {
  readonly poolId: PoolId;
  readonly poolType: PoolType;
  /** Concentrated liquidity: current tick and price. */
  readonly currentTick?: number;
  readonly sqrtPriceX96?: bigint;
  readonly liquidity?: bigint;
  /** Liquidity book: currently active bin. */
  readonly activeId?: number;
  readonly source: DataSource;
}

/** One hop of a route. */
export interface RouteStep {
  readonly poolId: PoolId;
  readonly poolType: PoolType;
  readonly tokenIn: TokenInfo;
  readonly tokenOut: TokenInfo;
  readonly lpFeePips: number;
  readonly hooks: Address;
}

/** A swap quote request. Only exact-input is supported by the swap widget UI. */
export interface SwapQuoteRequest {
  readonly tokenIn: TokenInfo;
  readonly tokenOut: TokenInfo;
  readonly amountIn: bigint;
}

/**
 * A swap quote.
 *
 * `grossAmountOut` is the pool's output **before** any integrator fee. The fee
 * split is computed by {@link ../core/math.js | buildQuoteBreakdown}, never by
 * the adapter, so that no adapter can under-report what an embedder earns.
 */
export interface SwapQuoteResult {
  readonly route: readonly RouteStep[];
  readonly amountIn: bigint;
  readonly grossAmountOut: bigint;
  /** Output at the current price with no impact, if computable. */
  readonly spotAmountOut: bigint | null;
  /** LP fee paid, expressed in the input currency. */
  readonly lpFeeAmount: bigint;
  readonly lpFeePips: number;
  readonly estimatedGas: bigint | null;
  readonly source: DataSource;
}

/** A transaction the host is asked to sign, in adapter-neutral form. */
export interface WidgetTransactionRequest {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  /** Human-readable summary, used in confirmation UI and error messages. */
  readonly summary: string;
  /** Populated when the transaction includes an integrator fee step. */
  readonly integratorFee?: {
    readonly referrer: Address;
    readonly feeBps: number;
    readonly currency: Address;
    readonly expectedAmount: bigint;
  };
  readonly source: DataSource;
}

/** The two-step allowance the router needs before it can pull the input token. */
export type ApprovalKind = "erc20-to-permit2" | "permit2-to-router";

/** An outstanding approval blocking a swap or liquidity action. */
export interface ApprovalRequirement {
  readonly kind: ApprovalKind;
  readonly token: TokenInfo;
  readonly spender: Address;
  readonly current: bigint;
  readonly required: bigint;
}

/** Parameters for building a swap transaction. */
export interface SwapExecutionRequest {
  readonly quote: SwapQuoteResult;
  readonly tokenIn: TokenInfo;
  readonly tokenOut: TokenInfo;
  readonly amountIn: bigint;
  /** Floor enforced by the swap action, before the integrator fee. */
  readonly minAmountOutGross: bigint;
  /** Floor on what the user receives, after the integrator fee. */
  readonly minAmountOutNet: bigint;
  /** Validated integrator config. Threaded straight into the call path. */
  readonly integrator: ResolvedIntegratorConfig;
  readonly recipient: Address;
  readonly deadline: bigint;
  /** Extra data forwarded to the pool's hook, if any. */
  readonly hookData?: Hex;
}

/** A price range, expressed in whichever units the pool type uses. */
export type LiquidityRange =
  | { readonly type: "CL"; readonly tickLower: number; readonly tickUpper: number }
  | {
      readonly type: "BIN";
      readonly activeIdDesired: number;
      readonly binIdLower: number;
      readonly binIdUpper: number;
      /** How many bins the active id may drift before the mint reverts. */
      readonly idSlippage: number;
    };

/** Request to quote an add-liquidity operation. */
export interface AddLiquidityQuoteRequest {
  readonly pool: PoolInfo;
  readonly range: LiquidityRange;
  readonly amount0Desired: bigint;
  readonly amount1Desired: bigint;
}

/** Quoted result of adding liquidity. */
export interface AddLiquidityQuote {
  readonly pool: PoolInfo;
  readonly range: LiquidityRange;
  readonly amount0: bigint;
  readonly amount1: bigint;
  /** CL: liquidity units. BIN: total liquidity minted across the bins. */
  readonly liquidity: bigint;
  /** Share of the pool this position would represent, in bps. Null if unknown. */
  readonly shareBps: number | null;
  /** BIN only: the per-bin distribution the call path will encode. */
  readonly binDistribution?: readonly BinLiquidityShare[];
  readonly source: DataSource;
}

/** One bin's share of a liquidity-book mint. */
export interface BinLiquidityShare {
  readonly binId: number;
  /** Offset from the active bin. */
  readonly deltaId: number;
  /** Share of `amount0`, scaled to 1e18. */
  readonly distributionX: bigint;
  /** Share of `amount1`, scaled to 1e18. */
  readonly distributionY: bigint;
}

/** An existing liquidity position owned by the connected account. */
export interface PositionInfo {
  readonly id: string;
  /** CL positions are ERC-721 token ids; bin positions are ERC-6909-style. */
  readonly tokenId?: bigint;
  readonly pool: PoolInfo;
  readonly range: LiquidityRange;
  readonly liquidity: bigint;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly feesOwed0: bigint;
  readonly feesOwed1: bigint;
  /** BIN positions: the bins actually held, with their share amounts. */
  readonly binAmounts?: readonly { readonly binId: number; readonly amount: bigint }[];
  readonly inRange: boolean;
  readonly source: DataSource;
}

/** Request to build an add-liquidity transaction. */
export interface AddLiquidityExecutionRequest {
  readonly quote: AddLiquidityQuote;
  readonly amount0Max: bigint;
  readonly amount1Max: bigint;
  readonly recipient: Address;
  readonly deadline: bigint;
  readonly integrator: ResolvedIntegratorConfig;
  readonly hookData?: Hex;
  /** Set to increase an existing CL position rather than mint a new one. */
  readonly tokenId?: bigint;
}

/** Request to build a remove-liquidity transaction. */
export interface RemoveLiquidityExecutionRequest {
  readonly position: PositionInfo;
  /** Fraction of the position to withdraw, in bps of its liquidity. */
  readonly percentBps: number;
  readonly amount0Min: bigint;
  readonly amount1Min: bigint;
  readonly recipient: Address;
  readonly deadline: bigint;
  readonly integrator: ResolvedIntegratorConfig;
  readonly hookData?: Hex;
}

/** Quote for removing liquidity. */
export interface RemoveLiquidityQuote {
  readonly position: PositionInfo;
  readonly percentBps: number;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly source: DataSource;
}

/** Lifecycle of a token sale. */
export type LaunchStatus = "upcoming" | "live" | "paused" | "ended" | "sold-out" | "cancelled";

/** Shape of a sale's price curve. */
export type LaunchPriceCurve =
  | { readonly kind: "fixed"; readonly price: bigint }
  | { readonly kind: "linear"; readonly startPrice: bigint; readonly endPrice: bigint }
  | {
      readonly kind: "exponential";
      readonly startPrice: bigint;
      readonly endPrice: bigint;
      /** Curvature exponent, scaled to 1e18. */
      readonly exponent: bigint;
    };

/** A token launch the launch widget can buy into. */
export interface LaunchInfo {
  readonly id: Address;
  readonly token: TokenInfo;
  /** Currency buyers pay in. */
  readonly paymentToken: TokenInfo;
  readonly status: LaunchStatus;
  readonly totalForSale: bigint;
  readonly sold: bigint;
  readonly raised: bigint;
  readonly softCap: bigint | null;
  readonly hardCap: bigint;
  /** Unix seconds. */
  readonly startTime: bigint;
  readonly endTime: bigint;
  /** Maximum a single wallet may spend, in the payment currency. */
  readonly perWalletCap: bigint | null;
  readonly minPurchase: bigint;
  readonly priceCurve: LaunchPriceCurve;
  readonly source: DataSource;
}

/** A single account's standing in a launch. */
export interface LaunchAccountState {
  readonly launchId: Address;
  readonly account: Address;
  /** Payment currency already spent by this wallet. */
  readonly spent: bigint;
  /** Tokens already allocated to this wallet. */
  readonly allocated: bigint;
  /** Remaining spend allowed under the per-wallet cap. Null when uncapped. */
  readonly capRemaining: bigint | null;
  /** Whether the wallet is permitted to buy right now, and why not. */
  readonly eligible: boolean;
  readonly ineligibleReason: string | null;
  readonly source: DataSource;
}

/** Quote for a launch purchase. */
export interface LaunchBuyQuote {
  readonly launch: LaunchInfo;
  readonly amountIn: bigint;
  readonly tokensOut: bigint;
  /** Effective price paid, in payment units per whole token. */
  readonly effectivePrice: bigint;
  readonly source: DataSource;
}

/** Request to build a launch purchase transaction. */
export interface LaunchBuyExecutionRequest {
  readonly quote: LaunchBuyQuote;
  readonly minTokensOut: bigint;
  readonly recipient: Address;
  readonly deadline: bigint;
  readonly integrator: ResolvedIntegratorConfig;
}

/** Result of waiting on a transaction. */
export interface TransactionOutcome {
  readonly hash: Hex;
  readonly status: "success" | "reverted";
  readonly blockNumber: bigint | null;
  readonly source: DataSource;
}

/**
 * The single interface every chain read and write passes through.
 *
 * Methods that a given deployment cannot support must throw
 * {@link UnsupportedOperationError} rather than returning empty or zero data.
 * Silence is indistinguishable from "there is no liquidity", which is a lie the
 * UI would render as fact.
 */
export interface ProtocolAdapter {
  /** Identifies the implementation, e.g. `"mock"` or `"viem"`. */
  readonly kind: string;
  /**
   * `true` when nothing this adapter returns came from a chain. The styled
   * widgets render a persistent banner when this is set, and it cannot be
   * suppressed by configuration.
   */
  readonly isMock: boolean;
  readonly chain: ChainConfig;

  /** Connected account, or `null` when no wallet is connected. */
  getAccount(): Promise<Address | null>;

  /** Tokens this deployment knows about, for the token picker. */
  listTokens(): Promise<readonly TokenInfo[]>;
  getToken(address: Address): Promise<TokenInfo | null>;
  getBalance(token: TokenInfo, owner: Address): Promise<bigint>;

  /** Pools available for routing and liquidity provision. */
  listPools(): Promise<readonly PoolInfo[]>;
  getPoolState(pool: PoolInfo): Promise<PoolState>;

  /** Approvals still required before `request` can be executed. */
  getApprovalRequirements(
    token: TokenInfo,
    owner: Address,
    amount: bigint,
  ): Promise<readonly ApprovalRequirement[]>;
  buildApproval(requirement: ApprovalRequirement): Promise<WidgetTransactionRequest>;

  quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResult>;
  buildSwap(request: SwapExecutionRequest): Promise<WidgetTransactionRequest>;

  quoteAddLiquidity(request: AddLiquidityQuoteRequest): Promise<AddLiquidityQuote>;
  buildAddLiquidity(request: AddLiquidityExecutionRequest): Promise<WidgetTransactionRequest>;
  listPositions(owner: Address, pool?: PoolInfo): Promise<readonly PositionInfo[]>;
  quoteRemoveLiquidity(position: PositionInfo, percentBps: number): Promise<RemoveLiquidityQuote>;
  buildRemoveLiquidity(
    request: RemoveLiquidityExecutionRequest,
  ): Promise<WidgetTransactionRequest>;

  listLaunches(): Promise<readonly LaunchInfo[]>;
  getLaunch(id: Address): Promise<LaunchInfo | null>;
  getLaunchAccountState(id: Address, account: Address): Promise<LaunchAccountState>;
  quoteLaunchBuy(launch: LaunchInfo, amountIn: bigint): Promise<LaunchBuyQuote>;
  buildLaunchBuy(request: LaunchBuyExecutionRequest): Promise<WidgetTransactionRequest>;

  sendTransaction(request: WidgetTransactionRequest): Promise<Hex>;
  waitForTransaction(hash: Hex): Promise<TransactionOutcome>;
}

/** Thrown when an adapter cannot perform an operation on this deployment. */
export class UnsupportedOperationError extends Error {
  readonly operation: string;

  constructor(operation: string, detail: string) {
    super(`[@latchprotocol/widgets] ${operation} is not available: ${detail}`);
    this.name = "UnsupportedOperationError";
    this.operation = operation;
  }
}

/** Thrown when a wallet action is required but no account is connected. */
export class WalletNotConnectedError extends Error {
  constructor(action: string) {
    super(`[@latchprotocol/widgets] connect a wallet before attempting to ${action}`);
    this.name = "WalletNotConnectedError";
  }
}

/** Thrown when the requested route does not exist in this deployment. */
export class NoRouteError extends Error {
  readonly tokenIn: Address;
  readonly tokenOut: Address;

  constructor(tokenIn: Address, tokenOut: Address) {
    super(`[@latchprotocol/widgets] no pool connects ${tokenIn} to ${tokenOut}`);
    this.name = "NoRouteError";
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
  }
}
