import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cacheRedis } from "./redis.js";

/**
 * Read-through cache.
 *
 * Design rule: a cache failure must never become a request failure. Every Redis
 * call here is wrapped, and a miss caused by an outage is indistinguishable to
 * the caller from an ordinary miss — it just costs a database query.
 *
 * Values are stored as JSON, so callers must pass already-serialisable data
 * (run it through `toJsonSafe` first if it contains BigInt or Decimal).
 */

function key(parts: readonly (string | number)[]): string {
  return [env.CACHE_PREFIX, ...parts].join(":");
}

export async function cacheGet<T>(parts: readonly (string | number)[]): Promise<T | undefined> {
  if (env.CACHE_TTL_SECONDS === 0) return undefined;
  try {
    const raw = await cacheRedis.get(key(parts));
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch (err) {
    logger.debug({ err, key: parts }, "cache read failed; falling through");
    return undefined;
  }
}

export async function cacheSet(
  parts: readonly (string | number)[],
  value: unknown,
  ttlSeconds = env.CACHE_TTL_SECONDS,
): Promise<void> {
  if (ttlSeconds <= 0) return;
  try {
    await cacheRedis.set(key(parts), JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    logger.debug({ err, key: parts }, "cache write failed; ignoring");
  }
}

/** Fetch from cache, or compute and store. */
export async function cached<T>(
  parts: readonly (string | number)[],
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(parts);
  if (hit !== undefined) return hit;
  const value = await compute();
  await cacheSet(parts, value, ttlSeconds);
  return value;
}

/**
 * Drop every cached entry under a prefix. Uses SCAN rather than KEYS so a large
 * keyspace does not block the Redis event loop.
 */
export async function cacheInvalidate(parts: readonly (string | number)[]): Promise<number> {
  const pattern = `${key(parts)}*`;
  let cursor = "0";
  let removed = 0;
  try {
    do {
      const [next, batch] = await cacheRedis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (batch.length > 0) {
        removed += await cacheRedis.del(...batch);
      }
    } while (cursor !== "0");
  } catch (err) {
    logger.debug({ err, pattern }, "cache invalidation failed; ignoring");
  }
  return removed;
}

/** TTL presets, so call sites do not sprinkle magic numbers. */
export const TTL = {
  /** Reference data that barely changes. */
  long: 300,
  /** List endpoints. */
  medium: env.CACHE_TTL_SECONDS,
  /** Aggregates over recent events. */
  short: Math.max(5, Math.floor(env.CACHE_TTL_SECONDS / 2)),
} as const;
