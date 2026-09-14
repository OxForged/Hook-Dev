import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LATCH_DEPLOYMENTS } from "@latchprotocol/sdk";
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { classifyTimelockCall, collectionVia, decodeLog, type IndexedEvent, type RawLog } from "../src/chain/decode.js";
import { COLLECT_SELECTOR, SWEEP_SELECTOR } from "../src/chain/abis.js";
import { revShareHooksFor, staticContractsFor, topicsForRole } from "../src/chain/deployments.js";
import { buildWindowRows } from "../src/indexer/rows.js";
import { splitSwap } from "../src/lib/units.js";
import { FIXTURE_ADDRESSES, FIXTURE_CHAIN_ID, fixtureLogs } from "./fixtures/devnet.js";

/**
 * REAL chain data: the receipt of Robinhood Chain (4663) tx
 * 0x68286e9b10e1e4d7e42adc9bc02bda0484ac53f6943dc8cd37cfd1d959bc629a, the first
 * swap on the LTT1/LTT2 reference pool (block 60,244,152), read with
 * eth_getTransactionReceipt on 2026-09-13.
 */
interface Receipt {
  blockNumber: string;
  blockHash: Hex;
  transactionIndex: number;
  timestamp: string;
  logs: { address: Hex; topics: Hex[]; data: Hex; logIndex: number }[];
}
const receipt = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/robinhood-swap-0x68286e9b.json", import.meta.url)), "utf8"),
) as Receipt;
const TX = "0x68286e9b10e1e4d7e42adc9bc02bda0484ac53f6943dc8cd37cfd1d959bc629a" as Hex;
const d = LATCH_DEPLOYMENTS[4663];

const raw = (i: number): RawLog => {
  const l = receipt.logs[i]!;
  return {
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: BigInt(receipt.blockNumber),
    blockHash: receipt.blockHash,
    transactionHash: TX,
    transactionIndex: receipt.transactionIndex,
    logIndex: l.logIndex,
  };
};

const E18 = 10n ** 18n;
const LTT1 = "0x2a21c0826848f2d597b7c87a4b931de1407958a6";
const LTT2 = "0xa29927045bdffd61b8f539d491085f1b6f7a8be4";
const DEMO_POOL = "0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8";

describe("Swap sign convention, on the real Robinhood swap", () => {
  const swapLog = raw(0);
  const decoded = decodeLog(4663, "clPoolManager", swapLog);

  it("decodes the CLPoolManager Swap", () => {
    expect(swapLog.address).toBe(d.clPoolManager.toLowerCase());
    expect(decoded.ok).toBe(true);
    const e = (decoded as { event: IndexedEvent }).event;
    expect(e.kind).toBe("Swap");
  });

  it("amount0 is -1e18: the caller PAID 1 LTT1 in (caller-side delta, negative = paid in)", () => {
    const e = (decoded as { event: Extract<IndexedEvent, { kind: "Swap" }> }).event;
    expect(e.poolId).toBe(DEMO_POOL);
    expect(e.amount0).toBe(-E18);
    expect(e.amount1).toBe(996006981039903216n);
    expect(e.fee).toBe(3000);
    expect(e.protocolFee).toBe(0);
  });

  it("the same tx moved exactly 1e18 LTT1 INTO the Vault, proving the sign", () => {
    const transfer = receipt.logs[4]!;
    expect(transfer.address).toBe(LTT1);
    // Transfer(from, to=Vault, value)
    expect(`0x${transfer.topics[2]!.slice(26)}`).toBe(d.vault.toLowerCase());
    expect(BigInt(transfer.data)).toBe(E18);
  });

  it("splitSwap: zeroForOne, 1e18 in, fee from the swap's own 3000 pips, all to LPs", () => {
    const split = splitSwap(-E18, 996006981039903216n, 3000, 0)!;
    expect(split.zeroForOne).toBe(true);
    expect(split.inputIndex).toBe(0);
    expect(split.amountIn).toBe(E18);
    expect(split.amountOut).toBe(996006981039903216n);
    expect(split.feeTotal).toBe(3n * 10n ** 15n);
    expect(split.feeProtocol).toBe(0n);
    expect(split.feeLp).toBe(3n * 10n ** 15n);
  });
});

describe("RevShareTaken on the same transaction", () => {
  it("decodes only under the revShareHook role, from the retired hook bound to the pool", () => {
    const log = raw(3);
    expect(log.address).toBe("0x23ce34e8199927dd270dddd8579c947542bde446");
    const r = decodeLog(4663, "revShareHook", log);
    expect(r.ok).toBe(true);
    const e = (r as { event: Extract<IndexedEvent, { kind: "RevShareTaken" }> }).event;
    expect(e.kind).toBe("RevShareTaken");
    expect(e.poolId).toBe(DEMO_POOL);
    expect(e.currency).toBe(LTT2);
    expect(e.lpDonated).toBe(0x21f8491611445n);
    expect(e.toBeneficiaries).toBe(0x87e1245845117n);
    expect(e.toDistributor).toBe(0n);
  });

  it("the cut comes out of the output leg: amount1 - cut = what the Vault paid the trader", () => {
    const cut = 0x21f8491611445n + 0x87e1245845117n;
    const paidOut = BigInt(receipt.logs[5]!.data);
    expect(996006981039903216n - cut).toBe(paidOut);
  });

  it("revShareHooksFor adds the reference pool's hook to the address-book hook", () => {
    const hooks = revShareHooksFor(d, "0x23CE34E8199927DD270dddd8579c947542bDE446");
    expect(hooks).toContain(d.revShareHook.toLowerCase());
    expect(hooks).toContain("0x23ce34e8199927dd270dddd8579c947542bde446");
    expect(revShareHooksFor(d, `0x${"0".repeat(40)}`)).toEqual([d.revShareHook.toLowerCase()]);
  });
});

