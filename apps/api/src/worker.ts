import { Queue, Worker, type Job } from "bullmq";
import type { PrismaClient, RunKind } from "@prisma/client";
import { flushUsage } from "./auth/identity.js";
import { cacheInvalidate } from "./cache/cache.js";
import { cacheRedis, disconnectRedis, queueRedis } from "./cache/redis.js";
import { requireIndexedDeployment } from "./chain/deployments.js";
import { chainRpc } from "./chain/rpc.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { disconnectDatabase, prisma } from "./db/prisma.js";
import { feedsPass, governancePass } from "./indexer/governance.js";
import { ConcurrentPassError, indexPass } from "./indexer/indexer.js";
import { snapshotPass } from "./indexer/snapshots.js";

/**
 * The worker process: the only process that reads chains.
 *
 * One BullMQ queue, jobs run ONE AT A TIME (concurrency 1) — an index pass, then
 * its snapshot, never two passes over the same chain at once. The advisory lock
 * and checkpoint guard in `applySpan` make an accidental second worker harmless
 * rather than relying on this alone.
 *
 *   index:<chain>       every INDEX_POLL_MS
 *   snapshot:<chain>    every SNAPSHOT_POLL_MS    (pool state, tokens, accruals, reconciliation, hazards)
 *   governance:<chain>  every GOVERNANCE_POLL_MS  (ownership, ops balances)
 *   feeds:<chain>       every FEEDS_POLL_MS       (Chainlink)
 *   usage-flush         every 60 s                (Redis usage counters -> Postgres)
 */

const QUEUE = "latch-worker";

type JobData = { chainId?: number };

async function recorded<T>(db: PrismaClient, chainId: number, kind: RunKind, fn: () => Promise<T>): Promise<T> {
  const run = await db.indexerRun.create({ data: { chainId, kind } });
  try {
    const out = await fn();
    await db.indexerRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
    return out;
  } catch (err) {
    await db.indexerRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: err instanceof Error ? err.message.slice(0, 500) : "unknown" } });
    throw err;
  }
}

export async function handle(job: Job<JobData>): Promise<unknown> {
  const [kind] = job.name.split(":");
  const chainId = job.data.chainId ?? 0;
  switch (kind) {
    case "index": {
      try {
        const s = await indexPass(prisma, chainRpc(chainId), chainId);
        if (s.rows > 0 || s.reorg) await cacheInvalidate([]);
        logger.info(s, "index pass");
        return s;
      } catch (err) {
        if (err instanceof ConcurrentPassError) {
          logger.warn({ chainId }, err.message);
          return null;
        }
        throw err;
      }
    }
    case "snapshot":
      return recorded(prisma, chainId, "SNAPSHOT", async () => {
        const s = await snapshotPass(prisma, chainRpc(chainId), chainId);
        logger.info(s, "snapshot pass");
        return s;
      });
    case "governance":
      return recorded(prisma, chainId, "GOVERNANCE_SNAPSHOT", () => governancePass(prisma, chainRpc(chainId), chainId));
    case "feeds":
      return recorded(prisma, chainId, "FEEDS", () => feedsPass(prisma, chainRpc(chainId), chainId));
    case "usage-flush":
      return flushUsage(prisma, cacheRedis(), env.CACHE_PREFIX);
    default:
      throw new Error(`unknown job ${job.name}`);
  }
}

async function main(): Promise<void> {
  const chains = env.INDEX_CHAIN_IDS.map(Number);
  for (const id of chains) requireIndexedDeployment(id); // fail fast on a chain the SDK does not know

  const queue = new Queue<JobData>(QUEUE, { connection: queueRedis(), prefix: env.BULLMQ_PREFIX });
  const common = { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } };
  for (const chainId of chains) {
    await queue.upsertJobScheduler(`index-${chainId}`, { every: env.INDEX_POLL_MS }, { name: `index:${chainId}`, data: { chainId }, opts: common });
    await queue.upsertJobScheduler(`snapshot-${chainId}`, { every: env.SNAPSHOT_POLL_MS }, { name: `snapshot:${chainId}`, data: { chainId }, opts: common });
    await queue.upsertJobScheduler(`governance-${chainId}`, { every: env.GOVERNANCE_POLL_MS }, { name: `governance:${chainId}`, data: { chainId }, opts: common });
    await queue.upsertJobScheduler(`feeds-${chainId}`, { every: env.FEEDS_POLL_MS }, { name: `feeds:${chainId}`, data: { chainId }, opts: common });
  }
  await queue.upsertJobScheduler("usage-flush", { every: 60_000 }, { name: "usage-flush", data: {}, opts: common });

  const worker = new Worker<JobData>(QUEUE, handle, {
    connection: queueRedis(),
    prefix: env.BULLMQ_PREFIX,
    concurrency: 1,
    lockDuration: 10 * 60_000,
  });
  worker.on("failed", (job, err) => logger.error({ job: job?.name, message: err.message.split("\n")[0]?.replace(/https?:\/\/\S+/g, "<url>") }, "job failed"));
  logger.info({ chains }, "Latch worker started (read-only: holds no key, sends no transaction)");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await worker.close();
    await queue.close();
    await disconnectDatabase();
    await disconnectRedis();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (entry.endsWith("/worker.js") || entry.endsWith("/worker.ts")) {
  main().catch((err: unknown) => {
    logger.fatal({ message: (err as Error)?.message }, "worker failed to start");
    process.exit(1);
  });
}
