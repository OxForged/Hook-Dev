// SPDX-License-Identifier: MIT
/**
 * `RevShareHook.getPendingConfig` has two shapes on chain, and a typed ABI is
 * right on exactly one of them.
 *
 *   legacy   7 words  (effectiveBlock, ConfigParams{6})               Robinhood 0x23CE..E446, Sepolia 0x1C86..BE28
 *   current  8 words  (effectiveBlock, expiryBlock, ConfigParams{6})  Robinhood 0xfC00..2aD2
 *
 * Confirmed on Robinhood (4663) on 2026-09-13 with a raw `cast call` for pool
 * 0xcb1f..50e8: the legacy hook returned 224 bytes, the current one 256, and an
 * 8-field decode of the legacy return failed outright.
 */

import { describe, expect, it } from "vitest";
import { encodeAbiParameters, type Hex, type PublicClient } from "viem";

import { decodePendingConfig } from "../src/abi.js";
import { createContext } from "../src/context.js";
import { maintenanceTool } from "../src/tools/maintenance.js";

const HOOK = "0x23CE34E8199927DD270dddd8579c947542bDE446" as const;
const POOL_ID = "0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8" as const;
const POOL_KEY = {
  currency0: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6",
  currency1: "0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4",
  hooks: HOOK,
  poolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66",
  fee: 3000,
  parameters: "0x00000000000000000000000000000000000000000000000000000000003c0881",
} as const;
const DIST = "0x3333333333333333333333333333333333333333" as const;

const PARAMS_TYPE = {
  type: "tuple",
  components: [
    { type: "uint24" },
    { type: "uint16" },
    { type: "uint16" },
    { type: "uint16" },
    { type: "address" },
    { type: "bool" },
  ],
} as const;

/** A 10% fee, all to the distributor, enabled - the armed proposal hazard item 5 describes. */
const TEN_PCT = [100_000, 0, 0, 10_000, DIST, true] as const;

function legacyReturn(effectiveBlock: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "tuple", components: [{ type: "uint48" }, PARAMS_TYPE] }],
    [[Number(effectiveBlock), TEN_PCT]],
  );
}

function currentReturn(effectiveBlock: bigint, expiryBlock: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "tuple", components: [{ type: "uint48" }, { type: "uint48" }, PARAMS_TYPE] }],
    [[Number(effectiveBlock), Number(expiryBlock), TEN_PCT]],
  );
}

describe("decodePendingConfig", () => {
  it("encodes to the lengths seen on chain", () => {
    expect((legacyReturn(0n).length - 2) / 2).toBe(224);
    expect((currentReturn(0n, 0n).length - 2) / 2).toBe(256);
  });

  it("decodes the 7-word legacy shape with NO expiry, never a fabricated one", () => {
    const p = decodePendingConfig(legacyReturn(123_456n));
    expect(p.shape).toBe("legacy");
    expect(p.effectiveBlock).toBe(123_456n);
    expect(p.expiryBlock).toBeNull();
  });

  it("decodes the 8-word current shape, expiry from word 1 and not from feePips", () => {
    const p = decodePendingConfig(currentReturn(123_456n, 130_656n));
    expect(p.shape).toBe("current");
    expect(p.effectiveBlock).toBe(123_456n);
    expect(p.expiryBlock).toBe(130_656n);
  });

  it("reads the live legacy no-proposal return (224 zero bytes) as no proposal", () => {
    const p = decodePendingConfig(`0x${"00".repeat(224)}`);
    expect(p).toEqual({ shape: "legacy", effectiveBlock: 0n, expiryBlock: null });
  });

  it("refuses every other length instead of guessing", () => {
    expect(() => decodePendingConfig("0x")).toThrow(/0 words/);
    expect(() => decodePendingConfig(`0x${"00".repeat(32 * 6)}`)).toThrow(/6 words/);
    expect(() => decodePendingConfig(`0x${"00".repeat(32 * 9)}`)).toThrow(/9 words/);
    expect(() => decodePendingConfig(`0x${"00".repeat(33)}`)).toThrow(/not a whole number of words/);
    expect(() => decodePendingConfig("0x0" as Hex)).toThrow(/whole bytes/);
  });
});

/* ------------------------------------------------------------------------- */

interface Scenario {
  readonly returnData: Hex | undefined;
  readonly blockNumber: bigint;
}

