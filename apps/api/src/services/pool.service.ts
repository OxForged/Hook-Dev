import { isDynamicLPFee, PIPS_DENOMINATOR } from "@latchprotocol/sdk";
import type { PrismaClient } from "@prisma/client";
import { cached, TTL } from "../cache/cache.js";
import { ApiError } from "../lib/errors.js";
import { toJsonSafe } from "../lib/serialize.js";
import {
  PoolRepository,
  type PoolListFilters,
  type PoolWithRelations,
} from "../repositories/pool.repository.js";
import { describeBitmap } from "./permissions.service.js";

/**
 * Pool read model.
 *
 * Presentation decisions that belong here rather than in a client:
 *   - the raw `parameters` word is decoded into its bitmap and pool-type config
 *   - the bitmap is expanded into named permissions
 *   - fee fields are resolved into "the fee actually in force right now",
 *     which differs from `feeRaw` for dynamic-fee pools
 */
export class PoolService {
  private readonly repo: PoolRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new PoolRepository(prisma);
  }

  async list(filters: PoolListFilters) {
    const cacheKey = [
      "pools",
      filters.chainId ?? "all",
      filters.poolType ?? "all",
      filters.hook ?? "-",
      filters.token ?? "-",
      filters.search ?? "-",
      filters.hasHook === undefined ? "-" : String(filters.hasHook),
      filters.sort ?? "swapCount",
      filters.direction ?? "desc",
      filters.limit,
      filters.offset,
    ];

    return cached(cacheKey, TTL.medium, async () => {
      const { items, total } = await this.repo.list(filters);
      return {
        items: items.map((p) => this.toSummary(p)),
        total,
        rows: items.map((p) => ({ dataSource: p.dataSource })),
      };
    });
  }

  async detail(idOrPoolId: string, chainId?: number) {
    const pool = await this.repo.findOne(idOrPoolId, chainId);
    if (!pool) throw ApiError.notFound(`Pool ${idOrPoolId}`);

    const counts = await this.repo.activityCounts(pool.id);
    return { pool: this.toDetail(pool, counts), dataSource: pool.dataSource };
  }

  // -------------------------------------------------------------------------

  private feeView(pool: PoolWithRelations) {
    const dynamic = pool.isDynamicFee || isDynamicLPFee(pool.feeRaw);
    // For a dynamic-fee pool `feeRaw` is only the 0x800000 marker; the fee in
    // force is whatever the hook last pushed through DynamicLPFeeUpdated.
    const effective = dynamic ? pool.currentLpFee : pool.staticLpFee ?? pool.feeRaw;
    return {
      raw: pool.feeRaw,
      isDynamic: dynamic,
      staticLpFeePips: pool.staticLpFee,
      currentLpFeePips: pool.currentLpFee,
      effectiveLpFeePips: effective,
      effectiveLpFeePercent: effective === null ? null : (effective / PIPS_DENOMINATOR) * 100,
      protocolFee: {
        packed: pool.protocolFee,
        zeroForOnePips: pool.protocolFeeZeroForOne,
        oneForZeroPips: pool.protocolFeeOneForZero,
      },
    };
  }

  private toSummary(pool: PoolWithRelations) {
    return {
      id: pool.id,
      poolId: pool.poolId,
      chain: pool.chain,
      poolType: pool.poolType,
      pair: {
        token0: pool.token0,
        token1: pool.token1,
        label: `${pool.token0.symbol ?? "?"} / ${pool.token1.symbol ?? "?"}`,
      },
      fee: this.feeView(pool),
      hook: pool.hook
        ? { ...pool.hook, hasHook: true }
        : { address: pool.hooksAddress, hasHook: false },
      permissions: describeBitmap(
        pool.poolType === "CL" ? "CL" : "BIN",
        pool.hooksRegistrationBitmap,
      ),
      config: {
        tickSpacing: pool.tickSpacing,
        binStep: pool.binStep,
      },
      activity: {
        swapCount: pool.swapCount,
        liquidityChangeCount: pool.liquidityChangeCount,
        donateCount: pool.donateCount,
        volumeToken0: pool.volumeToken0,
        volumeToken1: pool.volumeToken1,
        lastEventAt: pool.lastEventAt,
      },
      dataSource: pool.dataSource.toLowerCase(),
    };
  }

  private toDetail(
    pool: PoolWithRelations,
    counts: Awaited<ReturnType<PoolRepository["activityCounts"]>>,
  ) {
    return {
      ...this.toSummary(pool),
      poolManager: pool.poolManager,
      // The pool key verbatim, so a consumer can recompute the pool id and
      // verify it rather than trusting this API.
      poolKey: {
        currency0: pool.currency0,
        currency1: pool.currency1,
        hooks: pool.hooksAddress,
        poolManager: pool.poolManager.address,
        fee: pool.feeRaw,
        parameters: pool.parameters,
      },
      state: {
        sqrtPriceX96: pool.sqrtPriceX96,
        tick: pool.tick,
        liquidity: pool.liquidity,
        activeId: pool.activeId,
      },
      provenance: {
        createdAtBlock: pool.createdAtBlock,
        createdAtTimestamp: pool.createdAtTimestamp,
        createdAtTx: pool.createdAtTx,
      },
      eventCounts: counts,
    };
  }
}

/** Shared JSON coercion for route handlers. */
export const asJson = toJsonSafe;
