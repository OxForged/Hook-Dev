// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { encodeCLHookPermissions, encodeBinHookPermissions } from "@latchprotocol/sdk";

import { explainPermissions } from "../src/explain/permissions.js";

/** Pull one finding out by its machine key. */
const finding = (e: ReturnType<typeof explainPermissions>, key: string) => {
  const f = e.findings.find((x) => x.capability === key);
  if (!f) throw new Error(`no finding for ${key}`);
  return f;
};

describe("explainPermissions", () => {
  it("reports an empty bitmap as observing only, without calling it safe", () => {
    const e = explainPermissions(0);
    expect(e.riskClass).toBe("Passive");
    expect(e.declaredCallbacks).toEqual([]);
    expect(finding(e, "observeOnly").granted).toBe(true);
    expect(finding(e, "takeSwapCut").granted).toBe(false);
    expect(finding(e, "blockSwaps").granted).toBe(false);
    expect(finding(e, "trapLiquidity").granted).toBe(false);
    // The limits are part of the answer, always.
    expect(e.doesNotCover.length).toBeGreaterThan(0);
  });

  it("classes a beforeSwap-only hook as Restrictive and says trading is at its discretion", () => {
    const bitmap = encodeCLHookPermissions({ beforeSwap: true });
    const e = explainPermissions(bitmap);
    expect(e.riskClass).toBe("Restrictive");
    expect(finding(e, "blockSwaps").granted).toBe(true);
    expect(finding(e, "takeSwapCut").granted).toBe(false);
    expect(e.plainLanguage.join(" ")).toContain("refuse a swap");
  });

  it("classes a swap-cut hook as ValueExtracting", () => {
    const bitmap = encodeCLHookPermissions({ beforeSwap: true, beforeSwapReturnsDelta: true });
    const e = explainPermissions(bitmap);
    expect(e.riskClass).toBe("ValueExtracting");
    expect(finding(e, "takeSwapCut").granted).toBe(true);
    expect(e.acceptedByPoolManagers).toBe(true);
  });

  it("treats beforeRemoveLiquidity as ValueExtracting because it can strand funds", () => {
    const bitmap = encodeCLHookPermissions({ beforeRemoveLiquidity: true });
    const e = explainPermissions(bitmap);
    expect(e.riskClass).toBe("ValueExtracting");
    expect(finding(e, "trapLiquidity").granted).toBe(true);
    expect(finding(e, "takeSwapCut").granted).toBe(false);
    expect(e.plainLanguage.join(" ")).toContain("one-way door");
  });

  it("flags a returns-delta bit with no base callback as unusable, not merely risky", () => {
    // beforeSwapReturnsDelta without beforeSwap: the pool manager rejects this
    // at initialization, so it can never be a live pool configuration.
    const bitmap = encodeCLHookPermissions({ beforeSwapReturnsDelta: true });
    const e = explainPermissions(bitmap);
    expect(e.acceptedByPoolManagers).toBe(false);
    expect(e.validationIssues.join(" ")).toContain("requires");
    expect(e.doesNotCover[0]).toContain("not one any pool manager will accept");
  });

  it("flags an unassigned bit", () => {
    const e = explainPermissions(0x4000);
    expect(e.acceptedByPoolManagers).toBe(false);
    expect(e.validationIssues.join(" ")).toContain("unassigned");
  });

  it("uses bin naming for a bin pool while classifying identically", () => {
    const bin = encodeBinHookPermissions({ beforeBurn: true });
    const cl = encodeCLHookPermissions({ beforeRemoveLiquidity: true });
    // Same offset, so the same number and the same class - only the name moves.
    expect(bin).toBe(cl);
    const e = explainPermissions(bin, "BIN");
    expect(e.declaredCallbacks).toEqual(["beforeBurn"]);
    expect(e.riskClass).toBe("ValueExtracting");
    expect(finding(e, "trapLiquidity").bits).toEqual(["beforeBurn"]);
  });

  it("accepts hex and decimal alike at the tool boundary, and rejects out of range here", () => {
    expect(() => explainPermissions(-1)).toThrow(RangeError);
    expect(() => explainPermissions(0x10000)).toThrow(RangeError);
    expect(() => explainPermissions(1.5)).toThrow(RangeError);
  });

  it("never asserts that a bitmap is safe", () => {
    for (let bitmap = 0; bitmap <= 0x3fff; bitmap += 137) {
      const text = JSON.stringify(explainPermissions(bitmap));
      expect(text).not.toMatch(/\bis safe\b/i);
      expect(text).not.toMatch(/\bsafe to (use|trade|interact)/i);
      expect(text).not.toMatch(/\bno risk\b/i);
      expect(text).not.toMatch(/\btrustworthy\b/i);
    }
  });
});
