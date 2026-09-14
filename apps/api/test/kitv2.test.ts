import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LATCH_DEPLOYMENTS } from "@latchprotocol/sdk";
import { Prisma } from "@prisma/client";
import request from "supertest";
import { decodeFunctionData, encodeFunctionResult, getAddress, toFunctionSelector, type Abi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { AdminKitV2Service, kitFeeChecks, readKitChainState } from "../src/admin/kitV2.js";
import { classifyLaunchFeeChange, prepareCancelPendingLaunchFee, prepareSetLaunchFee } from "../src/admin/safeTx.js";
import { revenueSourcesFor } from "../src/admin/service.js";
import type { TreasuryClient } from "../src/admin/treasury/chain.js";
import type { Simulator } from "../src/admin/simulate.js";
import { KIT_V2_FUNCTIONS_ABI } from "../src/chain/abis.js";
import { decodeLog, type IndexedEvent, type RawLog } from "../src/chain/decode.js";
import { addressSetHash, CORE_EVENTS, kitV2ContractsFor, staticContractsFor, topicsForRole, type WatchRole } from "../src/chain/deployments.js";
import { chainConfig, kitV2Addresses, parseChainConfig, type KitV2Addresses } from "../src/config/chainConfig.js";
import { buildWindowRows, rowCount } from "../src/indexer/rows.js";
import { deriveLaunchFeeState, KitV2ReadService, NATIVE, type LaunchFeeEventRow } from "../src/services/kitV2.js";
import { buildAdminApp, fakePrisma, ORIGIN, signIn } from "./helpers/adminApp.js";

/**
 * Kit v2 and the LP lockers, tested against logs the REAL contracts emitted.
 *
 * test/fixtures/kitv2-logs.forge.json was captured with vm.recordLogs in a forge test
 * that drives packages/launchpad/test/kitv2/KitV2Fixture.sol (real Vault, pool
 * managers, position managers, guards, registries, LaunchpadKitV2, LatchLPLocker,
 * LatchBinLPLocker). address/topics/data are encoder output; only block numbers,
 * timestamps (vm.roll/vm.warp), tx hashes and log indexes were assigned by the
 * harness. See `_provenance` inside the file.
 */

interface ForgeLog { step: string; blockNumber: string; timestamp: string; transactionHash: Hex; transactionIndex: number; logIndex: number; address: Hex; topics: Hex[]; data: Hex }
const F = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/kitv2-logs.forge.json", import.meta.url)), "utf8")) as { addresses: Record<string, string>; logs: ForgeLog[] };
const A = F.addresses as Record<string, Hex>;
const d = LATCH_DEPLOYMENTS[4663];
const E15 = 10n ** 15n;
const SAFE = A.safe!; // the fixture's FakeSafe: protocolFeeRecipient and both lockers' protocolRecipient
const CFG: KitV2Addresses = { kit: A.kit!, clLocker: A.clLocker!, binLocker: A.binLocker!, verification: "test fixture: addresses deployed inside the forge harness, not on any chain" };
const lookup = (chainId: number) => (chainId === 4663 ? CFG : null);

const roleOf = (a: string): WatchRole => (a === A.kit ? "launchpadKitV2" : a === A.clLocker ? "clLpLocker" : a === A.binLocker ? "binLpLocker" : (() => { throw new Error(`unknown emitter ${a}`); })());
const raw = (l: ForgeLog): RawLog => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: BigInt(l.blockNumber), blockHash: `0x${"00".repeat(32)}`, transactionHash: l.transactionHash, transactionIndex: l.transactionIndex, logIndex: l.logIndex });
const decodeAll = () =>
  F.logs.map((l) => {
    const r = decodeLog(4663, roleOf(l.address), raw(l));
    if (!r.ok) throw new Error(`${l.step} log ${l.logIndex} did not decode: ${r.reason}`);
    return { step: l.step, event: r.event };
  });
const EVENTS = decodeAll();
const inStep = (step: string) => EVENTS.filter((e) => e.step === step).map((e) => e.event);
const one = <K extends IndexedEvent["kind"]>(step: string, kind: K, pred: (e: Extract<IndexedEvent, { kind: K }>) => boolean = () => true) => {
  const hits = inStep(step).filter((e): e is Extract<IndexedEvent, { kind: K }> => e.kind === kind && pred(e as Extract<IndexedEvent, { kind: K }>));
  expect(hits, `${step} ${kind}`).toHaveLength(1);
  return hits[0]!;
};
const tsOf = (step: string) => BigInt(F.logs.find((l) => l.step === step)!.timestamp);

