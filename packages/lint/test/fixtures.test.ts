// SPDX-License-Identifier: MIT
/**
 * True positives, one deliberately-broken fixture per rule.
 *
 * Each entry pins the rule the fixture exists to trigger AND asserts that no
 * other rule fires on it. The second half matters as much as the first: a rule
 * that reports its own bug plus three neighbours is not usable, and without the
 * exact-match assertion a regression that made a rule fire everywhere would
 * still pass.
 */

import { describe, expect, it } from "vitest";
import { ALL_RULES } from "../src/index.js";
import { analyzeFixtures, describeFindings, findingsFor, rulesFor } from "./helpers.js";

/** contract -> the rule ids it must report, and nothing else. */
const BROKEN: ReadonlyArray<readonly [string, readonly string[], string]> = [
  ["UnguardedCallback", ["LATCH-001"], "callback with no pool-manager guard"],
  ["BitmapDeclaresUnimplemented", ["LATCH-002"], "bitmap declares a callback the code does not implement"],
  ["BitmapOmitsImplemented", ["LATCH-002"], "callback implemented but never registered"],
  ["DeltaWithoutBaseCallback", ["LATCH-003"], "returns-delta permission without its base callback"],
  ["ReservedBitSet", ["LATCH-003"], "reserved bit 15 set"],
  ["SilentFeeOverride", ["LATCH-004"], "fee override with no dynamic-fee assertion"],
  ["FeeFlagBitmaskTest", ["LATCH-004"], "dynamic-fee marker tested with a bitmask"],
  ["PerWalletCap", ["LATCH-005"], "per-wallet accounting keyed on `sender`"],
  ["OracleGatedSwap", ["LATCH-006"], "swap path gated on an external contract"],
  ["AlwaysRevertingSwap", ["LATCH-006"], "unconditional revert on the swap path"],
  ["UnboundedParticipantLoop", ["LATCH-007"], "loop bounded by growable storage"],
  ["WrongSelectorReturn", ["LATCH-008"], "callback returns another callback's selector"],
  ["UnguardedConfig", ["LATCH-009"], "callback-critical state writable by anyone"],
  ["ManagerReentrancy", ["LATCH-010"], "callback re-enters the pool manager"],
  ["BinNaivePortFreeMintRoute", ["LATCH-011"], "bin hook prices swaps but not the mint composition swap"],
  ["BinFeeAboveCeiling", ["LATCH-012"], "bin LP fee above core's 10% ceiling"],
  ["BrokenV4Hook", ["LATCH-001", "LATCH-003"], "Uniswap v4 hook: no guard, and an orphaned delta permission"],
];

/** Correct code. A finding on any of these is a linter bug. */
const CLEAN = ["FixtureBaseHook", "FixtureBaseBinHook", "CleanCLHook", "CleanBinHook", "CleanV4Hook"];

describe("broken fixtures", () => {
  const result = analyzeFixtures();

  it("analyses every fixture contract", () => {
    const analysed = new Set(result.hooks.map((hook) => hook.name));
    for (const [contract] of BROKEN) expect(analysed, `${contract} was not analysed`).toContain(contract);
    for (const contract of CLEAN) expect(analysed, `${contract} was not analysed`).toContain(contract);
    expect(result.warnings).toEqual([]);
  });

  for (const [contract, expected, what] of BROKEN) {
    it(`${contract}: ${what}`, () => {
      const found = rulesFor(result, contract);
      expect(found, `expected exactly ${expected.join(", ")}\n${describeFindings(findingsFor(result, contract))}`).toEqual(
        [...expected].sort(),
      );
    });
  }
});

describe("correct fixtures", () => {
  const result = analyzeFixtures();

  for (const contract of CLEAN) {
    it(`${contract} produces no findings`, () => {
      const findings = findingsFor(result, contract);
      expect(findings.length, `false positive(s):\n${describeFindings(findings)}`).toBe(0);
    });
  }
});

describe("rule coverage", () => {
  it("every rule has a fixture that triggers it", () => {
    const result = analyzeFixtures();
    const triggered = new Set(result.findings.map((finding) => finding.rule));
    const untriggered = ALL_RULES.map((rule) => rule.id).filter((id) => !triggered.has(id));
    expect(untriggered, "rules with no true-positive fixture").toEqual([]);
  });

  it("every rule states which analysis input it uses", () => {
    for (const rule of ALL_RULES) {
      expect(rule.basis.length, `${rule.id} has no basis`).toBeGreaterThan(40);
      expect(rule.id).toMatch(/^LATCH-\d{3}$/);
    }
  });

  it("rule ids are unique", () => {
    const ids = ALL_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pool type detection", () => {
  it("distinguishes bin hooks from CL hooks", () => {
    const result = analyzeFixtures();
    const poolTypeOf = (name: string): string | undefined =>
      result.hooks.find((hook) => hook.name === name)?.poolType;

    expect(poolTypeOf("CleanBinHook")).toBe("BIN");
    expect(poolTypeOf("BinNaivePortFreeMintRoute")).toBe("BIN");
    expect(poolTypeOf("CleanCLHook")).toBe("CL");
    expect(poolTypeOf("CleanV4Hook")).toBe("CL");
  });

  it("decodes the declared bitmap from the source", () => {
    const result = analyzeFixtures();
    const bitmapOf = (name: string): number | undefined =>
      result.hooks.find((hook) => hook.name === name)?.declaredBitmap;

    // BEFORE_INITIALIZE | BEFORE_SWAP
    expect(bitmapOf("CleanCLHook")).toBe(0x0041);
    // BEFORE_INITIALIZE | BEFORE_MINT | BEFORE_SWAP
    expect(bitmapOf("CleanBinHook")).toBe(0x0045);
    // a v4 Permissions struct, mapped onto the same offsets
    expect(bitmapOf("CleanV4Hook")).toBe(0x0040);
    // an abstract base has no concrete bitmap and must not be guessed at
    expect(bitmapOf("FixtureBaseHook")).toBeUndefined();
  });
});
