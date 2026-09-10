// SPDX-License-Identifier: MIT
/**
 * Integrator fee attribution.
 *
 * This is the feature the package exists for, so it gets the most tests. Three
 * properties matter and are checked here:
 *
 * 1. A bad config is rejected loudly, with a specific code - never coerced to
 *    "no fee", which would silently stop paying the embedder.
 * 2. The predicted fee is byte-identical to what `BipsLibrary.calculatePortion`
 *    computes on-chain, including its truncation.
 * 3. The fee is genuinely in the encoded calldata, and removing it from the
 *    config genuinely removes the step.
 */

import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData } from "viem";
import { createCLPoolKey } from "@latchprotocol/sdk";
import {
  BPS_DENOMINATOR,
  IntegratorConfigError,
  MAX_INTEGRATOR_FEE_BPS,
  NO_INTEGRATOR_FEE,
  calculateIntegratorFee,
  formatBps,
  resolveIntegratorConfig,
  splitIntegratorFee,
  validateIntegratorConfig,
} from "../src/config/integrator.js";
import { ACTIONS, COMMANDS, UNIVERSAL_ROUTER_ABI } from "../src/callpath/constants.js";
import { buildSwapCall, type SwapHop } from "../src/callpath/swap.js";

const REFERRER = "0x1111111111111111111111111111111111111111" as const;
const ROUTER = "0x00000000000000000000000000000000000000a4" as const;
const SENDER = "0x00000000000000000000000000000000000000ff" as const;
const TOKEN_A = "0x000000000000000000000000000000000000000a" as const;
const TOKEN_B = "0x000000000000000000000000000000000000000b" as const;
const POOL_MANAGER = "0x00000000000000000000000000000000000000a2" as const;

const HOP: SwapHop = {
  poolKey: createCLPoolKey({
    currency0: TOKEN_A,
    currency1: TOKEN_B,
    hooks: "0x0000000000000000000000000000000000000000",
    poolManager: POOL_MANAGER,
    fee: 3_000,
    tickSpacing: 60,
  }),
  poolType: "CL",
  currencyIn: TOKEN_A,
  currencyOut: TOKEN_B,
};