describe("decoding the real kit v2 and locker logs", () => {
  it("every captured log decodes under its emitter's role, and every watched event name appears", () => {
    expect(EVENTS).toHaveLength(F.logs.length);
    const names = new Set(F.logs.map((l) => `${roleOf(l.address)}:${l.topics[0]}`));
    for (const role of ["launchpadKitV2", "clLpLocker", "binLpLocker"] as const) {
      const topics = topicsForRole(role);
      expect(topics).toHaveLength(CORE_EVENTS[role].length);
      const missing = CORE_EVENTS[role].filter((_n, i) => !names.has(`${role}:${topics[i]}`));
      // Not emitted by the scenario: OwnershipTransferStarted, and the Bin locker's claim/skim/rotation
      // events (signature-identical to the CL locker's, and diffed against the artifact in abis.test.ts).
      expect(missing).toEqual(role === "launchpadKitV2" ? ["OwnershipTransferStarted"] : role === "binLpLocker" ? ["Claimed", "Skimmed", "CreatorTransferStarted", "CreatorTransferred"] : []);
    }
  });

  it("LaunchCreated (tenant launch A): the fees and supplies frozen at creation", () => {
    const e = one("launchA", "KitLaunchCreated");
    expect(e.token).toBe(A.tokenA);
    expect(e.creator).toBe(A.creator);
    expect(e.tenant).toBe(A.tenant);
    expect(e.launcher).toBe(A.launcher);
    expect(e.operator).toBe(A.operator);
    expect(e.totalSupply).toBe(1_000_000_000n * 10n ** 18n);
    expect(e.seedSupply).toBe(800_000_000n * 10n ** 18n);
    expect(e.legCount).toBe(2);
    expect(e.protocolFeeWei).toBe(E15);
    expect(e.integrator).toBe(A.integrator);
    expect(e.integratorFeeWei).toBe(E15);
    // startTime is WALL CLOCK: the block timestamp of the launch + the fixture's 120 s start delay.
    expect(e.startTime).toBe(tsOf("launchA") + 120n);
  });

  it("LaunchCreated (direct native launch B) has no tenant and no integrator", () => {
    const e = one("launchB", "KitLaunchCreated");
    expect(e.tenant).toBe(NATIVE);
    expect(e.integrator).toBe(NATIVE);
    expect(e.integratorFeeWei).toBe(0n);
    expect(e.legCount).toBe(1);
  });

  it("LaunchLegCreated carries the KIT's address (emitted from the linked library) and both kinds", () => {
    const cl = one("launchA", "KitLaunchLegCreated", (x) => x.legKind === "CL");
    const bin = one("launchA", "KitLaunchLegCreated", (x) => x.legKind === "BIN");
    expect(cl.meta.contract).toBe(A.kit);
    expect(cl.poolId).toBe(A.poolA0);
    expect(bin.poolId).toBe(A.poolA1);
    expect([cl.weightBps, bin.weightBps]).toEqual([6_000, 4_000]);
    expect(cl.quote).toBe(A.quote);
    expect(cl.lockId).toBe(BigInt(A.lockA0!));
    expect(bin.lockId).toBe(BigInt(A.lockA1!));
    expect(cl.launchTokenSeeded).toBeGreaterThan(0n);
    expect(one("launchB", "KitLaunchLegCreated").quote).toBe(NATIVE);
  });

  it("PositionLocked and BinsLocked: the split each lock froze, matching the launch", () => {
    const cl = one("launchA", "LpLocked", (x) => x.lockerKind === "CL");
    expect(cl.meta.contract).toBe(A.clLocker);
    expect([cl.creatorBps, cl.integratorBps, cl.protocolBps]).toEqual([7_000, 1_000, 2_000]);
    expect(cl.integrator).toBe(A.integrator);
    expect(cl.creator).toBe(A.creator);
    expect(cl.poolId).toBe(A.poolA0);
    expect(cl.from).toBe(A.kit);
    expect(cl.liquidity).toBeGreaterThan(0n);
    const bin = one("launchA", "LpLocked", (x) => x.lockerKind === "BIN");
    expect(bin.meta.contract).toBe(A.binLocker);
    expect(bin.binIds).toHaveLength(10);
    expect(bin.shares).toHaveLength(10);
    expect(bin.principals).toHaveLength(10);
    expect(bin.binIds.map(BigInt)).toEqual([...bin.binIds.map(BigInt)].sort((a, b) => (a < b ? -1 : 1)));
    const b = one("launchB", "LpLocked");
    expect([b.creatorBps, b.integratorBps, b.protocolBps, b.integrator]).toEqual([8_000, 0, 2_000, NATIVE]);
  });

  it("FeesCollected: the three shares sum to the collected amount exactly, on both lockers", () => {
    const all = [...inStep("clCollect"), ...inStep("binCollect")].filter((e): e is Extract<IndexedEvent, { kind: "LpFeesCollected" }> => e.kind === "LpFeesCollected");
    expect(all.map((e) => e.lockerKind)).toEqual(["CL", "BIN", "BIN"]);
    for (const e of all) {
      expect(e.creatorShare + e.integratorShare + e.protocolShare).toBe(e.amount);
      expect(e.creatorShare).toBe((e.amount * 7_000n) / 10_000n);
      expect(e.protocolShare).toBeGreaterThanOrEqual((e.amount * 2_000n) / 10_000n);
    }
  });

  it("kit fee flows: two credits for launch A, one for B, a flush to the Safe, an integrator claim", () => {
    const credits = inStep("launchA").filter((e) => e.kind === "FeeFlow");
    expect(credits.map((e) => (e as Extract<IndexedEvent, { kind: "FeeFlow" }>).account)).toEqual([SAFE, A.integrator]);
    const flush = one("kitFlush", "FeeFlow");
    expect([flush.flow, flush.account, flush.to, flush.token, flush.amount]).toEqual(["CLAIMED", SAFE, SAFE, NATIVE, 2n * E15]);
    const skim = one("clSkim", "FeeFlow");
    expect([skim.flow, skim.account, skim.token, skim.amount]).toEqual(["SKIMMED", null, A.quote, 5n * 10n ** 18n]);
  });

  it("decoding is keyed on the emitter: a kit log under a locker role, or a locker Claimed under the kit, is refused", () => {
    const kitLog = F.logs.find((l) => l.step === "kitFlush")!;
    expect(decodeLog(4663, "clLpLocker", raw(kitLog)).ok).toBe(false);
    const lockerClaim = F.logs.find((l) => l.step === "clSafeClaim")!;
    expect(decodeLog(4663, "launchpadKitV2", raw(lockerClaim)).ok).toBe(false);
    // RevShareHook.Claimed is byte-identical to the lockers' Claimed: only the address tells them apart.
    const asRevShare = decodeLog(4663, "revShareHook", raw(lockerClaim));
    expect(asRevShare.ok && asRevShare.event.kind).toBe("RevShareClaimed");
  });
});

