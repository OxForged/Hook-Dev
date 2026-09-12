// SPDX-License-Identifier: MIT
/**
 * Building a `LaunchpadKit.createLaunch` transaction.
 *
 * One call creates the pool, configures the launch-guard decay schedule, seeds
 * liquidity from the caller and optionally lists the hook in the registry. It
 * is `payable` **only** so native liquidity can be forwarded: the kit reverts
 * `NativeValueMismatch` if `msg.value` is anything other than the exact native
 * amount being seeded, so there is no way to attach a tip and no way for this
 * app to skim one here. A tenant's revenue comes from the swap fee in
 * `latch.config.ts`, which is a different mechanism in a different place.
 *
 * Nothing in this module sends anything. It returns calldata for a wallet to
 * sign, and the caller is expected to simulate first — every guard in the kit
 * is a revert, which makes a simulation a free and complete pre-flight.
 */

import { LAUNCHPAD_KIT_ABI } from "@latchprotocol/sdk";
import { encodeFunctionData, type Address, type Hex } from "viem";

import { resolveConfig } from "../config/resolve";
import { publicClient } from "./client";
import { LaunchpadNotConfiguredError } from "./launches";

/** Concentrated-liquidity tick bounds. Fixed by core's price range, not policy. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export interface LaunchDraft {
  readonly launchToken: Address;
  readonly quoteToken: Address;
  readonly tickSpacing: number;
  /** Starting price, as quote tokens per one launch token, in human units. */
  readonly startPrice: string;
  readonly launchTokenDecimals: number;
  readonly quoteTokenDecimals: number;
  /** Index into `PRESETS`. `4` (Custom) uses the three fee/decay fields below. */
  readonly preset: number;
  readonly initialFeeBips: number;
  readonly finalFeeBips: number;
  readonly decayBlocks: number;
  readonly startDelaySeconds: number;
  /** Raw units. `0n` means uncapped. */
  readonly maxBuyPerTx: bigint;
  /** Sole holder of `reconfigureLaunch`, and only until the launch starts. */
  readonly operator: Address;
  /** Raw units of each side to seed. Both may be zero for an unseeded pool. */
  readonly seedLaunchTokenAmount: bigint;
  readonly seedQuoteTokenAmount: bigint;
  /** Who receives the position NFT for the seeded liquidity. */
  readonly positionRecipient: Address;
  readonly deadlineSeconds: number;
}

/** Integer square root, for the sqrtPriceX96 conversion. */
export function bigintSqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("bigintSqrt: negative");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

const Q96 = 2n ** 96n;

/**
 * `sqrtPriceX96` for a pool, from a human-readable price.
 *
 * Core prices a pool as currency1 per currency0 in RAW units, so the decimals
 * of both sides have to be folded in before the square root. Getting this wrong
 * does not fail loudly — it initialises the pool at a price off by a power of
 * ten, permanently, and the first liquidity provider pays for it.
 *
 * @param price quote tokens per one launch token, in human units
 */
export function sqrtPriceX96For(
  price: string,
  launchTokenIsCurrency0: boolean,
  launchTokenDecimals: number,
  quoteTokenDecimals: number,
): bigint {
  const parsed = parseDecimal(price);
  if (parsed === null || parsed.numerator === 0n) {
    throw new RangeError(`startPrice must be a positive decimal number, received "${price}"`);
  }

  // price = quote per launch, in human units. Convert to raw: multiply by
  // 10^quoteDecimals / 10^launchDecimals.
  let rawNum = parsed.numerator * 10n ** BigInt(quoteTokenDecimals);
  let rawDen = parsed.denominator * 10n ** BigInt(launchTokenDecimals);

  // Core wants currency1 per currency0. When the launch token is currency1 the
  // ratio is the other way up.
  if (!launchTokenIsCurrency0) {
    [rawNum, rawDen] = [rawDen, rawNum];
  }

  // sqrt(num/den) * 2^96, computed as sqrt(num * 2^192 / den) so no float is
  // ever involved.
  const scaled = (rawNum * Q96 * Q96) / rawDen;
  return bigintSqrt(scaled);
}

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Parses a plain decimal string into an exact fraction. No floats, no rounding. */
export function parseDecimal(input: string): Fraction | null {
  const text = input.trim();
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const dot = text.indexOf(".");
  if (dot === -1) return { numerator: BigInt(text), denominator: 1n };
  const digits = text.slice(0, dot) + text.slice(dot + 1);
  const places = text.length - dot - 1;
  return { numerator: BigInt(digits === "" ? "0" : digits), denominator: 10n ** BigInt(places) };
}

