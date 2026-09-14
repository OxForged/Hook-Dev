import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import type { AdminRole, RoleResolver } from "../../src/admin/roles.js";
import type { Simulator } from "../../src/admin/simulate.js";
import type { TreasuryClient } from "../../src/admin/treasury/chain.js";
import type { CaptchaVerifier } from "../../src/admin/turnstile.js";
import { disabledCaptcha } from "../../src/admin/turnstile.js";
import { createApp, type AppDeps } from "../../src/app.js";
import { MemoryRateLimitStore } from "../../src/ratelimit/limiter.js";

/**
 * TEST FIXTURE ONLY. An in-memory stand-in for the Prisma tables the admin
 * routes WRITE (moderation, keys, audit, sessions) plus seedable read tables.
 * Anything not modelled answers "nothing indexed". No database, Redis or chain.
 */

type Row = Record<string, unknown> & { id?: string };
let seq = 0;
const cuid = () => `c${(++seq).toString(36).padStart(8, "0")}${Math.random().toString(36).slice(2, 12)}`;

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "NOT" || k === "OR" || k === "AND") continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if ("in" in o && !(o.in as unknown[]).includes(row[k])) return false;
      if ("startsWith" in o && !String(row[k]).startsWith(String(o.startsWith))) return false;
      if ("gte" in o && !(row[k] instanceof Date && (row[k] as Date) >= (o.gte as Date))) return false;
      if ("gt" in o && !(row[k] instanceof Date && (row[k] as Date) > (o.gt as Date))) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function table(rows: Row[] = [], defaults: (data: Row) => Row = (d) => d) {
  return {
    rows,
    create: async ({ data }: { data: Row }) => {
      const row = defaults({ id: cuid(), createdAt: new Date(), updatedAt: new Date(), ...data });
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: { where?: Row } = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take, skip }: { where?: Row; take?: number; skip?: number } = {}) => rows.filter((r) => matches(r, where)).slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length)),
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((x) => matches(x, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
    groupBy: async () => [],
    aggregate: async () => ({ _sum: {} }),
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const r = rows.find((x) => matches(x, where));
      if (r) return Object.assign(r, update);
      rows.push(create);
      return create;
    },
  };
}

export interface Seed {
  ownershipSnapshot?: Row[];
  opsBalance?: Row[];
  timelockEvent?: Row[];
  listingSubmission?: Row[];
  apiAccount?: Row[];
  apiKey?: Row[];
  pool?: Row[];
}

export function fakePrisma(seed: Seed = {}) {
  const tables = {
    adminNonce: table([], (d) => ({ consumedAt: null, ...d })),
    adminSession: table([], (d) => ({ revokedAt: null, ...d })),
    auditLog: table(),
    listingSubmission: table(seed.listingSubmission ?? [], (d) => ({ status: "PENDING", reviewer: null, reviewNotes: null, reviewedAt: null, uses: [], chains: [], ...d })),
    listingAsset: table(),
    apiAccount: table(seed.apiAccount ?? [], (d) => ({ plan: "free", billingProvider: null, ...d })),
    apiKey: table(seed.apiKey ?? [], (d) => ({ status: "ACTIVE", revokedAt: null, revokedReason: null, lastUsedAt: null, expiresAt: null, ...d })),
    apiUsageMonthly: table(),
    ownershipSnapshot: table(seed.ownershipSnapshot ?? []),
    opsBalance: table(seed.opsBalance ?? []),
    timelockEvent: table(seed.timelockEvent ?? []),
    pool: table(seed.pool ?? []),
  };
  // Relations the routes include.
  const accountFindMany = tables.apiAccount.findMany;
  (tables.apiAccount as unknown as { findMany: unknown }).findMany = async (args: Row = {}) =>
    (await accountFindMany(args as never)).map((a) => ({ ...a, _count: { keys: tables.apiKey.rows.filter((k) => k.accountId === a.id).length } }));
  const keyFindMany = tables.apiKey.findMany;
  (tables.apiKey as unknown as { findMany: unknown }).findMany = async (args: Row = {}) =>
    (await keyFindMany(args as never)).map((k) => ({ ...k, account: { name: String(tables.apiAccount.rows.find((a) => a.id === k.accountId)?.name ?? "") } }));

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
  const prisma = new Proxy({ ...tables, $queryRaw: async () => [] } as Record<string, unknown>, {
    get: (t, p: string) => (p in t ? t[p] : empty),
  }) as unknown as PrismaClient;
  return { prisma, tables };
}

export const ORIGIN = "https://admin.example";

export function buildAdminApp(opts: {
  roles?: AdminRole[];
  seed?: Seed;
  simulator?: Simulator | null;
  listings?: { enabled: boolean; perHour?: number; captcha?: CaptchaVerifier };
  adminUiDir?: string | null;
  adminEnabled?: boolean;
  treasuryClient?: TreasuryClient | null;
} = {}) {
  const { prisma, tables } = fakePrisma(opts.seed);
  let roles: AdminRole[] = opts.roles ?? ["viewer"];
  const roleResolver: RoleResolver = { rolesFor: async () => roles };
  const rate = new MemoryRateLimitStore();
  const invalidated: string[] = [];
  const deps: AppDeps = {
    prisma,
    keys: { resolve: async () => null },
    rate,
    usage: { increment: async () => 1 },
    anonPerMinute: 1_000,
    requestTimeoutMs: 10_000,
    dexMaxRange: 1_000,
    trustProxy: false,
    logRequests: false,
    ready: async () => ({ database: true, redis: true }),
    admin:
      opts.adminEnabled === false
        ? null
        : {
            prisma,
            roles: roleResolver,
            verifyClient: null,
            rate,
            simulator: opts.simulator ?? null,
            treasuryClient: opts.treasuryClient ? () => opts.treasuryClient! : null,
            keys: { pepper: "admin-test-pepper-0123456789abcdef0123", defaultRpm: 600, defaultQuota: 1_000_000, invalidate: async (h) => void invalidated.push(h) },
            config: { origins: [ORIGIN], siweDomain: "admin.example", roleChainId: 4663, sessionTtlSeconds: 600, roleRecheckSeconds: 300, perMinute: 10_000, cookieSecure: true },
          },
    adminUiDir: opts.adminUiDir ?? null,
    listings: opts.listings
      ? { prisma, rate, captcha: opts.listings.captcha ?? disabledCaptcha, submissionsEnabled: opts.listings.enabled, submitPerHour: opts.listings.perHour ?? 100, ipHashKey: "listing-ip-test-key" }
      : null,
  };
  const app = createApp(deps);
  return { app, tables, invalidated, setRoles: (r: AdminRole[]) => void (roles = r) };
}

/** A real SIWE round trip with an ephemeral key generated per call. */
export async function signIn(app: ReturnType<typeof buildAdminApp>["app"]) {
  const account = privateKeyToAccount(generatePrivateKey());
  const { body: n } = await request(app).post("/v1/admin/auth/nonce").set("Origin", ORIGIN).expect(200);
  const message = createSiweMessage({ address: account.address, chainId: 4663, domain: "admin.example", nonce: n.nonce, uri: `${ORIGIN}/admin/`, version: "1", issuedAt: new Date() });
  const signature = await account.signMessage({ message });
  const res = await request(app).post("/v1/admin/auth/verify").set("Origin", ORIGIN).send({ message, signature });
  if (res.status !== 200) return { res, cookie: "", csrf: "", address: account.address };
  return { res, cookie: String(res.headers["set-cookie"]![0]!).split(";")[0]!, csrf: res.body.csrfToken as string, address: account.address };
}
