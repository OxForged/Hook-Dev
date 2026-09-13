// SPDX-License-Identifier: MIT
/**
 * Distributor identity (`IEpochDistributor.kind()`) and rollover eligibility.
 *
 * The fake client here dispatches on `functionName` and records every read, so
 * the tests can assert what the tool did NOT call as well as what it did: it
 * must never fall back to the `token()` / `challengeDelay()` selector probe, and
 * it must never read `getEpoch` through an ABI it has not identified.
 */

import { describe, expect, it } from "vitest";
import { keccak256, toHex, type PublicClient } from "viem";

import { DISTRIBUTOR_KIND, kindFromBytes32 } from "../src/abi.js";
import { createContext } from "../src/context.js";
import { maintenanceTool } from "../src/tools/maintenance.js";

const DIST = "0x1111111111111111111111111111111111111111" as const;
const ZERO32 = `0x${"00".repeat(32)}` as const;

describe("kind constants", () => {
  it("match IEpochDistributor.sol byte for byte", () => {
    expect(DISTRIBUTOR_KIND.snapshot).toBe(keccak256(toHex("latch.revshare.distributor.snapshot.v1")));
    expect(DISTRIBUTOR_KIND.merkle).toBe(keccak256(toHex("latch.revshare.distributor.merkle.v1")));
    // Pinned literals, identical to the keeper's decode test, so a refactor that
    // changes the string is caught rather than absorbed.
    expect(DISTRIBUTOR_KIND.snapshot).toBe("0x6c8c753e7c890a8073f5cfa610b29805cf941f79c7bf9c9a8bbac78de7c5a7c1");
    expect(DISTRIBUTOR_KIND.merkle).toBe("0xa4c52bdd5374e29d7759675f0150c74d0a7b6631fa9c38e09feea924a000a516");
  });
});

describe("kindFromBytes32", () => {
  it("is exact-match only", () => {
    expect(kindFromBytes32(DISTRIBUTOR_KIND.snapshot)).toBe("snapshot");
    expect(kindFromBytes32(DISTRIBUTOR_KIND.merkle)).toBe("merkle");
    expect(kindFromBytes32(DISTRIBUTOR_KIND.merkle.toUpperCase().replace("0X", "0x"))).toBe("merkle");
    // Zero is what every wrong answer decodes to. It must never be a kind.
    expect(kindFromBytes32(ZERO32)).toBe("unknown");
    expect(kindFromBytes32(keccak256(toHex("latch.revshare.distributor.snapshot.v2")))).toBe("unknown");
    expect(kindFromBytes32(undefined)).toBe("unknown");
    expect(kindFromBytes32(null)).toBe("unknown");
    expect(kindFromBytes32("0x1234")).toBe("unknown");
    expect(kindFromBytes32(`${DISTRIBUTOR_KIND.merkle}00`)).toBe("unknown");
  });
});

/* ------------------------------------------------------------------------- */

interface Scenario {
  /** What `kind()` returns; an Error makes it revert. */
  readonly kind: unknown;
  readonly now?: bigint;
  readonly epochCount?: bigint;
  /** Nine-field tuple. Fields 4-6 are irrelevant to rollover and left zero. */
  readonly epoch?: {
    amount0?: bigint;
    amount1?: bigint;
    claimed0?: bigint;
    claimed1?: bigint;
    expiresAt?: bigint;
    rolledOver?: boolean;
  };
  readonly rolloverEligibleAt?: bigint;
  /** Make the simulation revert. */
  readonly simulateReverts?: boolean;
}

interface Call {
  readonly method: string;
  readonly functionName?: string;
  /** For getEpoch: the declared type of struct field 4, which is how the two ABIs differ. */
  readonly field4Type?: string;
}

