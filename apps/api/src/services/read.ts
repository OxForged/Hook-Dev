import {
  blockWindowPhase,
  contractBlocksToSeconds,
  getDeployment,
  isDynamicLPFee,
  listingFromUint8,
  verificationFromUint8,
} from "@latchprotocol/sdk";
import type { Prisma, PrismaClient } from "@prisma/client";
import { revShareHooksFor } from "../chain/deployments.js";
import { chainConfig } from "../config/chainConfig.js";
import { ApiError } from "../lib/errors.js";
import { beforeCursor, toPage, type EventCursor } from "../lib/pagination.js";
import { describeBitmap } from "../lib/permissions.js";
import type { Provenance, ReconciledState } from "../lib/response.js";
import { decStr } from "../lib/serialize.js";
import { formatUnitsExact, ratioToDecimal, sqrtPriceX96ToRatio, toBigInt } from "../lib/units.js";
import { buildCandles, INTERVALS, type IntervalName } from "./candleBuilder.js";

/**
 * Every public read. Postgres only: nothing in this file (or anything it
 * imports) talks to a chain, so no request can trigger an unbounded chain read.
 */

export const WINDOWS = { "24h": 86_400, "7d": 604_800, "30d": 2_592_000, all: null } as const;
export type WindowName = keyof typeof WINDOWS;

/** Cap on swaps pulled into one candle request; beyond it the caller narrows the range. */
export const MAX_CANDLE_SWAPS = 50_000;
export const MAX_CANDLES = 1_500;

const ZERO = "0x0000000000000000000000000000000000000000";

