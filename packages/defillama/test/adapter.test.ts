import { beforeEach, describe, expect, it } from "vitest";
import adapter, {
  BIN_INITIALIZE_EVENT,
  BIN_SWAP_EVENT,
  CL_INITIALIZE_EVENT,
  CL_SWAP_EVENT,
  chainConfig,
} from "../dimension-adapters/dexs/latch.js";
import type {
  FetchGetLogsOptions,
  FetchOptions,
} from "../dimension-adapters/adapters/types.js";
import { Balances } from "../harness/balances.js";

/**
 * Behavioural tests for the dimension adapter, driven by SYNTHETIC logs.
 *
 * Every number in this file is invented. It exists to pin the adapter's
 * arithmetic and its log-query discipline, not to describe any real trading -
 * Latch has none. See test/sepolia.live.test.ts for what the live deployment
 * actually returns.
 */

const CL = "0x00000000000000000000000000000000000000c1";
const BIN = "0x00000000000000000000000000000000000000b1";
const VAULT = "0x00000000000000000000000000000000000000fa";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // core asset on ethereum
const LONGTAIL = "0x00000000000000000000000000000000deadbeef"; // not a core asset

const CL_POOL = "0x" + "11".repeat(32);
const BIN_POOL = "0x" + "22".repeat(32);

/** 0.1% protocol fee (the live Sepolia default) composed with a 0.3% LP tier. */
const PROTOCOL_FEE = 1000n;
const SWAP_FEE = PROTOCOL_FEE + 3000n - (PROTOCOL_FEE * 3000n) / 1_000_000n; // 3997

interface Recorded {
  target?: string;
  targets?: string[];
  eventAbi?: string;
  fromBlock?: number;
  noTarget?: boolean;
  topics?: string[];
}

function makeOptions(logsFor: (p: FetchGetLogsOptions) => any[]) {
  const calls: Recorded[] = [];
  const options = {
    chain: "ethereum",
    createBalances: () => new Balances({ chain: "ethereum" }),
    getLogs: async (p: FetchGetLogsOptions) => {
      calls.push({
        target: p.target,
        targets: p.targets,
        eventAbi: p.eventAbi,
        fromBlock: p.fromBlock,
        noTarget: p.noTarget,
        topics: p.topics,
      });
      return logsFor(p);
    },
  } as unknown as FetchOptions;
  return { options, calls };
}

const initLog = (id: string, currency0: string, currency1: string, hooks = "0x" + "00".repeat(20)) => ({
  id,
  currency0,
  currency1,
  hooks,
});

const swapLog = (id: string, amount0: bigint, amount1: bigint) => ({
  id,
  sender: "0x" + "99".repeat(20),
  amount0,
  amount1,
  fee: SWAP_FEE,
  protocolFee: PROTOCOL_FEE,
});

beforeEach(() => {
  chainConfig["ethereum"] = {
    vault: VAULT,
    clPoolManager: CL,
    binPoolManager: BIN,
    fromBlock: 100,
    start: "2026-01-01",
    blacklistTokens: [],
  };
});

describe("log query discipline (topic0 collision)", () => {
  it("scopes every query to one pool manager address and its own ABI", async () => {
    const { options, calls } = makeOptions(() => []);
    await adapter.fetch!(options);

    // Two managers x (Initialize scan + Swap window) = four calls.
    expect(calls).toHaveLength(4);

    for (const c of calls) {
      // Never a chain-wide topic scan: that is what would merge CL and Bin, and
      // would also pick up ProtocolFees' identical events from a third address.
      expect(c.noTarget).toBeFalsy();
      expect(c.topics).toBeUndefined();
      expect(c.target).toBeTruthy();
      expect(c.eventAbi).toBeTruthy();
    }

    const byTarget = new Map(calls.map((c) => [`${c.target}|${c.eventAbi}`, c]));
    // Each manager is decoded with ITS OWN abi - the CL Initialize/Swap shapes
    // differ from the Bin ones, and swapping them would decode garbage.
    expect(byTarget.has(`${CL}|${CL_INITIALIZE_EVENT}`)).toBe(true);
    expect(byTarget.has(`${CL}|${CL_SWAP_EVENT}`)).toBe(true);
    expect(byTarget.has(`${BIN}|${BIN_INITIALIZE_EVENT}`)).toBe(true);
    expect(byTarget.has(`${BIN}|${BIN_SWAP_EVENT}`)).toBe(true);
    // and the CL abi is never sent to the Bin manager or vice versa
    expect(byTarget.has(`${BIN}|${CL_SWAP_EVENT}`)).toBe(false);
    expect(byTarget.has(`${CL}|${BIN_SWAP_EVENT}`)).toBe(false);
  });

  it("scans Initialize from the configured deployment block, not the window", async () => {
    const { options, calls } = makeOptions(() => []);
    await adapter.fetch!(options);

    const initCalls = calls.filter((c) => c.eventAbi?.startsWith("event Initialize"));
    const swapCalls = calls.filter((c) => c.eventAbi?.startsWith("event Swap"));
    expect(initCalls.every((c) => c.fromBlock === 100)).toBe(true);
    // Swap queries take the measurement window, so they must NOT pin fromBlock.
    expect(swapCalls.every((c) => c.fromBlock === undefined)).toBe(true);
  });
});

