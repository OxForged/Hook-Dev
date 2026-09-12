// SPDX-License-Identifier: MIT
/**
 * Call-path encoding for both pool types, plus the mock adapter's contract.
 *
 * These assert the shape the contracts decode: strict `abi.encode(bytes, bytes[])`
 * transport, the right action ids in the right order, and the pool-type
 * divergence confined to the encoder.
 */

import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData } from "viem";
import { createBinPoolKey, createCLPoolKey } from "@latchprotocol/sdk";
import {
  ACTIONS,
  BIN_DISTRIBUTION_SCALE,
  MSG_SENDER,
  POSITION_MANAGER_ABI,
} from "../src/callpath/constants.js";
import { ActionPlan, plan } from "../src/callpath/plan.js";
import {
  buildBinAddCall,
  buildBinRemoveCall,
  buildCLDecreaseCall,
  buildCLMintCall,
} from "../src/callpath/liquidity.js";
import {
  buildLaunchBuyCall,
  decodeLaunchGuard,
  evaluateLaunchBuy,
  hopIsLaunchBuy,
  isLaunchConfigured,
  launchFeeAtBlock,
  launchScheduleAt,
  type LaunchGuard,
} from "../src/callpath/launch.js";
import { buildSwapCall, type SwapHop } from "../src/callpath/swap.js";
import { NO_INTEGRATOR_FEE, validateIntegratorConfig } from "../src/config/integrator.js";
import { createMockAdapter, buildUniformBinDistribution } from "../src/adapters/mock.js";
import { ChainConfigError, type ChainConfig } from "../src/config/chain.js";
import {
  buildLaunchView,
  isLaunchpadNotConfigured,
  resolveLaunchDataState,
} from "../src/hooks/useLaunch.js";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const TOKEN_A = "0x000000000000000000000000000000000000000a" as const;
const TOKEN_B = "0x000000000000000000000000000000000000000b" as const;
const MANAGER = "0x00000000000000000000000000000000000000a2" as const;
const POSITION_MANAGER = "0x00000000000000000000000000000000000000a5" as const;
const OWNER = "0x00000000000000000000000000000000000000ff" as const;
const REFERRER = "0x1111111111111111111111111111111111111111" as const;

const CL_KEY = createCLPoolKey({
  currency0: TOKEN_A,
  currency1: TOKEN_B,
  hooks: ZERO,
  poolManager: MANAGER,
  fee: 3_000,
  tickSpacing: 60,
});

const BIN_KEY = createBinPoolKey({
  currency0: TOKEN_A,
  currency1: TOKEN_B,
  hooks: ZERO,
  poolManager: MANAGER,
  fee: 100,
  binStep: 25,
});

/**
 * Decodes a bare action plan - the `abi.encode(bytes actions, bytes[] params)`
 * blob the router hands to `_executeActions`.
 *
 * A swap's `inputs[0]` is this, NOT function calldata: `Dispatcher` passes the
 * input straight through without decoding a selector. Running it through
 * `unwrapPlan` reads the first four bytes as a selector and fails.
 */
