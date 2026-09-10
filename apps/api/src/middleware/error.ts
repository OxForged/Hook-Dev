import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { isProduction } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ApiError, ChainProviderNotConfiguredError } from "../lib/errors.js";

/** 404 for anything the router did not match. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `No route for ${req.method} ${req.path}`,
    },
  });
};

/**
 * Terminal error handler.
 *
 * Maps known failure shapes onto stable codes, and refuses to leak anything
 * else: an unrecognised error becomes a bare 500 whose message is fixed, with
 * the real detail going to the log rather than the response.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so handlers do not need try/catch just to reach this.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = res.getHeader("X-Request-Id");

  if (err instanceof ApiError) {
    if (err.status >= 500) {
      logger.error({ err, requestId, path: req.path }, err.message);
    } else {
      logger.debug({ code: err.code, requestId, path: req.path }, err.message);
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid request",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof ChainProviderNotConfiguredError) {
    logger.warn({ chainId: err.chainId, requestId }, err.message);
    res.status(503).json({
      error: { code: "DEPENDENCY_UNAVAILABLE", message: err.message },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025 = record not found; P2002 = unique constraint violated.
    const map: Record<string, { status: number; code: string }> = {
      P2025: { status: 404, code: "NOT_FOUND" },
      P2002: { status: 409, code: "CONFLICT" },
      P2003: { status: 409, code: "CONFLICT" },
    };
    const mapped = map[err.code];
    if (mapped) {
      res.status(mapped.status).json({
        error: { code: mapped.code, message: `Database constraint ${err.code}` },
      });
      return;
    }
  }

  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    logger.error({ err, requestId }, "database unavailable");
    res.status(503).json({
      error: { code: "DEPENDENCY_UNAVAILABLE", message: "Database unavailable" },
    });
    return;
  }

  logger.error({ err, requestId, path: req.path }, "unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: "Internal server error",
      ...(isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
    },
  });
};
