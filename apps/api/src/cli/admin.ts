import { parseArgs } from "node:util";
import { keyCacheKey, flushUsage, usagePeriod } from "../auth/identity.js";
import { hashKey, isScope, mintKey, SCOPES } from "../auth/keys.js";
import { cacheRedis, disconnectRedis } from "../cache/redis.js";
import { chainRpc } from "../chain/rpc.js";
import { apiKeyPepper, env } from "../config/env.js";
import { disconnectDatabase, prisma } from "../db/prisma.js";
import { feedsPass, governancePass } from "../indexer/governance.js";
import { indexPass } from "../indexer/indexer.js";
import { snapshotPass } from "../indexer/snapshots.js";

/**
 * Operator CLI. The ONLY way to mint or revoke API keys: there is no HTTP route
 * that creates, lists or revokes keys.
 *
 *   npm run admin -- accounts:create --name "Acme" [--contact ops@acme.example] [--plan pro]
 *   npm run admin -- accounts:list
 *   npm run admin -- keys:create --account <id> --name "prod" [--scopes public:read,dexscreener:read] [--rpm 600] [--quota 1000000] [--expires 2027-01-01]
 *   npm run admin -- keys:list [--account <id>]
 *   npm run admin -- keys:revoke --id <keyId> --reason "leaked"
 *   npm run admin -- usage:show [--period 2026-09]
 *   npm run admin -- usage:flush
 *   npm run admin -- index:once --chain 4663          (one index pass, then snapshots)
 *   npm run admin -- governance:once --chain 4663
 *   npm run admin -- feeds:once --chain 4663
 *
 * A minted key is printed ONCE, to stdout, and never again. It is not logged,
 * not stored, and cannot be recovered: a lost key is revoked and re-minted.
 */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    contact: { type: "string" },
    plan: { type: "string" },
    account: { type: "string" },
    scopes: { type: "string" },
    rpm: { type: "string" },
    quota: { type: "string" },
    expires: { type: "string" },
    id: { type: "string" },
    reason: { type: "string" },
    period: { type: "string" },
    chain: { type: "string" },
  },
});

function need(v: string | undefined, flag: string): string {
  if (!v) throw new Error(`--${flag} is required`);
  return v;
}

async function run(): Promise<void> {
  const cmd = positionals[0];
  switch (cmd) {
    case "accounts:create": {
      const a = await prisma.apiAccount.create({ data: { name: need(values.name, "name"), contact: values.contact ?? null, plan: values.plan ?? "free" } });
      console.log(JSON.stringify({ id: a.id, name: a.name, plan: a.plan }, null, 2));
      return;
    }
    case "accounts:list": {
      const rows = await prisma.apiAccount.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { keys: true } } } });
      console.table(rows.map((r) => ({ id: r.id, name: r.name, plan: r.plan, keys: r._count.keys, billing: r.billingProvider ?? "-" })));
      return;
    }
    case "keys:create": {
      const accountId = need(values.account, "account");
      const scopes = (values.scopes ?? "public:read,dexscreener:read").split(",").map((s) => s.trim());
      const bad = scopes.filter((s) => !isScope(s));
      if (bad.length) throw new Error(`unknown scope(s): ${bad.join(", ")}. Known: ${SCOPES.join(", ")}`);
      const rpm = Number(values.rpm ?? env.KEY_DEFAULT_RATE_LIMIT_PER_MINUTE);
      const quota = Number(values.quota ?? env.KEY_DEFAULT_MONTHLY_QUOTA);
      if (!Number.isInteger(rpm) || rpm <= 0 || !Number.isInteger(quota) || quota <= 0) throw new Error("--rpm and --quota must be positive integers");
      await prisma.apiAccount.findUniqueOrThrow({ where: { id: accountId } });
      const minted = mintKey(apiKeyPepper());
      const key = await prisma.apiKey.create({
        data: {
          accountId,
          name: need(values.name, "name"),
          prefix: minted.prefix,
          secretHash: minted.secretHash,
          scopes,
          rateLimitPerMinute: rpm,
          monthlyQuota: quota,
          expiresAt: values.expires ? new Date(values.expires) : null,
        },
      });
      console.log(JSON.stringify({ id: key.id, prefix: key.prefix, scopes, rateLimitPerMinute: rpm, monthlyQuota: quota }, null, 2));
      // The only time the plaintext exists outside the caller's secret store.
      process.stdout.write(`\nAPI KEY (shown once, store it now):\n${minted.plaintext}\n`);
      return;
    }
    case "keys:list": {
      const rows = await prisma.apiKey.findMany({ where: values.account ? { accountId: values.account } : {}, orderBy: { createdAt: "asc" } });
      console.table(rows.map((k) => ({ id: k.id, prefix: `latchk_${k.prefix}_…`, name: k.name, status: k.status, rpm: k.rateLimitPerMinute, quota: k.monthlyQuota, scopes: k.scopes.join(","), lastUsedAt: k.lastUsedAt?.toISOString() ?? "-" })));
      return;
    }
    case "keys:revoke": {
      const id = need(values.id, "id");
      const key = await prisma.apiKey.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date(), revokedReason: need(values.reason, "reason") } });
      // Drop the cached identity so the revocation is immediate.
      try {
        await cacheRedis().del(keyCacheKey(env.CACHE_PREFIX, key.secretHash));
      } catch {
        console.warn("Redis unreachable: revocation takes effect within the 60 s key-cache TTL.");
      }
      await prisma.auditLog.create({ data: { actor: "cli", actorRoles: ["operator"], action: "apikey.revoke", targetType: "api_key", targetId: id, after: { reason: key.revokedReason } } });
      console.log(`revoked ${key.id} (latchk_${key.prefix}_…)`);
      return;
    }
    case "usage:show": {
      const period = values.period ?? usagePeriod();
      const rows = await prisma.apiUsageMonthly.findMany({ where: { period }, include: { key: { select: { prefix: true, name: true, monthlyQuota: true } } } });
      console.table(rows.map((r) => ({ key: `latchk_${r.key.prefix}_…`, name: r.key.name, period, requests: r.requests.toString(), quota: r.key.monthlyQuota, flushedAt: r.flushedAt.toISOString() })));
      return;
    }
    case "usage:flush":
      console.log(`flushed ${await flushUsage(prisma, cacheRedis(), env.CACHE_PREFIX)} counter(s)`);
      return;
    case "index:once": {
      const chainId = Number(need(values.chain, "chain"));
      console.log(JSON.stringify(await indexPass(prisma, chainRpc(chainId), chainId), null, 2));
      console.log(JSON.stringify(await snapshotPass(prisma, chainRpc(chainId), chainId), null, 2));
      return;
    }
    case "governance:once": {
      const chainId = Number(need(values.chain, "chain"));
      console.log(JSON.stringify(await governancePass(prisma, chainRpc(chainId), chainId), null, 2));
      return;
    }
    case "feeds:once": {
      const chainId = Number(need(values.chain, "chain"));
      console.log(`feeds written: ${await feedsPass(prisma, chainRpc(chainId), chainId)}`);
      return;
    }
    default:
      console.error("unknown command. See the header of src/cli/admin.ts.");
      process.exitCode = 2;
  }
}

run()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await disconnectRedis();
  });

export { hashKey };
