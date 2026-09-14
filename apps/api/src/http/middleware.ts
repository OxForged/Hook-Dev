import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { pinoHttp } from "pino-http";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { keyFromHeaders, type Scope } from "../auth/keys.js";
import { ANON_SCOPES, usagePeriod, type Identity, type KeyResolver, type UsageCounter } from "../auth/identity.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../lib/errors.js";
import { checkRate, type RateLimitStore } from "../ratelimit/limiter.js";

/** Kept here (not imported from listings.ts) so middleware has no route dependency. listings.test pins them equal. */
export const LISTING_BODY_LIMIT_BYTES = 400 * 1024;

/* ---------------------------------------------------------------------------
   Request context and logging
   --------------------------------------------------------------------------- */

export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header("x-request-id");
  const id = inbound && /^[A-Za-z0-9._-]{1,100}$/.test(inbound) ? inbound : randomUUID();
  res.setHeader("X-Request-Id", id);
  res.locals.requestId = id;
  next();
};

/**
 * Access log. Custom serializers log method, PATH (no query string) and status —
 * never headers — so a key, cookie or CSRF token cannot reach a log line even if
 * the redaction list were wrong.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? randomUUID()),
  serializers: {
    req: (req: { method?: string; url?: string; id?: string }) => ({ id: req.id, method: req.method, path: (req.url ?? "").split("?")[0] }),
    res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
  },
  customProps: (_req, res) => {
    const who = (res as Response).locals?.identity as Identity | undefined;
    return who ? { caller: who.kind === "key" ? `key:${who.prefix}` : "anonymous" } : {};
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
  autoLogging: { ignore: (req) => req.url === "/health/live" },
});

/* ---------------------------------------------------------------------------
   Abuse limits: size, shape, time
   --------------------------------------------------------------------------- */

export const MAX_URL_LENGTH = 2_048;

/** Read-only API: no bodies, short URLs, no credentials in the query string. */
export const requestLimits: RequestHandler = (req, _res, next) => {
  if (req.originalUrl.length > MAX_URL_LENGTH) return next(new ApiError(414, "URI_TOO_LONG", "URL too long"));
  const len = Number(req.header("content-length") ?? "0");
  const isAdminWrite = req.path.startsWith("/v1/admin/") && req.method === "POST";
  // The public listing submission carries a base64 icon; its own json() parser enforces the same cap.
  const isListingSubmit = (req.path === "/v1/listings" || req.path === "/v1/listings/") && req.method === "POST";
  const maxBody = isAdminWrite ? 16_384 : isListingSubmit ? LISTING_BODY_LIMIT_BYTES : 0;
  if (!Number.isFinite(len) || len > maxBody || (maxBody === 0 && req.header("transfer-encoding"))) {
    return next(new ApiError(413, "PAYLOAD_TOO_LARGE", maxBody === 0 ? "This endpoint takes no request body" : "Request body too large"));
  }
  const q = req.query as Record<string, unknown>;
  if ("apiKey" in q || "api_key" in q || "key" in q) {
    // Query strings end up in proxy logs, browser history and Referer headers.
    return next(ApiError.badRequest("Send API keys in the X-API-Key header, never in the URL"));
  }
  next();
};

/** Hard per-request deadline. A slow query becomes a 503, not a hung socket. */
export function requestTimeout(ms: number): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: { code: "TIMEOUT", message: `Request exceeded ${ms} ms` } });
      }
    }, ms);
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

/* ---------------------------------------------------------------------------
   Validation
   --------------------------------------------------------------------------- */

export function validate(schemas: { query?: ZodTypeAny; params?: ZodTypeAny; body?: ZodTypeAny }): RequestHandler {
  return (req, res, next) => {
    const out: Record<string, unknown> = {};
    for (const source of ["query", "params", "body"] as const) {
      const schema = schemas[source];
      if (!schema) continue;
      const r = schema.safeParse(req[source] ?? {});
      if (!r.success) {
        return next(ApiError.validation(`Invalid request ${source}`, r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))));
      }
      out[source] = r.data;
    }
    res.locals.validated = out;
    next();
  };
}

