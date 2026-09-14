// SPDX-License-Identifier: MIT
/* ============================================================================
   Three `getPendingConfig` shapes, and why the decoder takes the shape as an
   argument instead of guessing it.

   The block-with-expiry hook (0xfC00…) and the timestamp hook return the SAME
   eight words. These tests build both returns from real-looking values and show
   that reading one as the other decodes cleanly into the wrong answer — then
   that `revShareProposalStatus` classifies each correctly on its own clock.
   ============================================================================ */

import { encodeAbiParameters, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  REVSHARE_PENDING_CONFIG_WORDS,
  RevSharePendingConfigShapeError,
  TIMESTAMP_CLOCK_MODE,
  decodeRevSharePendingConfig,
  encodeGetPendingConfig,
  inferRevSharePendingShape,
  revShareHookRecord,
  revShareProposalStatus,
  windowPhase,
} from "../src/index.js";

const PARAMS = {
  feePips: 100_000,
  lpDonateBps: 0,
  beneficiaryBps: 10_000,
  distributorBps: 0,
  distributor: "0x0000000000000000000000000000000000000000",
  enabled: true,
} as const;

const PARAMS_TYPE = {
  type: "tuple",
  components: [
    { name: "feePips", type: "uint24" },
    { name: "lpDonateBps", type: "uint16" },
    { name: "beneficiaryBps", type: "uint16" },
    { name: "distributorBps", type: "uint16" },
    { name: "distributor", type: "address" },
    { name: "enabled", type: "bool" },
  ],
} as const;

function sevenWords(effectiveBlock: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "tuple", components: [{ name: "e", type: "uint48" }, { name: "p", ...PARAMS_TYPE }] }],
    [{ e: Number(effectiveBlock), p: PARAMS }],
  );
}

function eightWords(effective: bigint, expiry: bigint): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [{ name: "e", type: "uint48" }, { name: "x", type: "uint48" }, { name: "p", ...PARAMS_TYPE }],
      },
    ],
    [{ e: Number(effective), x: Number(expiry), p: PARAMS }],
  );
}

/* Robinhood, 2026-09-13: contract block ~25.97M, block.timestamp ~1.789e9. */
const CONTRACT_BLOCK = 25_972_228n;
const NOW = 1_789_346_507n;

describe("decodeRevSharePendingConfig", () => {
  it("decodes the retired 7-word shape with a null expiry, never a default", () => {
    const d = decodeRevSharePendingConfig(sevenWords(CONTRACT_BLOCK - 10n), "block-no-expiry");
    expect(d.durationClock).toBe("contract-block");
    expect(d.effective).toBe(CONTRACT_BLOCK - 10n);
    expect(d.expiry).toBeNull();
    expect(d.params.feePips).toBe(100_000);
  });

  it("decodes both 8-word shapes, which are byte-identical in layout", () => {
    const blockData = eightWords(CONTRACT_BLOCK + 3_600n, CONTRACT_BLOCK + 25_200n);
    const tsData = eightWords(NOW + 43_200n, NOW + 43_200n + 259_200n);
    expect((blockData.length - 2) / 2).toBe(REVSHARE_PENDING_CONFIG_WORDS["block-with-expiry"] * 32);
    expect((tsData.length - 2) / 2).toBe(REVSHARE_PENDING_CONFIG_WORDS["timestamp-with-expiry"] * 32);

    const b = decodeRevSharePendingConfig(blockData, "block-with-expiry");
    expect(b.durationClock).toBe("contract-block");
    const t = decodeRevSharePendingConfig(tsData, "timestamp-with-expiry");
    expect(t.durationClock).toBe("timestamp");
    expect(t.expiry! - t.effective).toBe(259_200n);
  });

  it("THE TRAP: a timestamp proposal read as blocks decodes cleanly and reads as queued for decades", () => {
    const armedNow = eightWords(NOW - 60n, NOW + 259_000n);
    const wrong = decodeRevSharePendingConfig(armedNow, "block-with-expiry");
    // No error. Only the status gives it away, and only if you know to look.
    expect(revShareProposalStatus(wrong, { timestamp: NOW, contractBlockNumber: CONTRACT_BLOCK })).toBe("queued");
    const right = decodeRevSharePendingConfig(armedNow, "timestamp-with-expiry");
    expect(revShareProposalStatus(right, { timestamp: NOW, contractBlockNumber: CONTRACT_BLOCK })).toBe("armed");
  });

  it("refuses a return whose length does not match the declared shape", () => {
    expect(() => decodeRevSharePendingConfig(sevenWords(1n), "timestamp-with-expiry")).toThrow(
      RevSharePendingConfigShapeError,
    );
    expect(() => decodeRevSharePendingConfig(eightWords(1n, 2n), "block-no-expiry")).toThrow(
      RevSharePendingConfigShapeError,
    );
    expect(() => decodeRevSharePendingConfig("0x1234" as Hex, "block-with-expiry")).toThrow(
      RevSharePendingConfigShapeError,
    );
  });
});

