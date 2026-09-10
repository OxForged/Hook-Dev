// SPDX-License-Identifier: MIT
/**
 * Quote arithmetic.
 *
 * The important invariant is the one that protects the user: whenever a swap
 * clears `minAmountOutGross`, the amount they actually receive after the
 * integrator fee is at least `minAmountOutNet`. It is asserted directly, and
 * then again over a wide sweep of amounts and fees, because it depends on a
 * monotonicity property of truncating integer division that is easy to break
 * by "simplifying" the formula.
 */

import { describe, expect, it } from "vitest";
import {
  buildQuoteBreakdown,
  ceilTickToSpacing,
  clampBigInt,
  DEFAULT_SLIPPAGE_BPS,
  exchangeRate,
  floorTickToSpacing,
  MAX_SLIPPAGE_BPS,
  maximumSpent,
  minimumReceived,
  pipsOf,
  portionOf,
  priceImpactBps,
  priceImpactSeverity,
  progressPercent,
} from "../src/core/math.js";
import {
  calculateIntegratorFee,
  NO_INTEGRATOR_FEE,
  validateIntegratorConfig,
} from "../src/config/integrator.js";
import {
  formatAmount,
  formatDuration,
  formatPercentFromBps,
  formatPercentFromPips,
  parseAmount,
} from "../src/core/format.js";

const REFERRER = "0x1111111111111111111111111111111111111111" as const;
const FEE_25 = validateIntegratorConfig({ referrer: REFERRER, feeBps: 25 });

describe("portionOf and pipsOf", () => {
  it("truncate rather than round", () => {
    expect(portionOf(9_999n, 1)).toBe(0n);
    expect(portionOf(10_000n, 1)).toBe(1n);
    expect(pipsOf(999_999n, 1)).toBe(0n);
    expect(pipsOf(1_000_000n, 1)).toBe(1n);
    expect(pipsOf(1_000_000n, 3_000)).toBe(3_000n);
  });

  it("reject out-of-range rates", () => {
    expect(() => portionOf(1n, 10_001)).toThrowError(RangeError);
    expect(() => pipsOf(1n, 1_000_001)).toThrowError(RangeError);
    expect(() => portionOf(-1n, 10)).toThrowError(RangeError);
  });
});

describe("minimumReceived", () => {
  it("rounds down so the on-chain floor is never tighter than requested", () => {
    expect(minimumReceived(1_000n, 50)).toBe(995n);
    expect(minimumReceived(1_001n, 50)).toBe(995n);
    expect(minimumReceived(1_000n, 0)).toBe(1_000n);
    expect(minimumReceived(0n, 100)).toBe(0n);
  });

  it("rejects a slippage above the hard ceiling", () => {
    expect(() => minimumReceived(1_000n, MAX_SLIPPAGE_BPS + 1)).toThrowError(RangeError);
    expect(minimumReceived(1_000n, MAX_SLIPPAGE_BPS)).toBe(500n);
  });
});

describe("maximumSpent", () => {
  it("rounds up so a one-wei difference does not revert the swap", () => {
    expect(maximumSpent(1_000n, 50)).toBe(1_005n);
    expect(maximumSpent(1_001n, 50)).toBe(1_007n);
    expect(maximumSpent(1_000n, 0)).toBe(1_000n);
  });

  it("is always at least the expected amount", () => {
    for (const amount of [1n, 3n, 997n, 10n ** 24n]) {
      for (const slippage of [0, 1, 50, 500]) {
        expect(maximumSpent(amount, slippage)).toBeGreaterThanOrEqual(amount);
      }
    }
  });
});

describe("priceImpactBps", () => {
  it("measures the shortfall against the no-impact reference", () => {
    expect(priceImpactBps(9_900n, 10_000n)).toBe(100);
    expect(priceImpactBps(10_000n, 10_000n)).toBe(0);
  });

  it("clamps a better-than-spot fill to zero rather than reporting a negative", () => {
    expect(priceImpactBps(10_500n, 10_000n)).toBe(0);
  });

  it("returns null - not zero - when the reference is unavailable", () => {
    expect(priceImpactBps(10_000n, null)).toBeNull();
    expect(priceImpactBps(10_000n, undefined)).toBeNull();
    expect(priceImpactBps(10_000n, 0n)).toBeNull();
  });

  it("classifies severity, and calls an unknown impact unknown", () => {
    expect(priceImpactSeverity(null)).toBe("unknown");
    expect(priceImpactSeverity(0)).toBe("low");
    expect(priceImpactSeverity(99)).toBe("low");
    expect(priceImpactSeverity(100)).toBe("elevated");
    expect(priceImpactSeverity(300)).toBe("high");
    expect(priceImpactSeverity(1_000)).toBe("severe");
  });
});

