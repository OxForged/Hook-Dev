/* ============================================================================
   Concentrated-liquidity arithmetic for the portfolio screen.

   Faithful BigInt ports of three routines from packages/core:

     TickMath.getSqrtRatioAtTick      -> sqrtRatioAtTick
     SqrtPriceMath.getAmount{0,1}Delta -> amountsForLiquidity
     Tick.getFeeGrowthInside +
     CLPosition.update (feesOwed)      -> uncollectedFees

   Every input is on-chain state (a position's liquidity and ticks, the pool's
   slot0, tick info and fee-growth globals) and every output is a token amount
   in base units. Nothing here estimates; a wrong constant would render a number
   that LOOKS real and is not, which is the one failure this app is built to
   avoid, so the magic constants are copied verbatim from TickMath.sol and the
   port is checked against the live pool (sqrtRatioAtTick(tick) <= sqrtPriceX96
   < sqrtRatioAtTick(tick + 1) must hold for slot0).

   No USD anywhere. These tokens have no price.
   ============================================================================ */

export const MIN_TICK = -887272
export const MAX_TICK = 887272

const Q32 = 1n << 32n
const Q96 = 1n << 96n
const Q128 = 1n << 128n
const U256 = (1n << 256n) - 1n

/** Wrap to uint256, reproducing Solidity `unchecked` subtraction. */
const u256 = (v: bigint): bigint => ((v % (U256 + 1n)) + (U256 + 1n)) % (U256 + 1n)

const RATIO_STEPS: readonly [number, bigint][] = [
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
]

/** sqrt(1.0001^tick) * 2^96, as TickMath.getSqrtRatioAtTick computes it. */
export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError(`tick ${tick} outside [${MIN_TICK}, ${MAX_TICK}]`)
  }
  const absTick = tick < 0 ? -tick : tick
  let ratio = absTick & 0x1 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 1n << 128n
  for (const [bit, k] of RATIO_STEPS) {
    if (absTick & bit) ratio = (ratio * k) >> 128n
  }
  if (tick > 0) ratio = U256 / ratio
  // Q128.128 -> Q64.96, rounding up.
  return (ratio + (Q32 - 1n)) >> 32n
}

/** Token0 owed for `liquidity` between two sqrt prices, rounded DOWN (what a withdrawal returns). */
function amount0Delta(a: bigint, b: bigint, liquidity: bigint): bigint {
  if (a > b) [a, b] = [b, a]
  if (a === 0n) throw new RangeError('sqrt price of zero')
  return ((liquidity << 96n) * (b - a)) / b / a
}

/** Token1 owed for `liquidity` between two sqrt prices, rounded DOWN. */
function amount1Delta(a: bigint, b: bigint, liquidity: bigint): bigint {
  if (a > b) [a, b] = [b, a]
  return (liquidity * (b - a)) / Q96
}

export interface PositionAmounts {
  amount0: bigint
  amount1: bigint
  /** tickLower <= currentTick < tickUpper. */
  inRange: boolean
}

/**
 * The token composition of a position right now, given the pool's current price.
 *
 * Mirrors CLPool.modifyLiquidity's three branches: entirely token0 below the
 * range, entirely token1 above it, a mix inside — where the split uses the
 * pool's exact sqrtPriceX96 rather than the price at its rounded tick.
 */
export function amountsForLiquidity(
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  currentTick: number,
  sqrtPriceX96: bigint,
): PositionAmounts {
  if (tickLower >= tickUpper) throw new RangeError('tickLower must be below tickUpper')
  const lower = sqrtRatioAtTick(tickLower)
  const upper = sqrtRatioAtTick(tickUpper)

  if (currentTick < tickLower) {
    return { amount0: amount0Delta(lower, upper, liquidity), amount1: 0n, inRange: false }
  }
  if (currentTick < tickUpper) {
    return {
      amount0: amount0Delta(sqrtPriceX96, upper, liquidity),
      amount1: amount1Delta(lower, sqrtPriceX96, liquidity),
      inRange: true,
    }
  }
  return { amount0: 0n, amount1: amount1Delta(lower, upper, liquidity), inRange: false }
}

export interface TickFeeGrowth {
  feeGrowthOutside0X128: bigint
  feeGrowthOutside1X128: bigint
}

export interface UncollectedFees {
  fees0: bigint
  fees1: bigint
}

/**
 * Fees a position has earned since its last touch, exactly as CLPosition.update
 * would credit them on the next modifyLiquidity(0).
 *
 * All subtractions wrap at 2^256 on purpose — the pool's own arithmetic is
 * `unchecked`, and fee-growth values are only meaningful modulo 2^256.
 */
export function uncollectedFees(
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  currentTick: number,
  feeGrowthGlobal0X128: bigint,
  feeGrowthGlobal1X128: bigint,
  lower: TickFeeGrowth,
  upper: TickFeeGrowth,
  feeGrowthInside0LastX128: bigint,
  feeGrowthInside1LastX128: bigint,
): UncollectedFees {
  const below0 =
    currentTick >= tickLower
      ? lower.feeGrowthOutside0X128
      : u256(feeGrowthGlobal0X128 - lower.feeGrowthOutside0X128)
  const below1 =
    currentTick >= tickLower
      ? lower.feeGrowthOutside1X128
      : u256(feeGrowthGlobal1X128 - lower.feeGrowthOutside1X128)

  const above0 =
    currentTick < tickUpper
      ? upper.feeGrowthOutside0X128
      : u256(feeGrowthGlobal0X128 - upper.feeGrowthOutside0X128)
  const above1 =
    currentTick < tickUpper
      ? upper.feeGrowthOutside1X128
      : u256(feeGrowthGlobal1X128 - upper.feeGrowthOutside1X128)

  const inside0 = u256(feeGrowthGlobal0X128 - below0 - above0)
  const inside1 = u256(feeGrowthGlobal1X128 - below1 - above1)

  return {
    fees0: (u256(inside0 - feeGrowthInside0LastX128) * liquidity) / Q128,
    fees1: (u256(inside1 - feeGrowthInside1LastX128) * liquidity) / Q128,
  }
}

/** Tick spacing lives in bits 16..39 of PoolKey.parameters (CLPoolParametersHelper). */
export function tickSpacingFromParameters(parameters: `0x${string}`): number {
  return Number((BigInt(parameters) >> 16n) & 0xffffffn)
}
