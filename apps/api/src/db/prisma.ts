import { PrismaClient } from "@prisma/client";
import { env, isProduction } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * One Prisma client per process. Query logging is OFF: a logged query carries
 * parameter values, and those include API-key hashes and session ids.
 */
const globalForPrisma = globalThis as unknown as { __latchPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__latchPrisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: [{ emit: "event", level: "error" }],
  });

prisma.$on("error" as never, (e: { message?: string; target?: string }) =>
  // `message` can embed SQL parameters; keep the target only.
  logger.error({ target: e?.target }, "prisma error"),
);

if (!isProduction) globalForPrisma.__latchPrisma = prisma;

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
