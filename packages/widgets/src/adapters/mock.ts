// SPDX-License-Identifier: MIT
/**
 * Mock protocol adapter - **DEVELOPMENT ONLY. NOT MARKET DATA.**
 *
 * This adapter exists so the widgets can be built, styled and reviewed end to
 * end with no chain attached. Every number it returns is invented by a
 * deterministic simulator over fake reserves. Latch itself IS deployed - point
 * `createViemAdapter` at it if you want real numbers.
 *
 * Three rules keep that from becoming a lie users can act on:
 *
 * 1. `isMock` is `true` and cannot be turned off. The styled widgets render a
 *    permanent warning banner whenever it is set.
 * 2. Every returned record carries `source: "mock"`.
 * 3. The tokens are named `MOCK-*` with a fake `m` prefix on the stable, and
 *    the prices are round numbers with no relation to any real asset. Nothing
 *    here can be mistaken for a quote on ETH, USDC or anything else that exists.
 *
 * The simulator is a plain constant-product curve. It is *not* the protocol's
 * concentrated-liquidity or bin math, and it must never be used to predict a
 * real fill.
 */

import { keccak256, stringToHex, type Address, type Hex } from "viem";
import {
  createCLPoolKey,
  createBinPoolKey,
  poolKeyToId,
  DYNAMIC_FEE_FLAG,
  type PoolId,
} from "@latchprotocol/sdk";
import type { ChainConfig } from "../config/chain.js";
import { requireContract } from "../config/chain.js";
import { BIN_DISTRIBUTION_SCALE } from "../callpath/constants.js";
import {
  isLaunchConfigured,
  launchFeeAtBlock,
  type LaunchGuard,
} from "../callpath/launch.js";
import {
  NoRouteError,
  UnsupportedOperationError,
  WalletNotConnectedError,
  type AddLiquidityExecutionRequest,
  type AddLiquidityQuote,
  type AddLiquidityQuoteRequest,
  type ApprovalRequirement,
  type BinLiquidityShare,
  type LaunchInfo,
  type PoolInfo,
  type PoolState,
  type PositionInfo,
  type ProtocolAdapter,
  type RemoveLiquidityExecutionRequest,
  type RemoveLiquidityQuote,
  type RouteStep,
  type SwapExecutionRequest,
  type SwapQuoteRequest,
  type SwapQuoteResult,
  type TokenInfo,
  type TransactionOutcome,
  type WidgetTransactionRequest,
} from "./protocol.js";

const MOCK_LABEL = "MOCK DATA - not a live quote";

/** Fake addresses, derived from labels so they are stable but obviously fake. */
function mockAddress(label: string): Address {
  return `0x${keccak256(stringToHex(`latchprotocol-mock:${label}`)).slice(-40)}` as Address;
}

const NATIVE: Address = "0x0000000000000000000000000000000000000000";

const MOCK_TOKENS: readonly TokenInfo[] = [
  {
    address: NATIVE,
    symbol: "MOCK-GAS",
    name: "Mock native asset (not a real currency)",
    decimals: 18,
    isNative: true,
  },
  {
    address: mockAddress("token-a"),
    symbol: "MOCK-A",
    name: "Mock token A",
    decimals: 18,
  },
  {
    address: mockAddress("token-b"),
    symbol: "MOCK-B",
    name: "Mock token B",
    decimals: 18,
  },
  {
    address: mockAddress("stable"),
    symbol: "mUSD",
    name: "Mock stable unit (fictional)",
    decimals: 6,
  },
  {
    address: mockAddress("launch-token"),
    symbol: "MOCK-NEW",
    name: "Mock launch token (fictional)",
    decimals: 18,
  },
];

/**
 * Block height the mock's clock starts from.
 *
 * Any number would do; a round one makes it obvious in a screenshot that this
 * is not a chain's real height.
 */
const MOCK_BASE_BLOCK = 1_000_000n;

function tokenBySymbol(symbol: string): TokenInfo {
  const token = MOCK_TOKENS.find((candidate) => candidate.symbol === symbol);
  if (token === undefined) throw new Error(`mock token ${symbol} is not defined`);
  return token;
}

