import { indexer } from "@latchprotocol/sdk";

/**
 * Exact integer and rational arithmetic for token amounts. No floats anywhere:
 * every value is a bigint until it becomes a decimal STRING at the edge.
 */

export const PIPS = 1_000_000n;

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

export interface SwapSplit {
  /** true when currency0 was paid in. */
  zeroForOne: boolean;
  /** 0 or 1: which currency was the input. */
  inputIndex: 0 | 1;
  amountIn: bigint;
  amountOut: bigint;
  feeTotal: bigint;
  feeProtocol: bigint;
  feeLp: bigint;
}

/**
 * Direction, amounts and fee split of one Swap log.
 *
 * DIRECTION: `Swap.amount0/amount1` are the CALLER's delta; negative = paid in.
 * `amount0 < 0n` means currency0 in (zeroForOne). This is the SDK's own
 * `indexer.swapIsZeroForOne`, verified on 4663 tx
 * 0x68286e9b10e1e4d7e42adc9bc02bda0484ac53f6943dc8cd37cfd1d959bc629a
 * (amount0 = -1e18, and 1e18 of currency0 moved into the Vault).
 *
 * FEES, per swap from the swap's OWN fields (so a later fee change cannot
 * rewrite history), matching `apps/web/src/lib/protocolActivity.ts` and the
 * DefiLlama adapter:
 *   fee          total rate, pips, protocol fee included
 *   protocolFee  single-direction protocol rate, pips
 *   feeTotal    = amountIn * fee / 1e6            (floored)
 *   feeProtocol = amountIn * protocolFee / 1e6    (floored)
 *   feeLp       = feeTotal - feeProtocol, floored at 0
 *
 * Returns null for a swap with no negative side (nothing paid in). Such a log is
 * still stored by the caller's choice; it simply carries no volume.
 */
export function splitSwap(amount0: bigint, amount1: bigint, fee: number, protocolFee: number): SwapSplit | null {
  const zeroForOne = indexer.swapIsZeroForOne(amount0);
  const in1 = !zeroForOne && amount1 < 0n;
  if (!zeroForOne && !in1) return null;
  const amountIn = zeroForOne ? -amount0 : -amount1;
  const amountOut = zeroForOne ? abs(amount1) : abs(amount0);
  const feeTotal = (amountIn * BigInt(fee)) / PIPS;
  const feeProtocol = (amountIn * BigInt(protocolFee)) / PIPS;
  const feeLp = feeTotal > feeProtocol ? feeTotal - feeProtocol : 0n;
  return { zeroForOne, inputIndex: zeroForOne ? 0 : 1, amountIn, amountOut, feeTotal, feeProtocol, feeLp };
}

/** Raw integer units -> exact decimal string ("1.5"). Trailing zeros trimmed. */
export function formatUnitsExact(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new RangeError("bad decimals");
  const neg = value < 0n;
  const a = abs(value);
  if (decimals === 0) return `${neg ? "-" : ""}${a}`;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac.length ? `.${frac}` : ""}`;
}

/** A non-negative rational num/den. Compared exactly by cross-multiplication. */
export interface Ratio {
  num: bigint;
  den: bigint;
}

export function compareRatio(a: Ratio, b: Ratio): number {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * num/den as a decimal string with `sig` significant digits, truncated (never
 * rounded up, so a displayed price never exceeds the true one). Exact integer
 * maths; a result like "0.000000001234567890123456789" keeps its digits.
 */
export function ratioToDecimal(r: Ratio, sig = 18): string {
  if (r.den === 0n) throw new RangeError("division by zero");
  if (r.num === 0n) return "0";
  const neg = r.num < 0n !== r.den < 0n;
  const num = abs(r.num);
  const den = abs(r.den);
  const whole = num / den;
  let rem = num % den;
  let out = whole.toString();
  let significant = whole === 0n ? 0 : out.length;
  if (significant >= sig || rem === 0n) return `${neg ? "-" : ""}${out}`;
  let frac = "";
  // Cap iterations: leading zeros plus `sig` digits, bounded to keep this O(1)-ish.
  for (let i = 0; i < 120 && rem !== 0n && significant < sig; i++) {
    rem *= 10n;
    const digit = rem / den;
    rem %= den;
    frac += digit.toString();
    if (significant > 0 || digit !== 0n) significant += 1;
  }
  frac = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${out}${frac.length ? `.${frac}` : ""}`;
}

/**
 * Price of token0 in token1 units from raw amounts, decimal-adjusted:
 *   (|amount1| / 10^dec1) / (|amount0| / 10^dec0) = |amount1| * 10^dec0 / (|amount0| * 10^dec1)
 */
export function executionPrice(amount0: bigint, amount1: bigint, dec0: number, dec1: number): Ratio | null {
  const a0 = abs(amount0);
  const a1 = abs(amount1);
  if (a0 === 0n || a1 === 0n) return null;
  return { num: a1 * 10n ** BigInt(dec0), den: a0 * 10n ** BigInt(dec1) };
}

export function invertRatio(r: Ratio): Ratio {
  return { num: r.den, den: r.num };
}

/** CL spot price of token0 in token1, decimal-adjusted: (sqrtP/2^96)^2 * 10^dec0 / 10^dec1. */
export function sqrtPriceX96ToRatio(sqrtPriceX96: bigint, dec0: number, dec1: number): Ratio {
  return { num: sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(dec0), den: (1n << 192n) * 10n ** BigInt(dec1) };
}

/** Parse a stored decimal integer string (Postgres NUMERIC) to bigint, rejecting fractions. */
export function toBigInt(value: { toFixed(): string } | string | bigint | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  const s = typeof value === "string" ? value : typeof value === "number" ? String(value) : value.toFixed();
  if (!/^-?\d+$/.test(s)) throw new RangeError(`not an integer: ${s}`);
  return BigInt(s);
}
