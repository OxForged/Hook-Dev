import type { Server } from "node:http";
import { createApp } from "./app.js";
import { disconnectRedis } from "./cache/redis.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { disconnectDatabase, prisma } from "./db/prisma.js";
import { closeQueues } from "./jobs/queue.js";
import { createIngestionWorker, scheduleAllChains } from "./jobs/worker.js";

/**
 * API entry point.
 *
 * By default this process also runs the ingestion worker, so `docker compose up`
 * plus `npm run dev` is enough to see data. Set `INGEST_ENABLED=false` here and
 * run `npm run start:worker` separately to split them, which is what you want
 * once a backfill is large enough to compete with request handling.
 */
async function main(): Promise<void> {
  const app = createApp(prisma);

  const workers: { close: () => Promise<void> }[] = [];

  if (env.INGEST_ENABLED) {
    workers.push(createIngestionWorker());
    // Scheduling touches the database, so failure here should not stop the API
    // from serving what is already ingested.
    scheduleAllChains().catch((err) =>
      logger.error({ err }, "failed to schedule ingestion polling"),
    );
  }

  const server: Server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        port: env.PORT,
        host: env.HOST,
        env: env.NODE_ENV,
        chainProvider: env.CHAIN_PROVIDER,
        ingestInProcess: env.INGEST_ENABLED,
      },
      "LatchProtocol API listening",
    );
    if (env.CHAIN_PROVIDER === "fixture") {
      logger.warn(
        "CHAIN_PROVIDER=fixture: every row served by this process is synthetic. " +
          "No LatchProtocol contract is deployed on any chain.",
      );
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    // Stop accepting connections first, then drain dependencies.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception; exiting");
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start API");
  process.exit(1);
});