describe("rows and the revenue ledger from the real logs", () => {
  const ctx = {
    chainId: 4663,
    timestamps: new Map(F.logs.map((l) => [BigInt(l.blockNumber), BigInt(l.timestamp)])),
    poolCurrencies: new Map(),
    txInputs: new Map<string, Hex>(),
    txFrom: new Map<string, Hex>(),
    protocolBeneficiaries: new Set([SAFE]),
    timelockTier: new Map<string, string>(),
  };
  const rows = buildWindowRows(ctx, EVENTS.map((e) => e.event));

  it("writes launches, legs, locks, collections and flows", () => {
    expect(rows.kitV2Launches).toHaveLength(2);
    expect(rows.kitV2Legs).toHaveLength(3);
    expect(rows.lpLocks).toHaveLength(3);
    expect(rows.lpFeeCollections).toHaveLength(3);
    expect(rows.feeFlows.map((f) => f.kind)).toEqual(["CREDITED", "CREDITED", "CREDITED", "CLAIMED", "CLAIMED", "CLAIMED", "CLAIMED", "SKIMMED"]);
    expect(rows.kitV2Launches[0]!.startTime).toBe(tsOf("launchA") + 120n);
    expect(rowCount(rows)).toBe(2 + 3 + 3 + 3 + 8 + rows.contractEvents.length + rows.ledger.length);
  });

  it("the ledger holds ONLY value that left a contract for the Safe: the kit flush (native) and the Safe's locker claim", () => {
    expect(rows.ledger.map((l) => [l.source, l.token, l.counterparty])).toEqual([
      ["LP_LOCKER_PROTOCOL_CLAIM", A.quote, SAFE],
      ["KIT_LAUNCH_FEE", NATIVE, SAFE],
    ]);
    expect(rows.ledger[1]!.amount).toBe((2n * E15).toString());
    // The Safe's locker claim equals the protocol share credited by the one CL collection (nothing else was owed in quote yet).
    const clProtocol = rows.lpFeeCollections.find((c) => c.locker === A.clLocker)!.protocolShare;
    expect(rows.ledger[0]!.amount).toBe(clProtocol);
    // Credits, skims, the creator's claim and the integrator's claim are never protocol revenue rows.
    expect(rows.ledger.some((l) => l.source === "LP_LOCKER_INTEGRATOR_CLAIM")).toBe(false);
  });

  it("is deterministic (range replacement relies on it)", () => {
    const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(j(buildWindowRows(ctx, EVENTS.map((e) => e.event)))).toBe(j(rows));
  });

  it("launch fee config events land in contract_events under launchpadKitV2", () => {
    const names = rows.contractEvents.filter((c) => c.contractKey === "launchpadKitV2").map((c) => c.eventName);
    expect(names).toEqual(["OwnershipTransferred", "LaunchFeeChanged", "TenantConfigured", "TenantQuoteSet", "LaunchReconfigured", "LaunchFeeIncreaseScheduled", "PendingLaunchFeeCancelled", "LaunchFeeChanged", "LaunchFeeIncreaseScheduled", "LaunchFeeChanged", "LaunchFeeChanged"]);
  });
});

