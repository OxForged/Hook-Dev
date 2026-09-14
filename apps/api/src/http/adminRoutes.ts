import { isLatchChainId } from "@latchprotocol/sdk";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { Request, RequestHandler, Response, Router } from "express";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { SCOPES, mintKey } from "../auth/keys.js";
import { usagePeriod } from "../auth/identity.js";
import { ApiError } from "../lib/errors.js";
import { toJsonSafe } from "../lib/serialize.js";
import type { AdminRole } from "../admin/roles.js";
import { writeAudit } from "../admin/session.js";
import { AdminService, ADMIN_WINDOWS, type RevenueQuery } from "../admin/service.js";
import { prepareCollectProtocolFees, prepareRegistryListing, prepareSweep } from "../admin/safeTx.js";
import type { Simulator, SimulationResult } from "../admin/simulate.js";
import { TIMELOCK_FUNCTIONS_ABI } from "../chain/abis.js";
import { encodeFunctionData } from "viem";
import { validate } from "./middleware.js";

/**
 * /v1/admin data routes. Mounted by adminRouter AFTER the session guard is
 * available; every route names its role explicitly, so a route without a role
 * check does not compile into this table (see ROUTES in test/adminRoutes.test.ts,
 * which asserts 401/403 for every entry).
 *
 *   viewer   reads
 *   curator  moderation, registry flag/unflag payloads
 *   admin    API keys, audit log, Safe payloads (collect, sweep)
 *
 * Every non-GET is CSRF-checked by the session guard and writes an audit row.
 */

export interface AdminDataDeps {
  prisma: PrismaClient;
  service: AdminService;
  simulator: Simulator | null;
  roleChainId: number;
  keys: { pepper: string; defaultRpm: number; defaultQuota: number; invalidate: (secretHash: string) => Promise<void> };
}

export interface Guards {
  requireSession: RequestHandler;
  requireRole: (role: AdminRole) => RequestHandler;
}

interface AdminLocals {
  id: string;
  address: Address;
  roles: string[];
}

type H = (req: Request, res: Response) => Promise<void>;
const h = (fn: H): RequestHandler => (req, res, next) => fn(req, res).catch(next);
const admin = (res: Response) => res.locals.admin as AdminLocals;
const v = <T>(res: Response, k: "query" | "params" | "body") => (res.locals.validated as Record<string, unknown>)[k] as T;

const address = z.string().refine((s) => isAddress(s), "must be a 0x address").transform((s) => s.toLowerCase());
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex value").transform((s) => s.toLowerCase());

async function audit(prisma: PrismaClient, req: Request, res: Response, action: string, target: { type?: string; id?: string }, before?: unknown, after?: unknown) {
  const a = admin(res);
  await writeAudit(prisma, { actor: a.address, actorRoles: a.roles, action, targetType: target.type, targetId: target.id, before, after, requestId: res.locals.requestId as string | undefined, ip: req.ip });
}

