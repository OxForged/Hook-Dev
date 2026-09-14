// SPDX-License-Identifier: MIT
/* ============================================================================
   The contract-visible block clock.

   Fixtures are the values read off Robinhood Chain (4663) on 2026-09-13:
   eth_blockNumber ~62.4M, header l1BlockNumber and eth_call NUMBER ~25.97M.
   Nothing here reaches the network.
   ============================================================================ */

import { describe, expect, it } from "vitest";
import type { Hex } from "viem";

import {
  CONTRACT_CLOCK_PROBE_CALLDATA,
  LATCH_DEPLOYMENTS,
  blockWindowPhase,
  clockStretch,
  contractBlocksToSeconds,
  decodeContractClockProbe,
  getContractClock,
  readContractBlockNumber,
  readContractClock,
  requireContractClock,
  secondsToContractBlocks,
  type ContractClockClient,
} from "../src/index.js";

const L2_HEAD = 62_356_430n;
const L1_AT_HEAD = 25_971_883n;
const TS = 1_789_343_079n;

const word = (v: bigint): string => v.toString(16).padStart(64, "0");
const probeReturn = (n: bigint, t: bigint): Hex => `0x${word(n)}${word(t)}`;

interface FakeOpts {
  readonly probe?: "ok" | "reverts" | "empty";
  readonly l1BlockNumber?: string | bigint | undefined;
  readonly number?: bigint;
  readonly probeNumber?: bigint;
}

function fakeClient(o: FakeOpts = {}): ContractClockClient & { calls: Hex[] } {
  const calls: Hex[] = [];
  const number = o.number ?? L2_HEAD;
  return {
    calls,
    async getBlockNumber() {
      return number;
    },
    async call({ data }) {
      calls.push(data);
      if (o.probe === "reverts") throw new Error("creation calls not allowed");
      if (o.probe === "empty") return { data: undefined };
      return { data: probeReturn(o.probeNumber ?? L1_AT_HEAD, TS) };
    },
    async getBlock() {
      const b: { number: bigint; timestamp: bigint; l1BlockNumber?: string | bigint } = { number, timestamp: TS };
      if (o.l1BlockNumber !== undefined) b.l1BlockNumber = o.l1BlockNumber;
      return b;
    },
  };
}

describe("address-book clock metadata", () => {
  it("records Robinhood as a parent-L1 clock at 12 s and Sepolia as native", () => {
    expect(LATCH_DEPLOYMENTS[4663].contractBlockClock).toBe("parent-l1");
    expect(LATCH_DEPLOYMENTS[4663].contractBlockTimeCentis).toBe(1200);
    expect(LATCH_DEPLOYMENTS[11155111].contractBlockClock).toBe("native");
    expect(getContractClock(4663)?.contractBlockTimeCentis).toBe(1200);
  });

  it("has no metadata for an unknown chain, and says how to measure it", () => {
    expect(getContractClock(1)).toBeUndefined();
    expect(() => requireContractClock(1)).toThrow(/Measure it/);
  });
});

describe("the probe bytecode", () => {
  it("is NUMBER, MSTORE 0, TIMESTAMP, MSTORE 32, RETURN 64", () => {
    expect(CONTRACT_CLOCK_PROBE_CALLDATA).toBe("0x436000524260205260406000f3");
  });

  it("decodes both words, and refuses a return of the wrong size", () => {
    expect(decodeContractClockProbe(probeReturn(L1_AT_HEAD, TS))).toEqual({ number: L1_AT_HEAD, timestamp: TS });
    expect(() => decodeContractClockProbe(`0x${word(1n)}`)).toThrow(/expected 64/);
  });
});

