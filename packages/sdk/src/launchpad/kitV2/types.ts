// SPDX-License-Identifier: MIT
/* ============================================================================
   LaunchpadKitV2: the parameter types, taken from the ABI rather than restated.

   `LaunchParamsV2` below is `ContractFunctionArgs<LAUNCHPAD_KIT_V2_ABI,
   "createLaunch">[0]` - the type viem itself will accept for the call. A field
   renamed or retyped in Solidity changes the generated ABI, and every helper in
   this folder then stops compiling, which is the only kind of drift alarm that
   cannot be skipped.

   The numbers exported here are either ENUM ENCODINGS (declaration order is the
   wire value) or facts about the kit that are constants in its bytecode. Anything
   a deployment chooses - `maxLegs`, `maxBinsPerLeg`, the fee caps - is read off
   the kit (`readKitV2Caps`), never assumed from this file.
   ============================================================================ */

import type { ContractFunctionArgs, ContractFunctionReturnType } from "viem";

import type { LAUNCHPAD_KIT_V2_ABI } from "../generated/abi.js";

/** `enum LegKind`. Declaration order IS the encoding. */
export const LEG_KIND = {
  CL: 0,
  Bin: 1,
} as const;
export type LegKindName = keyof typeof LEG_KIND;

/**
 * `enum BinShape`. Declaration order IS the encoding.
 *
 * `Custom` is the ZERO value, exactly like `Preset.Custom`: an unset field means
 * "validate my arrays", and empty arrays then revert `BinShapeBadCount`.
 */
export const BIN_SHAPE = {
  Custom: 0,
  Flat: 1,
  Linear: 2,
  Exponential: 3,
  Stepped: 4,
} as const;
export type BinShapeName = keyof typeof BIN_SHAPE;
export const BIN_SHAPE_NAMES = Object.keys(BIN_SHAPE) as readonly BinShapeName[];

/** `LaunchpadKitV2.CL_HOOK_BITMAP`: `beforeInitialize | beforeSwap`. */
export const KIT_V2_CL_HOOK_BITMAP = 0x0041;
/** `LaunchpadKitV2.BIN_HOOK_BITMAP`: `beforeInitialize | beforeMint | beforeSwap`. */
export const KIT_V2_BIN_HOOK_BITMAP = 0x0045;
/** Every kit leg is born dynamic-fee (`LPFeeLibrary.DYNAMIC_FEE_FLAG`); the fee is never a caller input. */
export const KIT_V2_LEG_FEE = 0x800000;
/** Leg weights and every split are in basis points of this. */
export const KIT_V2_BPS = 10_000;
/** Bin weights are fractions of this (`BinLaunchShapes.PRECISION`). */
export const BIN_WEIGHT_PRECISION = 10n ** 18n;
/** `LaunchpadKitV2.MAX_START_DELAY_SECONDS` (30 days). */
export const KIT_V2_MAX_START_DELAY_SECONDS = 2_592_000;
/**
 * Core caps a Bin pool's LP fee at 10% (`LPFeeLibrary.TEN_PERCENT_FEE`), and the
 * kit refuses a Bin leg whose schedule OPENS above it (`PresetUnavailableOnBin`).
 * That removes `AntiSniperAggressive` and `Stealth` (50%) and any Custom schedule
 * starting above 10% from every launch that has a Bin leg.
 */
export const BIN_LEG_MAX_INITIAL_FEE_PIPS = 100_000;

/**
 * The caps `script/DeployLaunchpadKitV2.s.sol` deploys with (`MAX_LEGS = 4`,
 * `MAX_BINS_PER_LEG = 20`), sized so the worst case (4 legs x 20 bins, ~24.4M
 * gas measured) fits Robinhood's 32M block with margin.
 *
 * A DEFAULT for rendering a form before a kit address exists. The deployed kit's
 * `maxLegs()` / `maxBinsPerLeg()` are the authority - read them with
 * `readKitV2Caps` once there is a kit; a kit deployed for a different chain may
 * carry different numbers.
 */
export const KIT_V2_DEPLOY_SCRIPT_CAPS = {
  maxLegs: 4,
  maxBinsPerLeg: 20,
} as const;

/** The `createLaunch` argument, exactly as viem encodes it. */
export type LaunchParamsV2 = ContractFunctionArgs<typeof LAUNCHPAD_KIT_V2_ABI, "payable", "createLaunch">[0];
/** One element of `LaunchParamsV2.legs`. */
export type LegParamsV2 = LaunchParamsV2["legs"][number];
export type CLLegParamsV2 = LegParamsV2["cl"];
export type BinLegParamsV2 = LegParamsV2["bin"];
export type ScheduleParamsV2 = LaunchParamsV2["schedule"];
/** `struct TenantConfig` as `tenantConfig(address)` returns it. */
export type TenantConfigV2 = ContractFunctionReturnType<typeof LAUNCHPAD_KIT_V2_ABI, "view", "tenantConfig">;
/** `struct LaunchResultV2`. */
export type LaunchResultV2 = ContractFunctionReturnType<typeof LAUNCHPAD_KIT_V2_ABI, "payable", "createLaunch">;

/** The caps a launch is validated against. Read them with `readKitV2Caps`. */
export interface KitV2Caps {
  readonly maxLegs: number;
  readonly maxBinsPerLeg: number;
}

/** A `CLLegParamsV2` for a Bin leg, or a `BinLegParamsV2` for a CL leg: the kit ignores it, but it must encode. */
export const EMPTY_CL_LEG: CLLegParamsV2 = { tickSpacing: 0, sqrtPriceX96: 0n, tickLower: 0, tickUpper: 0 };
export const EMPTY_BIN_LEG: BinLegParamsV2 = {
  binStep: 0,
  activeId: 0,
  shape: BIN_SHAPE.Custom,
  binCount: 0,
  offsets: [],
  weights: [],
  floorBins: 0,
};