interface MockPool {
  readonly info: PoolInfo;
  /** Fake reserves driving the constant-product simulator. */
  reserve0: bigint;
  reserve1: bigint;
  readonly currentTick: number;
  readonly activeId: number;
}

function sortPair(a: TokenInfo, b: TokenInfo): [TokenInfo, TokenInfo] {
  return BigInt(a.address) < BigInt(b.address) ? [a, b] : [b, a];
}

/** Options for {@link createMockAdapter}. */
export interface MockAdapterOptions {
  readonly chain: ChainConfig;
  /** Account the mock reports as connected. `null` simulates a disconnected wallet. */
  readonly account?: Address | null;
  /** Artificial latency in milliseconds, to exercise loading states. */
  readonly latencyMs?: number;
  /** Force every quote to fail, to exercise error states. */
  readonly failQuotes?: boolean;
  /** Simulate a wallet that rejects the transaction. */
  readonly rejectTransactions?: boolean;
  /** Pretend the user has already granted every approval. */
  readonly preApproved?: boolean;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Constant-product output with a fee, entirely fictional.
 *
 * Deliberately simple and deliberately not the protocol's math, so that no one
 * mistakes its output for a real fill prediction.
 */
function constantProductOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feePips: number,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInAfterFee = amountIn - (amountIn * BigInt(feePips)) / 1_000_000n;
  return (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
}

/** Output at the current price with no impact and no fee. */
function spotOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (reserveIn <= 0n) return 0n;
  return (amountIn * reserveOut) / reserveIn;
}

class MockProtocolAdapter implements ProtocolAdapter {
  readonly kind = "mock";
  readonly isMock = true;
  readonly chain: ChainConfig;

  readonly #options: MockAdapterOptions;
  readonly #pools: MockPool[];
  readonly #balances = new Map<string, bigint>();
  readonly #erc20Allowances = new Map<string, bigint>();
  readonly #permit2Allowances = new Map<string, bigint>();
  readonly #positions: PositionInfo[] = [];
  readonly #launchGuards = new Map<PoolId, LaunchGuard>();
  readonly #startedAtMs = Date.now();
  #nonce = 0;

  constructor(options: MockAdapterOptions) {
    this.#options = options;
    this.chain = options.chain;
    this.#pools = this.#buildPools();
    this.#seedLaunchGuards();
    this.#seedBalances();
    this.#seedPositions();
  }

  #buildPools(): MockPool[] {
    const clManager = this.chain.contracts.clPoolManager ?? mockAddress("cl-pool-manager");
    const binManager = this.chain.contracts.binPoolManager ?? mockAddress("bin-pool-manager");
    const gas = tokenBySymbol("MOCK-GAS");
    const a = tokenBySymbol("MOCK-A");
    const b = tokenBySymbol("MOCK-B");
    const usd = tokenBySymbol("mUSD");

    const pools: MockPool[] = [];

    {
      const [t0, t1] = sortPair(gas, usd);
      const key = createCLPoolKey({
        currency0: t0.address,
        currency1: t1.address,
        hooks: NATIVE,
        poolManager: clManager,
        fee: 3_000,
        tickSpacing: 60,
      });
      const reserves = reservesFor(t0, t1, 2_000n);
      pools.push({
        info: {
          id: poolKeyToId(key),
          key,
          poolType: "CL",
          token0: t0,
          token1: t1,
          lpFeePips: 3_000,
          tickSpacing: 60,
          hooks: NATIVE,
        },
        reserve0: reserves[0],
        reserve1: reserves[1],
        currentTick: -76_020,
        activeId: 0,
      });
    }

    {
      const [t0, t1] = sortPair(a, usd);
      const key = createCLPoolKey({
        currency0: t0.address,
        currency1: t1.address,
        hooks: mockAddress("dynamic-fee-hook"),
        poolManager: clManager,
        fee: 500,
        tickSpacing: 10,
        hooksRegistrationBitmap: 0b0000_0000_1100_0000,
      });
      const reserves = reservesFor(t0, t1, 4n);
      pools.push({
        info: {
          id: poolKeyToId(key),
          key,
          poolType: "CL",
          token0: t0,
          token1: t1,
          lpFeePips: 500,
          tickSpacing: 10,
          hooks: mockAddress("dynamic-fee-hook"),
        },
        reserve0: reserves[0],
        reserve1: reserves[1],
        currentTick: 13_860,
        activeId: 0,
      });
    }

