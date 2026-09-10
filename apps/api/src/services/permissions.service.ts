import {
  BIN_HOOK_FLAGS,
  CL_HOOK_FLAGS,
  decodeBinHookPermissions,
  decodeCLHookPermissions,
  enabledHookNames,
  validateHookRegistrationBitmap,
  type PoolType,
} from "@latchprotocol/sdk";

/**
 * Human-readable permission views.
 *
 * The bit layout, the encode/decode maths and the dependency rules all come
 * from `@latchprotocol/sdk`, which derives them from the compiled ABIs and the
 * `ICLHooks`/`IBinHooks` offset constants. Nothing here re-derives them; this
 * module only shapes them for an HTTP response.
 *
 * Context worth carrying into any UI built on this: the bitmap lives in
 * `poolKey.parameters`, NOT in the hook's address. That is why one hook address
 * can appear with several different bitmaps, and why decoding needs to be told
 * which bitmap it is looking at.
 */

export interface DecodedPermission {
  offset: number;
  name: string;
  enabled: boolean;
  /** True for the four bits that unlock the hookDelta return path. */
  returnsDelta: boolean;
  /** Bit that must also be set for this one to be valid, if any. */
  requires?: number;
}

/** Bits 10-13 are the "returns delta" family in both pool types. */
const RETURNS_DELTA_OFFSETS = new Set([10, 11, 12, 13]);

/**
 * Parent callback each "returns delta" bit depends on.
 * Mirrors `CLHooks.validatePermissionsConflict` / `BinHooks` equivalent.
 */
const REQUIRES: Record<number, number> = { 10: 6, 11: 7, 12: 3, 13: 5 };

export interface PermissionSummary {
  bitmap: number;
  hex: string;
  binary: string;
  poolType: PoolType;
  enabled: string[];
  permissions: DecodedPermission[];
  /** Non-empty when the bitmap would be rejected by initialize(). */
  problems: { code: string; message: string }[];
  valid: boolean;
  /** True when the hook can move value through the hookDelta path. */
  canTakeHookFees: boolean;
}

export function describeBitmap(poolType: PoolType, bitmap: number): PermissionSummary {
  const flags = poolType === "CL" ? CL_HOOK_FLAGS : BIN_HOOK_FLAGS;
  const decoded =
    poolType === "CL"
      ? (decodeCLHookPermissions(bitmap) as Record<string, boolean>)
      : (decodeBinHookPermissions(bitmap) as Record<string, boolean>);

  const permissions: DecodedPermission[] = Object.entries(flags)
    .map(([name, offset]) => ({
      offset: offset as number,
      name,
      enabled: decoded[name] ?? false,
      returnsDelta: RETURNS_DELTA_OFFSETS.has(offset as number),
      requires: REQUIRES[offset as number],
    }))
    .sort((a, b) => a.offset - b.offset);

  const validation = validateHookRegistrationBitmap(poolType, bitmap);

  return {
    bitmap,
    hex: `0x${(bitmap & 0xffff).toString(16).padStart(4, "0")}`,
    binary: toBinaryLiteral(bitmap),
    poolType,
    enabled: enabledHookNames(poolType, bitmap),
    permissions,
    problems: validation.issues.map((i) => ({ code: i.code, message: i.message })),
    valid: validation.valid,
    canTakeHookFees: permissions.some((p) => p.returnsDelta && p.enabled),
  };
}

/** `0b0000_1000_1100_0000`, the way a hook declares it in Solidity. */
export function toBinaryLiteral(bitmap: number): string {
  const bits = (bitmap & 0xffff).toString(2).padStart(16, "0");
  return `0b${bits.slice(0, 4)}_${bits.slice(4, 8)}_${bits.slice(8, 12)}_${bits.slice(12, 16)}`;
}

/** Flag table for a pool type, so a client can render a bit picker. */
export function flagTable(poolType: PoolType) {
  const flags = poolType === "CL" ? CL_HOOK_FLAGS : BIN_HOOK_FLAGS;
  return Object.entries(flags)
    .map(([name, offset]) => ({
      name,
      offset: offset as number,
      returnsDelta: RETURNS_DELTA_OFFSETS.has(offset as number),
      requires: REQUIRES[offset as number],
    }))
    .sort((a, b) => a.offset - b.offset);
}
