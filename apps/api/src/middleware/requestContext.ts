import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../lib/errors.js";

/** Attach a request id, echoing an inbound one so traces survive a proxy. */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header("x-request-id");
  const id = inbound && inbound.length <= 200 ? inbound : randomUUID();
  res.setHeader("X-Request-Id", id);
  res.locals.requestId = id;
  next();
};

export const httpLogger = pinoHttp({
  logger,
  genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? randomUUID()),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    // Health checks are noisy and uninteresting when they pass.
    return res.statusCode < 400 && _req.url?.startsWith("/health") ? "debug" : "info";
  },
  autoLogging: {
    ignore: (req) => req.url === "/health/live",
  },
});

/**
 * Guards the admin routes with a shared secret.
 *
 * When ADMIN_TOKEN is unset the routes are disabled outright rather than left
 * open — an unauthenticated "trigger a backfill" endpoint is not a default
 * anyone should get by forgetting to configure something.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!env.ADMIN_TOKEN) {
    next(
      ApiError.forbidden(
        "Admin routes are disabled because ADMIN_TOKEN is not set. See .env.example.",
      ),
    );
    return;
  }

  const header = req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : req.header("x-admin-token");

  if (!presented || !timingSafeEqual(presented, env.ADMIN_TOKEN)) {
    next(ApiError.unauthorized("Missing or invalid admin token"));
    return;
  }
  next();
};

/** Constant-time comparison, so the token cannot be recovered byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
