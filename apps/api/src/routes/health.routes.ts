import { Router } from "express";
import { pingRedis } from "../cache/redis.js";
import { env } from "../config/env.js";
import { pingDatabase, prisma } from "../db/prisma.js";
import { getChainLogProvider } from "../chain/provider/index.js";
import { IngestionService } from "../services/ingestion.service.js";

/**
 * Liveness vs readiness.
 *
 *   /health/live   the process is up. No dependency checks, so a database blip
 *                  never causes an orchestrator to kill a healthy process.
 *   /health/ready  the process can serve traffic: Postgres and Redis both
 *                  answer. Returns 503 otherwise.
 */
export function healthRoutes(): Router {
  const router = Router();
  const ingestion = new IngestionService(prisma);

  router.get("/live", (_req, res) => {
    res.json({
      status: "ok",
      service: "latchprotocol-api",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    const [dbResult, redisResult] = await Promise.allSettled([pingDatabase(), pingRedis()]);
    checks.database =
      dbResult.status === "fulfilled"
        ? { ok: true }
        : { ok: false, detail: describe(dbResult.reason) };
    checks.redis =
      redisResult.status === "fulfilled"
        ? { ok: true }
        : { ok: false, detail: describe(redisResult.reason) };

    const ready = Object.values(checks).every((c) => c.ok);

    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "degraded",
      checks,
      config: {
        // Surfaced because it determines whether anything this API serves is
        // real. Today it is "fixture" everywhere.
        chainProvider: env.CHAIN_PROVIDER,
        ingestEnabled: env.INGEST_ENABLED,
        cacheTtlSeconds: env.CACHE_TTL_SECONDS,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /** Ingestion state: cursors, recent runs, and which provider each chain uses. */
  router.get("/ingestion", async (_req, res) => {
    const status = await ingestion.status();
    const chains = await prisma.chain.findMany({
      where: { enabled: true },
      select: { id: true, slug: true, name: true, dataSource: true },
    });

    const providers = await Promise.all(
      chains.map(async (chain) => {
        const contracts = await ingestion.resolveContracts(chain.id);
        const provider = getChainLogProvider(chain.id, contracts);
        return {
          chainId: chain.id,
          slug: chain.slug,
          providerKind: provider.kind,
          description: provider.describe(),
          watchedContracts: contracts.map((c) => ({
            role: c.role,
            address: c.address,
            label: c.label,
          })),
        };
      }),
    );

    res.json({
      providers,
      cursors: status.cursors.map((c) => ({
        ...c,
        lastProcessedBlock: c.lastProcessedBlock.toString(),
      })),
      recentRuns: status.recentRuns.map((r) => ({
        ...r,
        fromBlock: r.fromBlock.toString(),
        toBlock: r.toBlock.toString(),
      })),
    });
  });

  return router;
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
