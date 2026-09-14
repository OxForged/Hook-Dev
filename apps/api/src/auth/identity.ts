import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { hashKey, isScope, parseKey, type Scope } from "./keys.js";

/**
 * Who is calling: anonymous (by IP) or a resolved API key.
 *
 * Key lookup is by HMAC hash (unique index), cached in Redis for 60 s. A
 * revocation deletes the cache entry (admin CLI), so revocation is immediate on
 * a healthy Redis and bounded by the TTL otherwise.
 */

export interface KeyIdentity {
  kind: "key";
  keyId: string;
  prefix: string;
  accountId: string;
  scopes: Scope[];
  rateLimitPerMinute: number;
  monthlyQuota: number;
}

export interface AnonIdentity {
  kind: "anonymous";
  ip: string;
  scopes: Scope[];
}

export type Identity = KeyIdentity | AnonIdentity;

export const ANON_SCOPES: Scope[] = ["public:read", "dexscreener:read"];

export interface KeyResolver {
  resolve(presented: string): Promise<KeyIdentity | null>;
}

export const keyCacheKey = (prefix: string, secretHash: string) => `${prefix}:key:${secretHash}`;

export class PrismaKeyResolver implements KeyResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pepper: string,
    private readonly redis: (() => Redis) | null,
    private readonly cachePrefix: string,
  ) {}

  async resolve(presented: string): Promise<KeyIdentity | null> {
    if (!parseKey(presented)) return null;
    const secretHash = hashKey(presented.trim(), this.pepper);
    const ck = keyCacheKey(this.cachePrefix, secretHash);
    if (this.redis) {
      try {
        const hit = await this.redis().get(ck);
        if (hit === "none") return null;
        if (hit) return JSON.parse(hit) as KeyIdentity;
      } catch {
        /* fall through to the database */
      }
    }
    const row = await this.prisma.apiKey.findUnique({ where: { secretHash } });
    const valid = row && row.status === "ACTIVE" && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
    const identity: KeyIdentity | null = valid
      ? {
          kind: "key",
          keyId: row.id,
          prefix: row.prefix,
          accountId: row.accountId,
          scopes: row.scopes.filter(isScope),
          rateLimitPerMinute: row.rateLimitPerMinute,
          monthlyQuota: row.monthlyQuota,
        }
      : null;
    if (this.redis) {
      try {
        await this.redis().set(ck, identity ? JSON.stringify(identity) : "none", "EX", 60);
      } catch {
        /* cache is best effort */
      }
    }
    return identity;
  }
}

/** UTC month bucket, e.g. "2026-09". */
export function usagePeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface UsageCounter {
  /** Increment and return the count for this key's current month. */
  increment(keyId: string, period: string): Promise<number>;
}

export class RedisUsageCounter implements UsageCounter {
  constructor(
    private readonly redis: () => Redis,
    private readonly prefix: string,
    private readonly prisma: PrismaClient,
  ) {}

  async increment(keyId: string, period: string): Promise<number> {
    const k = `${this.prefix}:usage:${keyId}:${period}`;
    const r = this.redis();
    const exists = await r.exists(k);
    if (!exists) {
      // Seed from Postgres so a Redis restart cannot reset a customer's month.
      const row = await this.prisma.apiUsageMonthly.findUnique({ where: { keyId_period: { keyId, period } } });
      await r.set(k, row ? row.requests.toString() : "0", "EX", 62 * 86_400, "NX");
      await r.sadd(`${this.prefix}:usage:dirty`, `${keyId}|${period}`);
    }
    const n = await r.incr(k);
    if (n % 50 === 1) await r.sadd(`${this.prefix}:usage:dirty`, `${keyId}|${period}`);
    return n;
  }
}

/** Copy Redis usage counters to Postgres. SET, never increment: replay-safe. */
export async function flushUsage(prisma: PrismaClient, redis: Redis, prefix: string): Promise<number> {
  const members = await redis.smembers(`${prefix}:usage:dirty`);
  let flushed = 0;
  for (const m of members) {
    const [keyId, period] = m.split("|");
    if (!keyId || !period) continue;
    const raw = await redis.get(`${prefix}:usage:${keyId}:${period}`);
    if (raw === null) continue;
    const requests = BigInt(raw);
    const key = await prisma.apiKey.findUnique({ where: { id: keyId }, select: { id: true } });
    if (!key) {
      await redis.srem(`${prefix}:usage:dirty`, m);
      continue;
    }
    await prisma.apiUsageMonthly.upsert({
      where: { keyId_period: { keyId, period } },
      create: { keyId, period, requests, flushedAt: new Date() },
      update: { requests, flushedAt: new Date() },
    });
    await prisma.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date() } });
    // Only drop it from the dirty set for a past month; the current month keeps flushing.
    if (period !== usagePeriod()) await redis.srem(`${prefix}:usage:dirty`, m);
    flushed += 1;
  }
  return flushed;
}
