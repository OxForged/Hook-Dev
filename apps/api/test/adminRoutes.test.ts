import { Prisma } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AdminRole } from "../src/admin/roles.js";
import { RECORDED_ACCEPT_OWNERSHIP_OPERATIONS } from "../src/admin/safeTx.js";
import type { Simulator } from "../src/admin/simulate.js";
import { buildAdminApp, ORIGIN, signIn, type Seed } from "./helpers/adminApp.js";
import { enumerateRoutes } from "../src/admin/treasury/route.js";
import { baseState, fakeTreasuryClient, poolRow, USDG, WETH } from "./helpers/treasuryChain.js";

// Treasury conversion fixture: pools and a chain on which USDG has a Latch route to native.
const TREASURY = baseState();
const TREASURY_POOLS = TREASURY.pools.map(poolRow);
const TREASURY_ROUTE = enumerateRoutes({ pools: TREASURY_POOLS, token: USDG, weth: WETH, latchClPoolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66" }).candidates.find((c) => c.end === "native")!;
const treasuryClient = () => fakeTreasuryClient(baseState());

/**
 * Every /v1/admin data route: auth required (401), wrong role (403), CSRF on
 * every mutation (403 without / with a wrong token / from a foreign origin), and
 * an audit row for every mutation.
 */

const SAFE = "0x715a6176946adbd22c1b2021d321fb3767ca3432";
const CUSTODY = "0x3ae354e2cdfb9cb855aba41c825f6ee53f28e119";
const ZERO = `0x${"0".repeat(40)}`;
const LISTING_ID = "clistingfixture0000000001";
const ACCOUNT_ID = "caccountfixture0000000001";
const KEY_ID = "ckeyfixture00000000000001";

interface RouteCase {
  method: "get" | "post";
  path: string;
  role: AdminRole;
  body?: Record<string, unknown>;
  /** audit action written on success (mutations and exports) */
  audit?: string;
  okStatus?: number;
}

export const ROUTES: RouteCase[] = [
  { method: "get", path: "/v1/admin/overview", role: "viewer" },
  { method: "get", path: "/v1/admin/alerts", role: "viewer" },
  { method: "get", path: "/v1/admin/revenue", role: "viewer" },
  { method: "get", path: "/v1/admin/revenue/export.csv", role: "viewer" },
  { method: "get", path: "/v1/admin/protocol", role: "viewer" },
  { method: "get", path: "/v1/admin/governance/ownership", role: "viewer" },
  { method: "get", path: "/v1/admin/governance/timelock", role: "viewer" },
  { method: "get", path: "/v1/admin/governance/roles", role: "viewer" },
  { method: "get", path: "/v1/admin/safety", role: "viewer" },
  { method: "get", path: "/v1/admin/safe/context", role: "viewer" },
  { method: "get", path: "/v1/admin/moderation/listings", role: "curator" },
  { method: "get", path: `/v1/admin/moderation/listings/${LISTING_ID}`, role: "curator" },
  { method: "get", path: `/v1/admin/moderation/listings/${LISTING_ID}/icon`, role: "curator", okStatus: 404 },
  { method: "post", path: `/v1/admin/moderation/listings/${LISTING_ID}/approve`, role: "curator", body: { note: "matches the project site" }, audit: "listing.approve" },
  { method: "post", path: `/v1/admin/moderation/listings/${LISTING_ID}/reject`, role: "curator", body: { reason: "the URL does not resolve to the project" }, audit: "listing.reject" },
  { method: "post", path: `/v1/admin/moderation/listings/${LISTING_ID}/request-changes`, role: "curator", body: { reason: "please add the public source repository" }, audit: "listing.request-changes" },
  { method: "get", path: "/v1/admin/keys/accounts", role: "admin" },
  { method: "post", path: "/v1/admin/keys/accounts", role: "admin", body: { name: "Acme", plan: "pro" }, audit: "apikey.account.create", okStatus: 201 },
  { method: "get", path: "/v1/admin/keys", role: "admin" },
  { method: "post", path: "/v1/admin/keys", role: "admin", body: { accountId: ACCOUNT_ID, name: "prod" }, audit: "apikey.mint", okStatus: 201 },
  { method: "post", path: `/v1/admin/keys/${KEY_ID}/revoke`, role: "admin", body: { reason: "rotated" }, audit: "apikey.revoke" },
  { method: "get", path: "/v1/admin/audit", role: "admin" },
  { method: "post", path: "/v1/admin/safe/fee-controller/collect", role: "admin", body: { poolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66", currency: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6", amount: "0" }, audit: "safe.prepare.collect" },
  { method: "post", path: "/v1/admin/safe/fee-controller/sweep", role: "admin", body: { poolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66", currency: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6" }, audit: "safe.prepare.sweep" },
  { method: "post", path: "/v1/admin/timelock/execute", role: "viewer", body: { operationId: RECORDED_ACCEPT_OWNERSHIP_OPERATIONS.operations[0].id }, audit: "timelock.prepare.execute" },
  { method: "get", path: "/v1/admin/treasury", role: "viewer" },
  { method: "get", path: `/v1/admin/treasury/route?token=${USDG}`, role: "viewer" },
  { method: "post", path: "/v1/admin/treasury/convert/prepare", role: "admin", body: { token: USDG, amount: "1000000000", routeId: TREASURY_ROUTE.id, quotedAt: new Date().toISOString() }, audit: "safe.prepare.treasury-convert" },
  { method: "post", path: "/v1/admin/registry/listing", role: "curator", body: { hook: "0x1111111111111111111111111111111111111111", action: "flag", reason: "drains swaps via hookDelta" }, audit: "registry.prepare.flag" },
];

const LOWER: Record<AdminRole, AdminRole | null> = { viewer: null, curator: "viewer", admin: "curator" };

function liveSeed(): Seed {
  const now = new Date();
  const ts = new Date(now.getTime() - 3 * 86_400_000); // scheduled 3 days ago: ready
  const own = (contractKey: string, address: string, check: string, observed: string, expectedAddress: string, tier: string) => ({
    id: `4663-${contractKey}-${check}`, chainId: 4663, contractKey, address, check, observed, expectedTier: tier, expectedAddress, matches: observed === expectedAddress, readError: null, readAtBlock: 62_600_000n, readAt: now,
  });
  const ops = RECORDED_ACCEPT_OWNERSHIP_OPERATIONS.operations;
  const tl = ops.flatMap((o, i) => [
    { id: `tl-${i}-s`, chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "CallScheduled", operationId: o.id, callIndex: 0, target: o.target.toLowerCase(), value: new Prisma.Decimal(0), data: "0x79ba5097", selector: "0x79ba5097", functionSignature: "function acceptOwnership()", predecessor: `0x${"0".repeat(64)}`, salt: null, delaySeconds: 172_800n, hazard: null, hazardNote: null, blockNumber: 61_325_176n, blockTimestamp: ts, txHash: `0x${"ab".repeat(32)}`, txIndex: 0, logIndex: i * 2 },
    { id: `tl-${i}-salt`, chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "CallSalt", operationId: o.id, callIndex: null, target: null, value: null, data: null, selector: null, functionSignature: null, predecessor: null, salt: o.salt, delaySeconds: null, hazard: null, hazardNote: null, blockNumber: 61_325_176n, blockTimestamp: ts, txHash: `0x${"ab".repeat(32)}`, txIndex: 0, logIndex: i * 2 + 1 },
  ]);
  return {
    ownershipSnapshot: [
      own("vault", "0x78e8359c6d34df797b8a793de8c7c6bffa97fb6c", "owner", SAFE, CUSTODY, "Custody (48h timelock)"),
      own("vault", "0x78e8359c6d34df797b8a793de8c7c6bffa97fb6c", "pendingOwner", CUSTODY, ZERO, "none pending"),
    ],
    opsBalance: [
      { id: "4663-canceller", chainId: 4663, label: "canceller", address: "0xe65f304e40b61d7417154cb3e725c0ee16701142", purpose: "canceller", balanceWei: new Prisma.Decimal("1183834050000"), minWei: new Prisma.Decimal("195835000000000"), belowMin: true, criticalWei: new Prisma.Decimal("19583500000000"), gasPriceWei: new Prisma.Decimal("78334000"), gasPriceSource: "config reference price", actionsAffordable: new Prisma.Decimal(0), severity: "CRITICAL", rationale: "r", readAtBlock: 62_600_000n, readAt: now },
    ],
    timelockEvent: tl,
    listingSubmission: [{ id: LISTING_ID, kind: "PROJECT", chainId: null, name: "Example", description: "d", websiteUrl: "https://example.org", status: "PENDING", iconAssetRef: null, contactPrivate: "ops@example.org", uses: ["rev-share"], chains: [4663], createdAt: now, updatedAt: now }],
    apiAccount: [{ id: ACCOUNT_ID, name: "Acme", plan: "pro", createdAt: now, updatedAt: now }],
    pool: TREASURY_POOLS,
    apiKey: [{ id: KEY_ID, accountId: ACCOUNT_ID, name: "old", prefix: "abcdefghijkl", secretHash: "f".repeat(64), scopes: ["public:read"], rateLimitPerMinute: 600, monthlyQuota: 1000, status: "ACTIVE", createdAt: now }],
  };
}

const okSimulator: Simulator = {
  simulate: async (req) => ({ status: "success", from: req.from, to: req.to, blockNumber: "1", returnData: `0x${"0".repeat(63)}1`, revert: null, error: null, simulatedAt: new Date().toISOString(), method: "eth_call" }),
};

const send = (app: Parameters<typeof request>[0], c: RouteCase, headers: Record<string, string>) => {
  let t = request(app)[c.method](c.path);
  for (const [k, v] of Object.entries(headers)) t = t.set(k, v);
  return c.method === "post" ? t.send(c.body ?? {}) : t;
};

describe("every admin route requires a session", () => {
  for (const c of ROUTES) {
    it(`${c.method.toUpperCase()} ${c.path} -> 401 without a session`, async () => {
      const { app } = buildAdminApp({ seed: liveSeed() });
      const res = await send(app, c, c.method === "post" ? { Origin: ORIGIN } : {});
      expect(res.status).toBe(401);
    });
  }
});

describe("every admin route enforces its role", () => {
  for (const c of ROUTES) {
    const lower = LOWER[c.role];
    if (!lower) continue;
    it(`${c.method.toUpperCase()} ${c.path} -> 403 for ${lower}`, async () => {
      const { app, tables } = buildAdminApp({ roles: [lower], seed: liveSeed(), treasuryClient: treasuryClient() });
      const s = await signIn(app);
      const res = await send(app, c, { Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(c.role);
      // A refused mutation writes nothing but the sign-in row.
      expect(tables.auditLog.rows.filter((r) => r.action === c.audit)).toHaveLength(0);
    });
  }
});

describe("every mutation enforces CSRF and writes an audit row", () => {
  for (const c of ROUTES.filter((r) => r.method === "post")) {
    it(`POST ${c.path}: CSRF missing/wrong/foreign origin -> 403; correct -> ${c.okStatus ?? 200} + audit ${c.audit}`, async () => {
      const { app, tables } = buildAdminApp({ roles: [c.role], seed: liveSeed(), simulator: okSimulator, treasuryClient: treasuryClient() });
      const s = await signIn(app);
      expect((await send(app, c, { Cookie: s.cookie, Origin: ORIGIN })).status).toBe(403);
      expect((await send(app, c, { Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": "wrong-token" })).status).toBe(403);
      expect((await send(app, c, { Cookie: s.cookie, Origin: "https://evil.example", "X-CSRF-Token": s.csrf })).status).toBe(403);
      expect(tables.auditLog.rows.filter((r) => r.action === c.audit)).toHaveLength(0);

      const ok = await send(app, c, { Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf });
      expect(ok.status, JSON.stringify(ok.body)).toBe(c.okStatus ?? 200);
      expect(ok.headers["cache-control"]).toBe("no-store");
      const rows = tables.auditLog.rows.filter((r) => r.action === c.audit);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor).toBe(s.address.toLowerCase());
    });
  }
});

describe("every read route answers its role, never publicly cached", () => {
  for (const c of ROUTES.filter((r) => r.method === "get")) {
    it(`GET ${c.path} as ${c.role}`, async () => {
      const { app } = buildAdminApp({ roles: [c.role], seed: liveSeed(), treasuryClient: treasuryClient() });
      const s = await signIn(app);
      const res = await send(app, c, { Cookie: s.cookie });
      // Revenue/protocol read the indexer checkpoint; with none they are NOT_INDEXED (the UI's not-configured state).
      expect([c.okStatus ?? 200, 503]).toContain(res.status);
      if (res.status === 503) expect(res.body.error.code).toBe("NOT_INDEXED");
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  }
});

describe("admin behaviour against the recorded live state", () => {
  it("session responses say which role was granted and why", async () => {
    const { app } = buildAdminApp({ roles: ["admin"] });
    const s = await signIn(app);
    expect(s.res.body.grants).toEqual([expect.objectContaining({ role: "admin", reason: "Safe owner" })]);
    const again = await request(app).get("/v1/admin/auth/session").set("Cookie", s.cookie).expect(200);
    expect(again.body.grants[0].source).toContain(SAFE.slice(2, 8));
  });

  it("overview surfaces the unaccepted custody handover as HIGH and the canceller as CRITICAL", async () => {
    const { app } = buildAdminApp({ roles: ["viewer"], seed: liveSeed() });
    const s = await signIn(app);
    const res = await request(app).get("/v1/admin/alerts").set("Cookie", s.cookie).expect(200);
    const high = res.body.alerts.find((a: { id: string }) => a.id === "own:4663:vault:custody-handover-unaccepted");
    expect(high.severity).toBe("HIGH");
    expect(high.detail).toContain("READY");
    expect(res.body.alerts.find((a: { id: string }) => a.id === "ops:4663:canceller").severity).toBe("CRITICAL");
    expect(res.body.counts.CRITICAL).toBeGreaterThanOrEqual(1);
  });

  it("mint returns the secret exactly once; listings show the prefix only; the audit row never holds the secret", async () => {
    const { app, tables } = buildAdminApp({ roles: ["admin"], seed: liveSeed() });
    const s = await signIn(app);
    const minted = await request(app).post("/v1/admin/keys").set({ Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf }).send({ accountId: ACCOUNT_ID, name: "prod" }).expect(201);
    expect(minted.body.secret).toMatch(/^latchk_[a-z2-7]{12}_[A-Za-z0-9_-]{43}$/);
    const list = await request(app).get("/v1/admin/keys").set("Cookie", s.cookie).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(minted.body.secret);
    expect(JSON.stringify(list.body)).not.toContain("secretHash");
    expect(JSON.stringify(tables.auditLog.rows)).not.toContain(minted.body.secret.split("_")[2]);
  });

  it("revoke drops the key cache entry", async () => {
    const { app, invalidated } = buildAdminApp({ roles: ["admin"], seed: liveSeed() });
    const s = await signIn(app);
    const r = await request(app).post(`/v1/admin/keys/${KEY_ID}/revoke`).set({ Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf }).send({ reason: "rotated" }).expect(200);
    expect(r.body.effective).toBe("immediately");
    expect(invalidated).toEqual(["f".repeat(64)]);
  });

  it("moderation detail shows the private contact to a curator; the queue list does not", async () => {
    const { app } = buildAdminApp({ roles: ["curator"], seed: liveSeed() });
    const s = await signIn(app);
    const list = await request(app).get("/v1/admin/moderation/listings").set("Cookie", s.cookie).expect(200);
    expect(JSON.stringify(list.body)).not.toContain("ops@example.org");
    const one = await request(app).get(`/v1/admin/moderation/listings/${LISTING_ID}`).set("Cookie", s.cookie).expect(200);
    expect(one.body.contactPrivate).toBe("ops@example.org");
  });

  it("a second review of the same listing conflicts instead of double-applying", async () => {
    const { app } = buildAdminApp({ roles: ["curator"], seed: liveSeed() });
    const s = await signIn(app);
    const h = { Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf };
    await request(app).post(`/v1/admin/moderation/listings/${LISTING_ID}/approve`).set(h).send({}).expect(200);
    await request(app).post(`/v1/admin/moderation/listings/${LISTING_ID}/request-changes`).set(h).send({ reason: "please add the public source repository" }).expect(409);
  });

  it("execute payload is built from indexed CallScheduled + CallSalt and refuses an unknown operation", async () => {
    const { app } = buildAdminApp({ roles: ["viewer"], seed: liveSeed(), simulator: okSimulator });
    const s = await signIn(app);
    const h = { Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf };
    const op = RECORDED_ACCEPT_OWNERSHIP_OPERATIONS.operations[1];
    const r = await request(app).post("/v1/admin/timelock/execute").set(h).send({ operationId: op.id }).expect(200);
    expect(r.body.payload.saltSource).toBe("indexed CallSalt event");
    expect(r.body.payload.recomputedId).toBe(op.id);
    expect(r.body.payload.direct.data.startsWith("0x134008d3")).toBe(true);
    expect(r.body.isOperationReady.ready).toBe(true);
    await request(app).post("/v1/admin/timelock/execute").set(h).send({ operationId: `0x${"12".repeat(32)}` }).expect(404);
  });

  it("the timelock view never shows a cancelled operation as executable", async () => {
    const seed = liveSeed();
    const op = RECORDED_ACCEPT_OWNERSHIP_OPERATIONS.operations[2];
    seed.timelockEvent!.push({ id: "tl-cancel", chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "Cancelled", operationId: op.id, callIndex: null, target: null, value: null, data: null, selector: null, functionSignature: null, predecessor: null, salt: null, delaySeconds: null, hazard: null, hazardNote: null, blockNumber: 61_400_000n, blockTimestamp: new Date(), txHash: `0x${"cd".repeat(32)}`, txIndex: 0, logIndex: 0 });
    const { app } = buildAdminApp({ roles: ["viewer"], seed, simulator: okSimulator });
    const s = await signIn(app);
    const tl = await request(app).get("/v1/admin/governance/timelock").set("Cookie", s.cookie).expect(200);
    const cancelled = tl.body.operations.find((o: { operationId: string }) => o.operationId === op.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.readyAt).toBeNull();
    await request(app).post("/v1/admin/timelock/execute").set({ Cookie: s.cookie, Origin: ORIGIN, "X-CSRF-Token": s.csrf }).send({ operationId: op.id }).expect(409);
  });

  it("CSV export of an unindexed chain is NOT_INDEXED, never an empty file", async () => {
    // The CSV encoder (formula injection) is covered in payloads.test.ts.
    const { app } = buildAdminApp({ roles: ["viewer"] });
    const s = await signIn(app);
    const r = await request(app).get("/v1/admin/revenue/export.csv").set("Cookie", s.cookie);
    expect(r.status).toBe(503);
  });

  it("admin UI is not served when the admin API is disabled", async () => {
    const { app } = buildAdminApp({ adminEnabled: false });
    await request(app).get("/admin/").expect(404);
    await request(app).get("/v1/admin/overview").expect(404);
  });
});