describe("buildQuoteBreakdown", () => {
  it("splits the integrator fee out of the gross output", () => {
    const breakdown = buildQuoteBreakdown({
      amountIn: 10n ** 18n,
      grossAmountOut: 2_000_000_000n,
      spotAmountOut: 2_010_000_000n,
      lpFeeAmount: 3_000_000n,
      lpFeePips: 3_000,
      slippageBps: 50,
      integrator: FEE_25,
    });

    expect(breakdown.integratorFeeBps).toBe(25);
    expect(breakdown.integratorFee).toBe(5_000_000n);
    expect(breakdown.netAmountOut).toBe(1_995_000_000n);
    expect(breakdown.integratorFee + breakdown.netAmountOut).toBe(breakdown.grossAmountOut);
    expect(breakdown.minAmountOutGross).toBe(1_990_000_000n);
    expect(breakdown.minAmountOutNet).toBe(1_990_000_000n - 4_975_000n);
    expect(breakdown.priceImpactBps).toBe(49);
    expect(breakdown.priceImpactSeverity).toBe("low");
  });

  it("leaves the output untouched when no integrator is configured", () => {
    const breakdown = buildQuoteBreakdown({
      amountIn: 1_000n,
      grossAmountOut: 2_000n,
      slippageBps: 50,
      integrator: NO_INTEGRATOR_FEE,
    });
    expect(breakdown.integratorFee).toBe(0n);
    expect(breakdown.netAmountOut).toBe(2_000n);
    expect(breakdown.minAmountOutNet).toBe(breakdown.minAmountOutGross);
  });

  it("keeps minAmountOutNet at or below minAmountOutGross", () => {
    for (const gross of [1n, 3n, 1_000n, 999_999n, 10n ** 24n]) {
      const breakdown = buildQuoteBreakdown({
        amountIn: 1n,
        grossAmountOut: gross,
        slippageBps: 50,
        integrator: FEE_25,
      });
      expect(breakdown.minAmountOutNet).toBeLessThanOrEqual(breakdown.minAmountOutGross);
    }
  });

  /**
   * The load-bearing property.
   *
   * `minAmountOutNet` is derived from `minAmountOutGross`, but the fee is taken
   * on-chain from the *realised* output. This checks that for every realised
   * output at or above the gross floor, what reaches the user still clears the
   * net floor - i.e. that `x - floor(x * bps / 10_000)` is non-decreasing.
   */
  it("guarantees the user's floor for every realised output above the gross floor", () => {
    const feeBpsCases = [1, 7, 25, 40, 100];
    const grossCases = [1_000n, 12_345n, 999_999n, 10n ** 18n + 7n];
    const slippageCases = [0, 1, 50, 300];

    for (const feeBps of feeBpsCases) {
      const config = validateIntegratorConfig({ referrer: REFERRER, feeBps });
      for (const grossQuote of grossCases) {
        for (const slippageBps of slippageCases) {
          const breakdown = buildQuoteBreakdown({
            amountIn: 1n,
            grossAmountOut: grossQuote,
            slippageBps,
            integrator: config,
          });

          for (const delta of [0n, 1n, 2n, 999n, grossQuote]) {
            const realised = breakdown.minAmountOutGross + delta;
            const received = realised - calculateIntegratorFee(realised, feeBps);
            expect(received).toBeGreaterThanOrEqual(breakdown.minAmountOutNet);
          }
        }
      }
    }
  });

  it("rejects negative inputs and out-of-range slippage", () => {
    expect(() =>
      buildQuoteBreakdown({
        amountIn: -1n,
        grossAmountOut: 1n,
        slippageBps: 50,
        integrator: NO_INTEGRATOR_FEE,
      }),
    ).toThrowError(RangeError);
    expect(() =>
      buildQuoteBreakdown({
        amountIn: 1n,
        grossAmountOut: 1n,
        slippageBps: MAX_SLIPPAGE_BPS + 1,
        integrator: NO_INTEGRATOR_FEE,
      }),
    ).toThrowError(RangeError);
  });

  it("uses a sane default slippage", () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBeGreaterThan(0);
    expect(DEFAULT_SLIPPAGE_BPS).toBeLessThanOrEqual(100);
  });
});

