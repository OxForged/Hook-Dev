import type { PrismaClient } from "@prisma/client";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { corsOrigins } from "./config/env.js";
import { prisma as defaultPrisma } from "./db/prisma.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { httpLogger, requestId } from "./middleware/requestContext.js";
import { buildRouter } from "./routes/index.js";

/**
 * Express application factory.
 *
 * Takes the Prisma client as a parameter so tests can hand in a client pointed
 * at a throwaway database without touching module-level state.
 */
export function createApp(prisma: PrismaClient = defaultPrisma): Express {
  const app = express();

  // Behind a load balancer, so req.ip and protocol come from X-Forwarded-*.
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(httpLogger);

  app.use(
    helmet({
      // This serves JSON to browser clients on other origins; a restrictive
      // CSP belongs on the frontend that renders HTML, not here.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  const origins = corsOrigins();
  app.use(
    cors({
      origin: origins === "*" ? true : origins,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Token", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "X-LatchProtocol-Data-Source"],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: "256kb" }));

  app.use(buildRouter(prisma));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
