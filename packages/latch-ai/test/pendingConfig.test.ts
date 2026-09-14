// SPDX-License-Identifier: MIT
/**
 * `RevShareHook.getPendingConfig` has THREE shapes on chain, and two share a length.
 *
 *   block-no-expiry        7 words  (effectiveBlock, ConfigParams{6})             Robinhood 0x23CE..E446, Sepolia 0x1C86..BE28
 *   block-with-expiry      8 words  (effectiveBlock, expiryBlock, ConfigParams{6}) Robinhood 0xfC00..2aD2
 *   timestamp-with-expiry  8 words  (effectiveAt, expiresAt, ConfigParams{6})      the timestamp build (Option B)
 *
 * The tool resolves the shape from the SDK address book, else a CLOCK_MODE() probe, and
 * compares timestamp proposals with block.timestamp and block proposals with the CONTRACT
 * block number. These tests pin all three, the cross-clock trap, and the refusal to guess.
 */

import { describe, expect, it } from "vitest";
import { ExecutionRevertedError, encodeAbiParameters, type Address, type Hex, type PublicClient } from "viem";

import { createContext } from "../src/context.js";
import { maintenanceTool } from "../src/tools/maintenance.js";

const OLD_HOOK = "0x23CE34E8199927DD270dddd8579c947542bDE446" as const; // block-no-expiry, known on 4663
const FC00_HOOK = "0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2" as const; // block-with-expiry, known on 4663
const NEW_HOOK = "0x00000000000000000000000000000000000071e5" as const; // unknown to the address book
const POOL_ID = "0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8" as const;
const DIST = "0x3333333333333333333333333333333333333333" as const;
const CLOCK_MODE_SELECTOR = "0x4bf5d7e9";

const PARAMS_TYPE = {
  type: "tuple",
  components: [{ type: "uint24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "address" }, { type: "bool" }],
} as const;
/** A 10% fee, all to the distributor, enabled - the armed proposal hazard item 5 describes. */
const TEN_PCT = [100_000, 0, 0, 10_000, DIST, true] as const;

function sevenWords(effective: bigint): Hex {
  return encodeAbiParameters([{ type: "tuple", components: [{ type: "uint48" }, PARAMS_TYPE] }], [[Number(effective), TEN_PCT]]);
}
function eightWords(effective: bigint, expiry: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "tuple", components: [{ type: "uint48" }, { type: "uint48" }, PARAMS_TYPE] }],
    [[Number(effective), Number(expiry), TEN_PCT]],
  );
}
const stringReturn = (s: string): Hex => encodeAbiParameters([{ type: "string" }], [s]);
const word = (v: bigint): string => v.toString(16).padStart(64, "0");

interface Scenario {
  readonly returnData: Hex | undefined;
  /** `block.number` as the hook sees it. */
  readonly blockNumber: bigint;
  /** `block.timestamp`. */
  readonly timestamp?: bigint;
  /** `eth_blockNumber`; defaults to `blockNumber`. On Nitro it is the L2 head and must NOT be used. */
  readonly rpcBlockNumber?: bigint;
  /** What CLOCK_MODE() does: a string, a revert, or a transport failure. */
  readonly clockMode?: string | "revert" | "transport";
}

const TS = 1_789_343_079n;