describe("validateIntegratorConfig", () => {
  it("accepts a well-formed config and checksums the referrer", () => {
    const resolved = validateIntegratorConfig({
      referrer: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      feeBps: 25,
    });
    expect(resolved.active).toBe(true);
    expect(resolved.feeBps).toBe(25);
    expect(resolved.feeMode).toBe("take-portion");
    expect(resolved.referrer).toBe("0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD");
  });

  it("rejects a fee with no referrer, rather than silently zeroing it", () => {
    expect(() =>
      validateIntegratorConfig({ referrer: undefined as never, feeBps: 25 }),
    ).toThrowError(IntegratorConfigError);

    try {
      validateIntegratorConfig({ referrer: "" as never, feeBps: 10 });
      expect.unreachable("expected a throw");
    } catch (cause: unknown) {
      expect(cause).toBeInstanceOf(IntegratorConfigError);
      expect((cause as IntegratorConfigError).code).toBe("REFERRER_MISSING");
    }
  });

  it("rejects a fee routed to the zero address", () => {
    try {
      validateIntegratorConfig({
        referrer: "0x0000000000000000000000000000000000000000",
        feeBps: 1,
      });
      expect.unreachable("expected a throw");
    } catch (cause: unknown) {
      expect((cause as IntegratorConfigError).code).toBe("REFERRER_ZERO_ADDRESS");
    }
  });

  it("rejects a malformed referrer", () => {
    try {
      validateIntegratorConfig({ referrer: "0xnot-an-address" as never, feeBps: 5 });
      expect.unreachable("expected a throw");
    } catch (cause: unknown) {
      expect((cause as IntegratorConfigError).code).toBe("REFERRER_MALFORMED");
    }
  });

  it("rejects a fee above the documented maximum", () => {
    try {
      validateIntegratorConfig({ referrer: REFERRER, feeBps: MAX_INTEGRATOR_FEE_BPS + 1 });
      expect.unreachable("expected a throw");
    } catch (cause: unknown) {
      expect((cause as IntegratorConfigError).code).toBe("FEE_BPS_ABOVE_MAX");
    }
    expect(
      validateIntegratorConfig({ referrer: REFERRER, feeBps: MAX_INTEGRATOR_FEE_BPS }).feeBps,
    ).toBe(MAX_INTEGRATOR_FEE_BPS);
  });

  it("rejects fractional, negative and non-numeric fees", () => {
    const cases: [unknown, string][] = [
      [12.5, "FEE_BPS_NOT_AN_INTEGER"],
      [-1, "FEE_BPS_NEGATIVE"],
      ["25", "FEE_BPS_NOT_A_NUMBER"],
      [Number.NaN, "FEE_BPS_NOT_A_NUMBER"],
      [Number.POSITIVE_INFINITY, "FEE_BPS_NOT_AN_INTEGER"],
    ];
    for (const [feeBps, code] of cases) {
      try {
        validateIntegratorConfig({ referrer: REFERRER, feeBps: feeBps as number });
        expect.unreachable(`expected ${String(feeBps)} to be rejected`);
      } catch (cause: unknown) {
        expect((cause as IntegratorConfigError).code).toBe(code);
      }
    }
  });

  it("rejects an unknown fee mode", () => {
    try {
      validateIntegratorConfig({
        referrer: REFERRER,
        feeBps: 10,
        feeMode: "skim" as never,
      });
      expect.unreachable("expected a throw");
    } catch (cause: unknown) {
      expect((cause as IntegratorConfigError).code).toBe("FEE_MODE_UNKNOWN");
    }
  });

  it("allows a referrer with a zero fee, but warns that it earns nothing", () => {
    const resolved = validateIntegratorConfig({ referrer: REFERRER, feeBps: 0 });
    expect(resolved.active).toBe(false);
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toContain("feeBps is 0");
  });

  it("treats a missing config as no fee", () => {
    expect(resolveIntegratorConfig(undefined)).toEqual(NO_INTEGRATOR_FEE);
    expect(resolveIntegratorConfig(null).active).toBe(false);
  });
});

describe("calculateIntegratorFee", () => {
  it("matches BipsLibrary.calculatePortion: multiply first, then truncate", () => {
    // 10_000 * 25 / 10_000 = 25 exactly.
    expect(calculateIntegratorFee(10_000n, 25)).toBe(25n);
    // 999 * 25 / 10_000 = 2.4975 -> 2 (truncated, in the user's favour).
    expect(calculateIntegratorFee(999n, 25)).toBe(2n);
    // Below the point where any fee is owed at all.
    expect(calculateIntegratorFee(399n, 25)).toBe(0n);
    expect(calculateIntegratorFee(400n, 25)).toBe(1n);
  });

  it("never rounds up, at any scale", () => {
    for (const amount of [1n, 7n, 1_000n, 123_456_789n, 10n ** 30n]) {
      for (const bps of [1, 7, 25, 100]) {
        const fee = calculateIntegratorFee(amount, bps);
        expect(fee * BigInt(BPS_DENOMINATOR)).toBeLessThanOrEqual(amount * BigInt(bps));
        expect((fee + 1n) * BigInt(BPS_DENOMINATOR)).toBeGreaterThan(amount * BigInt(bps));
      }
    }
  });

  it("is exact on amounts far beyond float precision", () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    expect(calculateIntegratorFee(huge, 30)).toBe((huge * 30n) / 10_000n);
  });

  it("rejects negative amounts and out-of-range bps", () => {
    expect(() => calculateIntegratorFee(-1n, 10)).toThrowError(RangeError);
    expect(() => calculateIntegratorFee(10n, 10_001)).toThrowError(RangeError);
    expect(() => calculateIntegratorFee(10n, 1.5)).toThrowError(RangeError);
  });
});

