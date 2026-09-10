import type { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { getChainLogProvider } from "../chain/provider/index.js";
import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { metaFor, send } from "../lib/response.js";
import { requireAdmin } from "../middleware/requestContext.js";
import { validate, validated, type Infer } from "../middleware/validate.js";
import { enqueueBackfill } from "../jobs/queue.js";
import { IngestionService } from "../services/ingestion.service.js";
import { eventRoutes } from "./events.routes.js";
import { healthRoutes } from "./health.routes.js";
import { hookRoutes, permissionRoutes, registryRoutes } from "./hooks.routes.js";
import { poolRoutes } from "./pools.routes.js";
import { ingestBody, statsQuery } from "./schemas.js";
import { statsRoutes } from "./stats.routes.js";

export function buildRouter(prisma: PrismaClient): Router {
  const router = Router();
  const ingestion = new IngestionService(prisma);

  router.use("/health", healthRoutes());

  const v1 = Router();

  /** GET /api/v1 — a self-describing index. */
  v1.get("/", (_req, res) => {
    send(
      res,
      {
        name: "LatchProtocol API",
        version: "0.1.0",
        status: "pre-deployment",
        note:
          "No LatchProtocol contract is deployed on any chain. Unless a response says " +
          "dataSource=onchain, its rows came from the fixture chain-log provider.",
        chainProvider: env.CHAIN_PROVIDER,
        routes: [
          "GET  /health/live",
          "GET  /health/ready",
          "GET  /health/ingestion",
          "GET  /api/v1/chains",
          "GET  /api/v1/pools",
          "GET  /api/v1/pools/:id",
          "GET  /api/v1/pools/:id/swaps",
          "GET  /api/v1/pools/:id/liquidity",
          "GET  /api/v1/swaps",
          "GET  /api/v1/liquidity-changes",
          "GET  /api/v1/protocol-fee-changes",
          "GET  /api/v1/vault-events",
          "GET  /api/v1/hooks",
          "GET  /api/v1/hooks/:address",
          "GET  /api/v1/registry",
          "GET  /api/v1/registry/facets",
          "GET  /api/v1/registry/:slug",
          "GET  /api/v1/permissions/flags",
          "GET  /api/v1/permissions/decode",
          "GET  /api/v1/stats/overview",
          "GET  /api/v1/stats/timeseries",
          "GET  /api/v1/stats/top-pools",
          "GET  /api/v1/stats/top-hooks",
          "GET  /api/v1/stats/permissions",
          "GET  /api/v1/stats/fee-tiers",
          "POST /api/v1/admin/ingest",
        ],
      },
      metaFor("curated"),
    );
  });

  /** GET /api/v1/chains */
  v1.get("/chains", validate({ query: statsQuery.partial() }), async (_req, res) => {
    const chains = await prisma.chain.findMany({
      orderBy: [{ isTestnet: "asc" }, { id: "asc" }],
      include: {
        _count: { select: { pools: true, hooks: true, swaps: true } },
      },
    });

    const enriched = await Promise.all(
      chains.map(async (chain) => {
        const contracts = await ingestion.resolveContracts(chain.id);
        const provider = getChainLogProvider(chain.id, contracts);
        return {
          id: chain.id,
          slug: chain.slug,
          name: chain.name,
          shortName: chain.shortName,
          nativeCurrency: {
            symbol: chain.nativeCurrencySymbol,
            decimals: chain.nativeCurrencyDecimals,
          },
          explorerUrl: chain.explorerUrl,
          isTestnet: chain.isTestnet,
          /**
           * Which build of the settlement layer this chain gets. Chains without
           * EIP-1153 run the storage-backed transient slots, which is why the
           * distinction is modelled rather than assumed.
           */
          supportsEip1153: chain.supportsEip1153,
          transientBackend: chain.transientBackend,
          enabled: chain.enabled,
          dataSource: chain.dataSource.toLowerCase(),
          providerKind: provider.kind,
          contracts: contracts.map((c) => ({ role: c.role, address: c.address })),
          counts: chain._count,
        };
      }),
    );

    send(res, enriched, metaFor(enriched.some((c) => c.dataSource === "onchain") ? "mixed" : "fixture"));
  });

  v1.use("/pools", poolRoutes(prisma));
  v1.use("/hooks", hookRoutes(prisma));
  v1.use("/registry", registryRoutes(prisma));
  v1.use("/permissions", permissionRoutes());
  v1.use("/stats", statsRoutes(prisma));
  v1.use("/", eventRoutes(prisma));

  /**
   * POST /api/v1/admin/ingest
   *
   * Trigger a backfill. Enqueues by default; `sync: true` runs it inline, which
   * is convenient in development and a bad idea under load.
   */
  v1.post("/admin/ingest", requireAdmin, validate({ body: ingestBody }), async (_req, res) => {
    const { body } = validated<unknown, unknown, Infer<typeof ingestBody>>(res);

    const chain = await prisma.chain.findUnique({ where: { id: body.chainId } });
    if (!chain) throw ApiError.notFound(`Chain ${body.chainId}`);

    if (body.sync) {
      const summary = await ingestion.ingest({
        chainId: body.chainId,
        fromBlock: body.fromBlock,
        toBlock: body.toBlock,
        force: body.force,
        jobName: "admin-sync",
      });
      send(res, { mode: "sync", summary }, metaFor("curated"), 200);
      return;
    }

    const job = await enqueueBackfill({
      chainId: body.chainId,
      fromBlock: body.fromBlock?.toString(),
      toBlock: body.toBlock?.toString(),
      force: body.force,
    });

    send(res, { mode: "queued", jobId: job.id, name: job.name }, metaFor("curated"), 202);
  });

  router.use("/api/v1", v1);
  return router;
}