function scenarioClient(s: Scenario): { client: PublicClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    async getBlock() {
      calls.push({ method: "getBlock" });
      return { timestamp: s.now ?? 10_000n };
    },
    async getBlockNumber() {
      calls.push({ method: "getBlockNumber" });
      return 1n;
    },
    async readContract(args: {
      functionName: string;
      abi: readonly { name?: string; outputs?: readonly { components?: readonly { type: string }[] }[] }[];
    }) {
      const fn = args.functionName;
      if (fn === "getEpoch") {
        const entry = args.abi.find((x) => x.name === "getEpoch");
        const field4Type = entry?.outputs?.[0]?.components?.[4]?.type;
        calls.push({ method: "readContract", functionName: fn, ...(field4Type ? { field4Type } : {}) });
      } else {
        calls.push({ method: "readContract", functionName: fn });
      }
      switch (fn) {
        case "kind":
          if (s.kind instanceof Error) throw s.kind;
          return s.kind;
        case "epochCount":
          return s.epochCount ?? 1n;
        case "getEpoch": {
          const e = s.epoch ?? {};
          return [
            e.amount0 ?? 100n,
            e.amount1 ?? 0n,
            e.claimed0 ?? 0n,
            e.claimed1 ?? 0n,
            0n,
            0n,
            0n,
            e.expiresAt ?? 0n,
            e.rolledOver ?? false,
          ];
        }
        case "rolloverEligibleAt":
          if (s.rolloverEligibleAt === undefined) throw new Error("fake: rolloverEligibleAt not set");
          return s.rolloverEligibleAt;
        default:
          throw new Error(`fake: unexpected read ${fn}`);
      }
    },
    async simulateContract(args: { functionName: string }) {
      calls.push({ method: "simulateContract", functionName: args.functionName });
      if (s.simulateReverts) throw new Error("NotExpiredYet(0, 1)");
      return { request: { functionName: args.functionName } };
    },
    async estimateContractGas(args: { functionName: string }) {
      calls.push({ method: "estimateContractGas", functionName: args.functionName });
      return 50_000n;
    },
  };
  return { client: client as unknown as PublicClient, calls };
}

interface RolloverData {
  readonly due: boolean;
  readonly wouldSucceed: boolean;
  readonly sent: boolean;
  readonly reason: string;
}

async function rollover(s: Scenario, epochId = 0): Promise<{ data: RolloverData; calls: Call[] }> {
  const { client, calls } = scenarioClient(s);
  // Simulate-only, which is also the default once maintenance is enabled.
  const tool = maintenanceTool(createContext({ publicClient: client, maintenance: { enabled: true } }));
  const r = await tool.handler({ action: "rollover", distributor: DIST, epochId });
  if (!r.ok) throw new Error(`tool errored: ${JSON.stringify(r.error)}`);
  return { data: r.data as unknown as RolloverData, calls };
}

const readsOf = (calls: readonly Call[]) =>
  calls.filter((c) => c.method === "readContract").map((c) => c.functionName);

describe("rollover: distributor identity", () => {
  const cases: readonly [string, unknown][] = [
    ["a kind() revert", new Error("execution reverted")],
    ["zero", ZERO32],
    ["an unrecognised hash", keccak256(toHex("latch.revshare.distributor.merkle.v2"))],
    ["empty return data", "0x"],
  ];

  for (const [label, kind] of cases) {
    it(`refuses on ${label}, and never falls back to the selector probe`, async () => {
      const { data, calls } = await rollover({ kind });
      expect(data.due).toBe(false);
      expect(data.sent).toBe(false);
      expect(data.reason).toMatch(/could not tell whether/);
      // kind() is the only thing asked. No token(), no challengeDelay(), no
      // getEpoch through a guessed ABI, and certainly no simulation.
      expect(readsOf(calls)).toEqual(["kind"]);
      expect(calls.some((c) => c.method === "simulateContract")).toBe(false);
    });
  }

  it("reads a snapshot epoch through the snapshot ABI", async () => {
    const { calls } = await rollover({ kind: DISTRIBUTOR_KIND.snapshot, epoch: { expiresAt: 99_999n } });
    const getEpoch = calls.find((c) => c.functionName === "getEpoch");
    expect(getEpoch?.field4Type).toBe("uint256");
  });

  it("reads a merkle epoch through the merkle ABI", async () => {
    const { calls } = await rollover({
      kind: DISTRIBUTOR_KIND.merkle,
      epoch: { expiresAt: 99_999n },
      rolloverEligibleAt: 99_999n,
    });
    const getEpoch = calls.find((c) => c.functionName === "getEpoch");
    expect(getEpoch?.field4Type).toBe("bytes32");
  });
});

