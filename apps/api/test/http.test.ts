import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { AdminRole, RoleResolver } from "../src/admin/roles.js";
import { createApp, type AppDeps } from "../src/app.js";
import type { KeyIdentity, KeyResolver, UsageCounter } from "../src/auth/identity.js";
import { mintKey } from "../src/auth/keys.js";
import { MemoryRateLimitStore } from "../src/ratelimit/limiter.js";

/**
 * HTTP-level behaviour with every stateful dependency in memory: no Postgres,
 * no Redis, no chain. The Prisma stub answers "nothing indexed" for reads and
 * implements just enough of the admin tables for a real SIWE round trip.
 */

function fakePrisma() {
  const nonces = new Map<string, { nonce: string; expiresAt: Date; consumedAt: Date | null }>();
  const sessions = new Map<string, Record<string, unknown> & { id: string }>();
  const audit: unknown[] = [];
  const empty = new Proxy(
    {},
    {
      get: (_t, method: string) => async () => {
        if (method === "count") return 0;
        if (method === "aggregate") return { _sum: {} };
        if (method.startsWith("find") && method !== "findMany") return null;
        return [];
      },
    },
  );
  const prisma = new Proxy(
    {
      adminNonce: {
        create: async ({ data }: { data: { nonce: string; expiresAt: Date } }) => {
          nonces.set(data.nonce, { ...data, consumedAt: null });
          return data;
        },
        updateMany: async ({ where }: { where: { nonce: string } }) => {
          const n = nonces.get(where.nonce);
          if (!n || n.consumedAt || n.expiresAt.getTime() <= Date.now()) return { count: 0 };
          n.consumedAt = new Date();
          return { count: 1 };
        },
      },
      adminSession: {
        create: async ({ data }: { data: { id: string } }) => {
          sessions.set(data.id, { ...data, revokedAt: null });
          return sessions.get(data.id);
        },
        findUnique: async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const s = sessions.get(where.id)!;
          Object.assign(s, data);
          return s;
        },
      },
      auditLog: { create: async ({ data }: { data: unknown }) => audit.push(data) },
      $queryRaw: async () => [],
    },
    { get: (t, p: string) => (p in t ? (t as Record<string, unknown>)[p] : empty) },
  ) as unknown as PrismaClient;
  return { prisma, audit, sessions };
}

const PEPPER = "http-test-pepper-0123456789abcdef0123";

function build(overrides: Partial<AppDeps> = {}, roles: AdminRole[] = ["viewer"]) {
  const { prisma, audit, sessions } = fakePrisma();
  const good = mintKey(PEPPER);
  const identity: KeyIdentity = { kind: "key", keyId: "k1", prefix: good.prefix, accountId: "a1", scopes: ["public:read"], rateLimitPerMinute: 3, monthlyQuota: 1_000 };
  const keys: KeyResolver = { resolve: async (p) => (p === good.plaintext ? identity : null) };
  const counts = new Map<string, number>();
  const usage: UsageCounter = { increment: async (k) => { counts.set(k, (counts.get(k) ?? 0) + 1); return counts.get(k)!; } };
  const roleResolver: RoleResolver = { rolesFor: async () => roles };
  const rate = new MemoryRateLimitStore();
  const deps: AppDeps = {
    prisma,
    keys,
    rate,
    usage,
    anonPerMinute: 2,
    requestTimeoutMs: 5_000,
    dexMaxRange: 1_000,
    trustProxy: false,
    logRequests: false,
    ready: async () => ({ database: true, redis: true }),
    admin: {
      prisma,
      roles: roleResolver,
      verifyClient: null,
      rate,
      config: { origins: ["https://admin.example"], siweDomain: "admin.example", roleChainId: 4663, sessionTtlSeconds: 600, roleRecheckSeconds: 300, perMinute: 100, cookieSecure: true },
    },
    ...overrides,
  };
  return { app: createApp(deps), key: good.plaintext, audit, sessions };
}