export function input<Q extends ZodTypeAny = ZodTypeAny, P extends ZodTypeAny = ZodTypeAny, B extends ZodTypeAny = ZodTypeAny>(
  res: Response,
): { query: z.infer<Q>; params: z.infer<P>; body: z.infer<B> } {
  return res.locals.validated as { query: z.infer<Q>; params: z.infer<P>; body: z.infer<B> };
}

/* ---------------------------------------------------------------------------
   Identity, scopes, rate limits, quotas
   --------------------------------------------------------------------------- */

export interface AccessDeps {
  keys: KeyResolver;
  rate: RateLimitStore;
  usage: UsageCounter;
  anonPerMinute: number;
}

/**
 * Anonymous callers are limited per IP. A PRESENTED key that does not resolve is
 * a 401, never a silent downgrade to anonymous (a typo'd key should fail loudly,
 * not quietly start eating the free tier).
 */
export function identify(deps: AccessDeps): RequestHandler {
  return async (req, res, next) => {
    try {
      const presented = keyFromHeaders({
        authorization: req.header("authorization"),
        "x-api-key": req.header("x-api-key"),
      });
      let identity: Identity;
      if (presented) {
        const key = await deps.keys.resolve(presented);
        if (!key) throw ApiError.unauthorized("Invalid, expired or revoked API key");
        identity = key;
      } else {
        identity = { kind: "anonymous", ip: req.ip ?? "unknown", scopes: ANON_SCOPES };
      }
      res.locals.identity = identity;

      const limit = identity.kind === "key" ? identity.rateLimitPerMinute : deps.anonPerMinute;
      const bucket = identity.kind === "key" ? `key:${identity.keyId}` : `ip:${identity.ip}`;
      const d = await checkRate(deps.rate, bucket, limit);
      res.setHeader("RateLimit-Limit", String(d.limit));
      res.setHeader("RateLimit-Remaining", String(d.remaining));
      res.setHeader("RateLimit-Reset", String(d.resetAt));
      if (!d.allowed) {
        res.setHeader("Retry-After", String(d.retryAfterSeconds));
        throw new ApiError(429, "RATE_LIMITED", identity.kind === "key" ? "Rate limit exceeded for this key" : "Anonymous rate limit exceeded; use an API key for more");
      }

      if (identity.kind === "key") {
        let used: number | null = null;
        try {
          used = await deps.usage.increment(identity.keyId, usagePeriod());
        } catch {
          logger.warn({ key: identity.prefix }, "usage counter unavailable; request served uncounted");
        }
        if (used !== null) {
          res.setHeader("X-Quota-Limit", String(identity.monthlyQuota));
          res.setHeader("X-Quota-Used", String(used));
          if (used > identity.monthlyQuota) throw new ApiError(429, "QUOTA_EXCEEDED", "Monthly quota exhausted for this key");
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireScope(scope: Scope): RequestHandler {
  return (_req, res, next) => {
    const who = res.locals.identity as Identity | undefined;
    if (!who || !who.scopes.includes(scope)) return next(ApiError.forbidden(`This request needs the ${scope} scope`));
    next();
  };
}

/** Public responses are cacheable for a few seconds; keyed ones only privately. */
export const publicCacheHeaders: RequestHandler = (_req, res, next) => {
  const who = res.locals.identity as Identity | undefined;
  res.setHeader("Cache-Control", who?.kind === "key" ? "private, max-age=5" : "public, max-age=10");
  res.setHeader("Vary", "X-API-Key, Authorization");
  next();
};

/* ---------------------------------------------------------------------------
   Errors
   --------------------------------------------------------------------------- */

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error({ code: err.code, path: req.path }, err.message);
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "Invalid request" } });
    return;
  }
  if ((err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } });
    return;
  }
  if (err instanceof Prisma.PrismaClientInitializationError || err instanceof Prisma.PrismaClientRustPanicError) {
    logger.error({ path: req.path }, "database unavailable");
    res.status(503).json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Database unavailable" } });
    return;
  }
  // Never echo an internal message: it can contain SQL, parameters or URLs.
  logger.error({ path: req.path, name: (err as Error)?.name }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
};
