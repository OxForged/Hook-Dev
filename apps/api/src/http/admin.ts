import type { PrismaClient } from "@prisma/client";
import { Router, type RequestHandler } from "express";
import { getAddress, verifyMessage, type Address, type Hex, type PublicClient } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { z } from "zod";
import { hasRole, roleGrants, type AdminRole, type RoleResolver } from "../admin/roles.js";
import { AdminService } from "../admin/service.js";
import type { Simulator } from "../admin/simulate.js";
import { ReadService } from "../services/read.js";
import { registerAdminDataRoutes, type AdminDataDeps } from "./adminRoutes.js";
import {
  clearedCookie,
  parseCookies,
  randomToken,
  safeEqualHex,
  sessionCookie,
  SESSION_COOKIE_DEV,
  SESSION_COOKIE_SECURE,
  sha256,
  writeAudit,
} from "../admin/session.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../lib/errors.js";
import { checkRate, type RateLimitStore } from "../ratelimit/limiter.js";
import { input, validate } from "./middleware.js";

/**
 * /v1/admin/* — the admin panel's API. Off unless ADMIN_ENABLED.
 *
 *   auth: SIWE (EIP-4361). No passwords. A signed message with a single-use
 *         server nonce buys a short-lived httpOnly session cookie.
 *   roles: from chain state (Safe owners, registry curators) plus an env viewer
 *         allowlist, re-read every ADMIN_ROLE_RECHECK_SECONDS within a session.
 *   csrf: SameSite=Strict cookie + Origin allowlist + X-CSRF-Token on non-GET.
 *   never cached; rate limited per IP; every mutation audited.
 *   never holds a key, never sends a transaction.
 */

export interface AdminDeps {
  prisma: PrismaClient;
  roles: RoleResolver;
  /** Only for ERC-1271 / contract-account signature checks at sign-in. */
  verifyClient: Pick<PublicClient, "verifyMessage"> | null;
  rate: RateLimitStore;
  /** eth_call simulation of prepared payloads. null = payloads are returned unsimulated, labelled so. */
  simulator: Simulator | null;
  /** API-key minting from the panel (admin role). The pepper never leaves this process. */
  keys: AdminDataDeps["keys"];
  config: {
    origins: string[];
    siweDomain: string;
    roleChainId: number;
    sessionTtlSeconds: number;
    roleRecheckSeconds: number;
    perMinute: number;
    cookieSecure: boolean;
  };
}

export interface AdminSessionLocals {
  id: string;
  address: Address;
  roles: string[];
}

const NONCE_TTL_MS = 5 * 60_000;