describe("exchangeRate", () => {
  it("normalises across differing decimals", () => {
    // 1 token (18dp) in, 2000 units (6dp) out -> 2000 per token.
    expect(exchangeRate(10n ** 18n, 18, 2_000n * 10n ** 6n, 6)).toBeCloseTo(2_000, 6);
  });

  it("returns null for degenerate inputs instead of Infinity or NaN", () => {
    expect(exchangeRate(0n, 18, 1n, 6)).toBeNull();
    expect(exchangeRate(1n, 18, 0n, 6)).toBeNull();
  });
});

describe("tick helpers", () => {
  it("snap outward to usable ticks, including across zero", () => {
    expect(floorTickToSpacing(125, 60)).toBe(120);
    expect(ceilTickToSpacing(125, 60)).toBe(180);
    expect(floorTickToSpacing(-125, 60)).toBe(-180);
    expect(ceilTickToSpacing(-125, 60)).toBe(-120);
    expect(floorTickToSpacing(120, 60)).toBe(120);
  });

  it("reject a non-positive spacing", () => {
    expect(() => floorTickToSpacing(1, 0)).toThrowError(RangeError);
    expect(() => ceilTickToSpacing(1, -60)).toThrowError(RangeError);
  });
});

describe("progressPercent and clampBigInt", () => {
  it("caps progress at 100 and handles an empty total", () => {
    expect(progressPercent(50n, 100n)).toBe(50);
    expect(progressPercent(150n, 100n)).toBe(100);
    expect(progressPercent(1n, 0n)).toBe(0);
    expect(progressPercent(1n, 3n)).toBeCloseTo(33.33, 2);
  });

  it("clamps into range", () => {
    expect(clampBigInt(5n, 0n, 10n)).toBe(5n);
    expect(clampBigInt(-5n, 0n, 10n)).toBe(0n);
    expect(clampBigInt(50n, 0n, 10n)).toBe(10n);
    expect(() => clampBigInt(1n, 10n, 0n)).toThrowError(RangeError);
  });
});

describe("parseAmount", () => {
  it("parses a decimal string into the smallest unit", () => {
    const result = parseAmount("1.5", 18);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1_500_000_000_000_000_000n);
  });

  it("refuses more decimal places than the token has, instead of truncating", () => {
    const result = parseAmount("1.1234567", 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-many-decimals");
  });

  it("classifies empty, negative, non-numeric and zero input", () => {
    expect(parseAmount("", 18).ok).toBe(false);
    const negative = parseAmount("-1", 18);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.reason).toBe("negative");
    const nan = parseAmount("1.2.3", 18);
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.reason).toBe("not-a-number");
    const zero = parseAmount("0", 18);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.reason).toBe("zero");
    expect(parseAmount("0", 18, true).ok).toBe(true);
  });
});

describe("formatAmount", () => {
  it("never renders a non-zero dust amount as plain zero", () => {
    expect(formatAmount(1n, 18)).toBe("<0.000001");
    expect(formatAmount(0n, 18)).toBe("0");
  });

  it("groups thousands and trims trailing zeros", () => {
    expect(formatAmount(1_234_500_000n, 6)).toBe("1,234.5");
    expect(formatAmount(1_000_000n, 6)).toBe("1");
  });

  it("handles negative amounts", () => {
    expect(formatAmount(-1_500_000n, 6)).toBe("-1.5");
  });
});

describe("percentage and duration formatting", () => {
  it("formats bps and pips", () => {
    expect(formatPercentFromBps(50)).toBe("0.50%");
    expect(formatPercentFromBps(null)).toBe("unknown");
    expect(formatPercentFromBps(1)).toBe("0.01%");
    expect(formatPercentFromPips(3_000)).toBe("0.3%");
    expect(formatPercentFromPips(1_000_000)).toBe("100%");
  });

  it("formats a countdown", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(3_600 + 120)).toBe("1h 2m");
    expect(formatDuration(86_400 * 2 + 3_600 * 3)).toBe("2d 3h");
  });
});
