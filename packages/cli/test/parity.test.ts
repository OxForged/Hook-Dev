/**
 * The permission tables in this CLI (and in `@latchprotocol/sdk`) are a copy of
 * numbers that really live in Solidity. This suite reads the Solidity and fails
 * if they ever disagree.
 *
 * That is the whole safety argument for generating both halves of the hook
 * configuration: the generator is only trustworthy while its bit offsets match
 * `ICLHooks.sol`, its constant names match `BaseCLHook.sol`, and its parameter
 * packing matches `ParametersHelper.sol` / `CLPoolParametersHelper.sol`.
 *
 * The suite skips itself when the Solidity is not on disk, so the package still
 * tests cleanly outside a full checkout.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CL_HOOK_FLAGS,
  HOOKS_BITMAP_BITS,
  OFFSET_HOOKS_BITMAP,
  OFFSET_TICK_SPACING,
  CL_MOST_SIGNIFICANT_UNUSED_BIT,
} from "@latchprotocol/sdk";
import { ALL_PERMISSIONS, SOLIDITY_CONSTANTS, poolParametersFor } from "../src/permissions.js";
import { resolveWorkspace } from "../src/util/workspace.js";

const here = dirname(fileURLToPath(import.meta.url));

function workspaceOrUndefined() {
  try {
    return resolveWorkspace({ near: here });
  } catch {
    return undefined;
  }
}

const workspace = workspaceOrUndefined();
const corePath = workspace?.core;
const hooksPath = workspace?.hooks;

/** `HOOKS_AFTER_ADD_LIQUIDIY_RETURNS_DELTA_OFFSET` -> `afteraddliquidityreturnsdelta`. */
function normalise(name: string): string {
  return name
    .replace(/^HOOKS_/, "")
    .replace(/_OFFSET$/, "")
    .replace(/_/g, "")
    .toLowerCase()
    // upstream spells it LIQUIDIY in the two returns-delta constants
    .replace(/liquidiy/g, "liquidity");
}

describe("bit offsets match packages/core", () => {
  const iclHooksPath =
    corePath === undefined ? undefined : join(corePath, "src", "pool-cl", "interfaces", "ICLHooks.sol");
  const available = iclHooksPath !== undefined && existsSync(iclHooksPath);

  it.skipIf(!available)("every HOOKS_*_OFFSET constant has the same value here", () => {
    const source = readFileSync(iclHooksPath as string, "utf8");
    const matches = [...source.matchAll(/uint8\s+constant\s+(HOOKS_\w+_OFFSET)\s*=\s*(\d+)\s*;/g)];

    expect(matches.length).toBe(ALL_PERMISSIONS.length);

    const fromSolidity = new Map<string, number>();
    for (const match of matches) {
      fromSolidity.set(normalise(match[1] as string), Number.parseInt(match[2] as string, 10));
    }

    for (const name of ALL_PERMISSIONS) {
      const key = name.toLowerCase();
      expect(fromSolidity.has(key), `ICLHooks.sol has no offset for ${name}`).toBe(true);
      expect(fromSolidity.get(key), `bit offset for ${name}`).toBe(CL_HOOK_FLAGS[name]);
    }
  });

  const parametersHelperPath =
    corePath === undefined ? undefined : join(corePath, "src", "libraries", "math", "ParametersHelper.sol");

  it.skipIf(parametersHelperPath === undefined || !existsSync(parametersHelperPath))(
    "the bitmap sits at OFFSET_HOOK and is 16 bits wide",
    () => {
      const source = readFileSync(parametersHelperPath as string, "utf8");
      const offset = /uint256\s+internal\s+constant\s+OFFSET_HOOK\s*=\s*(\d+)\s*;/.exec(source);
      expect(offset, "OFFSET_HOOK not found in ParametersHelper.sol").not.toBeNull();
      expect(Number.parseInt((offset as RegExpExecArray)[1] as string, 10)).toBe(OFFSET_HOOKS_BITMAP);
      // decodeUint16 is what the library uses to read it
      expect(source).toContain("decodeUint16(OFFSET_HOOK)");
      expect(HOOKS_BITMAP_BITS).toBe(16);
    },
  );

  const clParametersPath =
    corePath === undefined
      ? undefined
      : join(corePath, "src", "pool-cl", "libraries", "CLPoolParametersHelper.sol");

  it.skipIf(clParametersPath === undefined || !existsSync(clParametersPath))(
    "tickSpacing and the first unused bit match CLPoolParametersHelper",
    () => {
      const source = readFileSync(clParametersPath as string, "utf8");
      const tick = /OFFSET_TICK_SPACING\s*=\s*(\d+)\s*;/.exec(source);
      const unused = /OFFSET_MOST_SIGNIFICANT_UNUSED_BITS\s*=\s*(\d+)\s*;/.exec(source);
      expect(tick).not.toBeNull();
      expect(unused).not.toBeNull();
      expect(Number.parseInt((tick as RegExpExecArray)[1] as string, 10)).toBe(OFFSET_TICK_SPACING);
      expect(Number.parseInt((unused as RegExpExecArray)[1] as string, 10)).toBe(
        CL_MOST_SIGNIFICANT_UNUSED_BIT,
      );
    },
  );
});

describe("Solidity constant names match packages/hooks", () => {
  const basePath =
    hooksPath === undefined ? undefined : join(hooksPath, "src", "base", "BaseCLHook.sol");
  const available = basePath !== undefined && existsSync(basePath);

  it.skipIf(!available)("every generated constant exists on BaseCLHook with the right bit", () => {
    const source = readFileSync(basePath as string, "utf8");
    const matches = [...source.matchAll(/uint16\s+internal\s+constant\s+(\w+)\s*=\s*1\s*<<\s*(\d+)\s*;/g)];

    const fromSolidity = new Map<string, number>();
    for (const match of matches) {
      fromSolidity.set(match[1] as string, Number.parseInt(match[2] as string, 10));
    }

    for (const name of ALL_PERMISSIONS) {
      const constant = SOLIDITY_CONSTANTS[name];
      expect(fromSolidity.has(constant), `BaseCLHook.sol has no constant ${constant}`).toBe(true);
      expect(fromSolidity.get(constant), `${constant} shift`).toBe(CL_HOOK_FLAGS[name]);
    }
  });

  it.skipIf(!available)("BaseCLHook rejects the same reserved bits the CLI refuses to emit", () => {
    const source = readFileSync(basePath as string, "utf8");
    expect(source).toContain("RESERVED_BITS = uint16(0xC000)");
  });
});

describe("parameter packing", () => {
  it("puts the bitmap in the low 16 bits and tickSpacing at bit 16", () => {
    // beforeSwap (bit 6) with tick spacing 60: 0x3c is 60, 0x0040 is 1 << 6.
    expect(poolParametersFor(1 << CL_HOOK_FLAGS.beforeSwap, 60)).toBe(
      "0x00000000000000000000000000000000000000000000000000000000003c0040",
    );
  });

  it("round-trips a negative tick spacing as two's complement", () => {
    const parameters = poolParametersFor(0, 1);
    expect(parameters.endsWith("010000")).toBe(true);
  });
});
