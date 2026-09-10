/**
 * Hook permissions: the one thing this CLI exists to get right.
 *
 * A Latch pool key carries the hook's permission bitmap in the low 16 bits of
 * `parameters`. At `initialize` the pool manager reads that bitmap and compares
 * it with the value the hook itself reports from `getHooksRegistrationBitmap()`
 * (`Hooks.validateHookConfig`); a mismatch reverts with
 * `HookConfigValidationError`. Those two values are written in different files,
 * in different languages, by different people - which is exactly why they drift,
 * and why a mismatch is the most common way a first hook fails.
 *
 * Everything downstream of this module - the Solidity constant, the pool key in
 * the test harness, the deploy script's log line, the README - is derived from
 * ONE permission set computed here, so drift is not merely unlikely: there is no
 * second source for it to drift from.
 *
 * The bit offsets, dependency rules and encoding are reused from
 * `@latchprotocol/sdk` (`src/hooks/bitmap.ts` and `src/types/parameters.ts`)
 * rather than re-derived. `test/parity.test.ts` reads the offsets straight out
 * of `packages/core/src/pool-cl/interfaces/ICLHooks.sol` and the constants out
 * of `packages/hooks/src/base/BaseCLHook.sol` and asserts all three agree.
 */

import {
  CL_HOOK_FLAGS,
  encodeCLPoolParameters,
  encodeHookPermissions,
  enabledHookNames,
  HOOK_PERMISSION_DEPENDENCIES,
  validateHookRegistrationBitmap,
  type CLHookFlagName,
} from "@latchprotocol/sdk";
import { UserError } from "./util/log.js";

export type PermissionName = CLHookFlagName;

/** Every concentrated-liquidity permission, in bit order. */
export const ALL_PERMISSIONS: readonly PermissionName[] = Object.entries(CL_HOOK_FLAGS)
  .sort((a, b) => a[1] - b[1])
  .map(([name]) => name as PermissionName);

/** Bit offset of each permission (re-exported from the SDK for convenience). */
export const PERMISSION_OFFSETS = CL_HOOK_FLAGS;

/**
 * `BaseCLHook` exposes each permission as an `internal constant`. Generated
 * Solidity refers to those names instead of magic numbers, so a reader can see
 * at a glance which callbacks a hook claims.
 */
export const SOLIDITY_CONSTANTS: Readonly<Record<PermissionName, string>> = {
  beforeInitialize: "BEFORE_INITIALIZE",
  afterInitialize: "AFTER_INITIALIZE",
  beforeAddLiquidity: "BEFORE_ADD_LIQUIDITY",
  afterAddLiquidity: "AFTER_ADD_LIQUIDITY",
  beforeRemoveLiquidity: "BEFORE_REMOVE_LIQUIDITY",
  afterRemoveLiquidity: "AFTER_REMOVE_LIQUIDITY",
  beforeSwap: "BEFORE_SWAP",
  afterSwap: "AFTER_SWAP",
  beforeDonate: "BEFORE_DONATE",
  afterDonate: "AFTER_DONATE",
  beforeSwapReturnsDelta: "BEFORE_SWAP_RETURNS_DELTA",
  afterSwapReturnsDelta: "AFTER_SWAP_RETURNS_DELTA",
  afterAddLiquidityReturnsDelta: "AFTER_ADD_LIQUIDITY_RETURNS_DELTA",
  afterRemoveLiquidityReturnsDelta: "AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA",
};

/** One-line description shown by the interactive picker and `latch permissions`. */
export const PERMISSION_HELP: Readonly<Record<PermissionName, string>> = {
  beforeInitialize: "runs before a pool using this hook is created",
  afterInitialize: "runs after creation; the place to set an initial dynamic fee",
  beforeAddLiquidity: "gate or account for liquidity being added",
  afterAddLiquidity: "observe an add; with the delta flag, charge for it",
  beforeRemoveLiquidity: "gate or account for liquidity being removed",
  afterRemoveLiquidity: "observe a remove; with the delta flag, charge for it",
  beforeSwap: "the workhorse: dynamic fees, gating, custom curves",
  afterSwap: "observe the executed swap; with the delta flag, take a cut",
  beforeDonate: "gate donations into the pool",
  afterDonate: "observe donations into the pool",
  beforeSwapReturnsDelta: "lets beforeSwap move funds (needs beforeSwap)",
  afterSwapReturnsDelta: "lets afterSwap move funds (needs afterSwap)",
  afterAddLiquidityReturnsDelta: "lets afterAddLiquidity move funds (needs afterAddLiquidity)",
  afterRemoveLiquidityReturnsDelta: "lets afterRemoveLiquidity move funds (needs afterRemoveLiquidity)",
};

/** Permissions that only enable a return value on another callback. */
export const RETURNS_DELTA_PERMISSIONS: ReadonlySet<PermissionName> = new Set<PermissionName>([
  "beforeSwapReturnsDelta",
  "afterSwapReturnsDelta",
  "afterAddLiquidityReturnsDelta",
  "afterRemoveLiquidityReturnsDelta",
]);