function hookClient(s: Scenario): { client: PublicClient; methods: string[] } {
  const methods: string[] = [];
  const rpcHead = s.rpcBlockNumber ?? s.blockNumber;
  const ts = s.timestamp ?? TS;
  const client = {
    async call(args: { to?: Address; data: Hex }) {
      if (args.to === undefined) {
        methods.push("probe");
        return { data: `0x${word(s.blockNumber)}${word(ts)}` as Hex };
      }
      if (args.data === CLOCK_MODE_SELECTOR) {
        methods.push("CLOCK_MODE");
        if (s.clockMode === "revert" || s.clockMode === undefined) throw new ExecutionRevertedError({ message: "execution reverted" });
        if (s.clockMode === "transport") throw new Error("fetch failed: 429");
        return { data: stringReturn(s.clockMode) };
      }
      methods.push("call");
      return { data: s.returnData };
    },
    async getBlockNumber() {
      methods.push("getBlockNumber");
      return rpcHead;
    },
    async getBlock() {
      methods.push("getBlock");
      return { number: rpcHead, timestamp: ts };
    },
    async readContract(args: { functionName: string }) {
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

function poolKey(hook: Address) {
  return {
    currency0: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6",
    currency1: "0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4",
    hooks: hook,
    poolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66",
    fee: 3000,
    parameters: "0x00000000000000000000000000000000000000000000000000000000003c0881",
  } as const;
}

async function apply(s: Scenario, hook: Address, chainId = 4663) {
  const { client, methods } = hookClient(s);
  const base = createContext({ publicClient: client, maintenance: { enabled: true } });
  const tool = maintenanceTool({ ...base, chainId });
  const r = await tool.handler({ action: "applyPendingConfig", hook, poolId: POOL_ID, poolKey: poolKey(hook) });
  return { r, methods };
}

async function applyOk(s: Scenario, hook: Address, chainId = 4663): Promise<{ data: Outcome; methods: string[] }> {
  const { r, methods } = await apply(s, hook, chainId);
  if (!r.ok) throw new Error(`tool errored: ${JSON.stringify(r.error)}`);
  return { data: r.data as unknown as Outcome, methods };
}

const simulated = (m: string[]) => m.some((x) => x.startsWith("simulate"));

describe("block-no-expiry (0x23CE, from the address book)", () => {
  it("no proposal is not due, and does not simulate or probe", async () => {
    const { data, methods } = await applyOk({ returnData: sevenWords(0n), blockNumber: 1_000n }, OLD_HOOK);
    expect(data.reason).toMatch(/no config change is outstanding/);
    expect(simulated(methods)).toBe(false);
    expect(methods).not.toContain("CLOCK_MODE");
  });

  it("an immature proposal says it will never expire once matured", async () => {
    const { data } = await applyOk({ returnData: sevenWords(2_000n), blockNumber: 1_000n }, OLD_HOOK);
    expect(data.reason).toMatch(/1000 contract block\(s\) to go/);
    expect(data.reason).toMatch(/no expiry/);
  });

  it("a matured proposal far past any would-be expiry is STILL armed and goes to simulation", async () => {
    const { data, methods } = await applyOk({ returnData: sevenWords(2_000n), blockNumber: 50_000_000n }, OLD_HOOK);
    expect(data.due).toBe(true);
    expect(data.reason).not.toMatch(/expired/);
    expect(methods).toContain("simulate:applyPendingConfig");
  });
});

describe("block-with-expiry (0xfC00) on Robinhood's two clocks", () => {
  const L1 = 25_971_883n;
  const L2 = 62_356_430n;
  const effective = L1 + 432_000n;
  const expiry = effective + 2_592_000n;

  it("a queued proposal is NOT DUE against the contract clock, even though the L2 head is past expiry", async () => {
    const { data, methods } = await applyOk({ returnData: eightWords(effective, expiry), blockNumber: L1, rpcBlockNumber: L2 }, FC00_HOOK);
    expect(L2 > expiry).toBe(true);
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/432000 contract block\(s\) to go/);
    expect(methods).not.toContain("getBlockNumber");
    expect(simulated(methods)).toBe(false);
  });

  it("inside the window simulates; past it is expired", async () => {
    const inside = await applyOk({ returnData: eightWords(effective, expiry), blockNumber: expiry, rpcBlockNumber: L2 }, FC00_HOOK);
    expect(inside.data.due).toBe(true);
    const past = await applyOk({ returnData: eightWords(effective, expiry), blockNumber: expiry + 1n, rpcBlockNumber: L2 }, FC00_HOOK);
    expect(past.data.reason).toMatch(/expired at contract block/);
    expect(simulated(past.methods)).toBe(false);
  });
});

describe("timestamp-with-expiry (an unknown hook identified by CLOCK_MODE)", () => {
  const effective = TS + 43_200n;
  const expiry = effective + 259_200n;

  it("is judged on block.timestamp: queued, with the time in its own unit", async () => {
    const { data, methods } = await applyOk(
      { returnData: eightWords(effective, expiry), blockNumber: 30_000_000n, clockMode: "mode=timestamp" },
      NEW_HOOK,
    );
    expect(methods).toContain("CLOCK_MODE");
    expect(data.due).toBe(false);
    expect(data.reason).toMatch(/43200 second\(s\) to go/);
    expect(data.reason).toMatch(/block\.timestamp/);
  });

  it("THE TRAP: the same 8 words from a block hook would read 'expired since 1970' - this one simulates when due", async () => {
    const { data, methods } = await applyOk(
      { returnData: eightWords(effective, expiry), blockNumber: 30_000_000n, timestamp: effective, clockMode: "mode=timestamp" },
      NEW_HOOK,
    );
    expect(data.due).toBe(true);
    expect(methods).toContain("simulate:applyPendingConfig");
  });

  it("past expiresAt is expired", async () => {
    const { data } = await applyOk(
      { returnData: eightWords(effective, expiry), blockNumber: 1n, timestamp: expiry + 1n, clockMode: "mode=timestamp" },
      NEW_HOOK,
    );
    expect(data.reason).toMatch(/expired at .*block\.timestamp/);
  });
});

describe("refusals", () => {
  it("an unknown hook whose CLOCK_MODE reverts and returns 8 words is read as block-with-expiry", async () => {
    const { data } = await applyOk({ returnData: eightWords(2_000n, 5_600n), blockNumber: 1_000n, clockMode: "revert" }, NEW_HOOK);
    expect(data.reason).toMatch(/contract block\(s\) to go/);
  });

  it("a transport failure on the probe is a tool error, never read as a revert", async () => {
    const { r, methods } = await apply({ returnData: eightWords(2_000n, 5_600n), blockNumber: 1_000n, clockMode: "transport" }, NEW_HOOK);
    expect(r.ok).toBe(false);
    expect(simulated(methods)).toBe(false);
  });

  it("an unknown length is a tool error, never a guessed decode", async () => {
    const { r, methods } = await apply({ returnData: `0x${"00".repeat(32 * 9)}`, blockNumber: 1_000n, clockMode: "revert" }, NEW_HOOK);
    expect(r.ok).toBe(false);
    expect(simulated(methods)).toBe(false);
  });

  it("a known hook whose return contradicts its recorded shape is a tool error", async () => {
    const { r } = await apply({ returnData: eightWords(2_000n, 5_600n), blockNumber: 1_000n }, OLD_HOOK);
    expect(r.ok).toBe(false);
  });

  it("no return data is not a hook, and is not simulated", async () => {
    const { data, methods } = await applyOk({ returnData: undefined, blockNumber: 1_000n }, NEW_HOOK);
    expect(data.reason).toMatch(/does not answer as a RevShareHook/);
    expect(simulated(methods)).toBe(false);
  });
});