describe("splitIntegratorFee", () => {
  it("splits a gross amount without losing a wei", () => {
    const config = validateIntegratorConfig({ referrer: REFERRER, feeBps: 30 });
    const split = splitIntegratorFee(1_000_000_007n, config);
    expect(split.integratorFee + split.netAmount).toBe(split.grossAmount);
    expect(split.referrer).toBe(REFERRER);
  });

  it("returns the whole amount to the user when no fee is active", () => {
    const split = splitIntegratorFee(1_000n, NO_INTEGRATOR_FEE);
    expect(split.integratorFee).toBe(0n);
    expect(split.netAmount).toBe(1_000n);
    expect(split.referrer).toBeNull();
  });
});

describe("formatBps", () => {
  it("renders whole and fractional percentages", () => {
    expect(formatBps(100)).toBe("1%");
    expect(formatBps(25)).toBe("0.25%");
    expect(formatBps(0)).toBe("0%");
  });
});

describe("buildSwapCall — fee threading", () => {
  const baseArgs = {
    router: ROUTER,
    hops: [HOP],
    amountIn: 1_000_000_000_000_000_000n,
    minAmountOutGross: 900_000n,
    minAmountOutNet: 897_750n,
    recipient: SENDER,
    sender: SENDER,
    deadline: 1_800_000_000n,
  };

  function decodeCommands(data: `0x${string}`): {
    commands: `0x${string}`;
    inputs: readonly `0x${string}`[];
  } {
    const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data });
    const [commands, inputs] = decoded.args as [`0x${string}`, readonly `0x${string}`[], bigint];
    return { commands, inputs };
  }

  function decodePlan(input: `0x${string}`): {
    actions: `0x${string}`;
    params: readonly `0x${string}`[];
  } {
    const [actions, params] = decodeAbiParameters(
      [
        { name: "actions", type: "bytes" },
        { name: "params", type: "bytes[]" },
      ],
      input,
    );
    return { actions, params };
  }

  it("adds a TAKE_PORTION step naming the referrer and the fee", () => {
    const config = validateIntegratorConfig({ referrer: REFERRER, feeBps: 25 });
    const call = buildSwapCall({ ...baseArgs, integrator: config });

    const { commands, inputs } = decodeCommands(call.data);
    expect(commands).toBe(`0x${COMMANDS.INFI_SWAP.toString(16).padStart(2, "0")}`);

    const first = inputs[0];
    expect(first).toBeDefined();
    const { actions, params } = decodePlan(first as `0x${string}`);

    const actionIds = (actions.slice(2).match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
    expect(actionIds).toEqual([
      ACTIONS.CL_SWAP_EXACT_IN_SINGLE,
      ACTIONS.SETTLE_ALL,
      ACTIONS.TAKE_PORTION,
      ACTIONS.TAKE_ALL,
    ]);

    const takePortionParams = params[2];
    expect(takePortionParams).toBeDefined();
    const [currency, recipient, bips] = decodeAbiParameters(
      [
        { name: "currency", type: "address" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      takePortionParams as `0x${string}`,
    );
    expect(currency.toLowerCase()).toBe(TOKEN_B);
    expect(recipient).toBe(REFERRER);
    expect(bips).toBe(25n);

    expect(call.integratorFee).not.toBeNull();
    expect(call.integratorFee?.referrer).toBe(REFERRER);
    expect(call.integratorFee?.feeBps).toBe(25);
    expect(call.integratorFee?.mode).toBe("take-portion");
  });

  it("omits the fee step entirely when no fee is configured", () => {
    const call = buildSwapCall({ ...baseArgs, integrator: NO_INTEGRATOR_FEE });
    const { inputs } = decodeCommands(call.data);
    const first = inputs[0];
    const { actions } = decodePlan(first as `0x${string}`);
    const actionIds = (actions.slice(2).match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
    expect(actionIds).toEqual([
      ACTIONS.CL_SWAP_EXACT_IN_SINGLE,
      ACTIONS.SETTLE_ALL,
      ACTIONS.TAKE_ALL,
    ]);
    expect(actionIds).not.toContain(ACTIONS.TAKE_PORTION);
    expect(call.integratorFee).toBeNull();
  });

  it("uses router-level PAY_PORTION and SWEEP in pay-portion mode", () => {
    const config = validateIntegratorConfig({
      referrer: REFERRER,
      feeBps: 40,
      feeMode: "pay-portion",
    });
    const call = buildSwapCall({ ...baseArgs, integrator: config });

    const { commands, inputs } = decodeCommands(call.data);
    const commandIds = (commands.slice(2).match(/../g) ?? []).map((byte) =>
      Number.parseInt(byte, 16),
    );
    expect(commandIds).toEqual([COMMANDS.INFI_SWAP, COMMANDS.PAY_PORTION, COMMANDS.SWEEP]);

    const payPortion = inputs[1];
    expect(payPortion).toBeDefined();
    const [token, recipient, bips] = decodeAbiParameters(
      [
        { name: "currency", type: "address" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      payPortion as `0x${string}`,
    );
    expect(token.toLowerCase()).toBe(TOKEN_B);
    expect(recipient).toBe(REFERRER);
    expect(bips).toBe(40n);

    // The swap must have taken its output to the router for PAY_PORTION to work.
    const { actions } = decodePlan(inputs[0] as `0x${string}`);
    const actionIds = (actions.slice(2).match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
    expect(actionIds).toEqual([
      ACTIONS.CL_SWAP_EXACT_IN_SINGLE,
      ACTIONS.SETTLE_ALL,
      ACTIONS.TAKE,
    ]);
  });

  it("refuses a hand-forged config that skipped validation", () => {
    expect(() =>
      buildSwapCall({
        ...baseArgs,
        integrator: {
          referrer: REFERRER,
          feeBps: 5_000,
          feeMode: "take-portion",
          label: null,
          active: true,
          warnings: [],
        },
      }),
    ).toThrowError(/refusing to encode integrator feeBps/);
  });

  it("refuses a fee aimed at the zero address even if marked active", () => {
    expect(() =>
      buildSwapCall({
        ...baseArgs,
        integrator: {
          referrer: "0x0000000000000000000000000000000000000000",
          feeBps: 20,
          feeMode: "take-portion",
          label: null,
          active: true,
          warnings: [],
        },
      }),
    ).toThrowError(/zero address/);
  });

  it("refuses a net minimum above the gross minimum", () => {
    const config = validateIntegratorConfig({ referrer: REFERRER, feeBps: 25 });
    expect(() =>
      buildSwapCall({
        ...baseArgs,
        minAmountOutNet: baseArgs.minAmountOutGross + 1n,
        integrator: config,
      }),
    ).toThrowError(/minAmountOutNet/);
  });

  it("attaches native value only when the input currency is native", () => {
    const nativeHop: SwapHop = {
      ...HOP,
      poolKey: createCLPoolKey({
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: TOKEN_B,
        hooks: "0x0000000000000000000000000000000000000000",
        poolManager: POOL_MANAGER,
        fee: 3_000,
        tickSpacing: 60,
      }),
      currencyIn: "0x0000000000000000000000000000000000000000",
      currencyOut: TOKEN_B,
    };
    const withNative = buildSwapCall({
      ...baseArgs,
      hops: [nativeHop],
      integrator: NO_INTEGRATOR_FEE,
    });
    expect(withNative.value).toBe(baseArgs.amountIn);

    const withErc20 = buildSwapCall({ ...baseArgs, integrator: NO_INTEGRATOR_FEE });
    expect(withErc20.value).toBe(0n);
  });
});