describe("public API guard rails", () => {
  it("serves liveness without auth", async () => {
    const { app } = build();
    await request(app).get("/health/live").expect(200);
  });

  it("rate limits anonymous callers per IP with standard headers", async () => {
    const { app } = build();
    await request(app).get("/v1/").expect(200);
    const second = await request(app).get("/v1/").expect(200);
    expect(second.headers["ratelimit-limit"]).toBe("2");
    const third = await request(app).get("/v1/").expect(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    expect(Number(third.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("gives a valid key its own limit and quota headers", async () => {
    const { app, key } = build();
    const r = await request(app).get("/v1/").set("X-API-Key", key).expect(200);
    expect(r.headers["ratelimit-limit"]).toBe("3");
    expect(r.headers["x-quota-used"]).toBe("1");
    expect(r.headers["cache-control"]).toContain("private");
  });

  it("rejects a presented-but-invalid key instead of downgrading to anonymous", async () => {
    const { app } = build();
    const r = await request(app).get("/v1/").set("X-API-Key", "latchk_aaaaaaaaaaaa_" + "A".repeat(43)).expect(401);
    expect(r.body.error.code).toBe("UNAUTHORIZED");
  });

  it("refuses keys in the query string", async () => {
    const { app } = build();
    await request(app).get("/v1/?apiKey=latchk_x").expect(400);
  });

  it("enforces scopes: a key without dexscreener:read cannot use the adapter", async () => {
    const { app, key } = build();
    const r = await request(app).get("/v1/dexscreener/4663/latest-block").set("X-API-Key", key).expect(403);
    expect(r.body.error.message).toContain("dexscreener:read");
  });

  it("is read-only, takes no bodies, and caps URL length", async () => {
    const { app } = build();
    await request(app).post("/v1/chains").expect(405);
    await request(app).post("/v1/chains").send({ a: 1 }).expect(413);
    await request(app).get("/v1/").set("Content-Length", "10").send("0123456789").expect(413);
    await request(app).get(`/v1/?q=${"a".repeat(3000)}`).expect(414);
  });

  it("allows cross-origin reads without credentials", async () => {
    const { app } = build();
    const r = await request(app).options("/v1/chains").set("Origin", "https://anything.example").expect(204);
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(r.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("reports an unindexed chain as 503 NOT_INDEXED, never as an empty success", async () => {
    const { app } = build({ anonPerMinute: 100 });
    const r = await request(app).get("/v1/chains/4663/pools").expect(503);
    expect(r.body.error.code).toBe("NOT_INDEXED");
  });

  it("rejects a chain that is not in the SDK address book", async () => {
    const { app } = build({ anonPerMinute: 100 });
    await request(app).get("/v1/chains/1/pools").expect(422);
  });

  it("validates pool ids and candle ranges before touching the database", async () => {
    const { app } = build({ anonPerMinute: 100 });
    await request(app).get("/v1/chains/4663/pools/0x1234").expect(422);
    await request(app).get(`/v1/chains/4663/pools/0x${"ab".repeat(32)}/candles?interval=7m&from=1&to=2`).expect(422);
  });

  it("returns 404 for the admin surface when admin is disabled", async () => {
    const { app } = build({ admin: null });
    await request(app).get("/v1/admin/overview").expect(404);
  });
});

describe("admin: SIWE sign-in, on-chain roles, CSRF, audit", () => {
  const ORIGIN = "https://admin.example";

  async function signIn(app: ReturnType<typeof build>["app"], opts: { domain?: string; uri?: string } = {}) {
    const account = privateKeyToAccount(generatePrivateKey()); // ephemeral, generated per test run
    const { body: n } = await request(app).post("/v1/admin/auth/nonce").set("Origin", ORIGIN).expect(200);
    const message = createSiweMessage({
      address: account.address,
      chainId: 4663,
      domain: opts.domain ?? "admin.example",
      nonce: n.nonce,
      uri: opts.uri ?? `${ORIGIN}/login`,
      version: "1",
      issuedAt: new Date(),
    });
    const signature = await account.signMessage({ message });
    return { account, message, signature, res: await request(app).post("/v1/admin/auth/verify").set("Origin", ORIGIN).send({ message, signature }) };
  }

  it("refuses a non-GET from an origin not on the allowlist", async () => {
    const { app } = build();
    await request(app).post("/v1/admin/auth/nonce").set("Origin", "https://evil.example").expect(403);
    await request(app).post("/v1/admin/auth/nonce").expect(403);
  });

  it("signs in, sets a hardened cookie, audits, and serves the overview", async () => {
    const { app, audit } = build();
    const { res } = await signIn(app);
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(["viewer"]);
    const cookie = res.headers["set-cookie"]![0]!;
    expect(cookie).toMatch(/^__Host-latch_admin=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(audit.some((a) => (a as { action: string }).action === "auth.signin")).toBe(true);

    const ov = await request(app).get("/v1/admin/overview").set("Cookie", cookie.split(";")[0]!).expect(200);
    expect(ov.headers["cache-control"]).toBe("no-store");
    expect(ov.body).toHaveProperty("indexer");
  });

  it("rejects a replayed nonce", async () => {
    const { app } = build();
    const first = await signIn(app);
    expect(first.res.status).toBe(200);
    const replay = await request(app).post("/v1/admin/auth/verify").set("Origin", ORIGIN).send({ message: first.message, signature: first.signature });
    expect(replay.status).toBe(401);
  });

  it("rejects a message for another domain or origin", async () => {
    const { app } = build();
    expect((await signIn(app, { domain: "evil.example" })).res.status).toBe(401);
    expect((await signIn(app, { uri: "https://evil.example/login" })).res.status).toBe(401);
  });

  it("rejects a signature from a different key", async () => {
    const { app } = build();
    const { body: n } = await request(app).post("/v1/admin/auth/nonce").set("Origin", ORIGIN).expect(200);
    const claimed = privateKeyToAccount(generatePrivateKey());
    const signer = privateKeyToAccount(generatePrivateKey());
    const message = createSiweMessage({ address: claimed.address, chainId: 4663, domain: "admin.example", nonce: n.nonce, uri: `${ORIGIN}/`, version: "1" });
    const signature = await signer.signMessage({ message });
    await request(app).post("/v1/admin/auth/verify").set("Origin", ORIGIN).send({ message, signature }).expect(401);
  });

  it("denies an address with no on-chain role and creates no session", async () => {
    const { app, sessions, audit } = build({}, []);
    const { res } = await signIn(app);
    expect(res.status).toBe(403);
    expect(sessions.size).toBe(0);
    expect(audit.some((a) => (a as { action: string }).action === "auth.denied")).toBe(true);
  });

  it("requires the CSRF token for logout", async () => {
    const { app } = build();
    const { res } = await signIn(app);
    const cookie = res.headers["set-cookie"]![0]!.split(";")[0]!;
    await request(app).post("/v1/admin/auth/logout").set("Origin", ORIGIN).set("Cookie", cookie).expect(403);
    await request(app).post("/v1/admin/auth/logout").set("Origin", ORIGIN).set("Cookie", cookie).set("X-CSRF-Token", res.body.csrfToken).expect(204);
    await request(app).get("/v1/admin/overview").set("Cookie", cookie).expect(401);
  });

  it("401s the overview without a session", async () => {
    const { app } = build();
    await request(app).get("/v1/admin/overview").expect(401);
  });
});