describe("revShareProposalStatus", () => {
  const ts = (effective: bigint, expiry: bigint | null) =>
    ({ durationClock: "timestamp", effective, expiry }) as const;
  const blk = (effective: bigint, expiry: bigint | null) =>
    ({ durationClock: "contract-block", effective, expiry }) as const;

  it("timestamp: none, queued, armed through expiry inclusive, then expired", () => {
    const now = (t: bigint) => ({ timestamp: t, contractBlockNumber: null });
    expect(revShareProposalStatus(ts(0n, 0n), now(NOW))).toBe("none");
    expect(revShareProposalStatus(ts(NOW + 1n, NOW + 10n), now(NOW))).toBe("queued");
    expect(revShareProposalStatus(ts(NOW, NOW + 10n), now(NOW))).toBe("armed");
    expect(revShareProposalStatus(ts(NOW - 10n, NOW), now(NOW))).toBe("armed");
    expect(revShareProposalStatus(ts(NOW - 10n, NOW - 1n), now(NOW))).toBe("expired");
  });

  it("block kits need the CONTRACT block number and refuse to guess without it", () => {
    expect(() => revShareProposalStatus(blk(CONTRACT_BLOCK, null), { timestamp: NOW, contractBlockNumber: null })).toThrow(
      /contract block clock/,
    );
    expect(
      revShareProposalStatus(blk(CONTRACT_BLOCK - 1n, null), { timestamp: NOW, contractBlockNumber: CONTRACT_BLOCK }),
    ).toBe("armed");
  });

  it("the retired no-expiry shape stays armed forever", () => {
    expect(
      revShareProposalStatus(blk(1n, null), { timestamp: NOW, contractBlockNumber: CONTRACT_BLOCK * 10n }),
    ).toBe("armed");
  });

  it("windowPhase never compares a timestamp window against a block number", () => {
    // A block number of ~26M against a timestamp window around 1.79e9 would read 'before'.
    expect(windowPhase("timestamp", NOW - 5n, NOW + 5n, { timestamp: NOW, contractBlockNumber: CONTRACT_BLOCK })).toBe(
      "open",
    );
  });
});

describe("shape selection", () => {
  it("comes from the address book for known hooks", () => {
    expect(revShareHookRecord(4663, "0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2")?.pendingShape).toBe("block-with-expiry");
  });

  it("can be inferred from CLOCK_MODE and word count for an unknown hook, and refuses the rest", () => {
    expect(inferRevSharePendingShape(TIMESTAMP_CLOCK_MODE, 8)).toBe("timestamp-with-expiry");
    expect(inferRevSharePendingShape(null, 8)).toBe("block-with-expiry");
    expect(inferRevSharePendingShape(null, 7)).toBe("block-no-expiry");
    expect(inferRevSharePendingShape(TIMESTAMP_CLOCK_MODE, 7)).toBeUndefined();
    expect(inferRevSharePendingShape("mode=blocknumber&from=default", 8)).toBeUndefined();
    expect(inferRevSharePendingShape(null, 9)).toBeUndefined();
  });

  it("encodes getPendingConfig(bytes32) with the real selector", () => {
    const data = encodeGetPendingConfig(`0x${"11".repeat(32)}`);
    expect(data.slice(0, 10)).toBe("0x4386ba2f"); // cast sig "getPendingConfig(bytes32)"
    expect(data.length).toBe(2 + 8 + 64);
  });
});
