import type { PrismaClient } from "@prisma/client";
import express, { type Express } from "express";
import helmet from "helmet";
import type { KeyResolver, UsageCounter } from "./auth/identity.js";
import type { AdminDeps } from "./http/admin.js";
import { adminRouter } from "./http/admin.js";
import {
  errorHandler,
  httpLogger,
  identify,
  notFound,
  requestId,
  requestLimits,
  requestTimeout,
} from "./http/middleware.js";
import { publicRouter } from "./http/public.js";
import type { RateLimitStore } from "./ratelimit/limiter.js";
import { DexScreenerService } from "./services/dexscreener.js";
import { ReadService } from "./services/read.js";

export interface AppDeps {
  prisma: PrismaClient;
  keys: KeyResolver;
  rate: RateLimitStore;
  usage: UsageCounter;
  anonPerMinute: number;
  requestTimeoutMs: number;
  dexMaxRange: number;
  trustProxy: boolean | string | number;
  /** Probe for /health/ready. */
  ready: () => Promise<Record<string, boolean>>;
  /** null disables /v1/admin entirely (the default). */
  admin: AdminDeps | null;
  logRequests?: boolean;
}

/**
 * Express app factory. Everything with state is injected, so the tests build
 * the app with in-memory stores and a stubbed Prisma.
 *
 * Order matters:
 *   request id -> log -> helmet -> size/shape limits -> timeout
 *   -> /health (no auth, no limit)
 *   -> /v1/admin (own CORS, own session auth, own limit)  [only if enabled]
 *   -> /v1 public CORS -> identify (key or IP) + rate limit + quota -> routes
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.set("trust proxy", deps.trustProxy);
  app.disable("x-powered-by");
  app.disable("etag");

  app.use(requestId);
  if (deps.logRequests !== false) app.use(httpLogger);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(requestLimits);
  app.use(requestTimeout(deps.requestTimeoutMs));

  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });
  app.get("/health/ready", async (_req, res) => {
    const checks = await deps.ready().catch(() => ({ database: false, redis: false }));
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded", checks });
  });

  if (deps.admin) {
    // Admin POST bodies are the only request bodies this service accepts (16 KB cap).
    app.use("/v1/admin", express.json({ limit: "16kb" }), adminRouter(deps.admin));
  } else {
    app.use("/v1/admin", (_req, res) => {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Admin API is disabled" } });
    });
  }

  // Public CORS: any origin may READ; no credentials, ever. Keys belong on servers.
  app.use("/v1", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "X-API-Key, Authorization, X-Request-Id");
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, X-Quota-Limit, X-Quota-Used, X-Latch-Provenance");
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") return void res.status(204).end();
    if (req.method !== "GET" && req.method !== "HEAD") return void res.status(405).json({ error: { code: "BAD_REQUEST", message: "Read-only API" } });
    next();
  });
  app.use("/v1", identify({ keys: deps.keys, rate: deps.rate, usage: deps.usage, anonPerMinute: deps.anonPerMinute }));

  const read = new ReadService(deps.prisma);
  app.use("/v1", publicRouter(read, new DexScreenerService(deps.prisma), deps.dexMaxRange));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