/** Widest tick range the spacing allows. Used for a full-range seed position. */
export function fullRangeTicks(tickSpacing: number): { tickLower: number; tickUpper: number } {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new RangeError(`tickSpacing must be a positive integer, received ${tickSpacing}`);
  }
  return {
    tickLower: Math.ceil(MIN_TICK / tickSpacing) * tickSpacing,
    tickUpper: Math.floor(MAX_TICK / tickSpacing) * tickSpacing,
  };
}

export interface CreateLaunchCall {
  readonly to: Address;
  readonly data: Hex;
  /** Native value to attach. Non-zero only when a side of the seed is native. */
  readonly value: bigint;
  readonly launchTokenIsCurrency0: boolean;
  readonly poolId: Hex;
}

const NATIVE: Address = "0x0000000000000000000000000000000000000000";

/**
 * Encodes `createLaunch`.
 *
 * The currency ordering is not guessed: `computePoolKey` is called on the kit
 * so the pool key, the pool id and `launchTokenIsCurrency0` all come from the
 * contract that will build them. Deriving them here and being one sort order
 * out would produce a pool at the reciprocal price.
 */
export async function buildCreateLaunch(draft: LaunchDraft): Promise<CreateLaunchCall> {
  const cfg = resolveConfig();
  if (cfg.launchpadKit === null) throw new LaunchpadNotConfiguredError();
  const kit = cfg.launchpadKit;

  const computed = await publicClient().readContract({
    address: kit,
    abi: LAUNCHPAD_KIT_ABI,
    functionName: "computePoolKey",
    args: [draft.launchToken, draft.quoteToken, draft.tickSpacing],
  });
  const [, poolId, launchTokenIsCurrency0] = computed;

  const sqrtPriceX96 = sqrtPriceX96For(
    draft.startPrice,
    launchTokenIsCurrency0,
    draft.launchTokenDecimals,
    draft.quoteTokenDecimals,
  );

  const { tickLower, tickUpper } = fullRangeTicks(draft.tickSpacing);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + draft.deadlineSeconds);

  const params = {
    launchToken: draft.launchToken,
    quoteToken: draft.quoteToken,
    tickSpacing: draft.tickSpacing,
    sqrtPriceX96,
    preset: draft.preset,
    initialFeeBips: draft.initialFeeBips,
    finalFeeBips: draft.finalFeeBips,
    decayBlocks: draft.decayBlocks,
    enabled: true,
    startDelaySeconds: draft.startDelaySeconds,
    maxBuyPerTx: draft.maxBuyPerTx,
    launchOperator: draft.operator,
    seed: {
      tickLower,
      tickUpper,
      launchTokenAmount: draft.seedLaunchTokenAmount,
      quoteTokenAmount: draft.seedQuoteTokenAmount,
      positionRecipient: draft.positionRecipient,
      deadline,
    },
    /* Registry listing is left OFF here. `listHook` records a steward and
       metadata for the HOOK CONTRACT, not for this launch, and the hook is
       shared by every launch the kit creates — the first caller to set it wins
       and later callers get nothing. Listing it is a one-off operational step
       for whoever deployed the kit, not something a launch wizard should do on
       a tenant's behalf. */
    listing: {
      register: false,
      steward: NATIVE,
      metadata: { name: "", description: "", sourceURI: "", auditURI: "", chainIds: [] },
    },
  } as const;

  /* The kit reverts unless msg.value is EXACTLY the native side of the seed. */
  const value =
    draft.launchToken === NATIVE
      ? draft.seedLaunchTokenAmount
      : draft.quoteToken === NATIVE
        ? draft.seedQuoteTokenAmount
        : 0n;

  return {
    to: kit,
    data: encodeFunctionData({
      abi: LAUNCHPAD_KIT_ABI,
      functionName: "createLaunch",
      args: [params],
    }),
    value,
    launchTokenIsCurrency0,
    poolId,
  };
}