export class ReadService {
  constructor(private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Provenance
  // -------------------------------------------------------------------------

  async checkpoint(chainId: number) {
    const cp = await this.prisma.indexerCheckpoint.findUnique({ where: { chainId } });
    if (!cp) throw ApiError.notIndexed(chainId);
    return cp;
  }

  async provenance(
    chainId: number,
    opts: { fromBlock?: bigint | null; reconcileKinds?: string[]; notes?: string[] } = {},
  ): Promise<Provenance> {
    const cp = await this.checkpoint(chainId);
    const d = getDeployment(chainId);
    let reconciled: Provenance["reconciled"] = { state: "not-applicable", atBlock: null, checks: 0 };
    const notes = [...(opts.notes ?? [])];
    if (opts.reconcileKinds && opts.reconcileKinds.length > 0) {
      const rows = await this.prisma.reconciliation.findMany({ where: { chainId, kind: { in: opts.reconcileKinds } } });
      let state: ReconciledState;
      if (rows.length === 0) state = "pending";
      else if (rows.some((r) => r.status === "MISMATCH")) state = "mismatch";
      else if (rows.every((r) => r.status === "VERIFIED")) state = "verified";
      else state = "partial";
      const atBlock = rows.length ? rows.reduce((m, r) => (r.atBlock < m ? r.atBlock : m), rows[0]!.atBlock) : null;
      if (atBlock !== null && atBlock < cp.lastIndexedBlock) {
        notes.push(`reconciled at block ${atBlock}; data extends to block ${cp.lastIndexedBlock}`);
      }
      reconciled = { state, atBlock: atBlock?.toString() ?? null, checks: rows.length };
    }
    const lag = cp.headBlock > cp.lastIndexedBlock ? cp.headBlock - cp.lastIndexedBlock : 0n;
    return {
      chainId,
      source: "latch-indexer",
      fromBlock: (opts.fromBlock ?? d?.deployedAtBlock ?? null)?.toString() ?? null,
      toBlock: cp.lastIndexedBlock.toString(),
      toBlockTimestamp: cp.lastIndexedBlockTimestamp.toISOString(),
      indexerLag: { blocks: lag.toString(), headBlock: cp.headBlock.toString(), headObservedAt: cp.headObservedAt.toISOString() },
      reconciled,
      generatedAt: new Date().toISOString(),
      ...(notes.length ? { notes } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Chains and health
  // -------------------------------------------------------------------------

  async chains() {
    const [chains, cps] = await Promise.all([this.prisma.chain.findMany({ orderBy: { id: "asc" } }), this.prisma.indexerCheckpoint.findMany()]);
    return chains.map((c) => {
      const cp = cps.find((x) => x.chainId === c.id);
      return {
        chainId: c.id,
        key: c.key,
        name: c.name,
        isMainnet: c.isMainnet,
        deployedAtBlock: c.deployedAtBlock.toString(),
        contractBlockClock: c.contractBlockClock,
        indexedToBlock: cp?.lastIndexedBlock.toString() ?? null,
      };
    });
  }

  async health(chainId: number) {
    const cp = await this.prisma.indexerCheckpoint.findUnique({ where: { chainId } });
    const runs = await this.prisma.indexerRun.findMany({ where: { chainId }, orderBy: { startedAt: "desc" }, take: 20 });
    const lastBy = (kind: string) => runs.find((r) => r.kind === kind) ?? null;
    const recs = await this.prisma.reconciliation.groupBy({ by: ["status"], where: { chainId }, _count: { _all: true } });
    const reorgs = await this.prisma.reorgEvent.count({ where: { chainId, detectedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } });
    const lagBlocks = cp ? (cp.headBlock > cp.lastIndexedBlock ? cp.headBlock - cp.lastIndexedBlock : 0n) : null;
    const summarise = (r: (typeof runs)[number] | null) =>
      r && { status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, error: r.error, endpointHost: r.endpointHost };
    return {
      chainId,
      indexed: cp !== null,
      lastIndexedBlock: cp?.lastIndexedBlock ?? null,
      lastIndexedBlockTimestamp: cp?.lastIndexedBlockTimestamp ?? null,
      headBlock: cp?.headBlock ?? null,
      headObservedAt: cp?.headObservedAt ?? null,
      lag: {
        blocks: lagBlocks,
        /** Wall clock at the head observation minus the last indexed block's timestamp. Approximate. */
        secondsApprox: cp ? Math.max(0, Math.round((cp.headObservedAt.getTime() - cp.lastIndexedBlockTimestamp.getTime()) / 1000)) : null,
        headObservationAgeSeconds: cp ? Math.round((Date.now() - cp.headObservedAt.getTime()) / 1000) : null,
      },
      contractClock: cp?.contractBlockNumber
        ? { contractBlockNumber: cp.contractBlockNumber, method: cp.contractClockMethod, rpcBlock: cp.contractClockRpcBlock, readAt: cp.contractClockReadAt }
        : null,
      runs: { index: summarise(lastBy("INDEX")), snapshot: summarise(lastBy("SNAPSHOT")), governance: summarise(lastBy("GOVERNANCE_SNAPSHOT")), feeds: summarise(lastBy("FEEDS")) },
      reconciliation: Object.fromEntries(recs.map((r) => [r.status, r._count._all])),
      reorgsLast7d: reorgs,
    };
  }

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  async usdFor(chainId: number, token: { address: string; uiMultiplier: Prisma.Decimal | null; decimals: number | null }) {
    const cfg = chainConfig(chainId);
    const mapping = cfg.pricedTokens.find((t) => t.token === token.address);
    if (!mapping) return { price: null, reason: "no oracle feed is configured for this token" };
    const feed = cfg.feeds.find((f) => f.label === mapping.feedLabel)!;
    const obs = await this.prisma.feedObservation.findFirst({ where: { chainId, proxy: feed.proxy }, orderBy: { readAt: "desc" } });
    if (!obs || obs.answer === null || obs.decimals === null) return { price: null, reason: obs?.error ? `last feed read failed: ${obs.error}` : "feed not read yet" };
    const answer = toBigInt(obs.answer);
    if (answer <= 0n) return { price: null, reason: "feed answered a non-positive price" };
    if (obs.heartbeatViolation) return { price: null, reason: `feed stale: ${obs.stalenessSeconds}s since update, heartbeat ${obs.heartbeatSeconds}s` };
    let num = answer;
    let den = 10n ** BigInt(obs.decimals);
    if (mapping.scaleByUiMultiplier) {
      if (token.uiMultiplier === null) return { price: null, reason: "token uiMultiplier not read; a per-share feed cannot be applied to raw token units without it" };
      num *= toBigInt(token.uiMultiplier);
      den *= 10n ** 18n;
    }
    return {
      price: {
        usdPerToken: ratioToDecimal({ num, den }, 18),
        source: "chainlink",
        feed: { label: feed.label, proxy: feed.proxy, description: obs.description },
        feedAnswer: answer.toString(),
        feedDecimals: obs.decimals,
        feedUpdatedAt: obs.feedUpdatedAt,
        readAtBlock: obs.readAtBlock,
        readAt: obs.readAt,
        uiMultiplier: mapping.scaleByUiMultiplier ? decStr(token.uiMultiplier) : null,
        method: mapping.scaleByUiMultiplier ? "answer / 10^decimals x uiMultiplier / 1e18" : "answer / 10^decimals",
      },
      reason: null,
    };
  }

  private tokenView(t: {
    address: string;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
    totalSupply: Prisma.Decimal | null;
    inAddressBook: boolean;
    isTestToken: boolean | null;
    uiMultiplier: Prisma.Decimal | null;
    readAtBlock: bigint | null;
    readAt: Date | null;
    readError: string | null;
  }) {
    return {
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      totalSupplyRaw: decStr(t.totalSupply),
      totalSupply: t.totalSupply !== null && t.decimals !== null ? formatUnitsExact(toBigInt(t.totalSupply), t.decimals) : null,
      isNative: t.address === ZERO,
      inAddressBook: t.inAddressBook,
      isTestToken: t.isTestToken,
      stockToken: t.uiMultiplier === null ? null : { uiMultiplier: decStr(t.uiMultiplier), note: "answered uiMultiplier(); issuer can pause, burn and upgrade" },
      metadata: { readAtBlock: t.readAtBlock, readAt: t.readAt, readError: t.readError },
    };
  }

  async tokens(chainId: number, q: { search?: string; limit: number; offset: number }) {
    const where: Prisma.TokenWhereInput = {
      chainId,
      ...(q.search ? { OR: [{ symbol: { contains: q.search, mode: "insensitive" } }, { address: q.search.toLowerCase() }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.token.findMany({ where, orderBy: [{ inAddressBook: "desc" }, { address: "asc" }], take: q.limit, skip: q.offset }),
      this.prisma.token.count({ where }),
    ]);
    return { items: rows.map((t) => this.tokenView(t)), total };
  }

  async token(chainId: number, address: string) {
    const t = await this.prisma.token.findUnique({ where: { chainId_address: { chainId, address } } });
    if (!t) throw ApiError.notFound(`Token ${address}`);
    const usd = await this.usdFor(chainId, t);
    const pools = await this.prisma.pool.count({ where: { chainId, OR: [{ currency0: address }, { currency1: address }] } });
    return { ...this.tokenView(t), usd: usd.price, usdUnavailableReason: usd.reason, poolCount: pools };
  }

  // -------------------------------------------------------------------------
  // Pools
  // -------------------------------------------------------------------------

  private async tokenMap(chainId: number, addresses: string[]) {
    const rows = await this.prisma.token.findMany({ where: { chainId, address: { in: [...new Set(addresses)] } } });
    return new Map(rows.map((r) => [r.address, r]));
  }

  private async poolView(
    chainId: number,
    p: Prisma.PoolGetPayload<{ include: { state: true } }>,
    tokens: Map<string, { symbol: string | null; decimals: number | null }>,
    ourHooks: Set<string>,
  ) {
    const t0 = tokens.get(p.currency0);
    const t1 = tokens.get(p.currency1);
    const s = p.state;
    let price: { token1PerToken0: string; token0PerToken1: string; source: string; readAtBlock: bigint } | null = null;
    if (s?.sqrtPriceX96 && t0?.decimals != null && t1?.decimals != null && toBigInt(s.sqrtPriceX96) > 0n) {
      const r = sqrtPriceX96ToRatio(toBigInt(s.sqrtPriceX96), t0.decimals, t1.decimals);
      price = { token1PerToken0: ratioToDecimal(r), token0PerToken1: ratioToDecimal({ num: r.den, den: r.num }), source: "getSlot0.sqrtPriceX96", readAtBlock: s.readAtBlock };
    }
    const dynamic = isDynamicLPFee(p.fee);
    const isHookless = p.hooks === ZERO;
    return {
      poolId: p.poolId,
      poolType: p.poolType,
      poolManager: p.poolManager,
      token0: { address: p.currency0, symbol: t0?.symbol ?? null, decimals: t0?.decimals ?? null },
      token1: { address: p.currency1, symbol: t1?.symbol ?? null, decimals: t1?.decimals ?? null },
      config: {
        feeRaw: p.fee,
        dynamicFee: dynamic,
        staticLpFeePips: dynamic ? null : p.fee,
        tickSpacing: p.tickSpacing,
        binStep: p.binStep,
        parameters: p.parameters,
      },
      hook: isHookless
        ? null
        : {
            address: p.hooks,
            latchRevShareHook: ourHooks.has(p.hooks),
            permissions: describeBitmap(p.poolType, p.hookBitmap),
            note: "A Latch is a hook contract attached to a pool. This reports its bitmap; it is not a safety assessment.",
          },
      state: s
        ? {
            sqrtPriceX96: decStr(s.sqrtPriceX96),
            tick: s.tick,
            activeLiquidityRaw: decStr(s.liquidity),
            activeId: s.activeId,
            lpFeePips: s.lpFee,
            protocolFeePacked: s.protocolFee,
            readAtBlock: s.readAtBlock,
            readAt: s.readAt,
            readError: s.readError,
          }
        : null,
      price,
      createdAt: { blockNumber: p.blockNumber, blockTimestamp: p.blockTimestamp, txHash: p.txHash },
    };
  }

  private async ourHooks(chainId: number) {
    const d = getDeployment(chainId);
    if (!d) return new Set<string>();
    const demo = d.demoPool ? await this.prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId: d.demoPool.id.toLowerCase() } }, select: { hooks: true } }) : null;
    return new Set<string>(revShareHooksFor(d, demo?.hooks ?? null));
  }

  async pools(chainId: number, q: { token?: string; hook?: string; limit: number; offset: number }) {
    const where: Prisma.PoolWhereInput = {
      chainId,
      ...(q.token ? { OR: [{ currency0: q.token }, { currency1: q.token }] } : {}),
      ...(q.hook ? { hooks: q.hook } : {}),
    };
    const [rows, total, hooks] = await Promise.all([
      this.prisma.pool.findMany({ where, include: { state: true }, orderBy: { blockNumber: "desc" }, take: q.limit, skip: q.offset }),
      this.prisma.pool.count({ where }),
      this.ourHooks(chainId),
    ]);
    const tokens = await this.tokenMap(chainId, rows.flatMap((r) => [r.currency0, r.currency1]));
    return { items: await Promise.all(rows.map((p) => this.poolView(chainId, p, tokens, hooks))), total };
  }

  async pool(chainId: number, poolId: string) {
    const p = await this.prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId } }, include: { state: true } });
    if (!p) throw ApiError.notFound(`Pool ${poolId}`);
    const [tokens, hooks, swapCount, lastSwap] = await Promise.all([
      this.tokenMap(chainId, [p.currency0, p.currency1]),
      this.ourHooks(chainId),
      this.prisma.swap.count({ where: { poolRowId: p.id } }),
      this.prisma.swap.findFirst({ where: { poolRowId: p.id }, orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }], select: { blockNumber: true, blockTimestamp: true } }),
    ]);
    return { ...(await this.poolView(chainId, p, tokens, hooks)), activity: { swapCount, lastSwap } };
  }

  async swaps(chainId: number, poolId: string, limit: number, cursor?: EventCursor) {
    const pool = await this.prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId } }, select: { id: true } });
    if (!pool) throw ApiError.notFound(`Pool ${poolId}`);
    const rows = await this.prisma.swap.findMany({
      where: { poolRowId: pool.id, ...beforeCursor(cursor) },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: limit + 1,
    });
    const { items, page } = toPage(rows, limit);
    return {
      items: items.map((s) => ({
        txHash: s.txHash,
        blockNumber: s.blockNumber,
        blockTimestamp: s.blockTimestamp,
        logIndex: s.logIndex,
        sender: s.sender,
        txFrom: s.txFrom,
        amount0: decStr(s.amount0),
        amount1: decStr(s.amount1),
        signConvention: "caller-side: negative = paid in",
        zeroForOne: s.zeroForOne,
        tokenIn: s.tokenIn,
        amountIn: decStr(s.amountIn),
        tokenOut: s.tokenOut,
        amountOut: decStr(s.amountOut),
        feePips: s.fee,
        protocolFeePips: s.protocolFee,
        fees: { total: decStr(s.feeTotal), lp: decStr(s.feeLp), protocol: decStr(s.feeProtocol), token: s.tokenIn },
      })),
      page,
    };
  }

  async candles(chainId: number, poolId: string, q: { interval: IntervalName; from: number; to: number; invert: boolean }) {
    const pool = await this.prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId } } });
    if (!pool) throw ApiError.notFound(`Pool ${poolId}`);
    const seconds = INTERVALS[q.interval];
    if (q.to <= q.from) throw ApiError.badRequest("`to` must be after `from`");
    if ((q.to - q.from) / seconds > MAX_CANDLES) throw ApiError.badRequest(`Range spans more than ${MAX_CANDLES} ${q.interval} intervals; narrow it or use a larger interval`);
    const tokens = await this.tokenMap(chainId, [pool.currency0, pool.currency1]);
    const d0 = tokens.get(pool.currency0)?.decimals;
    const d1 = tokens.get(pool.currency1)?.decimals;
    if (d0 == null || d1 == null) throw ApiError.unavailable("Token decimals not read yet; prices cannot be decimal-adjusted");
    const where = { poolRowId: pool.id, blockTimestamp: { gte: new Date(q.from * 1000), lt: new Date(q.to * 1000) } };
    const count = await this.prisma.swap.count({ where });
    if (count > MAX_CANDLE_SWAPS) throw ApiError.badRequest(`Range contains ${count} swaps (cap ${MAX_CANDLE_SWAPS}); narrow it`);
    const rows = await this.prisma.swap.findMany({
      where,
      select: { blockNumber: true, logIndex: true, blockTimestamp: true, amount0: true, amount1: true },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });
    const candles = buildCandles(
      rows.map((r) => ({ blockNumber: r.blockNumber, logIndex: r.logIndex, timestamp: Math.floor(r.blockTimestamp.getTime() / 1000), amount0: toBigInt(r.amount0), amount1: toBigInt(r.amount1) })),
      seconds,
      d0,
      d1,
      q.invert,
    );
    return {
      pool: poolId,
      base: q.invert ? pool.currency1 : pool.currency0,
      quote: q.invert ? pool.currency0 : pool.currency1,
      interval: q.interval,
      priceDefinition: "execution price per swap (gross Swap-log amounts, includes LP fee and price impact), quote per base",
      emptyIntervals: "omitted: there is no candle for an interval with no trades",
      swapsInRange: count,
      candles,
    };
  }

  // -------------------------------------------------------------------------
  // Volume, fees, revenue
  // -------------------------------------------------------------------------

  private async windowStart(chainId: number, window: WindowName): Promise<Date | null> {
    const secs = WINDOWS[window];
    if (secs === null) return null;
    const cp = await this.checkpoint(chainId);
    return new Date(cp.lastIndexedBlockTimestamp.getTime() - secs * 1000);
  }

  async volume(chainId: number, q: { window: WindowName; poolId?: string }) {
    const since = await this.windowStart(chainId, q.window);
    const poolRow = q.poolId ? `${chainId}-${q.poolId}` : undefined;
    const rows = await this.prisma.swap.groupBy({
      by: ["tokenIn"],
      where: { chainId, ...(since ? { blockTimestamp: { gte: since } } : {}), ...(poolRow ? { poolRowId: poolRow } : {}) },
      _count: { _all: true },
      _sum: { amountIn: true, feeTotal: true, feeLp: true, feeProtocol: true },
    });
    const tokens = await this.tokenMap(chainId, rows.map((r) => r.tokenIn));
    return {
      window: q.window,
      windowStart: since,
      windowEndsAt: "timestamp of the last indexed block (provenance.toBlockTimestamp)",
      definitions: {
        volumeIn: "sum of the INPUT leg (the negative Swap delta), per input token",
        fees: "per swap from its own fee/protocolFee fields: total = amountIn*fee/1e6, protocol = amountIn*protocolFee/1e6, lp = total - protocol",
      },
      byToken: rows.map((r) => {
        const t = tokens.get(r.tokenIn);
        const fmt = (v: Prisma.Decimal | null) => (v === null ? null : t?.decimals != null ? formatUnitsExact(toBigInt(v), t.decimals) : null);
        return {
          token: r.tokenIn,
          symbol: t?.symbol ?? null,
          decimals: t?.decimals ?? null,
          swapsIn: r._count._all,
          volumeInRaw: decStr(r._sum.amountIn),
          volumeIn: fmt(r._sum.amountIn),
          feesRaw: { total: decStr(r._sum.feeTotal), lp: decStr(r._sum.feeLp), protocol: decStr(r._sum.feeProtocol) },
          fees: { total: fmt(r._sum.feeTotal), lp: fmt(r._sum.feeLp), protocol: fmt(r._sum.feeProtocol) },
        };
      }),
    };
  }

  async creatorRevenue(chainId: number, q: { window: WindowName; poolId?: string }) {
    const since = await this.windowStart(chainId, q.window);
    const rows = await this.prisma.revShareTake.groupBy({
      by: ["hook", "poolId", "currency"],
      where: { chainId, ...(since ? { blockTimestamp: { gte: since } } : {}), ...(q.poolId ? { poolId: q.poolId } : {}) },
      _count: { _all: true },
      _sum: { lpDonated: true, toBeneficiaries: true, toDistributor: true },
    });
    const recs = await this.prisma.reconciliation.findMany({ where: { chainId, kind: "revshare.totalTaken" } });
    const tokens = await this.tokenMap(chainId, rows.map((r) => r.currency));
    return {
      window: q.window,
      windowStart: since,
      source: "RevShareTaken logs from Latch's own RevShareHook deployments only",
      noCumulativeCounterNote: "Summed from logs. Lifetime sums are checked against RevShareHook.totalTaken where the hook has it.",
      items: rows.map((r) => {
        const t = tokens.get(r.currency);
        const rec = recs.find((x) => x.subject === `${r.hook}:${r.poolId}:${r.currency}`);
        const f = (v: Prisma.Decimal | null) => (v !== null && t?.decimals != null ? formatUnitsExact(toBigInt(v), t.decimals) : null);
        return {
          hook: r.hook,
          poolId: r.poolId,
          currency: r.currency,
          symbol: t?.symbol ?? null,
          takes: r._count._all,
          raw: { lpDonated: decStr(r._sum.lpDonated), toBeneficiaries: decStr(r._sum.toBeneficiaries), toDistributor: decStr(r._sum.toDistributor) },
          units: { lpDonated: f(r._sum.lpDonated), toBeneficiaries: f(r._sum.toBeneficiaries), toDistributor: f(r._sum.toDistributor) },
          lifetimeReconciliation: rec ? { status: rec.status, atBlock: rec.atBlock, logSum: rec.observed, counter: rec.expected, detail: rec.detail } : null,
        };
      }),
    };
  }

  async protocolRevenue(chainId: number, q: { window: WindowName }) {
    const since = await this.windowStart(chainId, q.window);
    const time = since ? { blockTimestamp: { gte: since } } : {};
    const [swapFees, collections, latestAccruals] = await Promise.all([
      this.prisma.swap.groupBy({ by: ["tokenIn"], where: { chainId, ...time }, _sum: { feeProtocol: true }, _count: { _all: true } }),
      this.prisma.protocolFeeCollection.groupBy({ by: ["currency", "via"], where: { chainId, ...time }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ poolManager: string; currency: string; amount: string; readAtBlock: bigint; readAt: Date }[]>`
        SELECT DISTINCT ON ("poolManager", currency) "poolManager", currency, amount::text AS amount, "readAtBlock", "readAt"
        FROM protocol_fee_accrual_snapshots WHERE "chainId" = ${chainId}
        ORDER BY "poolManager", currency, "readAtBlock" DESC`,
    ]);
    const tokens = await this.tokenMap(chainId, [...swapFees.map((r) => r.tokenIn), ...collections.map((r) => r.currency), ...latestAccruals.map((r) => r.currency)]);
    const f = (addr: string, raw: string | null) => {
      const t = tokens.get(addr);
      return raw !== null && t?.decimals != null ? formatUnitsExact(BigInt(raw), t.decimals) : null;
    };
    return {
      window: q.window,
      windowStart: since,
      swapProtocolFees: {
        definition: "amountIn * protocolFee / 1e6 per swap, from the Swap log's own protocolFee",
        byToken: swapFees.map((r) => ({ token: r.tokenIn, symbol: tokens.get(r.tokenIn)?.symbol ?? null, swaps: r._count._all, raw: decStr(r._sum.feeProtocol), units: f(r.tokenIn, decStr(r._sum.feeProtocol)) })),
      },
      collections: {
        source: "LatchProtocolFeeControllerV2 ProtocolFeesCollected",
        byTokenAndMethod: collections.map((r) => ({ token: r.currency, via: r.via, count: r._count._all, raw: decStr(r._sum.amount), units: f(r.currency, decStr(r._sum.amount)) })),
      },
      uncollectedAccrued: {
        source: "protocolFeesAccrued(currency) snapshot on each pool manager (latest read, not windowed)",
        items: latestAccruals.map((r) => ({ poolManager: r.poolManager, token: r.currency, raw: r.amount, units: f(r.currency, r.amount), readAtBlock: r.readAtBlock, readAt: r.readAt })),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Launches
  // -------------------------------------------------------------------------

  private launchView(
    chainId: number,
    l: Prisma.LaunchGetPayload<object>,
    clock: { contractBlockNumber: bigint | null; method: string | null; readAt: Date | null },
  ) {
    const end = l.startContractBlock + BigInt(l.decayContractBlocks);
    const phase = clock.contractBlockNumber === null ? "unknown" : blockWindowPhase(l.startContractBlock, end, clock.contractBlockNumber);
    let startsInSecondsApprox: number | null = null;
    if (clock.contractBlockNumber !== null && l.startContractBlock > clock.contractBlockNumber) {
      startsInSecondsApprox = contractBlocksToSeconds(l.startContractBlock - clock.contractBlockNumber, chainId);
    }
    return {
      poolId: l.poolId,
      kit: l.kit,
      launchToken: l.launchToken,
      quoteToken: l.quoteToken,
      operator: l.operator,
      schedule: {
        clock: "contract block.number (Ethereum L1 on Robinhood), NOT the RPC block",
        startContractBlock: l.startContractBlock,
        decayContractBlocks: l.decayContractBlocks,
        phase,
        startsInSecondsApprox,
        judgedAgainst: clock,
      },
      fees: { initialFeeBips: l.initialFeeBips, finalFeeBips: l.finalFeeBips },
      maxBuyPerTxRaw: decStr(l.maxBuyPerTx),
      launchTokenIsCurrency0: l.launchTokenIsCurrency0,
      preset: l.preset,
      createdAt: { blockNumber: l.blockNumber, blockTimestamp: l.blockTimestamp, txHash: l.txHash },
    };
  }

  async launches(chainId: number, q: { limit: number; offset: number }) {
    const cp = await this.checkpoint(chainId);
    const clock = { contractBlockNumber: cp.contractBlockNumber, method: cp.contractClockMethod, readAt: cp.contractClockReadAt };
    const [rows, total] = await Promise.all([
      this.prisma.launch.findMany({ where: { chainId }, orderBy: { blockNumber: "desc" }, take: q.limit, skip: q.offset }),
      this.prisma.launch.count({ where: { chainId } }),
    ]);
    return { items: rows.map((l) => this.launchView(chainId, l, clock)), total };
  }

  async launch(chainId: number, poolId: string) {
    const cp = await this.checkpoint(chainId);
    const l = await this.prisma.launch.findFirst({ where: { chainId, poolId } });
    if (!l) throw ApiError.notFound(`Launch ${poolId}`);
    const events = await this.prisma.contractEvent.findMany({
      where: { chainId, subject: poolId, contractKey: { in: ["launchpadKit", "launchRegistry"] } },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: 200,
    });
    return {
      ...this.launchView(chainId, l, { contractBlockNumber: cp.contractBlockNumber, method: cp.contractClockMethod, readAt: cp.contractClockReadAt }),
      history: events.map((e) => ({ contract: e.contractKey, event: e.eventName, args: e.args, blockNumber: e.blockNumber, txHash: e.txHash })),
    };
  }

  /** What the LatchRegistry events say about a hook. Not an audit. */
  async registryStatus(chainId: number, hook: string) {
    const events = await this.prisma.contractEvent.findMany({ where: { chainId, contractKey: "registry", subject: hook }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] });
    const lastOf = (name: string) => [...events].reverse().find((e) => e.eventName === name);
    const listing = lastOf("LatchListingChanged");
    const verification = lastOf("LatchVerificationChanged");
    const safe = <T>(fn: () => T) => {
      try {
        return fn();
      } catch {
        return null;
      }
    };
    return {
      registered: events.some((e) => e.eventName === "LatchRegistered"),
      listing: listing ? safe(() => listingFromUint8(Number((listing.args as { current: string }).current))) : null,
      verification: verification ? safe(() => verificationFromUint8(Number((verification.args as { current: string }).current))) : null,
      note: "What the registry records. A listing is not an audit and says nothing about code the registry did not attest.",
    };
  }
}