describe("readContractClock", () => {
  it("on Robinhood returns the EVM's number, not eth_blockNumber", async () => {
    const r = await readContractClock(fakeClient(), 4663);
    expect(r.contractBlockNumber).toBe(L1_AT_HEAD);
    expect(r.rpcBlockNumber).toBe(L2_HEAD);
    expect(r.method).toBe("eth_call NUMBER");
    expect(r.clock).toBe("parent-l1");
    expect(r.timestamp).toBe(TS);
  });

  it("falls back to the header's l1BlockNumber when the RPC refuses creation calls", async () => {
    const c = fakeClient({ probe: "reverts", l1BlockNumber: `0x${L1_AT_HEAD.toString(16)}` });
    const r = await readContractClock(c, 4663);
    expect(r.contractBlockNumber).toBe(L1_AT_HEAD);
    expect(r.method).toBe("header l1BlockNumber");
  });

  it("accepts an l1BlockNumber already formatted as a bigint", async () => {
    const r = await readContractClock(fakeClient({ probe: "empty", l1BlockNumber: L1_AT_HEAD }), 4663);
    expect(r.contractBlockNumber).toBe(L1_AT_HEAD);
  });

  it("NEVER falls back to eth_blockNumber on a parent-L1 chain", async () => {
    await expect(readContractClock(fakeClient({ probe: "reverts" }), 4663)).rejects.toThrow(/NOT a substitute/);
  });

  it("uses eth_blockNumber on a native chain without probing", async () => {
    const c = fakeClient({ number: 11_699_528n });
    const r = await readContractClock(c, 11155111);
    expect(r.contractBlockNumber).toBe(11_699_528n);
    expect(r.method).toBe("eth_blockNumber");
    expect(c.calls).toHaveLength(0);
  });

  it("probes an unknown chain and reports which clock it found", async () => {
    const nitro = await readContractClock(fakeClient(), 42161);
    expect(nitro.clock).toBe("parent-l1");
    const l1 = await readContractClock(fakeClient({ number: 100n, probeNumber: 100n }), 1);
    expect(l1.clock).toBe("native");
    expect(l1.contractBlockNumber).toBe(100n);
  });

  it("readContractBlockNumber is the bare number", async () => {
    expect(await readContractBlockNumber(fakeClient(), 4663)).toBe(L1_AT_HEAD);
  });
});

describe("durations at the real contract cadence", () => {
  it("the live RevShareHook delay of 432,000 blocks is 60 days, not 12 hours", () => {
    expect(contractBlocksToSeconds(432_000n, 4663)).toBe(60 * 86_400);
  });

  it("the live LaunchGuardHook cap of 26,000,000 blocks is ~9.9 years", () => {
    const s = contractBlocksToSeconds(26_000_000n, 4663);
    expect(s).toBe(312_000_000);
    expect(s / (365.25 * 86_400)).toBeCloseTo(9.89, 2);
  });

  it("secondsToContractBlocks rounds up and inverts", () => {
    expect(secondsToContractBlocks(12 * 3600, 4663)).toBe(3_600n);
    expect(secondsToContractBlocks(13, 4663)).toBe(2n);
    expect(contractBlocksToSeconds(secondsToContractBlocks(3 * 86_400, 4663), 4663)).toBe(3 * 86_400);
  });

  it("clockStretch is 120 for the live kit's declared 10 centis", () => {
    expect(clockStretch(10, 4663)).toBe(120);
    expect(clockStretch(1200, 4663)).toBe(1);
  });

  it("refuses negative inputs", () => {
    expect(() => contractBlocksToSeconds(-1n, 4663)).toThrow(RangeError);
    expect(() => secondsToContractBlocks(-1, 4663)).toThrow(RangeError);
  });
});

describe("blockWindowPhase across the clock mismatch", () => {
  /* A proposal made at contract block 25,971,883 on the live hook. */
  const effective = L1_AT_HEAD + 432_000n;
  const expiry = effective + 2_592_000n;

  it("is 'before' against the contract clock", () => {
    expect(blockWindowPhase(effective, expiry, L1_AT_HEAD)).toBe("before");
  });

  it("would be 'closed' against eth_blockNumber — the bug this module removes", () => {
    expect(blockWindowPhase(effective, expiry, L2_HEAD)).toBe("closed");
  });

  it("opens at effective, stays open through expiry inclusive, then closes", () => {
    expect(blockWindowPhase(effective, expiry, effective)).toBe("open");
    expect(blockWindowPhase(effective, expiry, expiry)).toBe("open");
    expect(blockWindowPhase(effective, expiry, expiry + 1n)).toBe("closed");
  });

  it("with no end block, never closes", () => {
    expect(blockWindowPhase(effective, null, effective + 10n ** 9n)).toBe("open");
  });

  it("startBlock 0 means no window", () => {
    expect(blockWindowPhase(0n, null, L1_AT_HEAD)).toBe("none");
  });
});