describe("decoding is keyed on role, never topic0 alone", () => {
  it("refuses a CL Swap under the bin role", () => {
    expect(decodeLog(4663, "binPoolManager", raw(0)).ok).toBe(false);
  });

  it("refuses a RevShareTaken presented as a pool-manager log", () => {
    expect(decodeLog(4663, "clPoolManager", raw(3)).ok).toBe(false);
  });

  it("does not index the CL Donate the hook emitted (not in the watched set)", () => {
    const r = decodeLog(4663, "clPoolManager", raw(1));
    expect(r.ok).toBe(false);
  });

  it("every watched event name resolves to a topic in the SDK or local ABI", () => {
    for (const c of staticContractsFor(d)) {
      expect(topicsForRole(c.role).length).toBe(c.events.length);
    }
    expect(topicsForRole("revShareHook")).toHaveLength(2);
  });

  it("decodes the synthetic devnet pool-manager logs (test fixture) without loss", () => {
    const pm = fixtureLogs().filter((l) => l.address === FIXTURE_ADDRESSES.clPoolManager || l.address === FIXTURE_ADDRESSES.binPoolManager);
    const swaps = pm
      .map((l) => decodeLog(FIXTURE_CHAIN_ID, l.address === FIXTURE_ADDRESSES.clPoolManager ? "clPoolManager" : "binPoolManager", l))
      .flatMap((r) => (r.ok && r.event.kind === "Swap" ? [r.event] : []));
    expect(swaps.length).toBe(240);
    for (const s of swaps) expect(s.amount0 < 0n).not.toBe(s.amount1 < 0n);
  });
});

describe("buildWindowRows on the real receipt", () => {
  const events = [decodeLog(4663, "clPoolManager", raw(0)), decodeLog(4663, "revShareHook", raw(3))].flatMap((r) => (r.ok ? [r.event] : []));
  const base = {
    chainId: 4663,
    timestamps: new Map([[BigInt(receipt.blockNumber), BigInt(receipt.timestamp)]]),
    txInputs: new Map<string, Hex>(),
    txFrom: new Map<string, Hex>([[TX, "0x304b0cc019cdba6c7c767d86a2a34e69fdb3c9a9"]]),
    protocolBeneficiaries: new Set([d.governanceSafe.toLowerCase()]),
    timelockTier: new Map<string, string>(),
  };

  it("writes a swap with tokenIn = LTT1 and the LP/protocol split, and the cut row", () => {
    const rows = buildWindowRows({ ...base, poolCurrencies: new Map([[DEMO_POOL, { currency0: LTT1 as Hex, currency1: LTT2 as Hex }]]) }, events);
    expect(rows.orphans).toBe(0);
    expect(rows.swaps).toHaveLength(1);
    const s = rows.swaps[0]!;
    expect(s.id).toBe(`4663-${TX}-40`);
    expect(s.tokenIn).toBe(LTT1);
    expect(s.tokenOut).toBe(LTT2);
    expect(s.zeroForOne).toBe(true);
    expect(s.amountIn).toBe(E18.toString());
    expect(s.feeTotal).toBe("3000000000000000");
    expect(s.feeProtocol).toBe("0");
    expect(s.feeLp).toBe("3000000000000000");
    expect(s.txFrom).toBe("0x304b0cc019cdba6c7c767d86a2a34e69fdb3c9a9");
    expect(s.blockNumber).toBe(60244152n);
    expect(rows.revShareTakes).toHaveLength(1);
    expect(rows.revShareTakes[0]!.hook).toBe("0x23ce34e8199927dd270dddd8579c947542bde446");
  });

  it("is deterministic: the same inputs build identical rows (range replacement relies on it)", () => {
    const ctx = { ...base, poolCurrencies: new Map([[DEMO_POOL, { currency0: LTT1 as Hex, currency1: LTT2 as Hex }]]) };
    expect(JSON.stringify(buildWindowRows(ctx, events), (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      JSON.stringify(buildWindowRows(ctx, events), (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  });

  it("counts a swap for an unknown pool as an orphan instead of guessing its tokens", () => {
    const rows = buildWindowRows({ ...base, poolCurrencies: new Map() }, events);
    expect(rows.swaps).toHaveLength(0);
    expect(rows.orphans).toBe(1);
  });

  it("refuses a window with a log whose block has no timestamp", () => {
    expect(() => buildWindowRows({ ...base, timestamps: new Map(), poolCurrencies: new Map() }, events)).toThrow(/no timestamp/);
  });
});

describe("governance and fee-collection classification", () => {
  it("flags CLAUDE.md do-not-queue selectors", () => {
    expect(classifyTimelockCall("0x715018a6").hazard).toBe("renounceOwnership");
    expect(classifyTimelockCall("0x64d62353" + "0".repeat(64) as Hex).hazard).toBe("updateDelay");
    expect(classifyTimelockCall("0x2f2ff15d" + "0".repeat(128) as Hex).hazard).toBe("grantRole");
    expect(classifyTimelockCall("0xf2fde38b" + "0".repeat(64) as Hex).hazard).toBeNull();
    expect(classifyTimelockCall(null).selector).toBeNull();
  });

  it("tells collect() from sweep() by the outer transaction input", () => {
    expect(collectionVia(`${COLLECT_SELECTOR}00` as Hex)).toBe("COLLECT");
    expect(collectionVia(`${SWEEP_SELECTOR}00` as Hex)).toBe("SWEEP");
    expect(collectionVia("0x6a761202" as Hex)).toBe("INNER_CALL");
    expect(collectionVia(undefined)).toBe("INNER_CALL");
  });
});
