import { compareRatio, executionPrice, formatUnitsExact, invertRatio, ratioToDecimal, type Ratio } from "../lib/units.js";

/**
 * OHLCV candles from swaps. PURE and exact.
 *
 * Definitions, stated so nobody has to guess:
 *   price     the EXECUTION price of each swap: |amount1| / |amount0|, decimal-
 *             adjusted, i.e. token1 per token0 (inverted with `invert`). Gross
 *             amounts as the Swap log reports them, so it includes the LP fee and
 *             the price impact of that swap. Not a mid price.
 *   open      first swap in the bucket by (blockNumber, logIndex); close = last.
 *   high/low  exact rational max/min over the bucket's swaps.
 *   volume    base = sum |amount0|, quote = sum |amount1|, token units (inverted
 *             when `invert`), as exact decimal strings.
 *   bucket    [start, start + interval) in unix seconds of the BLOCK timestamp.
 *
 * THERE IS NO CANDLE FOR AN INTERVAL WITH NO TRADES. No forward fill, no
 * carried close, no zero-volume placeholder: an empty interval is absent from
 * the array. A chart that wants gaps drawn flat must decide that itself.
 */

export interface CandleSwap {
  blockNumber: bigint;
  logIndex: number;
  /** unix seconds */
  timestamp: number;
  amount0: bigint;
  amount1: bigint;
}

export interface Candle {
  /** unix seconds, bucket start */
  t: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeBase: string;
  volumeQuote: string;
  trades: number;
  firstBlock: string;
  lastBlock: string;
}

export const INTERVALS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 } as const;
export type IntervalName = keyof typeof INTERVALS;

const abs = (v: bigint) => (v < 0n ? -v : v);

export function buildCandles(
  swaps: readonly CandleSwap[],
  intervalSeconds: number,
  decimals0: number,
  decimals1: number,
  invert = false,
  significantDigits = 18,
): Candle[] {
  const ordered = [...swaps].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const out: Candle[] = [];
  let cur:
    | { t: number; open: Ratio; high: Ratio; low: Ratio; close: Ratio; v0: bigint; v1: bigint; n: number; first: bigint; last: bigint }
    | undefined;

  const flush = () => {
    if (!cur) return;
    out.push({
      t: cur.t,
      open: ratioToDecimal(cur.open, significantDigits),
      high: ratioToDecimal(cur.high, significantDigits),
      low: ratioToDecimal(cur.low, significantDigits),
      close: ratioToDecimal(cur.close, significantDigits),
      volumeBase: invert ? formatUnitsExact(cur.v1, decimals1) : formatUnitsExact(cur.v0, decimals0),
      volumeQuote: invert ? formatUnitsExact(cur.v0, decimals0) : formatUnitsExact(cur.v1, decimals1),
      trades: cur.n,
      firstBlock: cur.first.toString(),
      lastBlock: cur.last.toString(),
    });
  };

  for (const s of ordered) {
    const raw = executionPrice(s.amount0, s.amount1, decimals0, decimals1);
    if (!raw) continue; // a zero leg has no price; it is not a trade for charting
    const p = invert ? invertRatio(raw) : raw;
    const t = Math.floor(s.timestamp / intervalSeconds) * intervalSeconds;
    if (!cur || cur.t !== t) {
      flush();
      cur = { t, open: p, high: p, low: p, close: p, v0: 0n, v1: 0n, n: 0, first: s.blockNumber, last: s.blockNumber };
    }
    if (compareRatio(p, cur.high) > 0) cur.high = p;
    if (compareRatio(p, cur.low) < 0) cur.low = p;
    cur.close = p;
    cur.v0 += abs(s.amount0);
    cur.v1 += abs(s.amount1);
    cur.n += 1;
    cur.last = s.blockNumber;
  }
  flush();
  return out;
}
