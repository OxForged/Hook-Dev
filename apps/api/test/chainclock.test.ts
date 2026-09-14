import { blockWindowPhase, readContractClock, type ContractClockClient } from "@latchprotocol/sdk";
import { encodeAbiParameters, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { decodePendingConfig, proposalStatus } from "../src/chain/pendingConfig.js";
import { ownershipChecks, staleness } from "../src/indexer/governance.js";
import { LATCH_DEPLOYMENTS } from "@latchprotocol/sdk";

const ADDR = "0x1111111111111111111111111111111111111111";
const params = [3000, 1000, 5000, 0, ADDR, true] as const;
const P = { type: "tuple", components: [
  { name: "feePips", type: "uint24" }, { name: "lpDonateBps", type: "uint16" }, { name: "beneficiaryBps", type: "uint16" },
  { name: "distributorBps", type: "uint16" }, { name: "distributor", type: "address" }, { name: "enabled", type: "bool" },
] } as const;

describe("getPendingConfig, decoded by return length", () => {
  it("decodes the legacy 7-word shape with NO expiry", () => {
    const data = encodeAbiParameters([{ type: "tuple", components: [{ name: "e", type: "uint48" }, { ...P, name: "p" }] }], [
      { e: 25_972_500, p: { feePips: params[0], lpDonateBps: params[1], beneficiaryBps: params[2], distributorBps: params[3], distributor: params[4], enabled: params[5] } },
    ]);
    expect((data.length - 2) / 64).toBe(7);
    const d = decodePendingConfig(data);
    expect(d.shape).toBe("legacy");
    expect(d.expiryBlock).toBeNull();
    expect(d.params.feePips).toBe(3000);
  });

  it("decodes the current 8-word shape", () => {
    const data = encodeAbiParameters(
      [{ type: "tuple", components: [{ name: "e", type: "uint48" }, { name: "x", type: "uint48" }, { ...P, name: "p" }] }],
      [{ e: 26_000_000, x: 26_216_000, p: { feePips: params[0], lpDonateBps: params[1], beneficiaryBps: params[2], distributorBps: params[3], distributor: params[4], enabled: params[5] } }],
    );
    const d = decodePendingConfig(data);
    expect(d.shape).toBe("current");
    expect(d.expiryBlock).toBe(26_216_000n);
    expect(d.params.feePips).toBe(3000);
  });

  it("refuses any other length rather than guessing", () => {
    expect(() => decodePendingConfig(`0x${"00".repeat(32 * 6)}` as Hex)).toThrow();
  });

  it("judges status on the CONTRACT clock; the L2 head would call a queued proposal expired", () => {
    const p = { effectiveBlock: 26_000_000n, expiryBlock: 26_216_000n };
    const contractBlock = 25_972_155n; // Ethereum L1 number contracts see on Robinhood
    const rpcHead = 62_388_681n; // eth_blockNumber, the L2 log clock
    expect(proposalStatus(p, contractBlock)).toBe("QUEUED");
    expect(proposalStatus(p, rpcHead)).toBe("EXPIRED"); // the bug this rule prevents
    expect(proposalStatus({ effectiveBlock: 25_000_000n, expiryBlock: null }, contractBlock)).toBe("ARMED");
    expect(proposalStatus({ effectiveBlock: 0n, expiryBlock: null }, contractBlock)).toBe("NONE");
  });
});

describe("SDK contract clock is what launch phases use", () => {
  it("reads NUMBER via the probe, not eth_blockNumber, on a parent-l1 chain", async () => {
    const word = (n: bigint) => n.toString(16).padStart(64, "0");
    const client: ContractClockClient = {
      getBlockNumber: async () => 62_388_681n,
      call: async () => ({ data: `0x${word(25_972_155n)}${word(1_789_128_381n)}` as Hex }),
      getBlock: async () => ({ number: 62_388_681n, timestamp: 1_789_128_381n }),
    };
    const r = await readContractClock(client, 4663);
    expect(r.contractBlockNumber).toBe(25_972_155n);
    expect(r.rpcBlockNumber).toBe(62_388_681n);
    expect(blockWindowPhase(25_980_000n, 25_990_000n, r.contractBlockNumber)).toBe("before");
    expect(blockWindowPhase(25_980_000n, 25_990_000n, r.rpcBlockNumber)).toBe("closed");
  });
});

describe("governance snapshot rules", () => {
  it("encodes the CLAUDE.md ownership table as checks against SDK tiers", () => {
    const d = LATCH_DEPLOYMENTS[4663];
    const checks = ownershipChecks(d, "0xe65f304e40b61d7417154cb3e725c0ee16701142");
    const vault = checks.find((c) => c.contractKey === "vault" && c.check === "owner")!;
    expect(vault.expected.address).toBe(d.timelockCustody.toLowerCase());
    const fee = checks.find((c) => c.contractKey === "feeController" && c.check === "owner")!;
    expect(fee.expected.address).toBe(d.governanceSafe.toLowerCase());
    expect(checks.some((c) => c.check.startsWith("hasRole:CANCELLER_ROLE:0xe65f"))).toBe(true);
    expect(checks.some((c) => c.check === `hasRole:EXECUTOR_ROLE:0x${"0".repeat(40)}`)).toBe(true);
  });

  it("flags feed staleness exactly like the keeper feed-watch", () => {
    expect(staleness(1_000, 900, 86_400)).toEqual({ stalenessSeconds: 100, heartbeatViolation: false });
    expect(staleness(200_000, 100, 86_400).heartbeatViolation).toBe(true);
  });
});
