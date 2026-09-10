// SPDX-License-Identifier: MIT
/**
 * Concentrated-liquidity arithmetic, for the fork harness only.
 *
 * This is *not* part of the shipped package - the widgets deliberately refuse to
 * invent a quote and ask the host for one instead. The fork suite needs a
 * predicted amount to compare the executed one against, and a prediction the
 * contracts disagree with is worse than none, so this transcribes the exact
 * formulas and rounding directions the pool uses:
 *
 * - `TickMath.getSqrtRatioAtTick` (bit-magic, verbatim constants)
 * - `SqrtPriceMath.getAmount{0,1}Delta`, which round **up** when liquidity is
 *   added and **down** when it is removed
 * - `LiquidityAmounts.getLiquidityForAmounts`
 *
 * {@link assertTickMathSelfConsistent} checks the transcription against a value
 * the chain publishes, so a typo in a constant fails here rather than showing up
 * as a mysterious one-wei mismatch in a liquidity test.
 */

/** 2^96. */
export const Q96 = 1n << 96n;
const Q128 = 1n << 128n;
const MAX_UINT256 = (1n << 256n) - 1n;

/** Lowest tick a pool can quote. */
export const MIN_TICK = -887272;
/** Highest tick a pool can quote. */
export const MAX_TICK = 887272;

const RATIOS: readonly [bigint, bigint][] = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

/** `TickMath.getSqrtRatioAtTick`. */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError(`tick out of range: ${tick}`);
  }
  const absTick = BigInt(Math.abs(tick));
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : Q128;
  for (const [bit, factor] of RATIOS) {
    if ((absTick & bit) !== 0n) ratio = (ratio * factor) >> 128n;
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  // Downcast from Q128.128 to Q96.64, rounding up.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  const product = a * b;
  return product % denominator === 0n ? product / denominator : product / denominator + 1n;
}

function divRoundingUp(a: bigint, b: bigint): bigint {
  return a % b === 0n ? a / b : a / b + 1n;
}

function sorted(a: bigint, b: bigint): [bigint, bigint] {
  return a <= b ? [a, b] : [b, a];
}

/** `SqrtPriceMath.getAmount0Delta`. */
export function getAmount0Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [lower, upper] = sorted(sqrtRatioAX96, sqrtRatioBX96);
  const numerator1 = liquidity << 96n;
  const numerator2 = upper - lower;
  return roundUp
    ? divRoundingUp(mulDivRoundingUp(numerator1, numerator2, upper), lower)
    : (numerator1 * numerator2) / upper / lower;
}

/** `SqrtPriceMath.getAmount1Delta`. */
export function getAmount1Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [lower, upper] = sorted(sqrtRatioAX96, sqrtRatioBX96);
  return roundUp
    ? mulDivRoundingUp(liquidity, upper - lower, Q96)
    : (liquidity * (upper - lower)) / Q96;
}

/** `LiquidityAmounts.getLiquidityForAmount0`. */
export function getLiquidityForAmount0(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
): bigint {
  const [lower, upper] = sorted(sqrtRatioAX96, sqrtRatioBX96);
  const intermediate = (lower * upper) / Q96;
  return (amount0 * intermediate) / (upper - lower);
}

/** `LiquidityAmounts.getLiquidityForAmount1`. */
export function getLiquidityForAmount1(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount1: bigint,
): bigint {
  const [lower, upper] = sorted(sqrtRatioAX96, sqrtRatioBX96);
  return (amount1 * Q96) / (upper - lower);
}

/** `LiquidityAmounts.getLiquidityForAmounts`. */
export function getLiquidityForAmounts(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [lower, upper] = sorted(sqrtRatioAX96, sqrtRatioBX96);
  if (sqrtRatioX96 <= lower) return getLiquidityForAmount0(lower, upper, amount0);
  if (sqrtRatioX96 < upper) {
    const liquidity0 = getLiquidityForAmount0(sqrtRatioX96, upper, amount0);
    const liquidity1 = getLiquidityForAmount1(lower, sqrtRatioX96, amount1);
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  }
  return getLiquidityForAmount1(lower, upper, amount1);
}

/**
 * Amounts the pool will move for a liquidity change spanning `sqrtRatioX96`.
 *
 * `adding` selects the rounding direction: the contracts round **towards the
 * pool** either way, so an add costs one wei more and a remove returns one wei
 * less than the unrounded figure.
 */
export function amountsForLiquidity(
  sqrtRatioX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  adding: boolean,
): { amount0: bigint; amount1: bigint } {
  const lower = getSqrtRatioAtTick(tickLower);
  const upper = getSqrtRatioAtTick(tickUpper);
  if (sqrtRatioX96 <= lower) {
    return { amount0: getAmount0Delta(lower, upper, liquidity, adding), amount1: 0n };
  }
  if (sqrtRatioX96 < upper) {
    return {
      amount0: getAmount0Delta(sqrtRatioX96, upper, liquidity, adding),
      amount1: getAmount1Delta(lower, sqrtRatioX96, liquidity, adding),
    };
  }
  return { amount0: 0n, amount1: getAmount1Delta(lower, upper, liquidity, adding) };
}

/**
 * Checks this transcription against a value the chain publishes.
 *
 * @throws when the bit-magic constants have been corrupted.
 */
export function assertTickMathSelfConsistent(): void {
  if (getSqrtRatioAtTick(0) !== Q96) {
    throw new Error(`getSqrtRatioAtTick(0) is ${getSqrtRatioAtTick(0)}, expected 2^96 (${Q96})`);
  }
  // getSqrtRatioAtTick(MAX_TICK), published as TickMath.MAX_SQRT_RATIO.
  const maxSqrtRatio = 1461446703485210103287273052203988822378723970342n;
  if (getSqrtRatioAtTick(MAX_TICK) !== maxSqrtRatio) {
    throw new Error(
      `getSqrtRatioAtTick(MAX_TICK) is ${getSqrtRatioAtTick(MAX_TICK)}, expected ${maxSqrtRatio}`,
    );
  }
  const minSqrtRatio = 4295128739n;
  if (getSqrtRatioAtTick(MIN_TICK) !== minSqrtRatio) {
    throw new Error(
      `getSqrtRatioAtTick(MIN_TICK) is ${getSqrtRatioAtTick(MIN_TICK)}, expected ${minSqrtRatio}`,
    );
  }
}