describe("rollover: eligibility", () => {
  it("snapshot: gates on expiresAt and never calls rolloverEligibleAt", async () => {
    const early = await rollover({ kind: DISTRIBUTOR_KIND.snapshot, now: 1_000n, epoch: { expiresAt: 2_000n } });
    expect(early.data.due).toBe(false);
    expect(early.data.reason).toMatch(/still claimable for another 1000 seconds/);
    expect(readsOf(early.calls)).not.toContain("rolloverEligibleAt");
    expect(early.calls.some((c) => c.method === "simulateContract")).toBe(false);

    const late = await rollover({ kind: DISTRIBUTOR_KIND.snapshot, now: 2_000n, epoch: { expiresAt: 2_000n } });
    expect(late.data.due).toBe(true);
    expect(late.data.sent).toBe(false);
    expect(readsOf(late.calls)).not.toContain("rolloverEligibleAt");
    expect(late.calls.some((c) => c.method === "simulateContract")).toBe(true);
  });

  it("merkle, no root: expiresAt == 0 is NOT due - rolloverEligibleAt governs", async () => {
    // The bug this replaced: `now < expiresAt` with expiresAt == 0 is always
    // false, so a rootless epoch read as due the moment it closed.
    const { data, calls } = await rollover({
      kind: DISTRIBUTOR_KIND.merkle,
      now: 5_000n,
      epoch: { expiresAt: 0n },
      rolloverEligibleAt: 9_000n,
    });
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/no root standing/);
    expect(data.reason).toMatch(/another 4000 seconds/);
    expect(readsOf(calls)).toContain("rolloverEligibleAt");
    expect(calls.some((c) => c.method === "simulateContract")).toBe(false);
  });

  it("merkle: trusts rolloverEligibleAt (e.g. a cancelRoot floor) even one second out", async () => {
    // Nothing is recomputed off chain; the view is the whole answer.
    const { data } = await rollover({
      kind: DISTRIBUTOR_KIND.merkle,
      now: 20_000n,
      epoch: { expiresAt: 0n },
      rolloverEligibleAt: 20_001n,
    });
    expect(data.due).toBe(false);
  });

  it("merkle: past rolloverEligibleAt, simulates before anything else and does not send in simulate mode", async () => {
    const { data, calls } = await rollover({
      kind: DISTRIBUTOR_KIND.merkle,
      now: 9_000n,
      epoch: { expiresAt: 0n },
      rolloverEligibleAt: 9_000n,
    });
    expect(data.due).toBe(true);
    expect(data.wouldSucceed).toBe(true);
    expect(data.sent).toBe(false);
    expect(calls.some((c) => c.method === "simulateContract" && c.functionName === "rollover")).toBe(true);
  });

  it("merkle: a simulation revert is reported as not due, never sent", async () => {
    const { data } = await rollover({
      kind: DISTRIBUTOR_KIND.merkle,
      now: 9_000n,
      epoch: { expiresAt: 0n },
      rolloverEligibleAt: 9_000n,
      simulateReverts: true,
    });
    expect(data.due).toBe(false);
    expect(data.sent).toBe(false);
    expect(data.reason).toMatch(/reverted in simulation/);
  });

  it("eligible but fully claimed is not worth a simulation", async () => {
    const { data, calls } = await rollover({
      kind: DISTRIBUTOR_KIND.merkle,
      now: 9_000n,
      epoch: { expiresAt: 8_000n, amount0: 100n, claimed0: 100n },
      rolloverEligibleAt: 8_000n,
    });
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/fully claimed/);
    expect(calls.some((c) => c.method === "simulateContract")).toBe(false);
  });
});
