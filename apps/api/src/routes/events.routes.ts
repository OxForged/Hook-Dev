import type { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { decodeCursor } from "../lib/pagination.js";
import { labelFor, metaFor, send } from "../lib/response.js";
import { validate, validated, type Infer } from "../middleware/validate.js";
import { EventService } from "../services/event.service.js";
import {
  listFeeChangesQuery,
  listLiquidityQuery,
  listSwapsQuery,
  listVaultEventsQuery,
} from "./schemas.js";

export function eventRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const events = new EventService(prisma);

  /** GET /api/v1/swaps */
  router.get("/swaps", validate({ query: listSwapsQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof listSwapsQuery>>(res);
    const page = await events.swaps({
      chainId: query.chainId,
      poolId: query.poolId,
      hookAddress: query.hook,
      sender: query.sender,
      poolType: query.poolType,
      from: query.from,
      to: query.to,
      limit: query.limit,
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
  });

  /** GET /api/v1/liquidity-changes — CL ModifyLiquidity plus bin Mint/Burn. */
  router.get("/liquidity-changes", validate({ query: listLiquidityQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof listLiquidityQuery>>(res);
    const page = await events.liquidityChanges({
      chainId: query.chainId,
      poolId: query.poolId,
      sender: query.sender,
      poolType: query.poolType,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
    });

    send(
      res,
      page.items,
      metaFor(labelFor(page.items), {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        limit: query.limit,
        note:
          "Bin Mint/Burn amounts are surfaced as opaque PackedUint128Math words. " +
          "They are not decoded, because the packing has not been verified against BinHelper.",
      }),
    );
  });

  /**
   * GET /api/v1/protocol-fee-changes
   *
   * Unifies the core's `ProtocolFeeUpdated` / `ProtocolFeeControllerUpdated`
   * with the fee controller's five governance events. Each row carries
   * `emittedBy`, which is the only field that separates the CL and bin
   * managers' identically-signed `ProtocolFeeUpdated` logs.
   */
  router.get("/protocol-fee-changes", validate({ query: listFeeChangesQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof listFeeChangesQuery>>(res);
    const page = await events.protocolFeeChanges({
      chainId: query.chainId,
      poolId: query.poolId,
      limit: query.limit,
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
  });

  /** GET /api/v1/vault-events — claim-token Transfer / Approval / OperatorSet. */
  router.get("/vault-events", validate({ query: listVaultEventsQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof listVaultEventsQuery>>(res);
    const page = await events.vaultTokenEvents({
      chainId: query.chainId,
      kind: query.kind,
      currency: query.currency,
      limit: query.limit,
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
  });

  return router;
}
