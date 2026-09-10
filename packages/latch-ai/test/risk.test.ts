// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { decodeLatchRecord, encodeCLHookPermissions } from "@latchprotocol/sdk";

import { assessRisk } from "../src/explain/risk.js";
import { emptyRawRecord } from "./helpers.js";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function record(overrides: Parameters<typeof emptyRawRecord>[0] = {}) {
  return decodeLatchRecord(ADDRESS, emptyRawRecord(overrides));
}

/**
 * The affirmative claims this package must never make.
 *
 * A substring ban on the word "safe" would be the wrong test - "this is not a
 * safety verdict" is an honest sentence and must stay allowed. What is banned
 * is the ASSERTION, so the patterns match the claim rather than the word.
 */
const SAFETY_CLAIMS = [
  /\bis safe\b/i,
  /\bsafe to (use|trade|interact|deposit)/i,
  /\bno risk\b/i,
  /\brisk[- ]free\b/i,
  /\bfully audited\b/i,
  /\bguaranteed\b/i,
  /\btrustworthy\b/i,
  /\byou can trust\b/i,
];

function expectNoSafetyClaim(value: unknown): void {
  const text = JSON.stringify(value);
  for (const pattern of SAFETY_CLAIMS) expect(text).not.toMatch(pattern);
}

describe("assessRisk - not registered", () => {
  it("separates an address with no code from a contract nobody listed", () => {
    const eoa = assessRisk({ registered: false, address: ADDRESS, hasCode: false });
    expect(eoa.standing).toBe("not-registered");
    expect(eoa.headline).toContain("no code");
    expect(eoa.permissions).toBeNull();

    const unlisted = assessRisk({ registered: false, address: ADDRESS, hasCode: true });
    expect(unlisted.standing).toBe("not-registered");
    expect(unlisted.headline).toContain("not in the Latch registry");
    expect(unlisted.headline).not.toContain("no code");
  });

  it("still explains the bitmap of an unlisted hook that reports one", () => {
    const bitmap = encodeCLHookPermissions({ beforeSwap: true, beforeSwapReturnsDelta: true });
    const a = assessRisk({ registered: false, address: ADDRESS, hasCode: true, onChainBitmap: bitmap });
    expect(a.permissions?.riskClass).toBe("ValueExtracting");
    expect(a.axes.riskClass).toBe("ValueExtracting");
    // Absent from the registry, so there is nothing a curator attested.
    expect(a.axes.verification).toBeNull();
    expect(a.axes.listing).toBeNull();
    expect(a.auditBadge).toBe(false);
  });

  it("says absence is not a finding", () => {
    const a = assessRisk({ registered: false, address: ADDRESS, hasCode: true });
    expect(a.doesNotCover[0]).toContain("Absence from the registry says nothing");
    expect(a.doesNotCover.length).toBeGreaterThan(1);
  });
});

describe("assessRisk - registered", () => {
  it("keeps the three axes separate for an audited value-extracting hook", () => {
    const a = assessRisk({
      registered: true,
      record: record({
        verification: 2, // Audited
        listing: 0, // Active
        permissions: encodeCLHookPermissions({ beforeSwap: true, beforeSwapReturnsDelta: true }),
      }),
    });
    expect(a.axes.verification).toBe("Audited");
    expect(a.axes.listing).toBe("Active");
    expect(a.axes.riskClass).toBe("ValueExtracting");
    // The badge is earned AND the value-extraction warning stands. Neither
    // cancels the other; that is the whole design.
    expect(a.auditBadge).toBe(true);
    expect(a.warnings.map((w) => w.code)).toContain("ValueExtracting");
    expectNoSafetyClaim(a);
  });

  it("puts a malicious flag first and at critical severity", () => {
    const a = assessRisk({ registered: true, record: record({ listing: 2 }) });
    expect(a.standing).toBe("flagged-malicious");
    expect(a.warnings[0]?.code).toBe("FlaggedMalicious");
    expect(a.warnings[0]?.severity).toBe("critical");
    expect(a.headline).toContain("Do not interact");
  });

  it("treats an unreadable bitmap as a high-severity warning, not a detail", () => {
    const a = assessRisk({
      registered: true,
      record: record({ permissionsReadable: false, permissionsValid: false }),
    });
    expect(a.axes.permissionState).toBe("Stale");
    const stale = a.warnings.find((w) => w.code === "PermissionsStale");
    expect(stale?.severity).toBe("high");
    expect(a.doesNotCover[0]).toContain("not fresh");
    expect(a.auditBadge).toBe(false);
  });

  it("calls Unverified informational, because it is the default state", () => {
    const a = assessRisk({ registered: true, record: record() });
    const unverified = a.warnings.find((w) => w.code === "Unverified");
    expect(unverified?.severity).toBe("info");
    expect(unverified?.message).toContain("state every listing starts in");
  });

  it("never asserts safety for any combination of the three axes", () => {
    for (const verification of [0, 1, 2]) {
      for (const listing of [0, 1, 2]) {
        for (const permissions of [0, 64, 1088, 16]) {
          expectNoSafetyClaim(
            assessRisk({ registered: true, record: record({ verification, listing, permissions }) }),
          );
        }
      }
    }
  });

  it("always states what it does not cover", () => {
    const a = assessRisk({ registered: true, record: record() });
    expect(a.doesNotCover.length).toBeGreaterThan(0);
    expect(a.doesNotCover.join(" ")).toContain("not an audit");
  });
});
