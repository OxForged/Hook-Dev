// SPDX-License-Identifier: MIT
/**
 * Unit tests for the pieces the rules stand on.
 *
 * Constant folding and callback resolution are where a silent regression does
 * the most damage: if folding stops working every bitmap rule stands down and
 * the linter reports "clean" instead of reporting nothing at all, and if
 * delegation resolution breaks, every hook built on a base contract looks like
 * it implements all ten callbacks.
 */

import { describe, expect, it } from "vitest";
import { CL_HOOK_FLAGS, BIN_HOOK_FLAGS, decodeCLHookPermissions } from "@latchprotocol/sdk";
import { findProjectRoot, loadCompilation, readFoundryConfig, findHookContracts } from "../src/index.js";
import { FEE_RETURN_INDEX } from "../src/model/callbacks.js";
import { meetsThreshold, parseSeverity, sortFindings, type Finding } from "../src/finding.js";
import { FIXTURES_SRC } from "./helpers.js";

function fixtureHooks() {
  const root = findProjectRoot(FIXTURES_SRC);
  if (root === undefined) throw new Error("fixture project root not found");
  return findHookContracts(loadCompilation(readFoundryConfig(root), { build: false }));
}

describe("callback resolution through a base hook", () => {
  const hooks = fixtureHooks();
  const hookNamed = (name: string) => hooks.find((hook) => hook.ref.name === name);

  it("sees through the base's forward-to-internal pattern", () => {
    const hook = hookNamed("CleanCLHook");
    expect(hook).toBeDefined();
    const swap = hook?.callbacks.get("beforeSwap");
    expect(swap?.status).toBe("implemented");
    // entry is the base's external `beforeSwap`; impl is the subclass override.
    expect(swap?.path.length).toBe(2);
  });

  it("treats the base's reverting default as NOT implemented", () => {
    // Every callback exists on the base and appears in the ABI, so a naive
    // reading would say all ten are implemented and every bitmap is wrong.
    const hook = hookNamed("CleanCLHook");
    expect(hook?.callbacks.get("afterSwap")?.status).toBe("not-implemented");
    expect(hook?.callbacks.get("beforeDonate")?.status).toBe("not-implemented");
    expect(hook?.callbacks.get("beforeSwap")?.status).toBe("implemented");
  });

  it("reports a callback that exists nowhere as absent", () => {
    const hook = hookNamed("UnguardedCallback");
    expect(hook?.callbacks.get("beforeSwap")?.status).toBe("absent");
    expect(hook?.callbacks.get("afterSwap")?.status).toBe("implemented");
  });

  it("recognises an abstract base as a hook without a concrete bitmap", () => {
    const base = hookNamed("FixtureBaseHook");
    expect(base?.isAbstract).toBe(true);
    expect(base?.declaredBitmap).toBeUndefined();
  });
});

describe("bitmap evaluation", () => {
  const hooks = fixtureHooks();
  const bitmapOf = (name: string): number | undefined =>
    hooks.find((hook) => hook.ref.name === name)?.declaredBitmap;

  it("folds `A | B` over constants inherited from a base", () => {
    expect(bitmapOf("CleanCLHook")).toBe(
      (1 << CL_HOOK_FLAGS.beforeInitialize) | (1 << CL_HOOK_FLAGS.beforeSwap),
    );
  });

  it("folds a cast and a shift", () => {
    // `BEFORE_SWAP | uint16(1 << 15)`
    expect(bitmapOf("ReservedBitSet")).toBe((1 << CL_HOOK_FLAGS.beforeSwap) | 0x8000);
  });

  it("maps a Uniswap v4 Permissions struct onto the same bit offsets", () => {
    expect(bitmapOf("CleanV4Hook")).toBe(1 << CL_HOOK_FLAGS.beforeSwap);
    expect(bitmapOf("BrokenV4Hook")).toBe(
      (1 << CL_HOOK_FLAGS.afterSwap) | (1 << CL_HOOK_FLAGS.beforeSwapReturnsDelta),
    );
  });

  it("decodes to the permission names the SDK defines", () => {
    const bitmap = bitmapOf("CleanCLHook");
    expect(bitmap).toBeDefined();
    const permissions = decodeCLHookPermissions(bitmap ?? 0);
    expect(permissions.beforeSwap).toBe(true);
    expect(permissions.beforeInitialize).toBe(true);
    expect(permissions.afterSwap).toBe(false);
  });

  it("uses bin bit 2 for beforeMint", () => {
    expect(bitmapOf("CleanBinHook")).toBe(
      (1 << BIN_HOOK_FLAGS.beforeInitialize) | (1 << BIN_HOOK_FLAGS.beforeMint) | (1 << BIN_HOOK_FLAGS.beforeSwap),
    );
  });
});

describe("bin return shapes", () => {
  it("knows the fee sits at a different tuple position per callback", () => {
    // Assuming `beforeSwap`'s layout for `beforeMint` would read the selector
    // as a fee and false-positive on every bin hook.
    expect(FEE_RETURN_INDEX["beforeSwap"]).toBe(2);
    expect(FEE_RETURN_INDEX["beforeMint"]).toBe(1);
    expect(FEE_RETURN_INDEX["afterSwap"]).toBeUndefined();
  });
});

describe("severity handling", () => {
  it("orders thresholds worst-first", () => {
    expect(meetsThreshold("critical", "medium")).toBe(true);
    expect(meetsThreshold("low", "medium")).toBe(false);
    expect(meetsThreshold("medium", "medium")).toBe(true);
  });

  it("parses severity names case-insensitively", () => {
    expect(parseSeverity("HIGH")).toBe("high");
    expect(parseSeverity("nonsense")).toBeUndefined();
  });

  it("sorts findings worst-first, then by file and line", () => {
    const make = (rule: string, severity: Finding["severity"], file: string, line: number): Finding => ({
      rule,
      title: "t",
      severity,
      confidence: "high",
      contract: "C",
      file,
      line,
      column: 1,
      message: "m",
      fix: "f",
      snippet: undefined,
    });
    const sorted = sortFindings([
      make("LATCH-002", "medium", "b.sol", 1),
      make("LATCH-001", "critical", "z.sol", 9),
      make("LATCH-003", "high", "a.sol", 2),
    ]);
    expect(sorted.map((finding) => finding.severity)).toEqual(["critical", "high", "medium"]);
  });
});
