import { Worker, type Job } from "bullmq";
import { queueRedis } from "../cache/redis.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { disconnectDatabase, prisma } from "../db/prisma.js";
import { disconnectRedis } from "../cache/redis.js";
import { IngestionService } from "../services/ingestion.service.js";
import {
  INGESTION_QUEUE,
  JOB_NAMES,
  closeQueues,
  scheduleChainPoll,
  type BackfillJobData,
  type IngestionJobData,
  type PollJobData,
} from "./queue.js";

/**
 * Event-ingestion worker.
 *
 * Runs as its own process (`npm run start:worker`) so a slow backfill cannot
 * starve HTTP request handling, and so the two can be scaled independently.
 *
 * What it is reading today: fixtures. `CHAIN_PROVIDER` defaults to `fixture`
 * because nothing is deployed. The worker itself is agnostic — it calls
 * `IngestionService.ingest`, which resolves a provider through the boundary in
 * src/chain/provider. Pointing it at a real chain is configuration, not code.
 */

const ingestion = new IngestionService(prisma);

async function handle(job: Job<IngestionJobData>) {
  const started = Date.now();

  if (job.name === JOB_NAMES.poll) {
    const { chainId } = job.data as PollJobData;
    const summary = await ingestion.ingest({
      chainId,
      jobId: job.id,
      jobName: JOB_NAMES.poll,
    });
    logger.debug({ jobId: job.id, ms: Date.now() - started, ...summary }, "poll job finished");
    return summary;
  }

  if (job.name === JOB_NAMES.backfill) {
    const data = job.data as BackfillJobData;
    const summary = await ingestion.ingest({
      chainId: data.chainId,
      fromBlock: data.fromBlock !== undefined ? BigInt(data.fromBlock) : undefined,
      toBlock: data.toBlock !== undefined ? BigInt(data.toBlock) : undefined,
      force: data.force ?? false,
      jobId: job.id,
      jobName: JOB_NAMES.backfill,
    });
    logger.info({ jobId: job.id, ms: Date.now() - started, ...summary }, "backfill job finished");
    return summary;
  }

  throw new Error(`Unknown job name: ${job.name}`);
}

export function createIngestionWorker(): Worker<IngestionJobData> {
  const worker = new Worker<IngestionJobData>(INGESTION_QUEUE, handle, {
    connection: queueRedis,
    prefix: env.BULLMQ_PREFIX,
    concurrency: env.WORKER_CONCURRENCY,
    // A stalled backfill should be retried, not silently dropped.
    stalledInterval: 60_000,
    maxStalledCount: 2,
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, "ingestion job failed");
  });
  worker.on("error", (err) => logger.error({ err }, "ingestion worker error"));

  return worker;
}

/** Register the repeatable poll job for every enabled chain. */
export async function scheduleAllChains(): Promise<number> {
  const chains = await prisma.chain.findMany({ where: { enabled: true }, select: { id: true } });
  for (const chain of chains) {
    await scheduleChainPoll(chain.id, env.INGEST_POLL_INTERVAL_MS);
  }
  logger.info(
    { chains: chains.map((c) => c.id), everyMs: env.INGEST_POLL_INTERVAL_MS },
    "scheduled ingestion polling",
  );
  return chains.length;
}

/** Entry point when this module is run directly. */
async function main() {
  logger.info(
    { provider: env.CHAIN_PROVIDER, concurrency: env.WORKER_CONCURRENCY },
    "starting ingestion worker",
  );

  const worker = createIngestionWorker();
  await scheduleAllChains();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await worker.close();
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Run only when invoked as the process entry point, not when imported by the
// API for in-process job scheduling.
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, "/").includes("jobs/worker");

if (invokedDirectly) {
  main().catch((err) => {
    logger.fatal({ err }, "ingestion worker failed to start");
    process.exit(1);
  });
}
