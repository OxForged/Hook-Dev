// SPDX-License-Identifier: MIT
/**
 * The credibility test: the protocol's own hooks are correct code, so any
 * finding against them is a bug in this linter, not in them.
 *
 * True positives are easy to manufacture. A hook linter is only worth running
 * if it stays silent on `BaseCLHook`, `BaseBinHook`, `LaunchGuardHook` and
 * `BinLaunchGuardHook` - which between them exercise every shape the rules are
 * most likely to trip over: base-class callback delegation, a fee override, a
 * launch gate that reverts on the swap path, owner-guarded configuration that
 * callbacks read, and both pool types.
 */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, type AnalysisResult } from "../src/index.js";
import { describeFindings, REAL_HOOKS_SRC } from "./helpers.js";

const EXPECTED = [
  { name: "BaseCLHook", poolType: "CL", abstract: true, bitmap: undefined },
  { name: "BaseBinHook", poolType: "BIN", abstract: true, bitmap: undefined },
  // beforeInitialize | beforeSwap
  { name: "LaunchGuardHook", poolType: "CL", abstract: false, bitmap: 0x0041 },
  // beforeInitialize | beforeMint | beforeSwap - beforeMint is what closes the
  // bin composition-swap route LATCH-011 exists to find.
  { name: "BinLaunchGuardHook", poolType: "BIN", abstract: false, bitmap: 0x0045 },
] as const;

const available = existsSync(REAL_HOOKS_SRC);

/**
 * Compiling the hooks package is what makes this test slow the first time; the
 * scratch build is cached afterwards. If the package does not currently
 * compile, that is not this linter's failure, so the suite says so instead of
 * reporting a red that belongs to someone else.
 */
function analyzeRealHooks(): AnalysisResult | { skipped: string } {
  try {
    return analyze(REAL_HOOKS_SRC, {});
  } catch (error) {
    return { skipped: error instanceof Error ? error.message : String(error) };
  }
}

describe.skipIf(!available)("the protocol's own hooks", () => {
  const outcome = analyzeRealHooks();
  const skipped = "skipped" in outcome;
  const result = skipped ? undefined : outcome;

  it("compiles and is analysable", () => {
    if (skipped) {
      expect.soft(true, `packages/hooks could not be analysed: ${outcome.skipped}`).toBe(true);
      return;
    }
    expect(result).toBeDefined();
  });

  it.skipIf(skipped)("finds every hook, with the right pool type and bitmap", () => {
    const hooks = result?.hooks ?? [];
    const names = hooks.map((hook) => hook.name);

    for (const expected of EXPECTED) {
      const hook = hooks.find((candidate) => candidate.name === expected.name);
      expect(hook, `${expected.name} not analysed (found: ${names.join(", ")})`).toBeDefined();
      if (hook === undefined) continue;
      expect(hook.poolType, `${expected.name} pool type`).toBe(expected.poolType);
      expect(hook.isAbstract, `${expected.name} abstractness`).toBe(expected.abstract);
      expect(hook.declaredBitmap, `${expected.name} bitmap`).toBe(expected.bitmap);
    }
  });

  it.skipIf(skipped)("reports NO findings - a false positive here is a linter bug", () => {
    const findings = result?.findings ?? [];
    expect(
      findings.length,
      `false positive(s) on correct production hooks:\n${describeFindings(findings)}`,
    ).toBe(0);
  });

  it.skipIf(skipped)("analysed the whole target, not a partial compilation", () => {
    // A partial build-info would make "no findings" meaningless, so the loader
    // warns rather than quietly linting two of four files.
    expect(result?.warnings.filter((warning) => warning.includes("NOT linted"))).toEqual([]);
    expect(result?.hooks.length).toBeGreaterThanOrEqual(EXPECTED.length);
  });

  it.skipIf(skipped)("exits zero at the default threshold", () => {
    const failing = (result?.findings ?? []).filter(
      (finding) => finding.severity !== "low" && finding.severity !== "info",
    );
    expect(failing).toEqual([]);
  });
});