describe("launch fee state replayed from the real events", () => {
  const feeRows = (upTo?: string): LaunchFeeEventRow[] => {
    const out: LaunchFeeEventRow[] = [];
    let reached = false;
    for (const { step, event } of EVENTS) {
      if (reached && step !== upTo) break;
      if (step === upTo) reached = true;
      if (event.kind === "Generic" && ["LaunchFeeChanged", "LaunchFeeIncreaseScheduled", "PendingLaunchFeeCancelled"].includes(event.eventName)) {
        out.push({ eventName: event.eventName, args: event.args, blockNumber: event.meta.blockNumber, blockTimestamp: new Date(Number(tsOf(step)) * 1000), txHash: event.meta.txHash, logIndex: event.meta.logIndex });
      }
    }
    return out;
  };

  it("after deploy: 0.001 ETH, nothing pending", () => {
    const s = deriveLaunchFeeState(feeRows("deploy"), tsOf("deploy"));
    expect([s.storedWei, s.effectiveWei, s.pendingStatus]).toEqual([E15.toString(), E15.toString(), "none"]);
  });

  it("an increase is scheduled with effectiveAt = its block timestamp + the 7-day notice, and is NOT the fee yet", () => {
    const s = deriveLaunchFeeState(feeRows("feeIncreaseScheduled"), tsOf("feeIncreaseScheduled"));
    expect(s.pendingStatus).toBe("scheduled");
    expect(s.pending!.feeWei).toBe((5n * E15).toString());
    expect(BigInt(s.pending!.effectiveAt)).toBe(tsOf("feeIncreaseScheduled") + 7n * 86_400n);
    expect(s.effectiveWei).toBe(E15.toString());
  });

  it("cancel clears it; a decrease is immediate", () => {
    expect(deriveLaunchFeeState(feeRows("feeIncreaseCancelled"), tsOf("feeIncreaseCancelled")).pendingStatus).toBe("none");
    const s = deriveLaunchFeeState(feeRows("feeDecreased"), tsOf("feeDecreased"));
    expect([s.storedWei, s.pendingStatus]).toEqual([(5n * 10n ** 14n).toString(), "none"]);
  });

  it("a scheduled increase MATURES BY ITSELF at effectiveAt, before any event says so", () => {
    const rows = feeRows("feeIncreaseScheduled2");
    const at = BigInt(deriveLaunchFeeState(rows, 0n).pending!.effectiveAt);
    expect(deriveLaunchFeeState(rows, at - 1n).effectiveWei).toBe((5n * 10n ** 14n).toString());
    const matured = deriveLaunchFeeState(rows, at);
    expect([matured.pendingStatus, matured.effectiveWei, matured.storedWei]).toEqual(["matured", (2n * E15).toString(), (5n * 10n ** 14n).toString()]);
  });

  it("the full history replays with no inconsistency and ends at 0.002 ETH, nothing pending", () => {
    const s = deriveLaunchFeeState(feeRows(), tsOf("feeMaterialised"));
    expect(s.inconsistencies).toEqual([]);
    expect([s.storedWei, s.effectiveWei, s.pendingStatus]).toEqual([(2n * E15).toString(), (2n * E15).toString(), "none"]);
    expect(s.history).toHaveLength(7);
  });

  it("a gap in the events is reported, never papered over", () => {
    const rows = feeRows().filter((r) => r.eventName !== "PendingLaunchFeeCancelled");
    expect(deriveLaunchFeeState(rows, tsOf("feeMaterialised")).inconsistencies.length).toBeGreaterThan(0);
  });
});

