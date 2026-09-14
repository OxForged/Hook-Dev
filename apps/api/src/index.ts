import type { Server } from "node:http";
import { createPublicClient, type PublicClient } from "viem";
import { latchTransport } from "@latchprotocol/sdk";
import { OnChainRoleResolver } from "./admin/roles.js";
import { RpcSimulator } from "./admin/simulate.js";
import { disabledCaptcha, turnstileVerifier } from "./admin/turnstile.js";
import { createApp } from "./app.js";
import { keyCacheKey, PrismaKeyResolver, RedisUsageCounter } from "./auth/identity.js";
import { cacheRedis, disconnectRedis, pingRedis } from "./cache/redis.js";
import { apiKeyPepper, env, trustProxySetting } from "./config/env.js";
import { logger } from "./config/logger.js";
import { disconnectDatabase, pingDatabase, prisma } from "./db/prisma.js";
import { FallbackRateLimitStore, RedisRateLimitStore } from "./ratelimit/limiter.js";

/**
 * API process. Serves reads from Postgres + Redis. It does NOT index (that is
 * `npm run start:worker`) and, outside admin sign-in, it never talks to a chain.
 */
async function main(): Promise<void> {
  const rate = new FallbackRateLimitStore(new RedisRateLimitStore(cacheRedis, env.CACHE_PREFIX));

  let admin = null;
  if (env.ADMIN_ENABLED) {
    // Admin sign-in is the one place the API process reads chain state: on-chain
    // roles and contract-account signatures, bounded per sign-in and per recheck.
    const client = createPublicClient({
      transport: latchTransport(env.ADMIN_ROLE_CHAIN_ID, { env: process.env, timeout: 10_000 }),
    }) as PublicClient;
    admin = {
      prisma,
      roles: new OnChainRoleResolver(client, env.ADMIN_ROLE_CHAIN_ID, env.ADMIN_VIEWER_ALLOWLIST),
      verifyClient: client,
      rate,
      // eth_call only. There is no account, key or wallet client anywhere in this process.
      simulator: env.ADMIN_SIMULATION_ENABLED ? new RpcSimulator(client) : null,
      keys: {
        pepper: apiKeyPepper(),
        defaultRpm: env.KEY_DEFAULT_RATE_LIMIT_PER_MINUTE,
        defaultQuota: env.KEY_DEFAULT_MONTHLY_QUOTA,
        invalidate: async (secretHash: string) => {
          await cacheRedis().del(keyCacheKey(env.CACHE_PREFIX, secretHash));
        },
      },
      config: {
        origins: env.ADMIN_ORIGINS,
        siweDomain: env.ADMIN_SIWE_DOMAIN ?? "localhost",
        roleChainId: env.ADMIN_ROLE_CHAIN_ID,
        sessionTtlSeconds: env.ADMIN_SESSION_TTL_SECONDS,
        roleRecheckSeconds: env.ADMIN_ROLE_RECHECK_SECONDS,
        perMinute: env.ADMIN_RATE_LIMIT_PER_MINUTE,
        cookieSecure: env.COOKIE_SECURE,
      },
    };
  }

  const app = createApp({
    prisma,
    keys: new PrismaKeyResolver(prisma, apiKeyPepper(), cacheRedis, env.CACHE_PREFIX),
    rate,
    usage: new RedisUsageCounter(cacheRedis, env.CACHE_PREFIX, prisma),
    anonPerMinute: env.ANON_RATE_LIMIT_PER_MINUTE,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    dexMaxRange: env.DEXSCREENER_MAX_BLOCK_RANGE,
    trustProxy: trustProxySetting(),
    admin,
    adminUiDir: env.ADMIN_ENABLED ? (env.ADMIN_UI_DIR ?? null) : null,
    listings: {
      prisma,
      rate,
      captcha: env.TURNSTILE_ENABLED ? turnstileVerifier(env.TURNSTILE_SECRET_KEY!) : disabledCaptcha,
      submissionsEnabled: env.LISTING_SUBMISSIONS_ENABLED,
      submitPerHour: env.LISTING_SUBMIT_PER_HOUR,
      ipHashKey: apiKeyPepper(),
    },
    ready: async () => {
      const [db, redis] = await Promise.allSettled([pingDatabase(), pingRedis()]);
      return { database: db.status === "fulfilled", redis: redis.status === "fulfilled" };
    },
  });

  const server: Server = app.listen(env.PORT, env.HOST, () => {
    logger.info({ port: env.PORT, admin: env.ADMIN_ENABLED }, "Latch API listening");
  });
  // Socket-level limits: slowloris and idle-connection exhaustion.
  server.headersTimeout = 10_000;
  server.requestTimeout = env.REQUEST_TIMEOUT_MS + 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDatabase();
    await disconnectRedis();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.fatal({ name: (err as Error)?.name, message: (err as Error)?.message }, "failed to start API");
  process.exit(1);
});
