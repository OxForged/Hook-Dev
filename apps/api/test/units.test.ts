import { describe, expect, it } from "vitest";
import { compareRatio, executionPrice, formatUnitsExact, ratioToDecimal, splitSwap, sqrtPriceX96ToRatio, toBigInt } from "../src/lib/units.js";

describe("fee split, per swap from its own fields", () => {
  it("splits a V2-controller swap: 0.30% total with 999 pips protocol", () => {
    // 2 tokens in on currency1 (amount1 negative), 3000 pips total, 999 pips protocol.
    const s = splitSwap(1_990_000_000_000_000_000n, -2_000_000_000_000_000_000n, 3000, 999)!;
    expect(s.zeroForOne).toBe(false);
    expect(s.inputIndex).toBe(1);
    expect(s.amountIn).toBe(2_000_000_000_000_000_000n);
    expect(s.feeTotal).toBe(6_000_000_000_000_000n);
    expect(s.feeProtocol).toBe(1_998_000_000_000_000n);
    expect(s.feeLp).toBe(4_002_000_000_000_000n);
    expect(s.feeLp + s.feeProtocol).toBe(s.feeTotal);
  });

  it("floors, and never produces a negative LP slice", () => {
    const s = splitSwap(-1n, 1n, 3000, 4000)!;
    expect(s.feeTotal).toBe(0n);
    expect(s.feeProtocol).toBe(0n);
    expect(s.feeLp).toBe(0n);
  });

  it("returns null when nothing was paid in", () => {
    expect(splitSwap(5n, 7n, 3000, 0)).toBeNull();
    expect(splitSwap(0n, 0n, 3000, 0)).toBeNull();
  });

  it("uses amount0 < 0 as zeroForOne (SDK indexer.swapIsZeroForOne)", () => {
    expect(splitSwap(-10n, 9n, 0, 0)!.zeroForOne).toBe(true);
    expect(splitSwap(9n, -10n, 0, 0)!.zeroForOne).toBe(false);
  });
});

describe("exact decimal formatting", () => {
  it("formats raw units without floats", () => {
    expect(formatUnitsExact(1_500_000_000_000_000_000n, 18)).toBe("1.5");
    expect(formatUnitsExact(1n, 18)).toBe("0.000000000000000001");
    expect(formatUnitsExact(-2_500_000n, 6)).toBe("-2.5");
    expect(formatUnitsExact(123n, 0)).toBe("123");
    // Beyond 2^53: a float would round this.
    expect(formatUnitsExact(9_007_199_254_740_993_000_000_000_001n, 18)).toBe("9007199254.740993000000000001");
  });

  it("formats ratios to significant digits, truncating", () => {
    expect(ratioToDecimal({ num: 1n, den: 3n }, 5)).toBe("0.33333");
    expect(ratioToDecimal({ num: 2n, den: 3n }, 5)).toBe("0.66666");
    expect(ratioToDecimal({ num: 1n, den: 8n })).toBe("0.125");
    expect(ratioToDecimal({ num: 1n, den: 10n ** 12n }, 3)).toBe("0.000000000001");
    expect(ratioToDecimal({ num: 12345n, den: 1n }, 3)).toBe("12345");
    expect(ratioToDecimal({ num: 0n, den: 5n })).toBe("0");
    expect(() => ratioToDecimal({ num: 1n, den: 0n })).toThrow();
  });

  it("compares ratios exactly", () => {
    expect(compareRatio({ num: 1n, den: 3n }, { num: 333_333n, den: 1_000_000n })).toBe(1);
    expect(compareRatio({ num: 2n, den: 4n }, { num: 1n, den: 2n })).toBe(0);
  });

  it("decimal-adjusts execution price (18-dec token0, 6-dec token1)", () => {
    // 1 WETH (1e18) for 2500 USDG (2.5e9 raw, 6 decimals) => 2500 USDG per WETH.
    const p = executionPrice(-(10n ** 18n), 2_500_000_000n, 18, 6)!;
    expect(ratioToDecimal(p)).toBe("2500");
    expect(executionPrice(0n, 5n, 18, 18)).toBeNull();
  });

  it("derives a CL spot price from sqrtPriceX96", () => {
    const Q96 = 1n << 96n;
    expect(ratioToDecimal(sqrtPriceX96ToRatio(Q96, 18, 18))).toBe("1");
    expect(ratioToDecimal(sqrtPriceX96ToRatio(2n * Q96, 18, 18))).toBe("4");
  });

  it("parses stored integers and refuses fractions", () => {
    expect(toBigInt("-12")).toBe(-12n);
    expect(toBigInt({ toFixed: () => "340282366920938463463374607431768211455" })).toBe(2n ** 128n - 1n);
    expect(() => toBigInt("1.5")).toThrow();
  });
});
