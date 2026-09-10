import type { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { metaFor, send } from "../lib/response.js";
import { validate, validated, type Infer } from "../middleware/validate.js";
import { HookService } from "../services/hook.service.js";
import { describeBitmap, flagTable } from "../services/permissions.service.js";
import {
  hookParams,
  hookQuery,
  listHooksQuery,
  listRegistryQuery,
  permissionsQuery,
  registryParams,
} from "./schemas.js";

export function hookRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const hooks = new HookService(prisma);

  /** GET /api/v1/hooks — hook contracts observed in pool keys. */
  router.get("/", validate({ query: listHooksQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof listHooksQuery>>(res);
    const result = await hooks.listHooks(query);

    send(
      res,
      result.items,
      metaFor(result.items.length === 0 ? "empty" : "fixture", {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  });

  /** GET /api/v1/hooks/:address */
  router.get("/:address", validate({ params: hookParams, query: hookQuery }), async (_req, res) => {
    const { params, query } = validated<Infer<typeof hookQuery>, Infer<typeof hookParams>>(res);
    const hook = await hooks.hookDetail(params.address, query.chainId);
    send(res, hook, metaFor(hook.dataSource === "onchain" ? "onchain" : "fixture"));
  });

  return router;
}

export function registryRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const hooks = new HookService(prisma);

  /**
   * GET /api/v1/registry — the hook marketplace.
   *
   * Filterable by pool type, audit status, verification, chain, tag, free text,
   * and by required permission bits (`?bits=6,7,11`).
   */
  router.get("/", validate({ query: listRegistryQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof listRegistryQuery>>(res);
    const result = await hooks.listRegistry({
      poolType: query.poolType,
      verified: query.verified,
      auditStatus: query.auditStatus,
      kind: query.kind,
      chainId: query.chainId,
      tag: query.tag,
      search: query.search,
      requiredBits: query.bits,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    });

    send(
      res,
      result.items,
      metaFor("curated", {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  });

  /** GET /api/v1/registry/facets — tag counts for filter chips. */
  router.get("/facets", async (_req, res) => {
    const facets = await hooks.registryFacets();
    send(res, facets, metaFor("curated"));
  });

  /** GET /api/v1/registry/:slug */
  router.get("/:slug", validate({ params: registryParams }), async (_req, res) => {
    const { params } = validated<unknown, Infer<typeof registryParams>>(res);
    const entry = await hooks.registryEntry(params.slug);
    send(res, entry, metaFor("curated"));
  });

  return router;
}

export function permissionRoutes(): Router {
  const router = Router();

  /**
   * GET /api/v1/permissions/flags?poolType=CL
   *
   * The bit table for a pool type. Useful for building a bitmap picker without
   * hard-coding offsets on the client.
   */
  router.get("/flags", validate({ query: permissionsQuery.partial() }), async (_req, res) => {
    const { query } = validated<{ poolType?: "CL" | "BIN" }>(res);
    const poolType = query.poolType ?? "CL";
    send(
      res,
      {
        poolType,
        flags: flagTable(poolType),
        note:
          "Permissions live in the low 16 bits of poolKey.parameters and are cross-checked " +
          "against the hook's getHooksRegistrationBitmap() at initialize(). They are NOT " +
          "encoded in the hook's address, so there is no CREATE2 salt to mine.",
      },
      metaFor("curated"),
    );
  });

  /** GET /api/v1/permissions/decode?poolType=CL&bitmap=0x08c0 */
  router.get("/decode", validate({ query: permissionsQuery }), async (_req, res) => {
    const { query } = validated<Infer<typeof permissionsQuery>>(res);
    send(res, describeBitmap(query.poolType, query.bitmap), metaFor("curated"));
  });

  return router;
}