describe("inert when no kit v2 address is configured", () => {
  it("config/chains/4663.json carries the slots, all null, so nothing is configured", () => {
    const k = chainConfig(4663).kitV2!;
    expect([k.kit, k.clLocker, k.binLocker]).toEqual([null, null, null]);
    expect(kitV2Addresses(4663)).toBeNull();
  });

  it("the watched set and its hash are EXACTLY the pre-kit-v2 ones (no history re-read on deploy of this change)", () => {
    const roles = staticContractsFor(d).map((c) => c.role);
    for (const r of ["launchpadKitV2", "clLpLocker", "binLpLocker"]) expect(roles).not.toContain(r);
    expect(staticContractsFor(d)).toEqual(staticContractsFor(d, null));
    expect(addressSetHash(d)).toBe(addressSetHash(d, null));
    expect(kitV2ContractsFor(null)).toEqual([]);
  });

  it("configuring an address adds exactly that contract and changes the hash", () => {
    const only = { ...CFG, clLocker: null, binLocker: null };
    expect(kitV2ContractsFor(only).map((c) => [c.role, c.address])).toEqual([["launchpadKitV2", A.kit]]);
    expect(addressSetHash(d, only)).not.toBe(addressSetHash(d, null));
    expect(staticContractsFor(d, CFG)).toHaveLength(staticContractsFor(d, null).length + 3);
  });

  it("the schema refuses an address with no verification note, the zero address, and duplicates", () => {
    const base = { chainId: 4663 };
    expect(() => parseChainConfig({ ...base, kitV2: { kit: A.kit } }, 4663)).toThrow(/verification/);
    expect(() => parseChainConfig({ ...base, kitV2: { kit: NATIVE, verification: "x".repeat(40) } }, 4663)).toThrow(/zero address/);
    expect(() => parseChainConfig({ ...base, kitV2: { kit: A.kit, clLocker: A.kit, verification: "x".repeat(40) } }, 4663)).toThrow(/distinct/);
    expect(parseChainConfig({ ...base, kitV2: { kit: null, clLocker: null, binLocker: null, verification: null } }, 4663).kitV2!.kit).toBeNull();
  });

  it("revenue lines stay not-deployed (never zero) until configured; the integrator line is never attributed", () => {
    const off = revenueSourcesFor(4663, () => null);
    expect(off.find((s) => s.source === "KIT_LAUNCH_FEE")!.status).toBe("not-deployed");
    expect(off.find((s) => s.source === "LP_LOCKER_PROTOCOL_CLAIM")!.status).toBe("not-deployed");
    const on = revenueSourcesFor(4663, lookup);
    expect(on.find((s) => s.source === "KIT_LAUNCH_FEE")!.status).toBe("indexed");
    expect(on.find((s) => s.source === "LP_LOCKER_PROTOCOL_CLAIM")!.status).toBe("indexed");
    expect(on.find((s) => s.source === "LP_LOCKER_INTEGRATOR_CLAIM")!.status).toBe("not-attributed");
  });

  it("public kit v2 routes answer 404 'not configured', and the admin reads say configured: false", async () => {
    const { app } = buildAdminApp({ roles: ["viewer"], kitV2Config: () => null });
    for (const path of ["/v1/chains/4663/kit-v2/launches", `/v1/chains/4663/kit-v2/launches/token/${A.tokenA}`, `/v1/chains/4663/kit-v2/launches/pool/${A.poolA0}`, `/v1/chains/4663/kit-v2/launches/token/${A.tokenA}/fees`]) {
      const r = await request(app).get(path);
      expect(r.status, path).toBe(404);
      expect(r.body.error.message).toMatch(/not configured/);
    }
    const s = await signIn(app);
    for (const path of ["/v1/admin/kit-v2/launches", "/v1/admin/kit-v2/fee-state"]) {
      const r = await request(app).get(path).set("Cookie", s.cookie).expect(200);
      expect(r.body.configured).toBe(false);
    }
    await request(app).post("/v1/admin/safe/kit-v2/launch-fee").set({ Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf }).send({ feeWei: "1" }).expect(403);
  });
});

/* ---------------------------------------------------------------------------
   Reads over the real rows, through the in-memory Prisma stand-in
   --------------------------------------------------------------------------- */

const dec = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? new Prisma.Decimal(v) : v);
const decimalFields = new Set(["totalSupply", "seedSupply", "protocolFeeWei", "integratorFeeWei", "lockId", "launchTokenSeeded", "liquidity", "amount", "creatorShare", "integratorShare", "protocolShare"]);
const withDecimals = <T extends Record<string, unknown>>(rows: T[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, decimalFields.has(k) ? dec(v) : v])));
function seededRows() {
  const rows = buildWindowRows(
    { chainId: 4663, timestamps: new Map(F.logs.map((l) => [BigInt(l.blockNumber), BigInt(l.timestamp)])), poolCurrencies: new Map(), txInputs: new Map(), txFrom: new Map(), protocolBeneficiaries: new Set([SAFE]), timelockTier: new Map() },
    EVENTS.map((e) => e.event),
  );
  const last = F.logs[F.logs.length - 1]!;
  return {
    rows,
    extra: {
      indexerCheckpoint: [{ chainId: 4663, lastIndexedBlock: BigInt(last.blockNumber), lastIndexedBlockHash: `0x${"11".repeat(32)}`, lastIndexedBlockTimestamp: new Date(Number(last.timestamp) * 1000), addressSetHash: "x", headBlock: BigInt(last.blockNumber) + 100n, headObservedAt: new Date() }],
      kitV2Launch: withDecimals(rows.kitV2Launches),
      kitV2LaunchLeg: withDecimals(rows.kitV2Legs),
      lpLock: withDecimals(rows.lpLocks),
      lpFeeCollection: withDecimals(rows.lpFeeCollections),
      feeFlow: withDecimals(rows.feeFlows),
      contractEvent: rows.contractEvents,
      token: [{ id: `4663-${A.quote}`, chainId: 4663, address: A.quote, symbol: "QUOT", decimals: 18 }],
    },
  };
}

