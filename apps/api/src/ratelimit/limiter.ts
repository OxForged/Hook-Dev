import type { Redis } from "ioredis";

/**
 * Sliding-window-counter rate limiter.
 *
 * Two fixed one-minute buckets; the previous bucket's count is weighted by how
 * much of it still overlaps the sliding window. Accurate to within a few
 * percent of a true sliding log, O(1) memory per client, and — unlike a plain
 * fixed window — it cannot be gamed by bursting across a bucket boundary.
 *
 * The decision maths is pure (`decide`) so it is testable without Redis; the
 * stores only persist the two counters atomically.
 */

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until a denied client may retry. 0 when allowed. */
  retryAfterSeconds: number;
  /** Unix seconds when the current bucket ends. */
  resetAt: number;
}

export function decide(nowMs: number, windowMs: number, limit: number, current: number, previous: number): RateDecision {
  const bucketStart = Math.floor(nowMs / windowMs) * windowMs;
  const elapsed = (nowMs - bucketStart) / windowMs;
  const weighted = previous * (1 - elapsed) + current;
  const allowed = weighted <= limit;
  let retryAfterSeconds = 0;
  if (!allowed) {
    // Solve previous*(1 - t) + current <= limit for the earliest t in this bucket,
    // else wait for the next bucket.
    const t = previous > 0 ? 1 - (limit - current) / previous : 1;
    const waitMs = t > elapsed && t < 1 ? (t - elapsed) * windowMs : bucketStart + windowMs - nowMs;
    retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));
  }
  return {
    allowed,
    limit,
    remaining: Math.max(0, Math.floor(limit - weighted)),
    retryAfterSeconds,
    resetAt: Math.ceil((bucketStart + windowMs) / 1000),
  };
}

export interface RateLimitStore {
  /** Increment the current bucket; return [current, previous]. */
  hit(key: string, nowMs: number, windowMs: number): Promise<[number, number]>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, number>();
  async hit(key: string, nowMs: number, windowMs: number): Promise<[number, number]> {
    const b = Math.floor(nowMs / windowMs);
    const cur = `${key}:${b}`;
    const next = (this.buckets.get(cur) ?? 0) + 1;
    this.buckets.set(cur, next);
    if (this.buckets.size > 50_000) {
      for (const k of this.buckets.keys()) {
        const kb = Number(k.slice(k.lastIndexOf(":") + 1));
        if (kb < b - 1) this.buckets.delete(k);
      }
    }
    return [next, this.buckets.get(`${key}:${b - 1}`) ?? 0];
  }
}

const HIT_LUA = `
local cur = redis.call('INCR', KEYS[1])
if cur == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local prev = redis.call('GET', KEYS[2])
return {cur, tonumber(prev) or 0}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: () => Redis,
    private readonly prefix: string,
  ) {}
  async hit(key: string, nowMs: number, windowMs: number): Promise<[number, number]> {
    const b = Math.floor(nowMs / windowMs);
    const res = (await this.redis().eval(HIT_LUA, 2, `${this.prefix}:rl:${key}:${b}`, `${this.prefix}:rl:${key}:${b - 1}`, String(windowMs * 2))) as [number, number];
    return [Number(res[0]), Number(res[1])];
  }
}

/**
 * Redis first; if Redis is unreachable, an in-process limiter so an outage does
 * not remove the limit entirely (fail-soft, per process rather than global).
 */
export class FallbackRateLimitStore implements RateLimitStore {
  private readonly memory = new MemoryRateLimitStore();
  constructor(private readonly primary: RateLimitStore) {}
  async hit(key: string, nowMs: number, windowMs: number): Promise<[number, number]> {
    try {
      return await this.primary.hit(key, nowMs, windowMs);
    } catch {
      return this.memory.hit(key, nowMs, windowMs);
    }
  }
}

export async function checkRate(store: RateLimitStore, key: string, limit: number, nowMs = Date.now(), windowMs = 60_000): Promise<RateDecision> {
  const [current, previous] = await store.hit(key, nowMs, windowMs);
  return decide(nowMs, windowMs, limit, current, previous);
}
