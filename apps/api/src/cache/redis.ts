import { Redis, type RedisOptions } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Redis connections, created on first use (so importing a module that might
 * touch Redis does not open a socket — the unit tests rely on that).
 *
 * Two connections, deliberately: BullMQ needs `maxRetriesPerRequest: null` and
 * owns blocking commands on its connection; the cache/rate-limit client must not
 * stall behind them.
 */

const BASE: RedisOptions = {
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
};

let cache: Redis | undefined;
let queue: Redis | undefined;

function create(name: string, options: RedisOptions): Redis {
  const client = new Redis(env.REDIS_URL, { ...BASE, ...options, connectionName: name });
  // The error object from ioredis can include the connection string; log the code only.
  client.on("error", (err: NodeJS.ErrnoException) =>
    logger.warn({ name, code: err.code ?? "unknown" }, "redis connection error"),
  );
  return client;
}

export function cacheRedis(): Redis {
  cache ??= create("latch-cache", { maxRetriesPerRequest: 1, commandTimeout: 1_000 });
  return cache;
}

export function queueRedis(): Redis {
  queue ??= create("latch-queue", { maxRetriesPerRequest: null });
  return queue;
}

export async function pingRedis(): Promise<void> {
  const pong = await cacheRedis().ping();
  if (pong !== "PONG") throw new Error("unexpected PING response");
}

export async function disconnectRedis(): Promise<void> {
  await Promise.allSettled([cache?.quit(), queue?.quit()]);
  cache = undefined;
  queue = undefined;
}
