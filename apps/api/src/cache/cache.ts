import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cacheRedis } from "./redis.js";

/**
 * Read-through response cache.
 *
 * A cache failure never becomes a request failure: an outage is a miss. Values
 * must already be JSON-safe (run through `toJsonSafe`). Every read endpoint is
 * served from Postgres through this; no endpoint reads a chain.
 */

function key(parts: readonly (string | number)[]): string {
  return [env.CACHE_PREFIX, ...parts].join(":");
}

export async function cached<T>(
  parts: readonly (string | number)[],
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  if (ttlSeconds > 0 && env.CACHE_TTL_SECONDS > 0) {
    try {
      const raw = await cacheRedis().get(key(parts));
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      logger.debug({ key: parts[0] }, "cache read failed; computing");
    }
  }
  const value = await compute();
  if (ttlSeconds > 0 && env.CACHE_TTL_SECONDS > 0) {
    try {
      await cacheRedis().set(key(parts), JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      logger.debug({ key: parts[0] }, "cache write failed; ignoring");
    }
  }
  return value;
}

/** Drop cached entries under a prefix (SCAN, never KEYS). */
export async function cacheInvalidate(parts: readonly (string | number)[]): Promise<void> {
  const pattern = `${key(parts)}*`;
  let cursor = "0";
  try {
    do {
      const [next, batch] = await cacheRedis().scan(cursor, "MATCH", pattern, "COUNT", 500);
      cursor = next;
      if (batch.length > 0) await cacheRedis().del(...batch);
    } while (cursor !== "0");
  } catch {
    logger.debug("cache invalidation failed; entries will expire by TTL");
  }
}

export const TTL = {
  short: Math.max(5, env.CACHE_TTL_SECONDS),
  medium: Math.max(15, env.CACHE_TTL_SECONDS * 2),
  long: 300,
} as const;
