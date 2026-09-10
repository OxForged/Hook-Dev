// SPDX-License-Identifier: MIT
/**
 * Which callbacks exist, and which bit each one occupies.
 *
 * The bit offsets are NOT re-derived here: they are imported from
 * `@latchprotocol/sdk`, which holds the verified tables and the validator the
 * pool managers' rules were transcribed from. This module only adds what the
 * SDK has no reason to know — which of those names are actual callback
 * *functions* (bits 0-9) versus delta permissions (bits 10-13), and the
 * equivalent naming used by Uniswap v4 so the same rules can run on a v4 hook.
 */

import { BIN_HOOK_FLAGS, CL_HOOK_FLAGS, type PoolType } from "@latchprotocol/sdk";

/** Highest bit that names an actual callback function. */
export const LAST_CALLBACK_BIT = 9;

/** A callback the pool manager may invoke on a hook. */
export interface CallbackSpec {
  readonly name: string;
  readonly bit: number;
  /** `true` for a callback the manager calls; `false` for a `*ReturnsDelta` permission. */
  readonly isFunction: boolean;
}

function specsFrom(table: Readonly<Record<string, number>>): readonly CallbackSpec[] {
  return Object.entries(table)
    .map(([name, bit]) => ({ name, bit, isFunction: bit <= LAST_CALLBACK_BIT }))
    .sort((a, b) => a.bit - b.bit);
}

export const CL_CALLBACKS = specsFrom(CL_HOOK_FLAGS);
export const BIN_CALLBACKS = specsFrom(BIN_HOOK_FLAGS);

/** All permission specs for a pool type. */
export function callbackSpecs(poolType: PoolType): readonly CallbackSpec[] {
  return poolType === "CL" ? CL_CALLBACKS : BIN_CALLBACKS;
}

/** Just the callbacks the manager actually calls (bits 0-9). */
export function callbackFunctions(poolType: PoolType): readonly CallbackSpec[] {
  return callbackSpecs(poolType).filter((spec) => spec.isFunction);
}

/** Every callback function name across both pool types, for hook detection. */
export const ALL_CALLBACK_NAMES: ReadonlySet<string> = new Set([
  ...CL_CALLBACKS.filter((s) => s.isFunction).map((s) => s.name),
  ...BIN_CALLBACKS.filter((s) => s.isFunction).map((s) => s.name),
]);

/** Callbacks that run inside a swap, where a revert or a gas blowup is felt hardest. */
export const HOT_CALLBACKS: ReadonlySet<string> = new Set(["beforeSwap", "afterSwap"]);

/** Callbacks that are on the critical path of any pool interaction. */
export const HOT_PATH_CALLBACKS: ReadonlySet<string> = new Set([
  "beforeSwap",
  "afterSwap",
  "beforeAddLiquidity",
  "afterAddLiquidity",
  "beforeRemoveLiquidity",
  "afterRemoveLiquidity",
  "beforeMint",
  "afterMint",
  "beforeBurn",
  "afterBurn",
]);

/**
 * Uniswap v4's `Hooks.Permissions` field names, mapped onto the same bit
 * offsets so bitmap-shaped rules can run unchanged on a v4 hook.
 *
 * v4 spells the delta permissions `...ReturnDelta`; Latch spells them
 * `...ReturnsDelta`. The offsets are identical, which is why a single set of
 * dependency rules covers both.
 */
export const V4_PERMISSION_FIELD_BITS: Readonly<Record<string, number>> = {
  beforeInitialize: 0,
  afterInitialize: 1,
  beforeAddLiquidity: 2,
  afterAddLiquidity: 3,
  beforeRemoveLiquidity: 4,
  afterRemoveLiquidity: 5,
  beforeSwap: 6,
  afterSwap: 7,
  beforeDonate: 8,
  afterDonate: 9,
  beforeSwapReturnDelta: 10,
  afterSwapReturnDelta: 11,
  afterAddLiquidityReturnDelta: 12,
  afterRemoveLiquidityReturnDelta: 13,
};

/**
 * Where the LP-fee override sits in a callback's return tuple.
 *
 * This is not uniform, and getting it wrong is how a linter false-positives on
 * every bin hook: `beforeSwap` returns `(bytes4, BeforeSwapDelta, uint24)` so
 * the fee is component 2, while bin's `beforeMint` returns `(bytes4, uint24)`
 * and the fee is component 1. A callback absent from this table returns no fee.
 */
export const FEE_RETURN_INDEX: Readonly<Record<string, number>> = {
  beforeSwap: 2,
  beforeMint: 1,
};

/** Callbacks through which a hook can override the LP fee, per pool type. */
export function feeBearingCallbacks(poolType: PoolType): readonly string[] {
  return poolType === "BIN" ? ["beforeSwap", "beforeMint"] : ["beforeSwap"];
}

/** Name of the view a hook uses to declare its permissions, per dialect. */
export const LATCH_BITMAP_FUNCTION = "getHooksRegistrationBitmap";
export const V4_PERMISSIONS_FUNCTION = "getHookPermissions";