export function adminRouter(deps: AdminDeps): Router {
  const r = Router();
  const cfg = deps.config;
  const cookieName = cfg.cookieSecure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV;

  // --- CORS: exact origins, credentials, no wildcard ------------------------
  r.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Origin");
    const origin = req.header("origin");
    if (origin && cfg.origins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Request-Id");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return void res.status(origin && cfg.origins.includes(origin) ? 204 : 403).end();
    // A browser always sends Origin on a cross-site or non-GET request. A non-GET
    // from any origin not on the list is refused before anything else runs.
    if (req.method !== "GET" && (!origin || !cfg.origins.includes(origin))) return next(ApiError.forbidden("Origin not allowed"));
    next();
  });

  // --- rate limit per IP ----------------------------------------------------
  r.use(async (req, res, next) => {
    try {
      const d = await checkRate(deps.rate, `admin:${req.ip ?? "unknown"}`, cfg.perMinute);
      if (!d.allowed) {
        res.setHeader("Retry-After", String(d.retryAfterSeconds));
        throw new ApiError(429, "RATE_LIMITED", "Admin rate limit exceeded");
      }
      next();
    } catch (e) {
      next(e);
    }
  });

  // --- auth -----------------------------------------------------------------

  r.post("/auth/nonce", async (req, res) => {
    const nonce = generateSiweNonce();
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    await deps.prisma.adminNonce.create({ data: { nonce, expiresAt, ip: req.ip ?? null } });
    res.json({ nonce, expiresAt: expiresAt.toISOString(), domain: cfg.siweDomain, chainId: cfg.roleChainId });
  });

  const verifyBody = z.object({ message: z.string().min(1).max(4_000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(20_000) });

  r.post("/auth/verify", validate({ body: verifyBody }), async (req, res) => {
    const { body } = input<z.ZodTypeAny, z.ZodTypeAny, typeof verifyBody>(res);
    const parsed = parseSiweMessage(body.message);
    if (!parsed.address || !parsed.nonce || !parsed.uri || !parsed.chainId) throw ApiError.badRequest("Malformed SIWE message");
    const address = getAddress(parsed.address);

    // Domain, time bounds, and address shape. Nonce is checked against the DB below.
    const valid = validateSiweMessage({ message: parsed, domain: cfg.siweDomain, address, time: new Date() });
    if (!valid) throw ApiError.unauthorized("SIWE message is for another domain or outside its validity window");
    if (parsed.chainId !== cfg.roleChainId) throw ApiError.unauthorized(`SIWE chainId must be ${cfg.roleChainId}`);
    let uriOrigin: string;
    try {
      uriOrigin = new URL(parsed.uri).origin;
    } catch {
      throw ApiError.unauthorized("SIWE uri is not a URL");
    }
    if (!cfg.origins.includes(uriOrigin)) throw ApiError.unauthorized("SIWE uri origin is not an allowed admin origin");

    // Single use: consume atomically. A replayed message finds nothing to consume.
    const consumed = await deps.prisma.adminNonce.updateMany({
      where: { nonce: parsed.nonce, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw ApiError.unauthorized("Nonce unknown, expired or already used");

    let ok = await verifyMessage({ address, message: body.message, signature: body.signature as Hex }).catch(() => false);
    if (!ok && deps.verifyClient) {
      ok = await deps.verifyClient.verifyMessage({ address, message: body.message, signature: body.signature as Hex }).catch(() => false);
    }
    if (!ok) throw ApiError.unauthorized("Signature does not match the address");

    let roles: AdminRole[];
    try {
      roles = await deps.roles.rolesFor(address);
    } catch {
      throw ApiError.unavailable("Could not read on-chain roles; try again");
    }
    if (roles.length === 0) {
      await writeAudit(deps.prisma, { actor: address, actorRoles: [], action: "auth.denied", requestId: res.locals.requestId, ip: req.ip });
      throw ApiError.forbidden("This address holds no admin, curator or viewer role");
    }

    const token = randomToken();
    const csrf = randomToken();
    const now = Date.now();
    const session = await deps.prisma.adminSession.create({
      data: {
        id: sha256(token),
        address: address.toLowerCase(),
        roles,
        csrfHash: sha256(csrf),
        chainId: cfg.roleChainId,
        expiresAt: new Date(now + cfg.sessionTtlSeconds * 1000),
        lastRoleCheckAt: new Date(now),
        ip: req.ip ?? null,
        userAgent: (req.header("user-agent") ?? "").slice(0, 200) || null,
      },
    });
    await writeAudit(deps.prisma, { actor: address, actorRoles: roles, action: "auth.signin", targetType: "session", targetId: session.id.slice(0, 12), requestId: res.locals.requestId, ip: req.ip });
    res.setHeader("Set-Cookie", sessionCookie(cookieName, token, cfg.sessionTtlSeconds, cfg.cookieSecure));
    res.json({ address: address.toLowerCase(), roles, grants: roleGrants(roles, cfg.roleChainId), chainId: cfg.roleChainId, expiresAt: session.expiresAt.toISOString(), csrfToken: csrf });
  });

  // --- session guard for everything below -----------------------------------
  const requireSession: RequestHandler = async (req, res, next) => {
    try {
      const token = parseCookies(req.header("cookie"))[cookieName];
      if (!token) throw ApiError.unauthorized("No admin session");
      const id = sha256(token);
      const s = await deps.prisma.adminSession.findUnique({ where: { id } });
      if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now()) throw ApiError.unauthorized("Session expired or revoked");

      if (req.method !== "GET") {
        const csrf = req.header("x-csrf-token");
        if (!csrf || !safeEqualHex(sha256(csrf), s.csrfHash)) throw ApiError.forbidden("Missing or invalid CSRF token");
      }

      let roles = s.roles;
      if (Date.now() - s.lastRoleCheckAt.getTime() > cfg.roleRecheckSeconds * 1000) {
        let fresh: AdminRole[];
        try {
          fresh = await deps.roles.rolesFor(getAddress(s.address));
        } catch {
          // Cannot confirm the role: refuse rather than trust a stale grant.
          throw ApiError.unavailable("Could not re-check on-chain roles");
        }
        if (fresh.length === 0) {
          await deps.prisma.adminSession.update({ where: { id }, data: { revokedAt: new Date(), roles: [] } });
          await writeAudit(deps.prisma, { actor: s.address, actorRoles: s.roles, action: "auth.revoked.role-lost", targetType: "session", targetId: id.slice(0, 12), before: { roles: s.roles }, after: { roles: [] }, requestId: res.locals.requestId, ip: req.ip });
          throw ApiError.unauthorized("On-chain role no longer held; session revoked");
        }
        if (fresh.join(",") !== s.roles.join(",")) {
          await writeAudit(deps.prisma, { actor: s.address, actorRoles: fresh, action: "auth.roles.changed", targetType: "session", targetId: id.slice(0, 12), before: { roles: s.roles }, after: { roles: fresh }, requestId: res.locals.requestId, ip: req.ip });
        }
        await deps.prisma.adminSession.update({ where: { id }, data: { roles: fresh, lastRoleCheckAt: new Date() } });
        roles = fresh;
      }
      res.locals.admin = { id, address: getAddress(s.address), roles } satisfies AdminSessionLocals;
      next();
    } catch (e) {
      next(e);
    }
  };

  const requireRole =
    (role: AdminRole): RequestHandler =>
    (_req, res, next) => {
      const a = res.locals.admin as AdminSessionLocals | undefined;
      if (!a || !hasRole(a.roles, role)) return next(ApiError.forbidden(`Requires the ${role} role`));
      next();
    };

  r.get("/auth/session", requireSession, async (req, res) => {
    const a = res.locals.admin as AdminSessionLocals;
    // Rotate the CSRF token and hand the new one to the same-origin UI.
    const csrf = randomToken();
    await deps.prisma.adminSession.update({ where: { id: a.id }, data: { csrfHash: sha256(csrf) } });
    res.json({ address: a.address.toLowerCase(), roles: a.roles, grants: roleGrants(a.roles, cfg.roleChainId), chainId: cfg.roleChainId, csrfToken: csrf });
  });

  r.post("/auth/logout", requireSession, async (req, res) => {
    const a = res.locals.admin as AdminSessionLocals;
    await deps.prisma.adminSession.update({ where: { id: a.id }, data: { revokedAt: new Date() } });
    await writeAudit(deps.prisma, { actor: a.address, actorRoles: a.roles, action: "auth.signout", targetType: "session", targetId: a.id.slice(0, 12), requestId: res.locals.requestId, ip: req.ip });
    res.setHeader("Set-Cookie", clearedCookie(cookieName, cfg.cookieSecure));
    res.status(204).end();
  });

  // --- data routes: every one names its role (src/http/adminRoutes.ts) ----------
  registerAdminDataRoutes(
    r,
    { prisma: deps.prisma, service: new AdminService(deps.prisma, new ReadService(deps.prisma)), simulator: deps.simulator, roleChainId: cfg.roleChainId, keys: deps.keys },
    { requireSession, requireRole },
  );

  r.use((err: unknown, _req: unknown, _res: unknown, next: (e?: unknown) => void) => {
    if (!(err instanceof ApiError)) logger.error({ name: (err as Error)?.name }, "admin route error");
    next(err);
  });
  return r;
}
