import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { decodeCursor } from "../lib/pagination.js";
import { labelFor, metaFor, send } from "../lib/response.js";
import { validate, validated, type Infer } from "../middleware/validate.js";
import { EventService } from "../services/event.service.js";
import { PoolService } from "../services/pool.service.js";
import {
  listPoolsQuery,
  listSwapsQuery,
  poolDetailQuery,
  poolParams,
} from "./schemas.js";

export function poolRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const pools = new PoolService(prisma);
  const events = new EventService(prisma);

  /** GET /api/v1/pools */
  router.get("/", validate({ query: listPoolsQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof listPoolsQuery>>(res);
    const result = await pools.list(query);

    send(
      res,
      result.items,
      metaFor(labelFor(result.rows), {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + result.items.length < result.total,
      }),
    );
  });

  /**
   * GET /api/v1/pools/:id
   *
   * `:id` accepts either the row id (`${chainId}-${poolId}`) or a bare pool id,
   * optionally narrowed by `?chainId=`.
   */
  router.get(
    "/:id",
    validate({ params: poolParams, query: poolDetailQuery }),
    async (_req, res) => {
      const { params, query } = validated<
        Infer<typeof poolDetailQuery>,
        Infer<typeof poolParams>
      >(res);
      const { pool, dataSource } = await pools.detail(params.id, query.chainId);
      send(res, pool, metaFor(labelFor([{ dataSource }])));
    },
  );

  /** GET /api/v1/pools/:id/swaps */
  router.get(
    "/:id/swaps",
    validate({ params: poolParams, query: listSwapsQuery }),
    async (_req, res) => {
      const { params, query } = validated<Infer<typeof listSwapsQuery>, Infer<typeof poolParams>>(
        res,
      );
      const page = await events.swaps({
        ...query,
        poolId: params.id,
        cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      });

      send(
        res,
        page.items,
        metaFor(labelFor(page.items), {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          limit: query.limit,
        }),
      );
    },
  );

  /** GET /api/v1/pools/:id/liquidity */
  router.get(
    "/:id/liquidity",
    validate({ params: poolParams, query: listSwapsQuery }),
    async (_req, res) => {
      const { params, query } = validated<Infer<typeof listSwapsQuery>, Infer<typeof poolParams>>(
        res,
      );
      const page = await events.liquidityChanges({
        ...query,
        poolId: params.id,
        cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      });

      send(
        res,
        page.items,
        metaFor(labelFor(page.items), {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          limit: query.limit,
        }),
      );
    },
  );

  return router;
}