describe("public /v1 kit v2 routes over the real rows", () => {
  const { extra } = seededRows();
  const app = () => buildAdminApp({ seed: { extra }, kitV2Config: lookup }).app;

  it("lists launches with legs, lock splits frozen at creation and native launch fees in token units", async () => {
    const r = await request(app()).get("/v1/chains/4663/kit-v2/launches").expect(200);
    expect(r.body.provenance.toBlock).toBe(F.logs[F.logs.length - 1]!.blockNumber);
    expect(r.body.data.total).toBe(2);
    const a = r.body.data.items.find((l: { token: string }) => l.token === A.tokenA);
    expect(a.launchFees.protocol).toEqual({ token: NATIVE, symbol: d.nativeCurrency.symbol, raw: E15.toString(), units: "0.001" });
    expect(a.tenant).toBe(A.tenant);
    expect(a.schedule.startTime).toBe((tsOf("launchA") + 120n).toString());
    expect(a.legs).toHaveLength(2);
    const cl = a.legs.find((g: { kind: string }) => g.kind === "CL");
    expect(cl.lock.status).toBe("indexed");
    expect(cl.lock.frozenAtCreation).toEqual({ creatorBps: 7_000, integratorBps: 1_000, protocolBps: 2_000, integrator: A.integrator });
    expect(cl.quote.symbol).toBe("QUOT");
    const bin = a.legs.find((g: { kind: string }) => g.kind === "BIN");
    expect(bin.lock.bins).toHaveLength(10);
  });

  it("finds a launch by token and by any of its pool ids, with reconfigurations", async () => {
    const byToken = await request(app()).get(`/v1/chains/4663/kit-v2/launches/token/${A.tokenB}`).expect(200);
    expect(byToken.body.data.reconfigurations).toHaveLength(1);
    const byPool = await request(app()).get(`/v1/chains/4663/kit-v2/launches/pool/${A.poolA1}`).expect(200);
    expect(byPool.body.data.token).toBe(A.tokenA);
    expect(byPool.body.data.matchedPoolId).toBe(A.poolA1);
    await request(app()).get(`/v1/chains/4663/kit-v2/launches/pool/0x${"12".repeat(32)}`).expect(404);
  });

  it("per-launch fees: collected per currency per lock, split summing exactly", async () => {
    const r = await request(app()).get(`/v1/chains/4663/kit-v2/launches/token/${A.tokenA}/fees`).expect(200);
    const legs = r.body.data.legs;
    expect(legs.find((g: { kind: string }) => g.kind === "CL").collected).toHaveLength(1);
    expect(legs.find((g: { kind: string }) => g.kind === "BIN").collected).toHaveLength(2);
    for (const g of legs) for (const c of g.collected) expect(c.sharesSumToTotal).toBe(true);
  });

  it("a configured but never-indexed chain is NOT_INDEXED, not an empty list", async () => {
    const { app: bare } = buildAdminApp({ kitV2Config: lookup });
    const r = await request(bare).get("/v1/chains/4663/kit-v2/launches");
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("NOT_INDEXED");
  });
});

/* ---------------------------------------------------------------------------
   Admin: fee state, accruals, payloads
   --------------------------------------------------------------------------- */

/** TEST FIXTURE ONLY: answers the kit's views by selector. LAYOUT values chosen per test, not chain reads. */
function fakeKitClient(state: { fee: bigint; pending: [bigint, bigint]; cap: bigint; notice: number; owner: string; recipient: string; clLocker: string; binLocker: string; owed: bigint; now: bigint; claimable?: bigint }): TreasuryClient {
  const abi = KIT_V2_FUNCTIONS_ABI as unknown as Abi;
  const lockerAbi = [{ type: "function", name: "claimable", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }] as const;
  return {
    getBlock: async () => ({ number: 5_000n, timestamp: state.now }),
    getBlockNumber: async () => 5_000n,
    getBalance: async () => 0n,
    getCode: async () => "0x",
    getStorageAt: async () => "0x",
    call: async ({ to, data }) => {
      if (to && getAddress(to) !== getAddress(CFG.kit!)) {
        decodeFunctionData({ abi: lockerAbi, data });
        return { data: encodeFunctionResult({ abi: lockerAbi, functionName: "claimable", result: state.claimable ?? 0n }) };
      }
      const { functionName } = decodeFunctionData({ abi, data });
      const result: Record<string, unknown> = {
        launchFeeWei: state.fee,
        pendingLaunchFee: state.pending,
        maxLaunchFeeWei: state.cap,
        launchFeeNoticeSeconds: state.notice,
        maxIntegratorLaunchFeeWei: 5n * E15,
        protocolFeeRecipient: state.recipient,
        owner: state.owner,
        pendingOwner: NATIVE,
        feesOwed: state.owed,
        totalFeesOwed: state.owed,
        clLocker: state.clLocker,
        binLocker: state.binLocker,
      };
      return { data: encodeFunctionResult({ abi, functionName, result: result[functionName] } as never) };
    },
  };
}