export function registerAdminDataRoutes(r: Router, deps: AdminDataDeps, g: Guards): void {
  const { prisma, service } = deps;
  const chainQ = z.object({
    chainId: z.coerce.number().int().refine((id) => isLatchChainId(id), "chain is not in the Latch address book").default(deps.roleChainId),
  });
  const chainOf = (res: Response) => v<{ chainId: number }>(res, "query").chainId;
  const S = g.requireSession;
  const R = g.requireRole;
  const json = (res: Response, body: unknown) => void res.json(toJsonSafe(body));

  const simulate = async (from: string, to: string, data: Hex, value = 0n): Promise<SimulationResult | { status: "unavailable"; error: string }> => {
    if (!deps.simulator) return { status: "unavailable", error: "simulation is not configured on this API process" };
    return deps.simulator.simulate({ from: getAddress(from), to: getAddress(to), data, value });
  };

  /* ---- reads (viewer) ---------------------------------------------------- */

  r.get("/overview", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, await service.overview(chainOf(res)))));
  r.get("/alerts", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, await service.alerts(chainOf(res)))));

  const revenueQ = chainQ.extend({
    token: address.optional(),
    source: z.enum(["PROTOCOL_FEE_COLLECTED", "PROTOCOL_FEE_SWEPT", "REVSHARE_PROTOCOL_CLAIM", "LP_LOCKER_PROTOCOL_CLAIM", "LP_LOCKER_INTEGRATOR_CLAIM", "KIT_LAUNCH_FEE"]).optional(),
    window: z.enum(Object.keys(ADMIN_WINDOWS) as [keyof typeof ADMIN_WINDOWS]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    usd: z.enum(["true", "false"]).default("false").transform((x) => x === "true"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  });
  const revenueQuery = (res: Response): RevenueQuery => {
    const q = v<z.infer<typeof revenueQ>>(res, "query");
    if (q.from && q.to && q.to <= q.from) throw ApiError.badRequest("`to` must be after `from`");
    return { token: q.token, source: q.source, window: q.window, from: q.from, to: q.to, usd: q.usd, limit: q.limit, offset: q.offset };
  };
  r.get("/revenue", S, R("viewer"), validate({ query: revenueQ }), h(async (_q, res) => json(res, await service.revenue(chainOf(res), revenueQuery(res)))));
  r.get(
    "/revenue/export.csv",
    S,
    R("viewer"),
    validate({ query: revenueQ }),
    h(async (req, res) => {
      const chainId = chainOf(res);
      const q = revenueQuery(res);
      const out = await service.revenueCsv(chainId, q);
      await audit(prisma, req, res, "revenue.export", { type: "revenue_ledger", id: String(chainId) }, undefined, { rows: out.rows, toBlock: out.toBlock, filters: { token: q.token ?? null, source: q.source ?? null, window: q.window ?? null } });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="latch-revenue-${chainId}-to-block-${out.toBlock}.csv"`);
      res.setHeader("X-Latch-Provenance", JSON.stringify({ chainId, toBlock: out.toBlock, rows: out.rows, truncated: out.truncated }));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(out.csv);
    }),
  );
  r.get("/protocol", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, await service.protocol(chainOf(res)))));
  r.get("/governance/ownership", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, await service.ownership(chainOf(res)))));
  r.get("/governance/timelock", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, await service.timelock(chainOf(res)))));
  r.get("/governance/roles", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, await service.roles(chainOf(res)))));
  r.get("/safety", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, await service.safety(chainOf(res)))));
  r.get("/safe/context", S, R("viewer"), validate({ query: chainQ }), h(async (_q, res) => json(res, service.safeContext(chainOf(res)))));

  /* ---- moderation (curator) ---------------------------------------------- */

  const listQ = z.object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  });
  const idP = z.object({ id: z.string().regex(/^[a-z0-9]{10,40}$/, "bad id") });

  const listingView = (l: Prisma.ListingSubmissionGetPayload<object>, withContact: boolean) => ({
    id: l.id,
    kind: l.kind,
    status: l.status,
    name: l.name,
    description: l.description,
    websiteUrl: l.websiteUrl,
    sourceUrl: l.sourceUrl,
    category: l.category,
    categoryOther: l.categoryOther,
    uses: l.uses,
    ownLatch: l.ownLatch,
    chains: l.chains,
    iconSourceUrl: l.iconSourceUrl,
    hasIcon: l.iconAssetRef !== null,
    turnstileVerified: l.turnstileVerified,
    ...(withContact ? { contactPrivate: l.contactPrivate } : {}),
    reviewer: l.reviewer,
    reviewNotes: l.reviewNotes,
    reviewedAt: l.reviewedAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  });

  r.get(
    "/moderation/listings",
    S,
    R("curator"),
    validate({ query: listQ }),
    h(async (_q, res) => {
      const q = v<z.infer<typeof listQ>>(res, "query");
      const where = q.status ? { status: q.status } : {};
      const [items, total, counts] = await Promise.all([
        prisma.listingSubmission.findMany({ where, orderBy: { createdAt: "asc" }, take: q.limit, skip: q.offset }),
        prisma.listingSubmission.count({ where }),
        prisma.listingSubmission.groupBy({ by: ["status"], _count: { _all: true } }),
      ]);
      json(res, { total, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), items: items.map((l) => listingView(l, false)) });
    }),
  );

  r.get(
    "/moderation/listings/:id",
    S,
    R("curator"),
    validate({ params: idP }),
    h(async (_q, res) => {
      const { id } = v<{ id: string }>(res, "params");
      const l = await prisma.listingSubmission.findUnique({ where: { id } });
      if (!l) throw ApiError.notFound(`Listing ${id}`);
      const asset = l.iconAssetRef ? await prisma.listingAsset.findUnique({ where: { id: l.iconAssetRef }, select: { id: true, contentType: true, byteLength: true, width: true, height: true, sha256: true } }) : null;
      json(res, { ...listingView(l, true), icon: asset });
    }),
  );

  r.get(
    "/moderation/listings/:id/icon",
    S,
    R("curator"),
    validate({ params: idP }),
    h(async (_q, res) => {
      const { id } = v<{ id: string }>(res, "params");
      const l = await prisma.listingSubmission.findUnique({ where: { id }, select: { iconAssetRef: true } });
      const asset = l?.iconAssetRef ? await prisma.listingAsset.findUnique({ where: { id: l.iconAssetRef } }) : null;
      if (!asset) throw ApiError.notFound("Icon");
      sendIcon(res, asset.contentType, Buffer.from(asset.bytes));
    }),
  );

  const reviewBody = z.object({ reason: z.string().trim().min(10, "give a reason the submitter can act on (10+ characters)").max(1_000) });
  const review = (action: "approve" | "reject" | "request-changes") =>
    h(async (req, res) => {
      const { id } = v<{ id: string }>(res, "params");
      const body = action === "approve" ? { reason: v<{ note?: string }>(res, "body").note ?? null } : v<{ reason: string }>(res, "body");
      const l = await prisma.listingSubmission.findUnique({ where: { id } });
      if (!l) throw ApiError.notFound(`Listing ${id}`);
      const allowed: Record<typeof action, string[]> = { approve: ["PENDING"], reject: ["PENDING", "APPROVED"], "request-changes": ["PENDING"] };
      if (!allowed[action].includes(l.status)) throw ApiError.conflict(`Cannot ${action} a listing that is ${l.status}`);
      const status = action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "CHANGES_REQUESTED";
      const a = admin(res);
      // Conditional update: a concurrent reviewer cannot double-apply.
      const updated = await prisma.listingSubmission.updateMany({ where: { id, status: l.status }, data: { status, reviewer: a.address.toLowerCase(), reviewNotes: body.reason, reviewedAt: new Date() } });
      if (updated.count !== 1) throw ApiError.conflict("The listing changed while you were reviewing it; reload");
      await audit(prisma, req, res, `listing.${action}`, { type: "listing_submission", id }, { status: l.status }, { status, reason: body.reason });
      json(res, { id, status, reviewer: a.address.toLowerCase(), reviewNotes: body.reason });
    });
  r.post("/moderation/listings/:id/approve", S, R("curator"), validate({ params: idP, body: z.object({ note: z.string().trim().max(1_000).optional() }) }), review("approve"));
  r.post("/moderation/listings/:id/reject", S, R("curator"), validate({ params: idP, body: reviewBody }), review("reject"));
  r.post("/moderation/listings/:id/request-changes", S, R("curator"), validate({ params: idP, body: reviewBody }), review("request-changes"));

  /* ---- API keys (admin) --------------------------------------------------- */

  r.get(
    "/keys/accounts",
    S,
    R("admin"),
    h(async (_q, res) => {
      const rows = await prisma.apiAccount.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { keys: true } } } });
      json(res, { items: rows.map((a) => ({ id: a.id, name: a.name, plan: a.plan, keys: a._count.keys, billingProvider: a.billingProvider, createdAt: a.createdAt })) });
    }),
  );

  const accountBody = z.object({ name: z.string().trim().min(1).max(120), contact: z.string().trim().max(200).optional(), plan: z.string().trim().regex(/^[a-z0-9-]{1,32}$/).default("free") });
  r.post(
    "/keys/accounts",
    S,
    R("admin"),
    validate({ body: accountBody }),
    h(async (req, res) => {
      const b = v<z.infer<typeof accountBody>>(res, "body");
      const a = await prisma.apiAccount.create({ data: { name: b.name, contact: b.contact ?? null, plan: b.plan } });
      await audit(prisma, req, res, "apikey.account.create", { type: "api_account", id: a.id }, undefined, { name: a.name, plan: a.plan });
      res.status(201);
      json(res, { id: a.id, name: a.name, plan: a.plan });
    }),
  );

  const keysQ = z.object({ accountId: z.string().regex(/^[a-z0-9]{10,40}$/).optional() });
  r.get(
    "/keys",
    S,
    R("admin"),
    validate({ query: keysQ }),
    h(async (_q, res) => {
      const q = v<z.infer<typeof keysQ>>(res, "query");
      const keys = await prisma.apiKey.findMany({ where: q.accountId ? { accountId: q.accountId } : {}, orderBy: { createdAt: "asc" }, include: { account: { select: { name: true } } } });
      const usage = keys.length ? await prisma.apiUsageMonthly.findMany({ where: { keyId: { in: keys.map((k) => k.id) } }, orderBy: { period: "desc" } }) : [];
      json(res, {
        period: usagePeriod(),
        usageSource: "api_usage_monthly (Redis counters flushed every 60 s; the current month can trail by up to a minute)",
        items: keys.map((k) => ({
          id: k.id,
          account: { id: k.accountId, name: k.account.name },
          name: k.name,
          // The prefix only. The secret is never stored and never returned after mint.
          prefix: `latchk_${k.prefix}_…`,
          scopes: k.scopes,
          status: k.status,
          rateLimitPerMinute: k.rateLimitPerMinute,
          monthlyQuota: k.monthlyQuota,
          createdAt: k.createdAt,
          expiresAt: k.expiresAt,
          revokedAt: k.revokedAt,
          revokedReason: k.revokedReason,
          lastUsedAt: k.lastUsedAt,
          usage: usage.filter((u) => u.keyId === k.id).slice(0, 12).map((u) => ({ period: u.period, requests: u.requests, flushedAt: u.flushedAt })),
        })),
      });
    }),
  );

  const mintBody = z.object({
    accountId: z.string().regex(/^[a-z0-9]{10,40}$/),
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.enum(SCOPES)).min(1).default(["public:read", "dexscreener:read"]),
    rateLimitPerMinute: z.number().int().min(1).max(100_000).optional(),
    monthlyQuota: z.number().int().min(1).max(1_000_000_000).optional(),
    expiresAt: z.coerce.date().optional(),
  });
  r.post(
    "/keys",
    S,
    R("admin"),
    validate({ body: mintBody }),
    h(async (req, res) => {
      const b = v<z.infer<typeof mintBody>>(res, "body");
      if (b.expiresAt && b.expiresAt.getTime() <= Date.now()) throw ApiError.badRequest("expiresAt is in the past");
      const account = await prisma.apiAccount.findUnique({ where: { id: b.accountId } });
      if (!account) throw ApiError.notFound(`Account ${b.accountId}`);
      const minted = mintKey(deps.keys.pepper);
      const key = await prisma.apiKey.create({
        data: { accountId: b.accountId, name: b.name, prefix: minted.prefix, secretHash: minted.secretHash, scopes: b.scopes, rateLimitPerMinute: b.rateLimitPerMinute ?? deps.keys.defaultRpm, monthlyQuota: b.monthlyQuota ?? deps.keys.defaultQuota, expiresAt: b.expiresAt ?? null },
      });
      // Audit carries the prefix, never the secret or its hash.
      await audit(prisma, req, res, "apikey.mint", { type: "api_key", id: key.id }, undefined, { prefix: key.prefix, accountId: key.accountId, scopes: key.scopes, rateLimitPerMinute: key.rateLimitPerMinute, monthlyQuota: key.monthlyQuota });
      res.status(201);
      json(res, {
        key: { id: key.id, prefix: `latchk_${key.prefix}_…`, scopes: key.scopes, rateLimitPerMinute: key.rateLimitPerMinute, monthlyQuota: key.monthlyQuota, expiresAt: key.expiresAt },
        secret: minted.plaintext,
        secretShownOnce: true,
        warning: "This is the only time the key is shown. It is not stored and cannot be recovered; a lost key is revoked and re-minted.",
      });
    }),
  );

  const revokeBody = z.object({ reason: z.string().trim().min(3).max(300) });
  r.post(
    "/keys/:id/revoke",
    S,
    R("admin"),
    validate({ params: idP, body: revokeBody }),
    h(async (req, res) => {
      const { id } = v<{ id: string }>(res, "params");
      const { reason } = v<{ reason: string }>(res, "body");
      const key = await prisma.apiKey.findUnique({ where: { id } });
      if (!key) throw ApiError.notFound(`Key ${id}`);
      if (key.status === "REVOKED") throw ApiError.conflict("Key is already revoked");
      await prisma.apiKey.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason } });
      let cacheDropped = true;
      try {
        await deps.keys.invalidate(key.secretHash);
      } catch {
        cacheDropped = false;
      }
      await audit(prisma, req, res, "apikey.revoke", { type: "api_key", id }, { status: key.status }, { status: "REVOKED", reason, prefix: key.prefix });
      json(res, { id, status: "REVOKED", effective: cacheDropped ? "immediately" : "within the 60 s key-cache TTL (Redis unreachable)" });
    }),
  );

  /* ---- audit log (admin) -------------------------------------------------- */

  const auditQ = z.object({
    actor: address.optional(),
    action: z.string().regex(/^[a-z0-9.-]{1,64}$/).optional(),
    targetType: z.string().regex(/^[a-z_]{1,40}$/).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  });
  r.get(
    "/audit",
    S,
    R("admin"),
    validate({ query: auditQ }),
    h(async (_q, res) => {
      const q = v<z.infer<typeof auditQ>>(res, "query");
      const where: Prisma.AuditLogWhereInput = {
        ...(q.actor ? { actor: q.actor } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.targetType ? { targetType: q.targetType } : {}),
        ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
      };
      const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: q.limit, skip: q.offset }), prisma.auditLog.count({ where })]);
      json(res, { total, limit: q.limit, offset: q.offset, items });
    }),
  );

  /* ---- payload builders ---------------------------------------------------- */

  const collectBody = z.object({ chainId: z.number().int().refine((id) => isLatchChainId(id)).default(deps.roleChainId), poolManager: address, currency: address, amount: z.string().regex(/^\d{1,78}$/), recipient: address.optional() });
  r.post(
    "/safe/fee-controller/collect",
    S,
    R("admin"),
    validate({ body: collectBody }),
    h(async (req, res) => {
      const b = v<z.infer<typeof collectBody>>(res, "body");
      const d = service.deployment(b.chainId);
      if (![d.clPoolManager, d.binPoolManager].map((x) => x.toLowerCase()).includes(b.poolManager)) throw ApiError.badRequest("poolManager must be one of the chain's Latch pool managers");
      let payload;
      try {
        payload = prepareCollectProtocolFees({ chainId: b.chainId, safe: d.governanceSafe, feeController: d.feeController, poolManager: b.poolManager, currency: b.currency, amount: BigInt(b.amount), recipient: b.recipient ?? d.governanceSafe });
      } catch (e) {
        throw ApiError.badRequest(e instanceof Error ? e.message : "invalid collect parameters");
      }
      const simulation = await simulate(d.governanceSafe, payload.to, payload.data);
      await audit(prisma, req, res, "safe.prepare.collect", { type: "fee_controller", id: d.feeController }, undefined, { to: payload.to, data: payload.data, simulation: simulation.status });
      json(res, { payload, simulation, simulatedFrom: d.governanceSafe });
    }),
  );

  const sweepBody = z.object({ chainId: z.number().int().refine((id) => isLatchChainId(id)).default(deps.roleChainId), poolManager: address, currency: address });
  r.post(
    "/safe/fee-controller/sweep",
    S,
    R("admin"),
    validate({ body: sweepBody }),
    h(async (req, res) => {
      const b = v<z.infer<typeof sweepBody>>(res, "body");
      const d = service.deployment(b.chainId);
      if (![d.clPoolManager, d.binPoolManager].map((x) => x.toLowerCase()).includes(b.poolManager)) throw ApiError.badRequest("poolManager must be one of the chain's Latch pool managers");
      const payload = prepareSweep({ chainId: b.chainId, safe: d.governanceSafe, feeController: d.feeController, poolManager: b.poolManager, currency: b.currency });
      const simulation = await simulate(d.governanceSafe, payload.to, payload.data);
      await audit(prisma, req, res, "safe.prepare.sweep", { type: "fee_controller", id: d.feeController }, undefined, { to: payload.to, data: payload.data, simulation: simulation.status });
      json(res, { payload, simulation, simulatedFrom: d.governanceSafe });
    }),
  );

  const execBody = z.object({ chainId: z.number().int().refine((id) => isLatchChainId(id)).default(deps.roleChainId), operationId: hex32 });
  r.post(
    "/timelock/execute",
    S,
    R("viewer"),
    validate({ body: execBody }),
    h(async (req, res) => {
      const b = v<z.infer<typeof execBody>>(res, "body");
      const from = admin(res).address;
      const { payload, operation } = await service.executePayload(b.chainId, b.operationId, from);
      const ready = await simulate(from, payload.direct.to, encodeFunctionData({ abi: TIMELOCK_FUNCTIONS_ABI, functionName: "isOperationReady", args: [b.operationId as Hex] }));
      const simulation = await simulate(from, payload.direct.to, payload.direct.data);
      await audit(prisma, req, res, "timelock.prepare.execute", { type: "timelock_operation", id: b.operationId }, undefined, { to: payload.direct.to, data: payload.direct.data, simulation: simulation.status });
      json(res, {
        payload,
        operation,
        isOperationReady: ready.status === "success" && "returnData" in ready ? { status: "success", ready: ready.returnData === `0x${"0".repeat(63)}1`, blockNumber: ready.blockNumber } : ready,
        simulation,
        simulatedFrom: from,
        note: "EXECUTOR_ROLE is address(0): any account may send this, not only the Safe.",
      });
    }),
  );

  const listingBody = z.object({ chainId: z.number().int().refine((id) => isLatchChainId(id)).default(deps.roleChainId), hook: address, action: z.enum(["flag", "unflag"]), reason: z.string().trim().min(10).max(512) });
  r.post(
    "/registry/listing",
    S,
    R("curator"),
    validate({ body: listingBody }),
    h(async (req, res) => {
      const b = v<z.infer<typeof listingBody>>(res, "body");
      const d = service.deployment(b.chainId);
      const from = admin(res).address;
      let payload;
      try {
        payload = prepareRegistryListing({ chainId: b.chainId, registry: d.registry, from, hook: b.hook, action: b.action, reason: b.reason });
      } catch (e) {
        throw ApiError.badRequest(e instanceof Error ? e.message : "invalid listing parameters");
      }
      const simulation = await simulate(from, payload.to, payload.data);
      await audit(prisma, req, res, `registry.prepare.${b.action}`, { type: "latch", id: b.hook }, undefined, { to: payload.to, data: payload.data, simulation: simulation.status });
      json(res, { payload, simulation, simulatedFrom: from, note: "A direct transaction from your curator (or, for flag, guardian) key. Not a Safe transaction: a queue on flagging a draining Latch makes the flag useless." });
    }),
  );
}

/** Icon response headers: a safe content type and a CSP that forbids everything, sandboxed. */
export function sendIcon(res: Response, contentType: string, bytes: Buffer): void {
  if (contentType !== "image/png" && contentType !== "image/svg+xml") throw ApiError.notFound("Icon");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="icon.${contentType === "image/png" ? "png" : "svg"}"`);
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.send(bytes);
}
