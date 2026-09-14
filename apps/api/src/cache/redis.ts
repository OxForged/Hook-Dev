import { Redis, type RedisOptions } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Two Redis connections, deliberately.
 *
 * BullMQ requires `maxRetriesPerRequest: null` and takes ownership of its
 * connection's blocking commands, so sharing one client between the job queue
 * and the response cache makes cache reads stall behind a blocking BRPOPLPUSH.
 * Keep them separate.
 */

const BASE_OPTIONS: RedisOptions = {
  lazyConnect: false,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
};

function create(name: string, options: RedisOptions): Redis {
  const client = new Redis(env.REDIS_URL, { ...BASE_OPTIONS, ...options, connectionName: name });
  client.on("error", (err) => logger.warn({ err, name }, "redis connection error"));
  client.on("ready", () => logger.debug({ name }, "redis ready"));
  return client;
}

const globalForRedis = globalThis as unknown as {
  __hpCacheRedis?: Redis;
  __hpQueueRedis?: Redis;
};

/** General-purpose cache connection. */
export const cacheRedis: Redis = globalForRedis.__hpCacheRedis ?? create("hp-cache", {});

/** Connection handed to BullMQ queues and workers. */
export const queueRedis: Redis =
  globalForRedis.__hpQueueRedis ??
  create("hp-queue", {
    // Required by BullMQ: it must be allowed to block indefinitely.
    maxRetriesPerRequest: null,
  });

globalForRedis.__hpCacheRedis = cacheRedis;
globalForRedis.__hpQueueRedis = queueRedis;

export async function pingRedis(): Promise<void> {
  const pong = await cacheRedis.ping();
  if (pong !== "PONG") throw new Error(`Unexpected Redis PING response: ${pong}`);
}

export async function disconnectRedis(): Promise<void> {
  await Promise.allSettled([cacheRedis.quit(), queueRedis.quit()]);
}