    // The launch pool. A launch is not a sale contract: it is this - a CL pool
    // with LaunchGuardHook in its key and a DYNAMIC fee, which is why `fee` is
    // the dynamic-fee marker rather than a number. The hook rejects a
    // static-fee pool at `beforeInitialize`, so a mock with a static fee here
    // would be a pool the real hook could not have created.
    const launchHook = this.chain.contracts.launchGuardHook;
    if (launchHook !== undefined) {
      const [t0, t1] = sortPair(tokenBySymbol("MOCK-NEW"), usd);
      const key = createCLPoolKey({
        currency0: t0.address,
        currency1: t1.address,
        hooks: launchHook,
        poolManager: clManager,
        fee: DYNAMIC_FEE_FLAG,
        tickSpacing: 60,
        // beforeInitialize (bit 0) | beforeSwap (bit 6), what
        // LaunchGuardHook.getHooksRegistrationBitmap() returns.
        hooksRegistrationBitmap: 0x0041,
      });
      const reserves = reservesFor(t0, t1, 1n);
      pools.push({
        info: {
          id: poolKeyToId(key),
          key,
          poolType: "CL",
          token0: t0,
          token1: t1,
          lpFeePips: DYNAMIC_FEE_FLAG,
          tickSpacing: 60,
          hooks: launchHook,
        },
        reserve0: reserves[0],
        reserve1: reserves[1],
        currentTick: 0,
        activeId: 0,
      });
    }

    {
      const [t0, t1] = sortPair(a, b);
      const key = createBinPoolKey({
        currency0: t0.address,
        currency1: t1.address,
        hooks: NATIVE,
        poolManager: binManager,
        fee: 100,
        binStep: 25,
      });
      const reserves = reservesFor(t0, t1, 1n);
      pools.push({
        info: {
          id: poolKeyToId(key),
          key,
          poolType: "BIN",
          token0: t0,
          token1: t1,
          lpFeePips: 100,
          binStep: 25,
          hooks: NATIVE,
        },
        reserve0: reserves[0],
        reserve1: reserves[1],
        currentTick: 0,
        activeId: 8_388_608,
      });
    }