const okSim: Simulator = { simulate: async (req) => ({ status: "success", from: req.from, to: req.to, blockNumber: "5000", returnData: "0x", revert: null, error: null, simulatedAt: new Date().toISOString(), method: "eth_call" }) };

describe("admin kit v2 fee state and payloads", () => {
  const govSafe = d.governanceSafe.toLowerCase();
  const chainState = (over: Partial<Parameters<typeof fakeKitClient>[0]> = {}) => fakeKitClient({ fee: 2n * E15, pending: [0n, 0n], cap: 10n * E15, notice: 604_800, owner: govSafe, recipient: govSafe, clLocker: CFG.clLocker!, binLocker: CFG.binLocker!, owed: 0n, now: 1_789_700_000n, ...over });

  it("reads every view at one block; checks pass for the Safe as owner and recipient", async () => {
    const c = await readKitChainState(chainState(), CFG.kit!, govSafe);
    expect(c.status).toBe("read");
    if (c.status !== "read") return;
    expect([c.launchFeeWei, c.maxLaunchFeeWei, c.launchFeeNoticeSeconds, c.pendingLaunchFee]).toEqual([(2n * E15).toString(), (10n * E15).toString(), 604_800, null]);
    expect(kitFeeChecks({ cfg: CFG, safe: govSafe, chain: c, events: null }).filter((x) => x.level !== "ok")).toEqual([]);
  });

  it("flags an owner or recipient that is not the Safe, and a locker that differs from config", async () => {
    const c = await readKitChainState(chainState({ owner: "0x0000000000000000000000000000000000000bad", recipient: "0x0000000000000000000000000000000000000bad", clLocker: "0x0000000000000000000000000000000000000c1c" }), CFG.kit!, govSafe);
    const high = kitFeeChecks({ cfg: CFG, safe: govSafe, chain: c, events: null }).filter((x) => x.level === "high").map((x) => x.check);
    expect(high).toEqual(expect.arrayContaining(["owner() is not the Safe", "protocolFeeRecipient() is not the Safe", "clLocker() differs from config"]));
  });

  it("an unreachable chain is 'unavailable', never a guessed fee", async () => {
    const broken: TreasuryClient = { ...chainState(), getBlock: async () => { throw new Error("connect ECONNREFUSED"); } };
    expect((await readKitChainState(broken, CFG.kit!, govSafe)).status).toBe("unavailable");
    expect((await readKitChainState(null, CFG.kit!, govSafe)).status).toBe("unavailable");
  });

  it("classifies decreases as immediate and increases as scheduled; refuses above the cap", () => {
    expect(classifyLaunchFeeChange(1n, 2n)).toBe("immediate-decrease");
    expect(classifyLaunchFeeChange(2n, 2n)).toBe("no-change");
    expect(classifyLaunchFeeChange(3n, 2n)).toBe("scheduled-increase");
    expect(classifyLaunchFeeChange(3n, null)).toBe("unknown");
    const inc = prepareSetLaunchFee({ chainId: 4663, safe: govSafe, kit: CFG.kit!, newFeeWei: 3n * E15, feeInForceWei: 2n * E15, capWei: 10n * E15, noticeSeconds: 604_800, pendingFeeWei: null, nowUnix: 1_000n });
    expect(inc.effect).toBe("scheduled-increase");
    expect(inc.effectiveAtUnix).toBe("605800");
    expect(inc.operation).toBe(0);
    expect(inc.decoded?.signature).toBe("setLaunchFee(uint256)");
    expect(inc.data.slice(0, 10)).toBe(toFunctionSelector("function setLaunchFee(uint256)"));
    expect(() => prepareSetLaunchFee({ chainId: 4663, safe: govSafe, kit: CFG.kit!, newFeeWei: 11n * E15, feeInForceWei: 2n * E15, capWei: 10n * E15, noticeSeconds: 604_800, pendingFeeWei: null, nowUnix: 1_000n })).toThrow(/LaunchFeeAboveCap/);
    const dec = prepareSetLaunchFee({ chainId: 4663, safe: govSafe, kit: CFG.kit!, newFeeWei: E15, feeInForceWei: 2n * E15, capWei: 10n * E15, noticeSeconds: 604_800, pendingFeeWei: 5n * E15, nowUnix: 1_000n });
    expect(dec.effect).toBe("immediate-decrease");
    expect(dec.warnings.join(" ")).toMatch(/CANCELS the scheduled increase/);
    expect(prepareCancelPendingLaunchFee({ chainId: 4663, safe: govSafe, kit: CFG.kit!, pendingFeeWei: null }).decoded?.signature).toBe("cancelPendingLaunchFee()");
  });

  it("POST launch-fee builds the payload from the kit's own read, simulates from the Safe and audits", async () => {
    const { app, tables } = buildAdminApp({ roles: ["admin"], kitV2Config: lookup, treasuryClient: chainState({ pending: [5n * E15, 1_790_000_000n] }), simulator: okSim });
    const s = await signIn(app);
    const h = { Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf };
    const inc = await request(app).post("/v1/admin/safe/kit-v2/launch-fee").set(h).send({ feeWei: (3n * E15).toString() }).expect(200);
    expect(inc.body.effect).toBe("scheduled-increase");
    expect(inc.body.effectiveAtUnix).toBe((1_789_700_000n + 604_800n).toString());
    expect(inc.body.payload.to).toBe(getAddress(CFG.kit!));
    expect(inc.body.payload.warnings.join(" ")).toMatch(/REPLACES the scheduled increase/);
    expect(inc.body.simulatedFrom.toLowerCase()).toBe(govSafe);
    const dec = await request(app).post("/v1/admin/safe/kit-v2/launch-fee").set(h).send({ feeWei: "0" }).expect(200);
    expect(dec.body.effect).toBe("immediate-decrease");
    await request(app).post("/v1/admin/safe/kit-v2/launch-fee").set(h).send({ feeWei: (11n * E15).toString() }).expect(400);
    expect(tables.auditLog.rows.filter((r) => r.action === "safe.prepare.kit-launch-fee")).toHaveLength(2);
    await request(app).post("/v1/admin/safe/kit-v2/cancel-pending-fee").set(h).send({}).expect(200);
  });

  it("POST cancel-pending-fee refuses when the kit reads nothing scheduled", async () => {
    const { app } = buildAdminApp({ roles: ["admin"], kitV2Config: lookup, treasuryClient: chainState(), simulator: okSim });
    const s = await signIn(app);
    const r = await request(app).post("/v1/admin/safe/kit-v2/cancel-pending-fee").set({ Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf }).send({}).expect(409);
    expect(r.body.error.message).toMatch(/no scheduled increase/);
  });

  it("fee state over the real events: replayed history, and accruals owed to the protocol reconciled per contract", async () => {
    const { extra } = seededRows();
    const { prisma } = fakePrisma({ extra });
    // The fixture's FakeSafe stands in for the governance Safe here (its address is the kit's recipient).
    const svc = new AdminKitV2Service(prisma, null, lookup);
    const acc = await svc.accruals(4663, CFG, SAFE, null);
    expect(acc.status).toBe("indexed");
    if (acc.status !== "indexed") return;
    const kit = acc.items.find((i) => i.role === "launchpadKitV2")!;
    expect([kit.credited.raw, kit.claimed.raw, kit.owed.raw, kit.token]).toEqual([(2n * E15).toString(), (2n * E15).toString(), "0", NATIVE]);
    const clQuote = acc.items.find((i) => i.role === "clLpLocker" && i.token === A.quote)!;
    // Protocol share credited, fully claimed by the Safe, then a 5-token skim credited: 5 QUOT owed.
    expect(clQuote.owed.raw).toBe((5n * 10n ** 18n).toString());
    expect(clQuote.owed.units).toBe("5");
    const binItems = acc.items.filter((i) => i.role === "binLpLocker");
    expect(binItems.map((i) => i.claimed.raw)).toEqual(["0", "0"]);
    expect(acc.provenance).toMatch(/Summed from fee_flows and lp_fee_collections since block \d+ to 1018/);
    const fs = await svc.feeState(4663);
    expect(fs.configured).toBe(true);
    if (!fs.configured || !("effectiveWei" in fs.events)) throw new Error("expected replayed events");
    expect(fs.events.effectiveWei).toBe((2n * E15).toString());
    expect(fs.events.provenance).toMatch(/to 1018/);
    expect(fs.chain.status).toBe("unavailable");
  });
});

describe("the kit v2 public service never answers for an unconfigured chain", () => {
  it("requireConfigured throws NOT_FOUND naming the config file", () => {
    const svc = new KitV2ReadService({} as never, () => null);
    expect(() => svc.requireConfigured(4663)).toThrow(/config\/chains\/4663\.json/);
  });
});