function decodePlan(encoded: `0x${string}`): {
  actionIds: number[];
  params: readonly `0x${string}`[];
} {
  const [actions, params] = decodeAbiParameters(
    [
      { name: "actions", type: "bytes" },
      { name: "params", type: "bytes[]" },
    ],
    encoded,
  );
  const actionIds = (actions.slice(2).match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
  return { actionIds, params };
}

function unwrapPlan(data: `0x${string}`): {
  actionIds: number[];
  params: readonly `0x${string}`[];
} {
  const decoded = decodeFunctionData({ abi: POSITION_MANAGER_ABI, data });
  const [unlockData] = decoded.args as [`0x${string}`, bigint];
  const [actions, params] = decodeAbiParameters(
    [
      { name: "actions", type: "bytes" },
      { name: "params", type: "bytes[]" },
    ],
    unlockData,
  );
  const actionIds = (actions.slice(2).match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
  return { actionIds, params };
}

describe("ActionPlan", () => {
  it("encodes strictly, with the actions offset the decoder demands", () => {
    const encoded = plan().add(0x06, "0x1234", "test").encode();
    // First word of abi.encode(bytes, bytes[]) is the offset to `actions`: 0x40.
    expect(encoded.slice(2, 66)).toBe("40".padStart(64, "0"));
    const [actions, params] = decodeAbiParameters(
      [
        { name: "actions", type: "bytes" },
        { name: "params", type: "bytes[]" },
      ],
      encoded,
    );
    expect(actions).toBe("0x06");
    expect(params).toEqual(["0x1234"]);
  });

  it("refuses an empty plan and an out-of-range action id", () => {
    expect(() => new ActionPlan().encode()).toThrowError(/empty action plan/);
    expect(() => plan().add(256, "0x", "bad")).toThrowError(RangeError);
  });

  it("describes itself for debugging", () => {
    const trace = plan().add(0x06, "0x", "swap").add(0x0c, "0x", "settle").describe();
    expect(trace).toContain("0. swap (0x06)");
    expect(trace).toContain("1. settle (0x0c)");
  });
});

describe("swap route validation", () => {
  const base = {
    router: "0x00000000000000000000000000000000000000a4" as const,
    amountIn: 1_000n,
    minAmountOutGross: 900n,
    minAmountOutNet: 900n,
    recipient: OWNER,
    sender: OWNER,
    deadline: 1n,
    integrator: NO_INTEGRATOR_FEE,
  };

  it("rejects a route whose hops do not connect", () => {
    const hops: SwapHop[] = [
      { poolKey: CL_KEY, poolType: "CL", currencyIn: TOKEN_A, currencyOut: TOKEN_B },
      { poolKey: CL_KEY, poolType: "CL", currencyIn: TOKEN_A, currencyOut: TOKEN_B },
    ];
    expect(() => buildSwapCall({ ...base, hops })).toThrowError(/not contiguous/);
  });

  it("rejects a route that mixes pool types in one action", () => {
    const hops: SwapHop[] = [
      { poolKey: CL_KEY, poolType: "CL", currencyIn: TOKEN_A, currencyOut: TOKEN_B },
      { poolKey: BIN_KEY, poolType: "BIN", currencyIn: TOKEN_B, currencyOut: TOKEN_A },
    ];
    expect(() => buildSwapCall({ ...base, hops })).toThrowError(/cannot mix CL and BIN/);
  });

  it("rejects an empty route and a zero amount", () => {
    expect(() => buildSwapCall({ ...base, hops: [] })).toThrowError(/no hops/);
    expect(() =>
      buildSwapCall({
        ...base,
        amountIn: 0n,
        hops: [{ poolKey: CL_KEY, poolType: "CL", currencyIn: TOKEN_A, currencyOut: TOKEN_B }],
      }),
    ).toThrowError(/amountIn must be positive/);
  });

  it("uses the multi-hop action for a two-hop same-type route", () => {
    const hops: SwapHop[] = [
      { poolKey: CL_KEY, poolType: "CL", currencyIn: TOKEN_A, currencyOut: TOKEN_B },
      { poolKey: CL_KEY, poolType: "CL", currencyIn: TOKEN_B, currencyOut: TOKEN_A },
    ];
    const call = buildSwapCall({ ...base, hops });
    expect(call.planTrace).toContain("CL swap exact-in (2 hops)");
  });

  it("uses the BIN swap action for a bin pool", () => {
    const call = buildSwapCall({
      ...base,
      hops: [{ poolKey: BIN_KEY, poolType: "BIN", currencyIn: TOKEN_A, currencyOut: TOKEN_B }],
    });
    expect(call.planTrace).toContain("BIN swap exact-in (single hop)");
  });
});

describe("concentrated-liquidity call path", () => {
  it("mints with CL_MINT_POSITION then SETTLE_PAIR", () => {
    const call = buildCLMintCall({
      positionManager: POSITION_MANAGER,
      poolKey: CL_KEY,
      tickLower: -120,
      tickUpper: 120,
      liquidity: 1_000_000n,
      amount0Max: 10n ** 18n,
      amount1Max: 10n ** 18n,
      owner: OWNER,
      deadline: 1_800_000_000n,
    });
    const { actionIds, params } = unwrapPlan(call.data);
    expect(actionIds).toEqual([ACTIONS.CL_MINT_POSITION, ACTIONS.SETTLE_PAIR]);

    const [poolKey, tickLower, tickUpper, liquidity, , , owner] = decodeAbiParameters(
      [
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
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
        { name: "liquidity", type: "uint256" },
        { name: "amount0Max", type: "uint128" },
        { name: "amount1Max", type: "uint128" },
        { name: "owner", type: "address" },
        { name: "hookData", type: "bytes" },
      ],
      params[0] as `0x${string}`,
    );
    expect(poolKey.currency0.toLowerCase()).toBe(TOKEN_A);
    expect(tickLower).toBe(-120);
    expect(tickUpper).toBe(120);
    expect(liquidity).toBe(1_000_000n);
    expect(owner).toBe(OWNER);
    expect(call.to).toBe(POSITION_MANAGER);
  });

  it("rejects an inverted or non-integer tick range", () => {
    const base = {
      positionManager: POSITION_MANAGER,
      poolKey: CL_KEY,
      liquidity: 1n,
      amount0Max: 1n,
      amount1Max: 1n,
      owner: OWNER,
      deadline: 1n,
    };
    expect(() => buildCLMintCall({ ...base, tickLower: 120, tickUpper: 120 })).toThrowError(
      /tickLower must be below tickUpper/,
    );
    expect(() => buildCLMintCall({ ...base, tickLower: 1.5, tickUpper: 120 })).toThrowError(
      /ticks must be integers/,
    );
    expect(() =>
      buildCLMintCall({ ...base, liquidity: 0n, tickLower: -120, tickUpper: 120 }),
    ).toThrowError(/liquidity must be positive/);
  });

  it("decreases with CL_DECREASE_LIQUIDITY then TAKE_PAIR to the sender sentinel", () => {
    const call = buildCLDecreaseCall({
      positionManager: POSITION_MANAGER,
      poolKey: CL_KEY,
      tokenId: 7n,
      liquidity: 500n,
      amount0Min: 1n,
      amount1Min: 2n,
      recipient: OWNER,
      owner: OWNER,
      deadline: 1n,
    });
    const { actionIds, params } = unwrapPlan(call.data);
    expect(actionIds).toEqual([ACTIONS.CL_DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR]);

    const [, , recipient] = decodeAbiParameters(
      [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "recipient", type: "address" },
      ],
      params[1] as `0x${string}`,
    );
    expect(recipient).toBe(MSG_SENDER);
  });
});

describe("liquidity-book call path", () => {
  it("adds with BIN_ADD_LIQUIDITY then SETTLE_PAIR", () => {
    const distribution = buildUniformBinDistribution(-2, 2, 0);
    const call = buildBinAddCall({
      positionManager: POSITION_MANAGER,
      poolKey: BIN_KEY,
      amount0: 100n,
      amount1: 200n,
      amount0Max: 110n,
      amount1Max: 220n,
      activeIdDesired: 8_388_608,
      idSlippage: 5,
      deltaIds: distribution.map((share) => share.deltaId),
      distributionX: distribution.map((share) => share.distributionX),
      distributionY: distribution.map((share) => share.distributionY),
      to: OWNER,
      deadline: 1n,
    });
    const { actionIds } = unwrapPlan(call.data);
    expect(actionIds).toEqual([ACTIONS.BIN_ADD_LIQUIDITY, ACTIONS.SETTLE_PAIR]);
    expect(call.planTrace).toContain("5 bins");
  });

  it("rejects mismatched distribution arrays and an empty bin set", () => {
    const base = {
      positionManager: POSITION_MANAGER,
      poolKey: BIN_KEY,
      amount0: 1n,
      amount1: 1n,
      amount0Max: 1n,
      amount1Max: 1n,
      activeIdDesired: 1,
      idSlippage: 1,
      to: OWNER,
      deadline: 1n,
    };
    expect(() =>
      buildBinAddCall({ ...base, deltaIds: [], distributionX: [], distributionY: [] }),
    ).toThrowError(/at least one bin/);
    expect(() =>
      buildBinAddCall({ ...base, deltaIds: [0, 1], distributionX: [1n], distributionY: [1n, 1n] }),
    ).toThrowError(/same length/);
  });

  it("removes with BIN_REMOVE_LIQUIDITY then TAKE_PAIR", () => {
    const call = buildBinRemoveCall({
      positionManager: POSITION_MANAGER,
      poolKey: BIN_KEY,
      amount0Min: 1n,
      amount1Min: 1n,
      ids: [8_388_607, 8_388_608],
      amounts: [10n, 20n],
      from: OWNER,
      recipient: OWNER,
      deadline: 1n,
    });
    const { actionIds } = unwrapPlan(call.data);
    expect(actionIds).toEqual([ACTIONS.BIN_REMOVE_LIQUIDITY, ACTIONS.TAKE_PAIR]);
  });
});

describe("buildUniformBinDistribution", () => {
  it("assigns each side exactly 1e18 across its bins", () => {
    const shares = buildUniformBinDistribution(-3, 3, 0);
    const totalX = shares.reduce((sum, share) => sum + share.distributionX, 0n);
    const totalY = shares.reduce((sum, share) => sum + share.distributionY, 0n);
    expect(totalX).toBe(BIN_DISTRIBUTION_SCALE);
    expect(totalY).toBe(BIN_DISTRIBUTION_SCALE);
  });

  it("puts no currency0 below the active bin and no currency1 above it", () => {
    const shares = buildUniformBinDistribution(-2, 2, 0);
    for (const share of shares) {
      if (share.deltaId < 0) expect(share.distributionX).toBe(0n);
      if (share.deltaId > 0) expect(share.distributionY).toBe(0n);
    }
  });

  it("rejects an inverted range", () => {
    expect(() => buildUniformBinDistribution(5, 1, 3)).toThrowError(RangeError);
  });
});

/**
 * The launch path.
 *
 * These assert the two things a launch adds to a swap - the fee schedule and
 * the gates - against `LaunchGuardHook`'s actual semantics, and then assert
 * that the buy itself is a swap and nothing else.
 */
describe("launch schedule", () => {
  function guard(overrides: Partial<LaunchGuard> = {}): LaunchGuard {
    return {
      owner: OWNER,
      startBlock: 1_000n,
      decayBlocks: 100,
      enabled: true,
      initialFeePips: 250_000,
      finalFeePips: 3_000,
      maxBuyPerTx: 0n,
      launchTokenIsCurrency0: true,
      launched: false,
      ...overrides,
    };
  }

  it("decodes the struct as the ABI returns it, widening startBlock", () => {
    const decoded = decodeLaunchGuard({
      owner: OWNER,
      startBlock: 1_000,
      decayBlocks: 100,
      enabled: true,
      initialFeeBips: 250_000,
      finalFeeBips: 3_000,
      maxBuyPerTx: 5n,
      launchTokenIsCurrency0: false,
      launched: true,
    });
    expect(decoded.startBlock).toBe(1_000n);
    // Named for the unit the contract's FEE_DENOMINATOR actually implies.
    expect(decoded.initialFeePips).toBe(250_000);
    expect(decoded.finalFeePips).toBe(3_000);
  });

  it("treats the zero owner as an unclaimed pool, not a launch at zero fee", () => {
    const unclaimed = guard({ owner: ZERO });
    expect(isLaunchConfigured(unclaimed)).toBe(false);
    expect(launchFeeAtBlock(unclaimed, 1_050n)).toBeNull();
    expect(launchScheduleAt(unclaimed, 1_050n).phase).toBe("unclaimed");
  });

  it("reproduces LaunchGuardHook._decayedFee at the boundaries", () => {
    const g = guard();
    // elapsed == 0 -> exactly the initial fee.
    expect(launchFeeAtBlock(g, 1_000n)).toBe(250_000);
    // elapsed == decayBlocks -> exactly the final fee; the window is half-open.
    expect(launchFeeAtBlock(g, 1_100n)).toBe(3_000);
    expect(launchFeeAtBlock(g, 1_101n)).toBe(3_000);
    // The last taxed block is strictly above the final fee.
    expect(launchFeeAtBlock(g, 1_099n)).toBeGreaterThan(3_000);
  });

  it("rounds the fee UP, toward the LPs and away from the sniper", () => {
    // spread 10, window 3: the floored discount keeps the fee above the exact
    // linear value at every interior block.
    const g = guard({ initialFeePips: 10, finalFeePips: 0, decayBlocks: 3 });
    expect(launchFeeAtBlock(g, 1_000n)).toBe(10);
    // exact linear would be 6.67 and 3.33; flooring the discount gives 7 and 4.
    expect(launchFeeAtBlock(g, 1_001n)).toBe(7);
    expect(launchFeeAtBlock(g, 1_002n)).toBe(4);
    expect(launchFeeAtBlock(g, 1_003n)).toBe(0);
  });

  it("never leaves the [finalFee, initialFee] range and never increases", () => {
    const g = guard();
    let previous = Number.POSITIVE_INFINITY;
    for (let block = 995n; block <= 1_110n; block += 1n) {
      const fee = launchFeeAtBlock(g, block)!;
      expect(fee).toBeLessThanOrEqual(250_000);
      expect(fee).toBeGreaterThanOrEqual(3_000);
      if (block >= 1_000n) expect(fee).toBeLessThanOrEqual(previous);
      previous = fee;
    }
  });

  it("reports a disabled launch as ungated and untaxed, not as closed", () => {
    const schedule = launchScheduleAt(guard({ enabled: false }), 900n);
    expect(schedule.phase).toBe("disabled");
    // `beforeSwap` returns finalFeeBips and returns early: no gate, no cap.
    expect(schedule.tradingOpen).toBe(true);
    expect(schedule.feePips).toBe(3_000);
    expect(schedule.maxBuyPerTxEnforced).toBe(false);
  });

  it("walks pending -> decaying -> settled", () => {
    const g = guard({ maxBuyPerTx: 500n });
    expect(launchScheduleAt(g, 990n).phase).toBe("pending");
    expect(launchScheduleAt(g, 990n).blocksUntilOpen).toBe(10n);
    expect(launchScheduleAt(g, 990n).tradingOpen).toBe(false);

    const mid = launchScheduleAt(g, 1_050n);
    expect(mid.phase).toBe("decaying");
    expect(mid.blocksRemaining).toBe(50n);
    expect(mid.decayProgressBps).toBe(5_000);
    expect(mid.maxBuyPerTxEnforced).toBe(true);

    const done = launchScheduleAt(g, 1_100n);
    expect(done.phase).toBe("settled");
    // The hook only checks the cap while `elapsed < decayBlocks`.
    expect(done.maxBuyPerTxEnforced).toBe(false);
  });
});

describe("launch gates", () => {
  function guard(overrides: Partial<LaunchGuard> = {}): LaunchGuard {
    return {
      owner: OWNER,
      startBlock: 1_000n,
      decayBlocks: 100,
      enabled: true,
      initialFeePips: 250_000,
      finalFeePips: 3_000,
      maxBuyPerTx: 500n,
      launchTokenIsCurrency0: true,
      launched: false,
      ...overrides,
    };
  }

  it("names the revert a blocked buy would produce", () => {
    expect(evaluateLaunchBuy({ guard: guard(), blockNumber: 900n, amountIn: 1n }).revert).toBe(
      "TradingNotOpen",
    );
    expect(
      evaluateLaunchBuy({ guard: guard(), blockNumber: 1_050n, amountIn: 501n }).revert,
    ).toBe("BuyExceedsMaxPerTx");
    expect(
      evaluateLaunchBuy({ guard: guard({ owner: ZERO }), blockNumber: 1_050n, amountIn: 1n })
        .revert,
    ).toBe("LaunchNotConfigured");
  });

  it("allows a buy at exactly the cap, which is what the contract allows", () => {
    // `if (amountIn > maxBuyPerTx) revert` - strictly greater.
    expect(
      evaluateLaunchBuy({ guard: guard(), blockNumber: 1_050n, amountIn: 500n }).reason,
    ).toBeNull();
  });

  it("stops enforcing the cap once the window has elapsed", () => {
    expect(
      evaluateLaunchBuy({ guard: guard(), blockNumber: 1_100n, amountIn: 10_000n }).reason,
    ).toBeNull();
  });

  it("checks the schedule even with no amount entered", () => {
    expect(evaluateLaunchBuy({ guard: guard(), blockNumber: 900n, amountIn: null }).reason).toBe(
      "trading-not-open",
    );
    expect(
      evaluateLaunchBuy({ guard: guard(), blockNumber: 1_050n, amountIn: null }).reason,
    ).toBeNull();
  });
});

describe("launch buy call path", () => {
  const LAUNCH_HOOK = "0x00000000000000000000000000000000000000a8" as const;
  const ROUTER = "0x00000000000000000000000000000000000000a4" as const;

  const LAUNCH_KEY = createCLPoolKey({
    currency0: TOKEN_A,
    currency1: TOKEN_B,
    hooks: LAUNCH_HOOK,
    poolManager: MANAGER,
    // Dynamic fee: the hook rejects a static-fee pool at beforeInitialize.
    fee: 0x800000,
    tickSpacing: 60,
    hooksRegistrationBitmap: 0x0041,
  });

  // TOKEN_A is currency0 and is the launch token, so a BUY spends TOKEN_B.
  const BUY_HOP: SwapHop = {
    poolKey: LAUNCH_KEY,
    poolType: "CL",
    currencyIn: TOKEN_B,
    currencyOut: TOKEN_A,
  };

  const GUARD: LaunchGuard = {
    owner: OWNER,
    startBlock: 1_000n,
    decayBlocks: 100,
    enabled: true,
    initialFeePips: 250_000,
    finalFeePips: 3_000,
    maxBuyPerTx: 500n,
    launchTokenIsCurrency0: true,
    launched: false,
  };

  function args(overrides: Record<string, unknown> = {}) {
    return {
      router: ROUTER,
      hop: BUY_HOP,
      guard: GUARD,
      blockNumber: 1_050n,
      amountIn: 100n,
      minAmountOutGross: 90n,
      minAmountOutNet: 90n,
      integrator: NO_INTEGRATOR_FEE,
      recipient: OWNER,
      sender: OWNER,
      deadline: 1n,
      ...overrides,
    } as Parameters<typeof buildLaunchBuyCall>[0];
  }

  it("identifies the buy direction the way the hook does", () => {
    expect(hopIsLaunchBuy(BUY_HOP, GUARD)).toBe(true);
    const sellHop: SwapHop = {
      poolKey: LAUNCH_KEY,
      poolType: "CL",
      currencyIn: TOKEN_A,
      currencyOut: TOKEN_B,
    };
    expect(hopIsLaunchBuy(sellHop, GUARD)).toBe(false);
    // Flip which side is the launch token and the answer flips with it.
    expect(hopIsLaunchBuy(sellHop, { ...GUARD, launchTokenIsCurrency0: false })).toBe(true);
  });

  it("encodes the ordinary swap plan, not a launch-specific call", () => {
    const call = buildLaunchBuyCall(args());
    const direct = buildSwapCall({
      router: ROUTER,
      hops: [BUY_HOP],
      amountIn: 100n,
      minAmountOutGross: 90n,
      minAmountOutNet: 90n,
      integrator: NO_INTEGRATOR_FEE,
      recipient: OWNER,
      sender: OWNER,
      deadline: 1n,
    });
    expect(call.data).toBe(direct.data);
    expect(call.to).toBe(ROUTER);
    // One INFI_SWAP command, and a plan of swap / settle / take.
    expect(call.commands).toBe("0x10");
    const { actionIds } = decodePlan(call.inputs[0]!);
    expect(actionIds).toEqual([
      ACTIONS.CL_SWAP_EXACT_IN_SINGLE,
      ACTIONS.SETTLE_ALL,
      ACTIONS.TAKE_ALL,
    ]);
  });

  it("still threads the integrator fee, because it is still a swap", () => {
    const config = validateIntegratorConfig({ referrer: REFERRER, feeBps: 50 });
    const call = buildLaunchBuyCall(args({ integrator: config, minAmountOutNet: 89n }));
    expect(call.integratorFee?.referrer).toBe(REFERRER);
    expect(call.integratorFee?.feeBps).toBe(50);
    const { actionIds } = decodePlan(call.inputs[0]!);
    expect(actionIds).toContain(ACTIONS.TAKE_PORTION);
  });

  it("refuses to encode a buy the hook would revert", () => {
    expect(() => buildLaunchBuyCall(args({ blockNumber: 900n }))).toThrowError(
      /TradingNotOpen/,
    );
    expect(() => buildLaunchBuyCall(args({ amountIn: 501n }))).toThrowError(
      /BuyExceedsMaxPerTx/,
    );
  });

  it("refuses a sell, which is an ordinary swap and not this function's job", () => {
    const sellHop: SwapHop = {
      poolKey: LAUNCH_KEY,
      poolType: "CL",
      currencyIn: TOKEN_A,
      currencyOut: TOKEN_B,
    };
    expect(() => buildLaunchBuyCall(args({ hop: sellHop }))).toThrowError(/sells the launch token/);
  });

  it("refuses a bin pool: BinLaunchGuardHook is a different contract", () => {
    const binHop: SwapHop = {
      poolKey: BIN_KEY,
      poolType: "BIN",
      currencyIn: TOKEN_B,
      currencyOut: TOKEN_A,
    };
    expect(() => buildLaunchBuyCall(args({ hop: binHop }))).toThrowError(
      /concentrated-liquidity pools only/,
    );
  });
});

describe("launch reads and the four states", () => {
  const LAUNCH_CHAIN: ChainConfig = {
    chainId: 31337,
    name: "Mock chain",
    nativeCurrency: { name: "Mock gas", symbol: "MOCK-GAS", decimals: 18 },
    contracts: {
      vault: "0x00000000000000000000000000000000000000a1",
      clPoolManager: MANAGER,
      binPoolManager: "0x00000000000000000000000000000000000000a3",
      universalRouter: "0x00000000000000000000000000000000000000a4",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      launchGuardHook: "0x00000000000000000000000000000000000000a8",
    },
  };

  /** The same config with the hook removed: a chain with no launchpad on it. */
  const NO_LAUNCHPAD_CHAIN: ChainConfig = {
    ...LAUNCH_CHAIN,
    contracts: { ...LAUNCH_CHAIN.contracts, launchGuardHook: undefined },
  };

  it("throws ChainConfigError, not an empty list, when no hook is configured", async () => {
    const adapter = createMockAdapter({ chain: NO_LAUNCHPAD_CHAIN, account: OWNER });
    // An empty array would read as "the launchpad is here and nobody has
    // launched", which is a different and untrue statement.
    await expect(adapter.listLaunches()).rejects.toBeInstanceOf(ChainConfigError);
    const error: Error | null = await adapter
      .listLaunches()
      .then(() => null)
      .catch((cause: unknown) => cause as Error);
    expect(isLaunchpadNotConfigured(error)).toBe(true);
    expect(resolveLaunchDataState({ status: "error", error, data: null })).toBe("not-configured");
  });

  it("reads a launch keyed by pool id, in pips, labelled mock", async () => {
    const adapter = createMockAdapter({ chain: LAUNCH_CHAIN, account: OWNER });
    const launches = await adapter.listLaunches();
    expect(launches.length).toBe(1);
    const launch = launches[0]!;
    expect(launch.source).toBe("mock");
    expect(launch.hook).toBe(LAUNCH_CHAIN.contracts.launchGuardHook);
    expect(launch.launchToken.symbol).toBe("MOCK-NEW");
    // Inside the hook's own caps: MAX_INITIAL_FEE 500_000, MAX_FINAL_FEE 100_000.
    expect(launch.guard.initialFeePips).toBeLessThanOrEqual(500_000);
    expect(launch.guard.finalFeePips).toBeLessThanOrEqual(100_000);
    expect(launch.guard.initialFeePips).toBeGreaterThanOrEqual(launch.guard.finalFeePips);
    // The pool must carry the dynamic-fee marker or the hook's override is discarded.
    expect(launch.pool.lpFeePips).toBe(0x800000);

    const byId = await adapter.getLaunch(launch.poolId);
    expect(byId?.poolId).toBe(launch.poolId);
  });

  it("reports a pool with no launch record as empty, not as an error", async () => {
    const adapter = createMockAdapter({ chain: LAUNCH_CHAIN, account: OWNER });
    const pools = await adapter.listPools();
    const plain = pools.find((pool) => pool.hooks === ZERO)!;
    const result = await adapter.getLaunch(plain.id);
    expect(result).toBeNull();
    expect(resolveLaunchDataState({ status: "success", error: null, data: result })).toBe("empty");
    expect(resolveLaunchDataState({ status: "success", error: null, data: [] })).toBe("empty");
  });

  it("derives the view from the block the launch was read at", async () => {
    const adapter = createMockAdapter({ chain: LAUNCH_CHAIN, account: OWNER });
    const launch = (await adapter.listLaunches())[0]!;
    const view = buildLaunchView(launch);
    expect(view.schedule.blockNumber).toBe(launch.readAtBlock);
    // The chain read and the local projection of the same block must agree.
    expect(view.feeProjectionDriftPips).toBe(0);
  });

  it("quotes a launch buy through the pool, at the guard's decayed fee", async () => {
    const adapter = createMockAdapter({ chain: LAUNCH_CHAIN, account: OWNER });
    const launch = (await adapter.listLaunches())[0]!;
    const quote = await adapter.quoteSwap({
      tokenIn: launch.quoteToken,
      tokenOut: launch.launchToken,
      amountIn: 10n ** 6n,
    });
    // Not the dynamic-fee marker: the rate the hook would override with.
    expect(quote.lpFeePips).toBe(launch.currentFeePips);
    expect(quote.grossAmountOut).toBeGreaterThan(0n);
  });
});

describe("mock adapter", () => {
  const chain: ChainConfig = {
    chainId: 31337,
    name: "Mock chain",
    nativeCurrency: { name: "Mock gas", symbol: "MOCK-GAS", decimals: 18 },
    contracts: {
      vault: "0x00000000000000000000000000000000000000a1",
      clPoolManager: MANAGER,
      binPoolManager: "0x00000000000000000000000000000000000000a3",
      universalRouter: "0x00000000000000000000000000000000000000a4",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
  };

  it("labels every record as mock and never claims to be live", async () => {
    const adapter = createMockAdapter({ chain, account: OWNER });
    expect(adapter.isMock).toBe(true);

    const tokens = await adapter.listTokens();
    expect(tokens.length).toBeGreaterThan(1);

    const [tokenIn, tokenOut] = [tokens[0], tokens[3]];
    expect(tokenIn).toBeDefined();
    expect(tokenOut).toBeDefined();

    const quote = await adapter.quoteSwap({
      tokenIn: tokenIn!,
      tokenOut: tokenOut!,
      amountIn: 10n ** 18n,
    });
    expect(quote.source).toBe("mock");
    expect(quote.grossAmountOut).toBeGreaterThan(0n);
    // A finite-liquidity curve must return less than the no-impact reference.
    expect(quote.grossAmountOut).toBeLessThan(quote.spotAmountOut ?? 0n);
  });

  it("throws NoRouteError rather than inventing a route", async () => {
    const adapter = createMockAdapter({ chain, account: OWNER });
    const unknownToken = {
      address: "0x00000000000000000000000000000000000000ee" as const,
      symbol: "NOPE",
      name: "Unlisted",
      decimals: 18,
    };
    const tokens = await adapter.listTokens();
    await expect(
      adapter.quoteSwap({ tokenIn: tokens[0]!, tokenOut: unknownToken, amountIn: 1n }),
    ).rejects.toThrowError(/no pool connects/);
  });

  it("reports a disconnected wallet instead of a zero balance", async () => {
    const adapter = createMockAdapter({ chain, account: null });
    expect(await adapter.getAccount()).toBeNull();
    await expect(
      adapter.sendTransaction({
        to: ZERO,
        data: "0x",
        value: 0n,
        summary: "test",
        source: "mock",
      }),
    ).rejects.toThrowError(/connect a wallet/);
  });

  it("produces no submittable calldata", async () => {
    const adapter = createMockAdapter({ chain, account: OWNER });
    const tokens = await adapter.listTokens();
    const quote = await adapter.quoteSwap({
      tokenIn: tokens[0]!,
      tokenOut: tokens[3]!,
      amountIn: 10n ** 18n,
    });
    const transaction = await adapter.buildSwap({
      quote,
      tokenIn: tokens[0]!,
      tokenOut: tokens[3]!,
      amountIn: 10n ** 18n,
      minAmountOutGross: 1n,
      minAmountOutNet: 1n,
      integrator: NO_INTEGRATOR_FEE,
      recipient: OWNER,
      deadline: 1n,
    });
    expect(transaction.data).toBe("0x");
    expect(transaction.summary).toContain("MOCK DATA");
    expect(transaction.source).toBe("mock");
  });

  it("surfaces the integrator fee on the prepared transaction", async () => {
    const adapter = createMockAdapter({ chain, account: OWNER });
    const tokens = await adapter.listTokens();
    const quote = await adapter.quoteSwap({
      tokenIn: tokens[0]!,
      tokenOut: tokens[3]!,
      amountIn: 10n ** 18n,
    });
    const config = validateIntegratorConfig({ referrer: REFERRER, feeBps: 25 });
    const transaction = await adapter.buildSwap({
      quote,
      tokenIn: tokens[0]!,
      tokenOut: tokens[3]!,
      amountIn: 10n ** 18n,
      minAmountOutGross: 1n,
      minAmountOutNet: 1n,
      integrator: config,
      recipient: OWNER,
      deadline: 1n,
    });
    expect(transaction.integratorFee?.referrer).toBe(REFERRER);
    expect(transaction.integratorFee?.expectedAmount).toBe(
      (quote.grossAmountOut * 25n) / 10_000n,
    );
  });
});