describe("volume and fee accounting", () => {
  const oneEth = 10n ** 18n;

  const logsFor = (p: FetchGetLogsOptions) => {
    if (p.eventAbi?.startsWith("event Initialize")) {
      return p.target === CL
        ? [initLog(CL_POOL, WETH, LONGTAIL)]
        : [initLog(BIN_POOL, WETH, LONGTAIL)];
    }
    // A swapper pays 1 WETH (negative = owed to the pool) and receives long-tail.
    return p.target === CL
      ? [swapLog(CL_POOL, -oneEth, 4200n * oneEth)]
      : [swapLog(BIN_POOL, -oneEth, 4100n * oneEth)];
  };

  it("counts one leg per swap, gross of fees, from both pool managers", async () => {
    const { options } = makeOptions(logsFor);
    const r = await adapter.fetch!(options);
    const volume = r["dailyVolume"] as Balances;

    // WETH is the core asset, so addOneToken prices off it: 1 WETH per swap,
    // two swaps, and the sign of the raw int128 is discarded.
    expect(volume.totals()).toEqual({ [WETH.toLowerCase()]: 2n * oneEth });
  });

  it("satisfies the income-statement identity Fees = Revenue + SupplySideRevenue", async () => {
    const { options } = makeOptions(logsFor);
    const r = await adapter.fetch!(options);

    const fees = (r["dailyFees"] as Balances).totals();
    const revenue = (r["dailyRevenue"] as Balances).totals();
    const supply = (r["dailySupplySideRevenue"] as Balances).totals();

    const token = WETH.toLowerCase();
    expect(fees[token]).toBe((2n * oneEth * SWAP_FEE) / 1_000_000n);
    expect(revenue[token]).toBe((2n * oneEth * PROTOCOL_FEE) / 1_000_000n);
    expect(revenue[token]! + supply[token]!).toBe(fees[token]);
  });

  it("reports user fees equal to total fees and protocol revenue equal to revenue", async () => {
    const { options } = makeOptions(logsFor);
    const r = await adapter.fetch!(options);

    expect((r["dailyUserFees"] as Balances).totals()).toEqual(
      (r["dailyFees"] as Balances).totals(),
    );
    expect((r["dailyProtocolRevenue"] as Balances).totals()).toEqual(
      (r["dailyRevenue"] as Balances).totals(),
    );
    // Latch has no token, so no holders revenue is claimed at all.
    expect(r["dailyHoldersRevenue"]).toBeUndefined();
  });

  it("labels every exported dimension with the label its breakdownMethodology declares", async () => {
    // The SDK's `add(otherBalances, label)` takes the label as its SECOND argument;
    // passing it third throws, and getting the position wrong silently drops the
    // label, which the upstream breakdown validator rejects.
    const { options } = makeOptions(logsFor);
    const r = await adapter.fetch!(options);

    const labelsOf = (key: string) =>
      new Set((r[key] as Balances).list().map((e) => e.label));

    expect(labelsOf("dailyFees")).toEqual(new Set(["Token Swap Fees"]));
    expect(labelsOf("dailyUserFees")).toEqual(new Set(["Token Swap Fees"]));
    expect(labelsOf("dailyRevenue")).toEqual(new Set(["Swap Fees To Protocol"]));
    expect(labelsOf("dailyProtocolRevenue")).toEqual(new Set(["Swap Fees To Protocol"]));
    expect(labelsOf("dailySupplySideRevenue")).toEqual(
      new Set(["Swap Fees To Liquidity Providers"]),
    );
    // dexs/AGENTS.md: "No volume breakdowns: breakdown labels are for fees only."
    expect(labelsOf("dailyVolume")).toEqual(new Set([undefined]));
  });

  it("prices off the long-tail leg only when neither side is a core asset", async () => {
    const other = "0x00000000000000000000000000000000000000aa";
    const { options } = makeOptions((p) =>
      p.eventAbi?.startsWith("event Initialize")
        ? p.target === CL
          ? [initLog(CL_POOL, LONGTAIL, other)]
          : []
        : p.target === CL
          ? [swapLog(CL_POOL, -oneEth, 7n * oneEth)]
          : [],
    );
    const r = await adapter.fetch!(options);
    // addOneToken falls through to token1 when token0 is not a core asset.
    expect((r["dailyVolume"] as Balances).totals()).toEqual({ [other]: 7n * oneEth });
  });

  it("drops swaps for pools it never saw initialized rather than guessing a pair", async () => {
    const { options } = makeOptions((p) =>
      p.eventAbi?.startsWith("event Initialize")
        ? []
        : p.target === CL
          ? [swapLog(CL_POOL, -oneEth, oneEth)]
          : [],
    );
    const r = await adapter.fetch!(options);
    expect((r["dailyVolume"] as Balances).isEmpty()).toBe(true);
  });

  it("honours the shared spam-token blacklist", async () => {
    chainConfig["ethereum"]!.blacklistTokens = [LONGTAIL];
    const { options } = makeOptions(logsFor);
    const r = await adapter.fetch!(options);
    expect((r["dailyVolume"] as Balances).isEmpty()).toBe(true);
  });

  it("throws rather than reporting zero for an unconfigured chain", async () => {
    const { options } = makeOptions(() => []);
    (options as any).chain = "base"; // placeholder row, no addresses
    await expect(adapter.fetch!(options)).rejects.toThrow(/no deployment configured/);
  });
});