const OFFSET_TO_NAME = new Map<number, PermissionName>(
  ALL_PERMISSIONS.map((name) => [CL_HOOK_FLAGS[name], name]),
);

/** For each returns-delta permission, the callback it cannot exist without. */
export const DEPENDENCY_OF: ReadonlyMap<PermissionName, PermissionName> = new Map(
  HOOK_PERMISSION_DEPENDENCIES.CL.map(([dependent, required]) => [
    OFFSET_TO_NAME.get(dependent) as PermissionName,
    OFFSET_TO_NAME.get(required) as PermissionName,
  ]),
);

function normalise(token: string): string {
  return token.trim().replace(/[-_\s]/g, "").toLowerCase();
}

const BY_NORMALISED = new Map<string, PermissionName>(
  ALL_PERMISSIONS.map((name) => [normalise(name), name]),
);

/**
 * Parses `--permissions beforeSwap,after-swap`.
 *
 * Case, dashes and underscores are all accepted because everyone writes these
 * names differently, and a scaffolder rejecting `before-swap` teaches nothing.
 */
export function parsePermissionList(input: string): PermissionName[] {
  const tokens = input
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return [];

  const out = new Set<PermissionName>();
  for (const token of tokens) {
    if (normalise(token) === "none") continue;
    if (normalise(token) === "all") {
      for (const name of ALL_PERMISSIONS) out.add(name);
      continue;
    }
    const match = BY_NORMALISED.get(normalise(token));
    if (match === undefined) {
      throw new UserError(
        `unknown hook permission "${token}"`,
        `valid permissions: ${ALL_PERMISSIONS.join(", ")}`,
      );
    }
    out.add(match);
  }
  return sortPermissions([...out]);
}

/** Sorts a permission set into bit order so generated output is deterministic. */
export function sortPermissions(names: readonly PermissionName[]): PermissionName[] {
  return [...new Set(names)].sort((a, b) => CL_HOOK_FLAGS[a] - CL_HOOK_FLAGS[b]);
}

export interface ResolvedPermissions {
  /** The permission set after dependencies were added. */
  readonly names: readonly PermissionName[];
  /** Base callbacks that had to be added because a delta flag required them. */
  readonly addedDependencies: readonly PermissionName[];
  /** The `uint16` registration bitmap. */
  readonly bitmap: number;
  /** `0x`-prefixed 4-hex-digit rendering of the bitmap. */
  readonly bitmapHex: string;
  /** `BEFORE_SWAP | AFTER_SWAP`, referring to `BaseCLHook`'s constants. */
  readonly solidityExpression: string;
}

/**
 * Turns a requested permission set into everything the generator needs.
 *
 * A returns-delta flag without its base callback is a guaranteed revert at pool
 * initialization (`CLHooks.validatePermissionsConflict`) and, before that, at
 * hook deployment (`BaseCLHook._validatePermissions`). Rather than emitting a
 * project that cannot work and letting the developer discover it from a bare
 * `HookPermissionsValidationError`, the missing callback is added and reported.
 */
export function resolvePermissions(requested: readonly PermissionName[]): ResolvedPermissions {
  const names = new Set(sortPermissions(requested));
  const added: PermissionName[] = [];

  for (const [dependent, required] of DEPENDENCY_OF) {
    if (names.has(dependent) && !names.has(required)) {
      names.add(required);
      added.push(required);
    }
  }

  const sorted = sortPermissions([...names]);
  const permissionsRecord = Object.fromEntries(sorted.map((name) => [name, true]));
  const bitmap = encodeHookPermissions("CL", permissionsRecord);

  const validation = validateHookRegistrationBitmap("CL", bitmap);
  if (!validation.valid) {
    // Unreachable for any set built from ALL_PERMISSIONS with dependencies
    // filled in, but a bad bitmap must never escape into generated Solidity.
    throw new UserError(
      `refusing to generate an invalid permission bitmap: ${validation.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return {
    names: sorted,
    addedDependencies: sortPermissions(added),
    bitmap,
    bitmapHex: toBitmapHex(bitmap),
    solidityExpression:
      sorted.length === 0 ? "0" : sorted.map((name) => SOLIDITY_CONSTANTS[name]).join(" | "),
  };
}

export function toBitmapHex(bitmap: number): string {
  return `0x${bitmap.toString(16).padStart(4, "0")}`;
}

/** The packed `parameters` word for a CL pool key using this hook. */
export function poolParametersFor(bitmap: number, tickSpacing: number): string {
  return encodeCLPoolParameters(bitmap, tickSpacing);
}

/** Names of the callbacks a bitmap enables, in bit order. */
export function namesForBitmap(bitmap: number): string[] {
  return enabledHookNames("CL", bitmap);
}
