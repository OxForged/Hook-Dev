import { describe, expect, it } from "vitest";
import { buildCandles, type CandleSwap } from "../src/services/candleBuilder.js";

const E18 = 10n ** 18n;
const swap = (block: number, logIndex: number, timestamp: number, amount0: bigint, amount1: bigint): CandleSwap => ({
  blockNumber: BigInt(block),
  logIndex,
  timestamp,
  amount0,
  amount1,
});

describe("buildCandles", () => {
  it("builds OHLCV from execution prices, exactly", () => {
    const swaps = [
      swap(1, 0, 60, -E18, 2n * E18), // price 2
      swap(2, 0, 70, 3n * E18, -E18), // price 1/3 of... |a1|/|a0| = 1/3
      swap(3, 0, 80, -E18, 5n * E18), // price 5
      swap(4, 0, 110, -2n * E18, 3n * E18), // price 1.5
    ];
    const [c] = buildCandles(swaps, 60, 18, 18);
    expect(c).toEqual({
      t: 60,
      open: "2",
      high: "5",
      low: "0.333333333333333333",
      close: "1.5",
      volumeBase: "7",
      volumeQuote: "11",
      trades: 4,
      firstBlock: "1",
      lastBlock: "4",
    });
  });

  it("emits NO candle for an interval with no trades (no forward fill)", () => {
    const swaps = [swap(1, 0, 0, -E18, E18), swap(2, 0, 3 * 60 + 5, -E18, 2n * E18)];
    const candles = buildCandles(swaps, 60, 18, 18);
    expect(candles.map((c) => c.t)).toEqual([0, 180]);
    expect(candles).toHaveLength(2);
  });

  it("returns an empty array for no swaps", () => {
    expect(buildCandles([], 60, 18, 18)).toEqual([]);
  });

  it("orders by (block, logIndex), not by arrival, for open and close", () => {
    const swaps = [swap(5, 2, 10, -E18, 3n * E18), swap(5, 1, 10, -E18, 1n * E18)];
    const [c] = buildCandles(swaps, 60, 18, 18);
    expect(c!.open).toBe("1");
    expect(c!.close).toBe("3");
  });

  it("inverts price and swaps volume sides", () => {
    const [c] = buildCandles([swap(1, 0, 0, -4n * E18, 2n * E18)], 60, 18, 18, true);
    expect(c!.open).toBe("2");
    expect(c!.volumeBase).toBe("2");
    expect(c!.volumeQuote).toBe("4");
  });

  it("decimal-adjusts mixed decimals (18 / 6)", () => {
    const [c] = buildCandles([swap(1, 0, 0, -E18, 2_500_000_000n)], 3600, 18, 6);
    expect(c!.close).toBe("2500");
    expect(c!.volumeQuote).toBe("2500");
  });

  it("skips a zero-leg swap as unpriceable rather than charting a zero", () => {
    const candles = buildCandles([swap(1, 0, 0, 0n, 5n), swap(2, 0, 1, -E18, E18)], 60, 18, 18);
    expect(candles).toHaveLength(1);
    expect(candles[0]!.trades).toBe(1);
  });
});
