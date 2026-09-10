import { PrismaClient } from "@prisma/client";
import { env, isProduction } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * One Prisma client per process. In watch mode `tsx` re-evaluates modules on
 * change, so the instance is stashed on `globalThis` to avoid leaking a
 * connection pool per reload.
 */
const globalForPrisma = globalThis as unknown as { __hpPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__hpPrisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: isProduction
      ? [{ emit: "event", level: "error" }]
      : [
          { emit: "event", level: "error" },
          { emit: "event", level: "warn" },
        ],
  });

prisma.$on("error" as never, (e: unknown) => logger.error({ prisma: e }, "prisma error"));

if (!isProduction) {
  globalForPrisma.__hpPrisma = prisma;
}

/** Cheap liveness probe for the readiness endpoint. */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
