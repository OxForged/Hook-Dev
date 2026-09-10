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
import { buildLaunchBuyCall, LAUNCHPAD_ABI } from "../src/callpath/launch.js";
import { buildSwapCall, type SwapHop } from "../src/callpath/swap.js";
import { NO_INTEGRATOR_FEE, validateIntegratorConfig } from "../src/config/integrator.js";
import { createMockAdapter, buildUniformBinDistribution } from "../src/adapters/mock.js";
import type { ChainConfig } from "../src/config/chain.js";

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

describe("launch call path", () => {
  it("passes the referrer and fee as call arguments", () => {
    const config = validateIntegratorConfig({ referrer: REFERRER, feeBps: 50 });
    const call = buildLaunchBuyCall({
      launchpad: "0x00000000000000000000000000000000000000a7",
      paymentToken: TOKEN_A,
      amountIn: 1_000n,
      minTokensOut: 900n,
      recipient: OWNER,
      integrator: config,
      deadline: 1n,
    });
    const decoded = decodeFunctionData({ abi: LAUNCHPAD_ABI, data: call.data });
    expect(decoded.functionName).toBe("buy");
    const args = decoded.args as readonly unknown[];
    expect(args[3]).toBe(REFERRER);
    expect(args[4]).toBe(50);
    expect(call.value).toBe(0n);
  });

  it("sends the zero address, not the buyer, when no fee is configured", () => {
    const call = buildLaunchBuyCall({
      launchpad: "0x00000000000000000000000000000000000000a7",
      paymentToken: ZERO,
      amountIn: 1_000n,
      minTokensOut: 0n,
      recipient: OWNER,
      integrator: NO_INTEGRATOR_FEE,
      deadline: 1n,
    });
    const decoded = decodeFunctionData({ abi: LAUNCHPAD_ABI, data: call.data });
    const args = decoded.args as readonly unknown[];
    expect(args[3]).toBe(ZERO);
    expect(args[4]).toBe(0);
    // Native payment carries value.
    expect(call.value).toBe(1_000n);
    expect(call.integratorFee).toBeNull();
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
