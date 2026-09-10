import type { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { metaFor, send } from "../lib/response.js";
import { validate, validated, type Infer } from "../middleware/validate.js";
import { StatsService } from "../services/stats.service.js";
import { statsQuery, timeseriesQuery, topQuery } from "./schemas.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function statsRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const stats = new StatsService(prisma);

  /**
   * Everything below is currently computed over fixture rows, so every response
   * is labelled `fixture` and carries the standard disclaimer. That label is
   * derived from the data, not hard-coded: once a chain is ingested over RPC,
   * rows carry `dataSource: ONCHAIN` and the label follows.
   */
  const label = async (chainId?: number) => {
    const counts = await prisma.pool.groupBy({
      by: ["dataSource"],
      where: chainId !== undefined ? { chainId } : {},
      _count: { _all: true },
    });
    if (counts.length === 0) return "empty" as const;
    if (counts.length > 1) return "mixed" as const;
    return counts[0]!.dataSource === "ONCHAIN" ? ("onchain" as const) : ("fixture" as const);
  };

  /** GET /api/v1/stats/overview */
  router.get("/overview", validate({ query: statsQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof statsQuery>>(res);
    const [data, dataSource] = await Promise.all([
      stats.overview(query.chainId),
      label(query.chainId),
    ]);
    send(res, data, metaFor(dataSource));
  });

  /**
   * GET /api/v1/stats/timeseries
   *
   * Bucketed swap counts and volume. Defaults to the last 30 days by day.
   */
  router.get("/timeseries", validate({ query: timeseriesQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof timeseriesQuery>>(res);
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 30 * DAY_MS);

    const [data, dataSource] = await Promise.all([
      stats.timeseries({
        chainId: query.chainId,
        poolId: query.poolId,
        poolType: query.poolType,
        interval: query.interval,
        from,
        to,
      }),
      label(query.chainId),
    ]);
    send(res, data, metaFor(dataSource));
  });

  /** GET /api/v1/stats/top-pools */
  router.get("/top-pools", validate({ query: topQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof topQuery>>(res);
    const [data, dataSource] = await Promise.all([
      stats.topPools(query.chainId, query.limit),
      label(query.chainId),
    ]);
    send(res, data, metaFor(dataSource, { limit: query.limit }));
  });

  /** GET /api/v1/stats/top-hooks */
  router.get("/top-hooks", validate({ query: topQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof topQuery>>(res);
    const [data, dataSource] = await Promise.all([
      stats.topHooks(query.chainId, query.limit),
      label(query.chainId),
    ]);
    send(res, data, metaFor(dataSource, { limit: query.limit }));
  });

  /**
   * GET /api/v1/stats/permissions
   *
   * How many pools register each callback, per pool type. This chart is only
   * possible because permissions are recorded per pool in `parameters` rather
   * than baked into hook addresses.
   */
  router.get("/permissions", validate({ query: statsQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof statsQuery>>(res);
    const [data, dataSource] = await Promise.all([
      stats.permissionHistogram(query.chainId),
      label(query.chainId),
    ]);
    send(res, data, metaFor(dataSource));
  });

  /** GET /api/v1/stats/fee-tiers */
  router.get("/fee-tiers", validate({ query: statsQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof statsQuery>>(res);
    const [data, dataSource] = await Promise.all([
      stats.feeTiers(query.chainId),
      label(query.chainId),
    ]);
    send(res, data, metaFor(dataSource));
  });

  return router;
}
