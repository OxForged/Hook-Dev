import { isLatchChainId } from "@latchprotocol/sdk";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { cached, TTL } from "../cache/cache.js";
import { ApiError } from "../lib/errors.js";
import { decodeCursor, pageQuery } from "../lib/pagination.js";
import { send } from "../lib/response.js";
import { toJsonSafe } from "../lib/serialize.js";
import { INTERVALS } from "../services/candleBuilder.js";
import type { DexScreenerService } from "../services/dexscreener.js";
import type { KitV2ReadService } from "../services/kitV2.js";
import { WINDOWS, type ReadService } from "../services/read.js";
import { input, publicCacheHeaders, requireScope, validate } from "./middleware.js";

/**
 * Public read API, /v1. Every handler reads Postgres (through ReadService) and
 * the response cache. None can reach a chain.
 */

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte 0x address")
  .transform((s) => s.toLowerCase());
const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x value")
  .transform((s) => s.toLowerCase());
const chainParam = z.object({
  chainId: z.coerce
    .number()
    .int()
    .refine((id) => isLatchChainId(id), "chain is not in the Latch address book"),
});
const offsetPage = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const windowQuery = z.object({ window: z.enum(Object.keys(WINDOWS) as [keyof typeof WINDOWS]).default("24h") });

type Handler = (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => Promise<void>;
const h = (fn: Handler): RequestHandler => (req, res, next) => fn(req, res).catch(next);

export function publicRouter(read: ReadService, dex: DexScreenerService, dexMaxRange: number, kitV2: KitV2ReadService): Router {
  const r = Router();
  r.use(publicCacheHeaders);

  r.get("/", (_req, res) => {
    res.json({
      name: "Latch hosted API",
      version: "v1",
      docs: "apps/api/README.md",
      auth: "Anonymous: per-IP limit. API key: X-API-Key header (never the query string).",
      routes: [
        "GET /v1/health",
        "GET /v1/chains",
        "GET /v1/chains/:chainId/health",
        "GET /v1/chains/:chainId/tokens",
        "GET /v1/chains/:chainId/tokens/:address",
        "GET /v1/chains/:chainId/pools",
        "GET /v1/chains/:chainId/pools/:poolId",
        "GET /v1/chains/:chainId/pools/:poolId/swaps",
        "GET /v1/chains/:chainId/pools/:poolId/candles",
        "GET /v1/chains/:chainId/volume",
        "GET /v1/chains/:chainId/revenue/creators",
        "GET /v1/chains/:chainId/revenue/protocol",
        "GET /v1/chains/:chainId/launches",
        "GET /v1/chains/:chainId/launches/:poolId",
        "GET /v1/chains/:chainId/latches/:address/registry",
        "GET /v1/chains/:chainId/kit-v2/launches",
        "GET /v1/chains/:chainId/kit-v2/launches/token/:token",
        "GET /v1/chains/:chainId/kit-v2/launches/token/:token/fees",
        "GET /v1/chains/:chainId/kit-v2/launches/pool/:poolId",
        "GET /v1/dexscreener/:chainId/latest-block",
        "GET /v1/dexscreener/:chainId/asset?id=",
        "GET /v1/dexscreener/:chainId/pair?id=",
        "GET /v1/dexscreener/:chainId/events?fromBlock=&toBlock=",
      ],
    });
  });

  r.get(
    "/chains",
    requireScope("public:read"),
    h(async (_req, res) => {
      res.json(toJsonSafe({ data: await cached(["chains"], TTL.short, () => read.chains()) }));
    }),
  );

  r.get(
    "/health",
    h(async (_req, res) => {
      const chains = await read.chains();
      const all = await Promise.all(chains.map((c) => read.health(c.chainId)));
      res.json(toJsonSafe({ data: all }));
    }),
  );

  const c = Router({ mergeParams: true });
  c.use(requireScope("public:read"), validate({ params: chainParam }));
  const chainId = (res: Parameters<RequestHandler>[1]) => (res.locals.validated.params as { chainId: number }).chainId;

  c.get(
    "/health",
    h(async (_req, res) => {
      res.json(toJsonSafe({ data: await read.health(chainId(res)) }));
    }),
  );

  const tokensQ = offsetPage.extend({ search: z.string().trim().min(1).max(64).optional() });
  c.get(
    "/tokens",
    (req, res, next) => validate({ params: chainParam, query: tokensQ })(req, res, next),
    h(async (_req, res) => {
      const id = chainId(res);
      const q = input<typeof tokensQ>(res).query;
      const result = await cached(["tokens", id, q.search ?? "-", q.limit, q.offset], TTL.medium, async () => toJsonSafe(await read.tokens(id, q)));
      send(res, { data: result, provenance: await read.provenance(id) });
    }),
  );

  c.get(
    "/tokens/:address",
    validate({ params: chainParam.extend({ address }) }),
    h(async (_req, res) => {
      const { chainId: id, address: a } = res.locals.validated.params as { chainId: number; address: string };
      const data = await cached(["token", id, a], TTL.short, async () => toJsonSafe(await read.token(id, a)));
      send(res, { data, provenance: await read.provenance(id, { notes: ["USD appears only from a Chainlink read; see usd.source and usd.feedUpdatedAt"] }) });
    }),
  );

  const poolsQ = offsetPage.extend({ token: address.optional(), hook: address.optional() });
  c.get(
    "/pools",
    validate({ params: chainParam, query: poolsQ }),
    h(async (_req, res) => {
      const id = chainId(res);
      const q = input<typeof poolsQ>(res).query;
      const data = await cached(["pools", id, q.token ?? "-", q.hook ?? "-", q.limit, q.offset], TTL.short, async () => toJsonSafe(await read.pools(id, q)));
      send(res, { data, provenance: await read.provenance(id) });
    }),
  );

  const poolParams = chainParam.extend({ poolId: bytes32 });
  c.get(
    "/pools/:poolId",
    validate({ params: poolParams }),
    h(async (_req, res) => {
      const { chainId: id, poolId } = res.locals.validated.params as { chainId: number; poolId: string };
      const data = await cached(["pool", id, poolId], TTL.short, async () => toJsonSafe(await read.pool(id, poolId)));
      send(res, { data, provenance: await read.provenance(id) });
    }),
  );

  c.get(
    "/pools/:poolId/swaps",
    validate({ params: poolParams, query: pageQuery }),
    h(async (_req, res) => {
      const { chainId: id, poolId } = res.locals.validated.params as { chainId: number; poolId: string };
      const q = input<typeof pageQuery>(res).query;
      const { items, page } = await read.swaps(id, poolId, q.limit, q.cursor ? decodeCursor(q.cursor) : undefined);
      send(res, { data: items, page, provenance: await read.provenance(id) });
    }),
  );

  const candleQ = z.object({
    interval: z.enum(Object.keys(INTERVALS) as [keyof typeof INTERVALS]).default("1h"),
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    invert: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  });
  c.get(
    "/pools/:poolId/candles",
    validate({ params: poolParams, query: candleQ }),
    h(async (_req, res) => {
      const { chainId: id, poolId } = res.locals.validated.params as { chainId: number; poolId: string };
      const q = input<typeof candleQ>(res).query;
      const data = await cached(["candles", id, poolId, q.interval, q.from, q.to, String(q.invert)], TTL.short, () => read.candles(id, poolId, q));
      send(res, { data, provenance: await read.provenance(id) });
    }),
  );

  const volumeQ = windowQuery.extend({ poolId: bytes32.optional() });
  c.get(
    "/volume",
    validate({ params: chainParam, query: volumeQ }),
    h(async (_req, res) => {
      const id = chainId(res);
      const q = input<typeof volumeQ>(res).query;
      const data = await cached(["volume", id, q.window, q.poolId ?? "-"], TTL.short, async () => toJsonSafe(await read.volume(id, q)));
      send(res, { data, provenance: await read.provenance(id) });
    }),
  );

  c.get(
    "/revenue/creators",
    validate({ params: chainParam, query: volumeQ }),
    h(async (_req, res) => {
      const id = chainId(res);
      const q = input<typeof volumeQ>(res).query;
      const data = await cached(["rev-creators", id, q.window, q.poolId ?? "-"], TTL.short, async () => toJsonSafe(await read.creatorRevenue(id, q)));
      send(res, { data, provenance: await read.provenance(id, { reconcileKinds: ["revshare.totalTaken", "revshare.cutHasSwap"] }) });
    }),
  );

  c.get(
    "/revenue/protocol",
    validate({ params: chainParam, query: windowQuery }),
    h(async (_req, res) => {
      const id = chainId(res);
      const q = input<typeof windowQuery>(res).query;
      const data = await cached(["rev-protocol", id, q.window], TTL.short, async () => toJsonSafe(await read.protocolRevenue(id, q)));
      send(res, {
        data,
        provenance: await read.provenance(id, { notes: ["No on-chain counter reconciles swap protocol-fee slices exactly (per-step rounding); accrued and collected are shown beside them."] }),
      });
    }),
  );

  c.get(
    "/launches",
    validate({ params: chainParam, query: offsetPage }),
    h(async (_req, res) => {
      const id = chainId(res);
      const q = input<typeof offsetPage>(res).query;
      const data = await cached(["launches", id, q.limit, q.offset], TTL.short, async () => toJsonSafe(await read.launches(id, q)));
      send(res, { data, provenance: await read.provenance(id) });
    }),
  );

  c.get(
    "/launches/:poolId",
    validate({ params: poolParams }),
    h(async (_req, res) => {
      const { chainId: id, poolId } = res.locals.validated.params as { chainId: number; poolId: string };
      const data = await cached(["launch", id, poolId], TTL.short, async () => toJsonSafe(await read.launch(id, poolId)));
      send(res, { data, provenance: await read.provenance(id) });
    }),
  );

  c.get(
    "/latches/:address/registry",
    validate({ params: chainParam.extend({ address }) }),
    h(async (_req, res) => {
      const { chainId: id, address: a } = res.locals.validated.params as { chainId: number; address: string };
      send(res, { data: await read.registryStatus(id, a), provenance: await read.provenance(id) });
    }),
  );

  // --- LaunchpadKitV2 (config-addressed; 404 "not configured" until an address is recorded) ---
  const kitNotes = ["Kit v2 is timestamp-clocked: startTime is unix seconds. Launch fees are native (wei); lock splits are frozen at creation. Token units only, no USD."];
  const kitListQ = offsetPage.extend({ creator: address.optional(), tenant: address.optional() });
  c.get(
    "/kit-v2/launches",
    validate({ params: chainParam, query: kitListQ }),
    h(async (_req, res) => {
      const id = chainId(res);
      kitV2.requireConfigured(id);
      const q = input<typeof kitListQ>(res).query;
      const provenance = await read.provenance(id, { notes: kitNotes });
      const data = await cached(["kitv2-launches", id, q.limit, q.offset, q.creator ?? "-", q.tenant ?? "-"], TTL.short, async () => toJsonSafe(await kitV2.launches(id, q)));
      send(res, { data, provenance });
    }),
  );
  c.get(
    "/kit-v2/launches/token/:token",
    validate({ params: chainParam.extend({ token: address }) }),
    h(async (_req, res) => {
      const { chainId: id, token } = res.locals.validated.params as { chainId: number; token: string };
      kitV2.requireConfigured(id);
      const provenance = await read.provenance(id, { notes: kitNotes });
      const data = await cached(["kitv2-launch", id, token], TTL.short, async () => toJsonSafe(await kitV2.launchByToken(id, token)));
      send(res, { data, provenance });
    }),
  );
  c.get(
    "/kit-v2/launches/token/:token/fees",
    validate({ params: chainParam.extend({ token: address }) }),
    h(async (_req, res) => {
      const { chainId: id, token } = res.locals.validated.params as { chainId: number; token: string };
      kitV2.requireConfigured(id);
      const provenance = await read.provenance(id, { notes: [...kitNotes, "Collected fees are summed from the lockers' FeesCollected logs; the split is checked to sum exactly per currency."] });
      const data = await cached(["kitv2-launch-fees", id, token], TTL.short, async () => toJsonSafe(await kitV2.launchFees(id, token)));
      send(res, { data, provenance });
    }),
  );
  c.get(
    "/kit-v2/launches/pool/:poolId",
    validate({ params: poolParams }),
    h(async (_req, res) => {
      const { chainId: id, poolId } = res.locals.validated.params as { chainId: number; poolId: string };
      kitV2.requireConfigured(id);
      const provenance = await read.provenance(id, { notes: kitNotes });
      const data = await cached(["kitv2-launch-pool", id, poolId], TTL.short, async () => toJsonSafe(await kitV2.launchByPool(id, poolId)));
      send(res, { data, provenance });
    }),
  );

  r.use("/chains/:chainId", c);

  // --- DEX Screener adapter --------------------------------------------------
  const d = Router({ mergeParams: true });
  d.use(requireScope("dexscreener:read"), validate({ params: chainParam }));
  const provenanceHeader = async (res: Parameters<RequestHandler>[1], id: number) => {
    const p = await read.provenance(id);
    res.setHeader("X-Latch-Provenance", JSON.stringify({ chainId: p.chainId, toBlock: p.toBlock, lagBlocks: p.indexerLag.blocks, reconciled: p.reconciled.state }));
    return p;
  };
  d.get(
    "/latest-block",
    h(async (_req, res) => {
      const id = chainId(res);
      const body = await dex.latestBlock(id);
      res.json({ ...body, provenance: await provenanceHeader(res, id) });
    }),
  );
  d.get(
    "/asset",
    validate({ params: chainParam, query: z.object({ id: address }) }),
    h(async (_req, res) => {
      const id = chainId(res);
      const body = await dex.asset(id, (res.locals.validated.query as { id: string }).id);
      res.json({ ...body, provenance: await provenanceHeader(res, id) });
    }),
  );
  d.get(
    "/pair",
    validate({ params: chainParam, query: z.object({ id: bytes32 }) }),
    h(async (_req, res) => {
      const id = chainId(res);
      const body = await dex.pair(id, (res.locals.validated.query as { id: string }).id);
      res.json({ ...body, provenance: await provenanceHeader(res, id) });
    }),
  );
  const evQ = z.object({ fromBlock: z.coerce.bigint().nonnegative(), toBlock: z.coerce.bigint().nonnegative() });
  d.get(
    "/events",
    validate({ params: chainParam, query: evQ }),
    h(async (_req, res) => {
      const id = chainId(res);
      const q = input<typeof evQ>(res).query;
      if (q.toBlock - q.fromBlock > BigInt(dexMaxRange)) throw ApiError.badRequest(`Block range exceeds ${dexMaxRange}`);
      const body = await dex.events(id, q.fromBlock, q.toBlock, dexMaxRange);
      res.json({ ...body, provenance: await provenanceHeader(res, id) });
    }),
  );
  r.use("/dexscreener/:chainId", d);

  return r;
}