function hookClient(s: Scenario): { client: PublicClient; methods: string[] } {
  const methods: string[] = [];
  const client = {
    async call() {
      methods.push("call");
      return { data: s.returnData };
    },
    async getBlockNumber() {
      methods.push("getBlockNumber");
      return s.blockNumber;
    },
    async readContract(args: { functionName: string }) {
      // Any typed read of getPendingConfig is the bug this suite exists for.
      throw new Error(`fake: unexpected typed read ${args.functionName}`);
    },
    async simulateContract(args: { functionName: string }) {
      methods.push(`simulate:${args.functionName}`);
      return { request: { functionName: args.functionName } };
    },
    async estimateContractGas() {
      methods.push("estimateContractGas");
      return 60_000n;
    },
  };
  return { client: client as unknown as PublicClient, methods };
}

interface Outcome {
  readonly due: boolean;
  readonly wouldSucceed: boolean;
  readonly sent: boolean;
  readonly reason: string;
}

async function apply(s: Scenario) {
  const { client, methods } = hookClient(s);
  const tool = maintenanceTool(createContext({ publicClient: client, maintenance: { enabled: true } }));
  const r = await tool.handler({ action: "applyPendingConfig", hook: HOOK, poolId: POOL_ID, poolKey: POOL_KEY });
  return { r, methods };
}

async function applyOk(s: Scenario): Promise<{ data: Outcome; methods: string[] }> {
  const { r, methods } = await apply(s);
  if (!r.ok) throw new Error(`tool errored: ${JSON.stringify(r.error)}`);
  return { data: r.data as unknown as Outcome, methods };
}

describe("applyPendingConfig: legacy 7-word hook", () => {
  it("no proposal is not due, and does not simulate", async () => {
    const { data, methods } = await applyOk({ returnData: legacyReturn(0n), blockNumber: 1_000n });
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/no config change is outstanding/);
    expect(methods.some((m) => m.startsWith("simulate"))).toBe(false);
  });

  it("an immature proposal says it will never expire once matured", async () => {
    const { data } = await applyOk({ returnData: legacyReturn(2_000n), blockNumber: 1_000n });
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/1000 block\(s\) to go/);
    expect(data.reason).toMatch(/no expiry/);
  });

  it("a matured proposal far past any would-be expiry is STILL armed and goes to simulation", async () => {
    // Had a missing expiry been read as 0 or as some default, this would be
    // reported "expired" - the dangerous direction, because it tells a reader a
    // 10% cut can no longer land when anyone can land it in the next block.
    const { data, methods } = await applyOk({ returnData: legacyReturn(2_000n), blockNumber: 50_000_000n });
    expect(data.due).toBe(true);
    expect(data.sent).toBe(false);
    expect(data.reason).not.toMatch(/expired/);
    expect(methods).toContain("simulate:applyPendingConfig");
  });
});

describe("applyPendingConfig: current 8-word hook", () => {
  it("inside [effectiveBlock, expiryBlock] simulates", async () => {
    const { data, methods } = await applyOk({ returnData: currentReturn(2_000n, 5_600n), blockNumber: 5_600n });
    expect(data.due).toBe(true);
    expect(methods).toContain("simulate:applyPendingConfig");
  });

  it("past expiryBlock is reported expired and not simulated", async () => {
    const { data, methods } = await applyOk({ returnData: currentReturn(2_000n, 5_600n), blockNumber: 5_601n });
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/expired at block 5600/);
    expect(methods.some((m) => m.startsWith("simulate"))).toBe(false);
  });

  it("an immature proposal reports its expiry", async () => {
    const { data } = await applyOk({ returnData: currentReturn(2_000n, 5_600n), blockNumber: 1_000n });
    expect(data.reason).toMatch(/expires after block 5600/);
  });
});

describe("applyPendingConfig: unrecognised return", () => {
  it("no return data is not a hook, and is not simulated", async () => {
    const { data, methods } = await applyOk({ returnData: undefined, blockNumber: 1_000n });
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/does not answer as a RevShareHook/);
    expect(methods.some((m) => m.startsWith("simulate"))).toBe(false);
  });

  it("an unknown length is a tool error, never a guessed decode", async () => {
    const { r, methods } = await apply({ returnData: `0x${"00".repeat(32 * 9)}`, blockNumber: 1_000n });
    expect(r.ok).toBe(false);
    expect(methods.some((m) => m.startsWith("simulate"))).toBe(false);
  });
});