    return pools;
  }

  /**
   * A fake `LaunchGuardHook` record for the fake launch pool.
   *
   * The shape is the contract's, not a convenient approximation: the same nine
   * fields, the same units (pips, with `FEE_DENOMINATOR = 1_000_000`), and a
   * schedule the hook would accept — `initialFeePips <= MAX_INITIAL_FEE`,
   * `finalFeePips <= MAX_FINAL_FEE`, `initialFeePips >= finalFeePips`. A mock
   * that produced a configuration the real hook would reject would train the UI
   * on states that cannot occur.
   *
   * It opens 60 mock blocks after the adapter is constructed and decays over
   * 600, so a developer sees `pending`, then `decaying`, then `settled` without
   * touching anything.
   */
  #seedLaunchGuards(): void {
    const hook = this.chain.contracts.launchGuardHook;
    if (hook === undefined) return;
    for (const pool of this.#pools) {
      if (pool.info.poolType !== "CL" || pool.info.hooks !== hook) continue;
      const launchTokenIsCurrency0 = pool.info.token0.symbol === "MOCK-NEW";
      const quoteDecimals = launchTokenIsCurrency0
        ? pool.info.token1.decimals
        : pool.info.token0.decimals;
      this.#launchGuards.set(pool.info.id, {
        owner: mockAddress("launch-owner"),
        startBlock: MOCK_BASE_BLOCK + 60n,
        decayBlocks: 600,
        enabled: true,
        // 25% at the open decaying to 0.30%: a plausible sniper tax, inside the
        // hook's MAX_INITIAL_FEE (500_000) and MAX_FINAL_FEE (100_000) caps.
        initialFeePips: 250_000,
        finalFeePips: 3_000,
        maxBuyPerTx: 500n * 10n ** BigInt(quoteDecimals),
        launchTokenIsCurrency0,
        launched: false,
      });
    }
  }

  #seedBalances(): void {
    const account = this.#options.account;
    if (account === undefined || account === null) return;
    this.#balances.set(balanceKey(NATIVE, account), 12n * 10n ** 18n);
    this.#balances.set(
      balanceKey(tokenBySymbol("MOCK-A").address, account),
      850n * 10n ** 18n,
    );
    this.#balances.set(
      balanceKey(tokenBySymbol("MOCK-B").address, account),
      1_200n * 10n ** 18n,
    );
    this.#balances.set(balanceKey(tokenBySymbol("mUSD").address, account), 25_000n * 10n ** 6n);
  }

  #seedPositions(): void {
    const account = this.#options.account;
    if (account === undefined || account === null) return;
    const clPool = this.#pools.find((pool) => pool.info.poolType === "CL");
    const binPool = this.#pools.find((pool) => pool.info.poolType === "BIN");
    if (clPool !== undefined) {
      this.#positions.push({
        id: `mock-cl-1`,
        tokenId: 1n,
        pool: clPool.info,
        range: { type: "CL", tickLower: -78_000, tickUpper: -74_000 },
        liquidity: 4_200_000_000_000n,
        amount0: 2n * 10n ** 18n,
        amount1: 3_900n * 10n ** BigInt(clPool.info.token1.decimals),
        feesOwed0: 10n ** 15n,
        feesOwed1: 4n * 10n ** BigInt(clPool.info.token1.decimals - 2),
        inRange: true,
        source: "mock",
      });
    }
    if (binPool !== undefined) {
      const active = binPool.activeId;
      this.#positions.push({
        id: `mock-bin-1`,
        pool: binPool.info,
        range: {
          type: "BIN",
          activeIdDesired: active,
          binIdLower: active - 3,
          binIdUpper: active + 3,
          idSlippage: 5,
        },
        liquidity: 700_000_000_000n,
        amount0: 120n * 10n ** 18n,
        amount1: 140n * 10n ** 18n,
        feesOwed0: 0n,
        feesOwed1: 0n,
        binAmounts: [-3, -2, -1, 0, 1, 2, 3].map((offset) => ({
          binId: active + offset,
          amount: 100_000_000_000n,
        })),
        inRange: true,
        source: "mock",
      });
    }
  }

  async #tick(): Promise<void> {
    await delay(this.#options.latencyMs ?? 0);
  }

  async getAccount(): Promise<Address | null> {
    await this.#tick();
    return this.#options.account ?? null;
  }

  async listTokens(): Promise<readonly TokenInfo[]> {
    await this.#tick();
    return MOCK_TOKENS;
  }

  async getToken(address: Address): Promise<TokenInfo | null> {
    await this.#tick();
    return (
      MOCK_TOKENS.find(
        (token) => token.address.toLowerCase() === address.toLowerCase(),
      ) ?? null
    );
  }

  async getBalance(token: TokenInfo, owner: Address): Promise<bigint> {
    await this.#tick();
    return this.#balances.get(balanceKey(token.address, owner)) ?? 0n;
  }

  async listPools(): Promise<readonly PoolInfo[]> {
    await this.#tick();
    return this.#pools.map((pool) => pool.info);
  }

  async getPoolState(pool: PoolInfo): Promise<PoolState> {
    await this.#tick();
    const found = this.#findPool(pool.id);
    if (found.info.poolType === "CL") {
      return {
        poolId: pool.id,
        poolType: "CL",
        currentTick: found.currentTick,
        liquidity: found.reserve0,
        source: "mock",
      };
    }
    return {
      poolId: pool.id,
      poolType: "BIN",
      activeId: found.activeId,
      liquidity: found.reserve0,
      source: "mock",
    };
  }

  async getApprovalRequirements(
    token: TokenInfo,
    owner: Address,
    amount: bigint,
  ): Promise<readonly ApprovalRequirement[]> {
    await this.#tick();
    if (token.isNative === true || token.address === NATIVE) return [];
    if (this.#options.preApproved === true) return [];
    const permit2 = this.chain.contracts.permit2 ?? mockAddress("permit2");
    const router = this.chain.contracts.universalRouter ?? mockAddress("universal-router");
    const requirements: ApprovalRequirement[] = [];

    const erc20Current = this.#erc20Allowances.get(allowanceKey(token.address, owner, permit2)) ?? 0n;
    if (erc20Current < amount) {
      requirements.push({
        kind: "erc20-to-permit2",
        token,
        spender: permit2,
        current: erc20Current,
        required: amount,
      });
    }
    const permit2Current =
      this.#permit2Allowances.get(allowanceKey(token.address, owner, router)) ?? 0n;
    if (permit2Current < amount) {
      requirements.push({
        kind: "permit2-to-router",
        token,
        spender: router,
        current: permit2Current,
        required: amount,
      });
    }
    return requirements;
  }

  async buildApproval(requirement: ApprovalRequirement): Promise<WidgetTransactionRequest> {
    await this.#tick();
    return {
      to: requirement.token.address,
      data: "0x",
      value: 0n,
      summary: `${MOCK_LABEL}: approve ${requirement.token.symbol} for ${requirement.kind}`,
      source: "mock",
    };
  }

  async quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResult> {
    await this.#tick();
    if (this.#options.failQuotes === true) {
      throw new Error("mock adapter: quotes are configured to fail");
    }
    const route = this.#findRoute(request.tokenIn, request.tokenOut);

    let amount = request.amountIn;
    let spot = request.amountIn;
    let lpFeeAmount = 0n;
    const steps: RouteStep[] = [];

    for (const hop of route) {
      const pool = this.#findPool(hop.info.id);
      const zeroForOne =
        pool.info.token0.address.toLowerCase() === hop.tokenIn.address.toLowerCase();
      const reserveIn = zeroForOne ? pool.reserve0 : pool.reserve1;
      const reserveOut = zeroForOne ? pool.reserve1 : pool.reserve0;
      const feePips = this.#effectiveFeePips(pool.info);
      const hopFee = (amount * BigInt(feePips)) / 1_000_000n;
      if (steps.length === 0) lpFeeAmount = hopFee;
      amount = constantProductOut(amount, reserveIn, reserveOut, feePips);
      spot = spotOut(spot, reserveIn, reserveOut);
      steps.push({
        poolId: pool.info.id,
        poolType: pool.info.poolType,
        tokenIn: hop.tokenIn,
        tokenOut: hop.tokenOut,
        lpFeePips: feePips,
        hooks: pool.info.hooks,
      });
    }

    return {
      route: steps,
      amountIn: request.amountIn,
      grossAmountOut: amount,
      spotAmountOut: spot,
      lpFeeAmount,
      lpFeePips: steps[0]?.lpFeePips ?? 0,
      estimatedGas: 180_000n,
      source: "mock",
    };
  }

  async buildSwap(request: SwapExecutionRequest): Promise<WidgetTransactionRequest> {
    await this.#tick();
    const router = this.chain.contracts.universalRouter ?? mockAddress("universal-router");
    const feeInfo = request.integrator.active
      ? {
          referrer: request.integrator.referrer,
          feeBps: request.integrator.feeBps,
          currency: request.tokenOut.address,
          expectedAmount:
            (request.quote.grossAmountOut * BigInt(request.integrator.feeBps)) / 10_000n,
        }
      : undefined;
    return {
      to: router,
      // The mock never produces real calldata: a mock transaction must not be
      // submittable by accident.
      data: "0x",
      value: request.tokenIn.address === NATIVE ? request.amountIn : 0n,
      summary:
        `${MOCK_LABEL}: swap ${request.amountIn} ${request.tokenIn.symbol} -> ` +
        `${request.tokenOut.symbol}` +
        (feeInfo ? ` (integrator fee ${feeInfo.feeBps} bps to ${feeInfo.referrer})` : ""),
      ...(feeInfo ? { integratorFee: feeInfo } : {}),
      source: "mock",
    };
  }

  async quoteAddLiquidity(request: AddLiquidityQuoteRequest): Promise<AddLiquidityQuote> {
    await this.#tick();
    const pool = this.#findPool(request.pool.id);
    if (request.range.type === "CL" && pool.info.poolType !== "CL") {
      throw new UnsupportedOperationError("quoteAddLiquidity", "tick range given for a bin pool");
    }
    if (request.range.type === "BIN" && pool.info.poolType !== "BIN") {
      throw new UnsupportedOperationError("quoteAddLiquidity", "bin range given for a CL pool");
    }

    // Fictional ratio: mirror the fake reserves so both sides look coherent.
    const ratioNumerator = pool.reserve1;
    const ratioDenominator = pool.reserve0 === 0n ? 1n : pool.reserve0;
    const amount0 = request.amount0Desired;
    const impliedAmount1 = (amount0 * ratioNumerator) / ratioDenominator;
    const amount1 =
      request.amount1Desired > 0n && request.amount1Desired < impliedAmount1
        ? request.amount1Desired
        : impliedAmount1;
    const liquidity = sqrtBigInt(amount0 * amount1 + 1n);

    if (request.range.type === "BIN") {
      const distribution = buildUniformBinDistribution(
        request.range.binIdLower,
        request.range.binIdUpper,
        request.range.activeIdDesired,
      );
      return {
        pool: pool.info,
        range: request.range,
        amount0,
        amount1,
        liquidity,
        shareBps: null,
        binDistribution: distribution,
        source: "mock",
      };
    }

    return {
      pool: pool.info,
      range: request.range,
      amount0,
      amount1,
      liquidity,
      shareBps: null,
      source: "mock",
    };
  }

  async buildAddLiquidity(
    request: AddLiquidityExecutionRequest,
  ): Promise<WidgetTransactionRequest> {
    await this.#tick();
    const manager =
      request.quote.pool.poolType === "CL"
        ? this.chain.contracts.clPositionManager ?? mockAddress("cl-position-manager")
        : this.chain.contracts.binPositionManager ?? mockAddress("bin-position-manager");
    return {
      to: manager,
      data: "0x",
      value: 0n,
      summary:
        `${MOCK_LABEL}: add liquidity to ${request.quote.pool.token0.symbol}/` +
        `${request.quote.pool.token1.symbol} (${request.quote.pool.poolType})`,
      source: "mock",
    };
  }

  async listPositions(owner: Address, pool?: PoolInfo): Promise<readonly PositionInfo[]> {
    await this.#tick();
    if (this.#options.account === null || this.#options.account === undefined) return [];
    if (this.#options.account.toLowerCase() !== owner.toLowerCase()) return [];
    return pool === undefined
      ? this.#positions
      : this.#positions.filter((position) => position.pool.id === pool.id);
  }

  async quoteRemoveLiquidity(
    position: PositionInfo,
    percentBps: number,
  ): Promise<RemoveLiquidityQuote> {
    await this.#tick();
    const scale = BigInt(percentBps);
    return {
      position,
      percentBps,
      amount0: (position.amount0 * scale) / 10_000n,
      amount1: (position.amount1 * scale) / 10_000n,
      source: "mock",
    };
  }

  async buildRemoveLiquidity(
    request: RemoveLiquidityExecutionRequest,
  ): Promise<WidgetTransactionRequest> {
    await this.#tick();
    const manager =
      request.position.pool.poolType === "CL"
        ? this.chain.contracts.clPositionManager ?? mockAddress("cl-position-manager")
        : this.chain.contracts.binPositionManager ?? mockAddress("bin-position-manager");
    return {
      to: manager,
      data: "0x",
      value: 0n,
      summary: `${MOCK_LABEL}: remove ${request.percentBps / 100}% of position ${request.position.id}`,
      source: "mock",
    };
  }

  /**
   * Launch pools, selected exactly the way the live adapter selects them: every
   * CL pool whose key names the configured `launchGuardHook`.
   *
   * Throws when no hook address is configured, so a host can exercise the
   * widget's "not configured on this chain" state against the mock instead of
   * discovering it in production.
   */
  async listLaunches(): Promise<readonly LaunchInfo[]> {
    await this.#tick();
    const hook = requireContract(this.chain, "launchGuardHook", "read a launch schedule");
    return this.#pools
      .filter((pool) => pool.info.poolType === "CL" && pool.info.hooks === hook)
      .map((pool) => this.#launchFor(pool.info, hook))
      .filter((launch): launch is LaunchInfo => launch !== null);
  }

  async getLaunch(poolId: PoolId): Promise<LaunchInfo | null> {
    await this.#tick();
    const hook = requireContract(this.chain, "launchGuardHook", "read a launch schedule");
    const pool = this.#pools.find((candidate) => candidate.info.id === poolId);
    if (pool === undefined) return null;
    if (pool.info.poolType !== "CL" || pool.info.hooks !== hook) return null;
    return this.#launchFor(pool.info, hook);
  }

  /**
   * The fake launch record.
   *
   * The schedule advances: `#mockBlockNumber` ticks one block per second of
   * wall clock from a fixed base, so the fee decay, the countdown and the phase
   * transitions can all be watched happening. It is a simulation of a block
   * height, not a block height, which is what `isMock` and `source: "mock"`
   * exist to say.
   */
  #launchFor(pool: PoolInfo, hook: Address): LaunchInfo | null {
    const guard = this.#launchGuards.get(pool.id);
    if (guard === undefined || !isLaunchConfigured(guard)) return null;
    const readAtBlock = this.#mockBlockNumber();
    const feePips = launchFeeAtBlock(guard, readAtBlock);
    if (feePips === null) return null;
    const [launchToken, quoteToken] = guard.launchTokenIsCurrency0
      ? [pool.token0, pool.token1]
      : [pool.token1, pool.token0];
    return {
      poolId: pool.id,
      pool,
      hook,
      launchToken,
      quoteToken,
      guard,
      currentFeePips: feePips,
      readAtBlock,
      source: "mock",
    };
  }

  #mockBlockNumber(): bigint {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.#startedAtMs) / 1000));
    return MOCK_BASE_BLOCK + BigInt(elapsedSeconds);
  }

  /**
   * The fee a swap through this pool pays right now.
   *
   * `lpFeePips` on a dynamic-fee pool is the marker `0x800000`, not a rate;
   * feeding it to the constant-product simulator would compute a fee of 838%
   * and return a negative output. On a launch pool the rate comes from the
   * guard's decay schedule, which is where it comes from on chain too.
   */
  #effectiveFeePips(pool: PoolInfo): number {
    if (pool.lpFeePips !== DYNAMIC_FEE_FLAG) return pool.lpFeePips;
    const guard = this.#launchGuards.get(pool.id);
    if (guard === undefined) {
      throw new UnsupportedOperationError(
        "quoteSwap",
        `mock pool ${pool.id} has a dynamic fee and no hook the mock knows how to ask`,
      );
    }
    return launchFeeAtBlock(guard, this.#mockBlockNumber()) ?? guard.finalFeePips;
  }

  async sendTransaction(request: WidgetTransactionRequest): Promise<Hex> {
    if (this.#options.account === null || this.#options.account === undefined) {
      throw new WalletNotConnectedError("send a transaction");
    }
    await delay(Math.max(this.#options.latencyMs ?? 0, 400));
    if (this.#options.rejectTransactions === true) {
      throw new Error("mock wallet: user rejected the transaction");
    }
    this.#nonce += 1;
    return keccak256(stringToHex(`mock-tx:${this.#nonce}:${request.summary}`));
  }

  async waitForTransaction(hash: Hex): Promise<TransactionOutcome> {
    await delay(Math.max(this.#options.latencyMs ?? 0, 600));
    return { hash, status: "success", blockNumber: null, source: "mock" };
  }

  #findPool(id: string): MockPool {
    const pool = this.#pools.find((candidate) => candidate.info.id === id);
    if (pool === undefined) {
      throw new UnsupportedOperationError("getPool", `unknown mock pool ${id}`);
    }
    return pool;
  }

  /** Direct pool, else a single-intermediate route. Never invents liquidity. */
  #findRoute(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
  ): { info: PoolInfo; tokenIn: TokenInfo; tokenOut: TokenInfo }[] {
    const direct = this.#pools.find((pool) => connects(pool.info, tokenIn, tokenOut));
    if (direct !== undefined) {
      return [{ info: direct.info, tokenIn, tokenOut }];
    }
    for (const first of this.#pools) {
      const intermediate = other(first.info, tokenIn);
      if (intermediate === null) continue;
      const second = this.#pools.find(
        (pool) => pool.info.id !== first.info.id && connects(pool.info, intermediate, tokenOut),
      );
      if (second !== undefined) {
        return [
          { info: first.info, tokenIn, tokenOut: intermediate },
          { info: second.info, tokenIn: intermediate, tokenOut },
        ];
      }
    }
    throw new NoRouteError(tokenIn.address, tokenOut.address);
  }
}

function connects(pool: PoolInfo, tokenIn: TokenInfo, tokenOut: TokenInfo): boolean {
  const pair = [pool.token0.address.toLowerCase(), pool.token1.address.toLowerCase()];
  return (
    pair.includes(tokenIn.address.toLowerCase()) && pair.includes(tokenOut.address.toLowerCase())
  );
}

function other(pool: PoolInfo, token: TokenInfo): TokenInfo | null {
  if (pool.token0.address.toLowerCase() === token.address.toLowerCase()) return pool.token1;
  if (pool.token1.address.toLowerCase() === token.address.toLowerCase()) return pool.token0;
  return null;
}

function balanceKey(token: Address, owner: Address): string {
  return `${token.toLowerCase()}:${owner.toLowerCase()}`;
}

function allowanceKey(token: Address, owner: Address, spender: Address): string {
  return `${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}`;
}

function reservesFor(token0: TokenInfo, token1: TokenInfo, priceOfToken0: bigint): [bigint, bigint] {
  const base = 1_000n;
  const reserve0 = base * 10n ** BigInt(token0.decimals);
  const reserve1 = base * priceOfToken0 * 10n ** BigInt(token1.decimals);
  return [reserve0, reserve1];
}

/** Integer square root, used only by the fictional liquidity estimate. */
function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("sqrtBigInt: negative input");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** Spreads liquidity evenly across a bin span, as a bin mint requires. */
export function buildUniformBinDistribution(
  binIdLower: number,
  binIdUpper: number,
  activeId: number,
): BinLiquidityShare[] {
  if (binIdLower > binIdUpper) {
    throw new RangeError(`binIdLower ${binIdLower} exceeds binIdUpper ${binIdUpper}`);
  }
  const ids: number[] = [];
  for (let id = binIdLower; id <= binIdUpper; id += 1) ids.push(id);

  // Bins strictly below the active id hold only currency1 (Y); bins above hold
  // only currency0 (X); the active bin holds both.
  const xBins = ids.filter((id) => id >= activeId).length;
  const yBins = ids.filter((id) => id <= activeId).length;

  const shares: BinLiquidityShare[] = [];
  let xAssigned = 0n;
  let yAssigned = 0n;
  ids.forEach((id, index) => {
    const isLastX = id === binIdUpper;
    const isLastY = id === binIdUpper;
    const rawX = id >= activeId && xBins > 0 ? BIN_DISTRIBUTION_SCALE / BigInt(xBins) : 0n;
    const rawY = id <= activeId && yBins > 0 ? BIN_DISTRIBUTION_SCALE / BigInt(yBins) : 0n;
    // Push the rounding dust into the final bin so each side sums to exactly 1e18.
    const distributionX =
      isLastX && rawX > 0n ? BIN_DISTRIBUTION_SCALE - xAssigned : rawX;
    const distributionY =
      isLastY && rawY > 0n ? BIN_DISTRIBUTION_SCALE - yAssigned : rawY;
    xAssigned += distributionX;
    yAssigned += distributionY;
    shares.push({
      binId: id,
      deltaId: id - activeId,
      distributionX,
      distributionY,
    });
    void index;
  });
  return shares;
}

/**
 * Creates the mock adapter.
 *
 * Anything this returns is fabricated. Do not use it in production, and do not
 * present its output as a price.
 */
export function createMockAdapter(options: MockAdapterOptions): ProtocolAdapter {
  return new MockProtocolAdapter(options);
}
