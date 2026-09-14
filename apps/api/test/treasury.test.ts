import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LATCH_DEPLOYMENTS, UNIVERSAL_ROUTER_ABI } from "@latchprotocol/sdk";
import request from "supertest";
import { decodeFunctionData, getAddress, keccak256, maxUint256, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { computeAlerts } from "../src/admin/alerts.js";
import { buildConversionSafeTx, decodeMultiSend, decodeRouterExecute, ERC20_APPROVE_ABI, PERMIT2_APPROVE_ABI } from "../src/admin/treasury/batch.js";
import { safeDelegatecallStub } from "../src/admin/treasury/chain.js";
import { enumerateRoutes, judgeHook, minOutFor, priceImpact, routeId, swapFeePips, type HookFacts, type PoolRow } from "../src/admin/treasury/route.js";
import { parseChainConfig } from "../src/config/chainConfig.js";
import { buildAdminApp, ORIGIN, signIn } from "./helpers/adminApp.js";
import { baseState, fakeTreasuryClient, legacyPending, MSC, MSC_CODE, NATIVE, NVDA, poolRow, RETIRED_REVSHARE, SAFE, THIRD_PARTY_HOOK, USDG, WETH, type FakeState } from "./helpers/treasuryChain.js";

const d = LATCH_DEPLOYMENTS[4663];
const cfgFile = fileURLToPath(new URL("../config/chains/4663.json", import.meta.url));
const cfg = parseChainConfig(JSON.parse(readFileSync(cfgFile, "utf8")), 4663);
const tc = cfg.treasuryConversion!;
const golden = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/treasury-golden.json", import.meta.url)), "utf8"));
const P = golden.fixture.parameters as Hex;

const row = (currency0: string, currency1: string, hooks: string, poolManager: string = d.clPoolManager): PoolRow => {
  const r = poolRow({ currency0: getAddress(currency0), currency1: getAddress(currency1), hooks: getAddress(hooks), fee: 3000, sqrtPriceX96: 1n });
  return { ...r, poolManager: poolManager.toLowerCase() };
};

/* ===========================================================================
   Config: the allowlist is config, and the MultiSend is pinned by code hash
   =========================================================================== */

describe("treasuryConversion config", () => {
  it("4663 targets native with the owner-decision defaults and a verified MultiSendCallOnly 1.4.1", () => {
    expect(tc.target).toBe("native");
    expect(tc.maxPriceImpactBps).toBe(100);
    expect(tc.slippageBps).toBe(50);
    expect(tc.multiSendCallOnly.address).toBe(MSC.toLowerCase());
    expect(tc.multiSendCallOnly.version).toBe("1.4.1");
    // The fixture is the code read from 4663 with cast; its hash is the pinned one.
    expect(keccak256(MSC_CODE)).toBe(tc.multiSendCallOnly.codeHash);
    expect(tc.allowlist.map((a) => a.symbol)).toEqual(["USDG", "NVDA"]);
    for (const a of tc.allowlist) expect(a.rationale.length).toBeGreaterThan(40);
  });

  it("refuses the native currency as an allowlist entry, and duplicates", () => {
    const base = { ...JSON.parse(readFileSync(cfgFile, "utf8")) };
    const withNative = { ...base, treasuryConversion: { ...base.treasuryConversion, allowlist: [{ token: NATIVE, symbol: "ETH", decimals: 18, rationale: "x".repeat(60) }] } };
    expect(() => parseChainConfig(withNative, 4663)).toThrow(/native/);
    const dup = { ...base, treasuryConversion: { ...base.treasuryConversion, allowlist: [base.treasuryConversion.allowlist[0], base.treasuryConversion.allowlist[0]] } };
    expect(() => parseChainConfig(dup, 4663)).toThrow(/twice/);
  });

  it("there is no HTTP route that writes the allowlist, and the README says so", () => {
    const routes = readFileSync(fileURLToPath(new URL("../src/http/adminRoutes.ts", import.meta.url)), "utf8");
    const posts = [...routes.matchAll(/r\.post\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(posts.filter((p) => /treasury/.test(p!))).toEqual(["/treasury/convert/prepare"]);
    expect(routes).not.toMatch(/allowlist[^\n]*(r\.post|write|update)/i);
    const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
    expect(readme).toMatch(/allowlist is config/i);
  });
});

/* ===========================================================================
   Routes: Latch pools only
   =========================================================================== */

describe("route discovery", () => {
  const pools = [row(NATIVE, USDG, NATIVE), row(WETH, USDG, NATIVE), row(USDG, NVDA, RETIRED_REVSHARE)];

  it("direct routes to native and to WETH", () => {
    const r = enumerateRoutes({ pools, token: USDG, weth: WETH, latchClPoolManager: d.clPoolManager });
    expect(r.candidates.map((c) => [c.hops.length, c.end]).sort()).toEqual([[1, "native"], [1, "weth"]]);
    expect(r.candidates.find((c) => c.end === "native")!.hops[0]!.zeroForOne).toBe(false); // USDG is currency1
  });

  it("one intermediate hop through another Latch pool", () => {
    const r = enumerateRoutes({ pools, token: NVDA, weth: WETH, latchClPoolManager: d.clPoolManager });
    expect(r.candidates).toHaveLength(2);
    for (const c of r.candidates) {
      expect(c.hops.map((h) => h.currencyIn)).toEqual([NVDA.toLowerCase(), USDG.toLowerCase()]);
      expect(c.hops[0]!.currencyOut).toBe(USDG.toLowerCase());
    }
  });

  it("no-route: a token with no Latch pool, and a token only reachable through two intermediates", () => {
    expect(enumerateRoutes({ pools, token: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6", weth: WETH, latchClPoolManager: d.clPoolManager }).candidates).toEqual([]);
    const far = [row(NATIVE, USDG, NATIVE), row(USDG, NVDA, NATIVE), row("0x2A21c0826848f2D597B7C87A4B931dE1407958A6", NVDA, NATIVE)];
    expect(enumerateRoutes({ pools: far, token: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6", weth: WETH, latchClPoolManager: d.clPoolManager }).candidates).toEqual([]);
  });

  it("a pool on any other pool manager is dropped before routing (Robinhood's Uniswap v4 PoolManager, and Bin pools)", () => {
    const v4 = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
    const r = enumerateRoutes({ pools: [row(NATIVE, USDG, NATIVE, v4), { ...row(NATIVE, USDG, NATIVE, d.binPoolManager), poolType: "BIN" }], token: USDG, weth: WETH, latchClPoolManager: d.clPoolManager });
    expect(r.candidates).toEqual([]);
    expect(r.droppedForeignPools).toBe(2);
  });

  it("route ids are stable and depend on path and end", () => {
    const a = enumerateRoutes({ pools, token: USDG, weth: WETH, latchClPoolManager: d.clPoolManager }).candidates;
    const b = enumerateRoutes({ pools: [...pools].reverse(), token: USDG, weth: WETH, latchClPoolManager: d.clPoolManager }).candidates;
    expect(a.map((c) => c.id).sort()).toEqual(b.map((c) => c.id).sort());
    expect(routeId(a[0]!.hops, "native")).not.toBe(routeId(a[0]!.hops, "weth"));
  });
});

/* ===========================================================================
   Arithmetic
   =========================================================================== */

describe("min-out, fees and price impact", () => {
  it("min-out = ceil(quote x (10000 - slippageBps) / 10000): rounding never loosens the Safe's bound", () => {
    expect(minOutFor(1001n, 50)).toBe(996n); // 995.995 -> 996
    expect(minOutFor(1000n, 50)).toBe(995n); // exact
    expect(minOutFor(1n, 50)).toBe(1n); // 0.995 -> 1
    expect(minOutFor(12345n, 0)).toBe(12345n);
    expect(minOutFor(12345n, 10_000)).toBe(0n);
    for (let q = 1n; q < 3000n; q += 7n) {
      for (const bps of [1, 50, 333, 9999]) {
        const m = minOutFor(q, bps);
        expect(m * 10_000n >= q * BigInt(10_000 - bps)).toBe(true); // never below the exact bound
        expect((m - 1n) * 10_000n < q * BigInt(10_000 - bps)).toBe(true); // and the smallest such integer
        expect(m <= q).toBe(true);
      }
    }
    expect(() => minOutFor(1n, 50.5)).toThrow(RangeError);
    expect(() => minOutFor(1n, -1)).toThrow(RangeError);
  });

  it("swap fee stacks protocol fee on the LP fee exactly as ProtocolFeeLibrary", () => {
    expect(swapFeePips(0, 3000)).toBe(3000);
    expect(swapFeePips(1000, 3000)).toBe(3997); // 1000 + 3000 - 3
  });

  it("impact is measured against the fee-adjusted mid price and rounds up", () => {
    const pools = [row(NATIVE, USDG, NATIVE)];
    const [c] = enumerateRoutes({ pools, token: USDG, weth: WETH, latchClPoolManager: d.clPoolManager }).candidates.filter((x) => x.end === "native");
    const sqrt = 1n << 96n; // price 1: 1 raw USDG = 1 wei
    const im = priceImpact(1_000_000n, c!.hops, [{ sqrtPriceX96: sqrt, protocolFee: 0, lpFee: 3000 }], 996_000n);
    expect(im.midOut).toBe(1_000_000n);
    expect(im.feeAdjustedMidOut).toBe(997_000n);
    expect(im.priceImpactBps).toBe(11); // (997000-996000)/997000 = 10.03 bps -> 11
    expect(im.totalCostBps).toBe(40);
    expect(() => priceImpact(1n, c!.hops, [{ sqrtPriceX96: 1n << 150n, protocolFee: 0, lpFee: 0 }], 1n)).toThrow(/too small/); // 1 raw USDG at a huge price rounds to 0 wei
  });
});

/* ===========================================================================
   Hook policy
   =========================================================================== */

describe("hook policy", () => {
  const f = (over: Partial<HookFacts>): HookFacts => ({ hook: THIRD_PARTY_HOOK.toLowerCase() as Hex, ownHook: null, registry: { status: "read", registered: true, listing: "Active" }, pending: null, ...over });

  it("refuses a Malicious hook, even one of Latch's own", () => {
    expect(judgeHook(f({ registry: { status: "read", registered: true, listing: "Malicious" } }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Malicious/) });
    expect(judgeHook(f({ ownHook: "Latch RevShareHook", registry: { status: "read", registered: true, listing: "Malicious" } })).ok).toBe(false);
  });

  it("refuses an unregistered hook unless the SDK names it as Latch's own", () => {
    expect(judgeHook(f({ registry: { status: "read", registered: false, listing: null } }))).toMatchObject({ ok: false, reason: expect.stringMatching(/not in LatchRegistry/) });
    expect(judgeHook(f({ ownHook: "Latch RevShareHook (retired)", registry: { status: "read", registered: false, listing: null } })).ok).toBe(true);
  });

  it("refuses an unreadable registry, an armed proposal, a queued one maturing inside the deadline, and an unreadable one", () => {
    expect(judgeHook(f({ registry: { status: "error", error: "timeout" } })).ok).toBe(false);
    expect(judgeHook(f({ pending: { status: "armed", shape: "block-no-expiry", effective: "1", expiry: null, maturesWithinDeadline: false } }))).toMatchObject({ ok: false, reason: expect.stringMatching(/ARMED.*never expires/) });
    expect(judgeHook(f({ pending: { status: "queued", shape: "block-with-expiry", effective: "9", expiry: "99", maturesWithinDeadline: true } })).ok).toBe(false);
    expect(judgeHook(f({ pending: { status: "error", error: "bad shape" } })).ok).toBe(false);
    const later = judgeHook(f({ pending: { status: "queued", shape: "block-with-expiry", effective: "9", expiry: "99", maturesWithinDeadline: false } }));
    expect(later.ok && later.warnings[0]).toMatch(/after the deadline/);
    expect(judgeHook(null)).toMatchObject({ ok: true, hook: null });
  });
});

/* ===========================================================================
   The batch: golden calldata, exact approvals, deadline, operation
   =========================================================================== */

function goldenRoute(kind: "singleHopNative" | "twoHopWeth") {
  const g = golden[kind];
  const pools: PoolRow[] = (kind === "singleHopNative" ? [g.pool] : g.pools).map((p: { currency0: string; currency1: string; hooks: string }) => ({ ...row(p.currency0, p.currency1, p.hooks), parameters: P }));
  const c = enumerateRoutes({ pools, token: g.tokenIn, weth: WETH, latchClPoolManager: d.clPoolManager }).candidates.find((x) => x.end === (kind === "singleHopNative" ? "native" : "weth"))!;
  return buildConversionSafeTx({ chainId: 4663, safe: SAFE, token: getAddress(g.tokenIn), tokenSymbol: kind === "singleHopNative" ? "USDG" : "NVDA", amountIn: BigInt(g.amountIn), minOut: BigInt(g.minOut), route: c, permit2: d.permit2, universalRouter: d.universalRouter, weth: WETH, multiSendCallOnly: MSC, nowSeconds: BigInt(golden.fixture.nowSeconds), deadlineSeconds: golden.fixture.deadlineSeconds });
}

describe("conversion batch", () => {
  it("golden: single hop USDG -> native matches calldata encoded independently with cast", () => {
    const { tx } = goldenRoute("singleHopNative");
    expect(tx.data).toBe(golden.singleHopNative.multiSend);
  });

  it("golden: two hops NVDA -> USDG (RevShare pool) -> WETH, then UNWRAP_WETH, matches cast", () => {
    const { tx } = goldenRoute("twoHopWeth");
    expect(tx.data).toBe(golden.twoHopWeth.multiSend);
  });

  it("is a DELEGATECALL to the verified MultiSendCallOnly whose inner calls are all CALLs, in order approve -> Permit2.approve -> router", () => {
    const { tx } = goldenRoute("singleHopNative");
    expect(tx.operation).toBe(1);
    expect(tx.to).toBe(MSC);
    expect(tx.value).toBe("0");
    expect("nonce" in tx).toBe(false);
    const inner = decodeMultiSend(tx.data);
    expect(inner.map((c) => c.operation)).toEqual([0, 0, 0]);
    expect(inner.map((c) => c.to)).toEqual([USDG, d.permit2, d.universalRouter]);
    expect(inner.every((c) => c.value === "0")).toBe(true);
    expect(tx.innerCalls.map((c) => c.decoded?.functionName)).toEqual(["approve", "approve", "execute"]);
    expect(tx.innerCalls.map((c) => c.decoded?.signature)).toEqual(["approve(address,uint256)", "approve(address,address,uint160,uint48)", "execute(bytes,bytes[],uint256)"]);
    expect(tx.innerCalls[2]!.decoded!.args.map((a) => a.name)).toEqual(["commands", "inputs", "deadline"]);
  });

  it("approvals are EXACT, never unlimited; Permit2 expiry and router deadline are chain time + deadlineSeconds", () => {
    for (const kind of ["singleHopNative", "twoHopWeth"] as const) {
      const { tx, deadline } = goldenRoute(kind);
      const amount = BigInt(golden[kind].amountIn);
      const inner = decodeMultiSend(tx.data);
      const a = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: inner[0]!.data });
      expect(a.args[0]).toBe(d.permit2);
      expect(a.args[1]).toBe(amount);
      expect(a.args[1]).not.toBe(maxUint256);
      const p = decodeFunctionData({ abi: PERMIT2_APPROVE_ABI, data: inner[1]!.data });
      expect(p.args).toEqual([getAddress(golden[kind].tokenIn), d.universalRouter, amount, Number(golden.fixture.deadline)]);
      expect(p.args[2]).not.toBe((1n << 160n) - 1n);
      const e = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: inner[2]!.data });
      expect(e.args?.[2]).toBe(BigInt(golden.fixture.deadline));
      expect(deadline).toBe(BigInt(golden.fixture.nowSeconds) + 3600n);
      // SETTLE_ALL caps what the router can pull at exactly amountIn.
      const r = decodeRouterExecute(inner[2]!.data);
      const settle = r.steps[0]!.actions!.find((x) => x.action === "SETTLE_ALL")!;
      expect(settle.params.maxAmount).toBe(amount.toString());
    }
  });

  it("proceeds go to the Safe: TAKE to the Safe on a native route; TAKE to the router then UNWRAP_WETH(Safe, minOut) on a WETH route", () => {
    const n = decodeRouterExecute(decodeMultiSend(goldenRoute("singleHopNative").tx.data)[2]!.data);
    expect(n.steps.map((s) => s.command)).toEqual(["INFI_SWAP"]);
    expect(n.steps[0]!.actions!.map((a) => a.action)).toEqual(["CL_SWAP_EXACT_IN_SINGLE", "SETTLE_ALL", "TAKE"]);
    expect(n.steps[0]!.actions![2]!.params).toEqual({ currency: NATIVE, recipient: SAFE, amount: "0" });
    expect(n.steps[0]!.actions![0]!.params.amountOutMinimum).toBe(golden.singleHopNative.minOut);
    const w = decodeRouterExecute(decodeMultiSend(goldenRoute("twoHopWeth").tx.data)[2]!.data);
    expect(w.steps.map((s) => s.command)).toEqual(["INFI_SWAP", "UNWRAP_WETH"]);
    expect(w.steps[0]!.actions![2]!.params).toEqual({ currency: WETH, recipient: "0x0000000000000000000000000000000000000002", amount: "0" });
    expect(w.steps[1]!.params).toEqual({ recipient: SAFE, amountMin: golden.twoHopWeth.minOut });
  });

  it("refuses zero amounts, zero min-out, and amounts Permit2 cannot hold", () => {
    const { route } = { route: enumerateRoutes({ pools: [row(NATIVE, USDG, NATIVE)], token: USDG, weth: WETH, latchClPoolManager: d.clPoolManager }).candidates[0]! };
    const base = { chainId: 4663, safe: SAFE, token: USDG, tokenSymbol: "USDG", route, permit2: d.permit2, universalRouter: d.universalRouter, weth: WETH, multiSendCallOnly: MSC, nowSeconds: 1_789_400_000n, deadlineSeconds: 3600 };
    expect(() => buildConversionSafeTx({ ...base, amountIn: 0n, minOut: 1n })).toThrow();
    expect(() => buildConversionSafeTx({ ...base, amountIn: 1n, minOut: 0n })).toThrow();
    expect(() => buildConversionSafeTx({ ...base, amountIn: 1n << 160n, minOut: 1n })).toThrow();
  });

  it("the simulation stub is 70 bytes and delegatecalls exactly the MultiSendCallOnly it was built for", () => {
    const stub = safeDelegatecallStub(MSC);
    expect((stub.length - 2) / 2).toBe(70);
    expect(stub).toContain(MSC.slice(2).toLowerCase());
    expect(stub.slice(0, 12)).toBe("0x3615604457"); // empty calldata -> STOP (accept ETH)
    expect(stub).toContain("5af4"); // GAS DELEGATECALL, never CALL
  });
});

/* ===========================================================================
   Infinity-only: no third-party venue in any code path
   =========================================================================== */

describe("Infinity-only", () => {
  // Known third-party AMM contracts. Robinhood's v4 PoolManager was read on chain
  // 2026-09-14 (Sourcify: v4-core/src/PoolManager.sol); the others are the
  // canonical Ethereum Uniswap v4 PoolManager and PancakeSwap Infinity Vault /
  // CLPoolManager.
  const FOREIGN = ["0x8366a39cc670b4001a1121b8f6a443a643e40951", "0x000000000004444c5dc75cb358380d2e3de08a90", "0x238a358808379702088667322f80ac48bad5e6c4", "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b"];
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

  it("no source file or chain config names a third-party AMM address, and no code line names a third-party venue", () => {
    const files = [...walk(fileURLToPath(new URL("../src", import.meta.url))), ...walk(fileURLToPath(new URL("../config", import.meta.url)))].filter((f) => /\.(ts|json)$/.test(f));
    for (const f of files) {
      const text = readFileSync(f, "utf8").toLowerCase();
      for (const a of FOREIGN) expect(text.includes(a.slice(2)), `${f} names ${a}`).toBe(false);
    }
    const treasury = walk(fileURLToPath(new URL("../src/admin/treasury", import.meta.url)));
    const code = treasury.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)));
    expect(code.filter((l) => /uniswap|pancake|sushi|curve\.fi|1inch|0x\.org|paraswap|odos/i.test(l))).toEqual([]);
  });

  it("every call a conversion batch makes targets the token, the SDK Permit2 or the SDK Latch router, and every pool is on the SDK Latch CLPoolManager", () => {
    for (const kind of ["singleHopNative", "twoHopWeth"] as const) {
      const { tx } = goldenRoute(kind);
      const allowed = new Set([getAddress(golden[kind].tokenIn), d.permit2, d.universalRouter].map((a) => a.toLowerCase()));
      for (const c of decodeMultiSend(tx.data)) expect(allowed.has(c.to.toLowerCase())).toBe(true);
      const r = decodeRouterExecute(decodeMultiSend(tx.data)[2]!.data);
      const swap = r.steps[0]!.actions![0]!.params as { poolKey?: { poolManager: string }; path?: { poolManager: string }[] };
      const managers = swap.poolKey ? [swap.poolKey.poolManager] : swap.path!.map((p) => p.poolManager);
      for (const m of managers) expect(m.toLowerCase()).toBe(d.clPoolManager.toLowerCase());
    }
  });
});

/* ===========================================================================
   Service over HTTP, against the fixture chain
   =========================================================================== */

async function app(state: FakeState, roles: ("viewer" | "admin")[] = ["admin"]) {
  const pools = state.pools.map(poolRow);
  const built = buildAdminApp({ roles, seed: { pool: pools }, treasuryClient: fakeTreasuryClient(state) });
  const s = await signIn(built.app);
  const h = { Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf };
  const route = async (token: string, amount?: string) => request(built.app).get(`/v1/admin/treasury/route?token=${token}${amount ? `&amount=${amount}` : ""}`).set("Cookie", s.cookie);
  const prepare = async (body: Record<string, unknown>) => request(built.app).post("/v1/admin/treasury/convert/prepare").set(h).send(body);
  return { ...built, s, h, route, prepare };
}

describe("treasury routes against the fixture chain", () => {
  it("GET /treasury: allowlisted balances read on chain, target native, the allowlist-is-config note", async () => {
    const a = await app(baseState(), ["viewer"]);
    const r = await request(a.app).get("/v1/admin/treasury").set("Cookie", a.s.cookie).expect(200);
    expect(r.body.configured).toBe(true);
    expect(r.body.target).toMatchObject({ currency: NATIVE, symbol: "ETH", balance: { wei: "500000000000000000" } });
    expect(r.body.tokens.map((t: { symbol: string }) => t.symbol)).toEqual(["USDG", "NVDA"]);
    expect(r.body.tokens[0].balance).toMatchObject({ raw: "2000000000", units: "2000", mismatch: null });
    expect(r.body.inflowsProvenance).toMatch(/not been indexed/);
    expect(r.body.allowlistNote).toMatch(/never written over HTTP/);
  });

  it("a token that is not allowlisted is refused, even with a perfect route", async () => {
    const a = await app(baseState(), ["viewer"]);
    const r = await a.route(WETH);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/not on the treasury conversion allowlist/);
    const p = await a.prepare({ token: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6", amount: "1", routeId: `0x${"1".repeat(64)}`, quotedAt: new Date().toISOString() });
    expect(p.status).toBe(403); // viewer
  });

  it("no-route: says so plainly and tries nothing else", async () => {
    const st = baseState({ pools: [] });
    const a = await app(st, ["viewer"]);
    const r = await a.route(USDG);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("no-route");
    expect(r.body.message).toMatch(/No Latch route from USDG to ETH/);
    expect(st.calls.some((c) => c.to?.toLowerCase() === d.clQuoter.toLowerCase())).toBe(false);
  });

  it("route: the best acceptable Latch route with quote, impact and a rounded-up min-out", async () => {
    const a = await app(baseState(), ["viewer"]);
    const r = await a.route(USDG, "1000000000");
    expect(r.body.status, JSON.stringify(r.body).slice(0, 600)).toBe("route");
    expect(r.body.best.end).toBe("native");
    expect(r.body.best.blockers).toEqual([]);
    expect(BigInt(r.body.best.minOut)).toBe(minOutFor(BigInt(r.body.best.quote.amountOut), 50));
    expect(r.body.best.impact.priceImpactBps).toBeGreaterThan(0);
    expect(r.body.best.impact.priceImpactBps).toBeLessThanOrEqual(100);
  });

  it("price impact above maxPriceImpactBps is a blocker and the payload is refused", async () => {
    const st = baseState({ quote: (_ids, _in, mid) => (mid * 95n) / 100n }); // 5% below mid
    const a = await app(st);
    const r = await a.route(USDG, "1000000000");
    expect(r.body.best.blockers.join()).toMatch(/price impact \d+ bps exceeds maxPriceImpactBps 100/);
    const p = await a.prepare({ token: USDG, amount: "1000000000", routeId: r.body.best.routeId, quotedAt: r.body.quotedAt });
    expect(p.status).toBe(409);
    expect(p.body.error.message).toMatch(/price impact/);
  });

  it("an ARMED RevShare proposal on a pool refuses every route through it (legacy shape, contract clock)", async () => {
    const st = baseState();
    const usdgNvda = poolRow(st.pools[2]!).poolId.toLowerCase();
    st.pending[`${RETIRED_REVSHARE.toLowerCase()}:${usdgNvda}`] = legacyPending(st.contractBlockNumber - 10n);
    const a = await app(st, ["viewer"]);
    const r = await a.route(NVDA, "1000000000000000000");
    expect(r.body.status).toBe("no-acceptable-route");
    expect(r.body.candidates.every((c: { refusals: string[] }) => c.refusals.some((x) => /ARMED/.test(x)))).toBe(true);
    // Refused pools are never quoted: the quoter would run the hook.
    expect(st.calls.some((c) => c.to?.toLowerCase() === d.clQuoter.toLowerCase())).toBe(false);
  });

  it("a queued proposal maturing inside the deadline is refused; one maturing after it is not", async () => {
    const soon = baseState();
    const id = poolRow(soon.pools[2]!).poolId.toLowerCase();
    soon.pending[`${RETIRED_REVSHARE.toLowerCase()}:${id}`] = legacyPending(soon.contractBlockNumber + 100n); // ~20 min at 12 s
    expect((await (await app(soon, ["viewer"])).route(NVDA, "1000000000000000000")).body.status).toBe("no-acceptable-route");
    const later = baseState();
    later.pending[`${RETIRED_REVSHARE.toLowerCase()}:${id}`] = legacyPending(later.contractBlockNumber + 10_000n); // ~33 h
    const r = await (await app(later, ["viewer"])).route(NVDA, "1000000000000000000");
    expect(r.body.status).toBe("route");
  });

  it("a hook flagged Malicious, or a third-party hook not in the registry, is refused", async () => {
    const mal = baseState();
    mal.pools[2] = { ...mal.pools[2]!, hooks: THIRD_PARTY_HOOK };
    mal.registry[THIRD_PARTY_HOOK.toLowerCase()] = { registered: true, listing: 2 };
    const r = await (await app(mal, ["viewer"])).route(NVDA, "1000000000000000000");
    expect(r.body.status).toBe("no-acceptable-route");
    expect(JSON.stringify(r.body.candidates)).toMatch(/Malicious/);
    const unreg = baseState();
    unreg.pools[2] = { ...unreg.pools[2]!, hooks: THIRD_PARTY_HOOK };
    const u = await (await app(unreg, ["viewer"])).route(NVDA, "1000000000000000000");
    expect(JSON.stringify(u.body.candidates)).toMatch(/not in LatchRegistry/);
  });

  it("prepare: returns the simulated Safe batch and writes an audit row; sends nothing", async () => {
    const st = baseState();
    const a = await app(st);
    const r = await a.route(USDG, "1000000000");
    const p = await a.prepare({ token: USDG, amount: "1000000000", routeId: r.body.best.routeId, quotedAt: r.body.quotedAt });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.payload).toMatchObject({ kind: "safe", to: MSC, operation: 1, value: "0", safe: SAFE });
    expect(p.body.payload.innerCalls).toHaveLength(3);
    expect(p.body.quote.deadline).toBe((st.nowSeconds + 3600n).toString());
    expect(p.body.simulation).toMatchObject({ status: "success", meetsMinOut: true, safe: { version: "1.4.1", guard: null } });
    expect(BigInt(p.body.simulation.nativeReceived)).toBeGreaterThanOrEqual(BigInt(p.body.quote.minOut));
    expect(p.body.simulation.notSimulated.join(" ")).toMatch(/signatures/);
    expect(p.body.multiSendCallOnly.codeHash).toBe(tc.multiSendCallOnly.codeHash);
    const audit = a.tables.auditLog.rows.filter((x) => x.action === "safe.prepare.treasury-convert");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.after)).toContain(p.body.payload.data.slice(0, 42));
  });

  it("prepare refuses a stale review, a changed route, a lagging head, an unverified MultiSend, too much, and too little", async () => {
    const st = baseState();
    const a = await app(st);
    const r = await a.route(USDG, "1000000000");
    const ok = { token: USDG, amount: "1000000000", routeId: r.body.best.routeId, quotedAt: r.body.quotedAt };
    expect((await a.prepare({ ...ok, quotedAt: new Date(Date.now() - 10 * 60_000).toISOString() })).body.error.message).toMatch(/stale/);
    expect((await a.prepare({ ...ok, routeId: `0x${"ab".repeat(32)}` })).body.error.message).toMatch(/route changed/);
    expect((await a.prepare({ ...ok, amount: "3000000000" })).body.error.message).toMatch(/exceeds the Safe's USDG balance/);
    expect((await a.prepare({ ...ok, amount: "1000" })).body.error.message).toMatch(/below minValueWei/);

    const lag = baseState({ nowSeconds: BigInt(Math.floor(Date.now() / 1000) - 900) });
    const la = await app(lag);
    const lr = await la.route(USDG, "1000000000");
    expect((await la.prepare({ token: USDG, amount: "1000000000", routeId: lr.body.best.routeId, quotedAt: new Date().toISOString() })).body.error.message).toMatch(/chain head .* old/);

    const bad = baseState({ multiSendCodeHashOk: false });
    const ba = await app(bad);
    const br = await ba.route(USDG, "1000000000");
    const bp = await ba.prepare({ token: USDG, amount: "1000000000", routeId: br.body.best.routeId, quotedAt: br.body.quotedAt });
    expect(bp.status).toBe(409);
    expect(bp.body.error.message).toMatch(/Refusing to build a DELEGATECALL/);
    expect(ba.tables.auditLog.rows.filter((x) => x.action === "safe.prepare.treasury-convert")).toHaveLength(0);
  });

  it("a reverting batch is returned with DO NOT SIGN and the failing call index; an RPC without state override reports what was not simulated", async () => {
    const st = baseState({ simulation: "revert" });
    const a = await app(st);
    const r = await a.route(USDG, "1000000000");
    const p = await a.prepare({ token: USDG, amount: "1000000000", routeId: r.body.best.routeId, quotedAt: r.body.quotedAt });
    expect(p.body.simulation.status).toBe("reverted");
    expect(p.body.payload.warnings[0]).toMatch(/Do not sign/);
    expect(p.body.simulation.steps.find((s: { status: string }) => s.status === "reverted").index).toBe(2);

    const no = baseState({ simulation: "override-unsupported" });
    const b = await app(no);
    const r2 = await b.route(USDG, "1000000000");
    const p2 = await b.prepare({ token: USDG, amount: "1000000000", routeId: r2.body.best.routeId, quotedAt: r2.body.quotedAt });
    expect(p2.body.simulation.status).toBe("unavailable");
    expect(p2.body.simulation.steps.map((s: { status: string }) => s.status)).toEqual(["success", "success", "not-simulated"]);
    expect(p2.body.simulation.notSimulated[0]).toMatch(/the swap/);
  });

  it("alerts: INFO 'conversion available' only when the balance is above its size AND a Latch route exists", async () => {
    const a = await app(baseState({ balances: { [`${USDG}:${SAFE}`.toLowerCase()]: 5_000n * 10n ** 6n } }), ["viewer"]);
    const r = await request(a.app).get("/v1/admin/alerts").set("Cookie", a.s.cookie).expect(200);
    const t = r.body.alerts.filter((x: { id: string }) => x.id.startsWith("treasury:"));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ severity: "INFO", category: "revenue", title: "Conversion available: 5000 USDG in the Safe", action: { page: "treasury" } });

    const none = await app(baseState({ pools: [], balances: { [`${USDG}:${SAFE}`.toLowerCase()]: 5_000n * 10n ** 6n } }), ["viewer"]);
    const r2 = await request(none.app).get("/v1/admin/alerts").set("Cookie", none.s.cookie).expect(200);
    expect(r2.body.alerts.filter((x: { id: string }) => x.id.startsWith("treasury:"))).toEqual([]);
    // The pure rule: a non-route status never alerts.
    expect(computeAlerts({ now: new Date(), chains: [], governance: [], ownership: [], pendingConfigs: [], opsBalances: [], feeds: [], stockTokens: [], timelockOps: [], reconciliationMismatches: [], pendingListings: 0, treasuryConversions: [{ chainId: 4663, token: USDG, symbol: "USDG", balanceRaw: "9", balanceUnits: "9", thresholdRaw: "1", routeStatus: "no-acceptable-route", blockers: [], minOutWei: null, readAtBlock: "1", readAt: "x" }] })).toEqual([]);
  });
});
