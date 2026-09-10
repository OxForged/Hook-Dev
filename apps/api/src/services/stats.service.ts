import type { PrismaClient } from "@prisma/client";
import { cached, TTL } from "../cache/cache.js";
import { toJsonSafe } from "../lib/serialize.js";
import {
  StatsRepository,
  type Interval,
  type TimeseriesFilters,
} from "../repositories/stats.repository.js";
import { describeBitmap, flagTable } from "./permissions.service.js";

/**
 * Aggregates for charts.
 *
 * Every number here is currently derived from fixture rows. The response
 * envelope says so (`meta.dataSource`), and so does each row's own
 * `dataSource`, because a chart with no provenance is the easiest way for
 * fabricated numbers to be mistaken for protocol metrics.
 */
export class StatsService {
  private readonly repo: StatsRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new StatsRepository(prisma);
  }

  async overview(chainId?: number) {
    return cached(["stats", "overview", chainId ?? "all"], TTL.short, async () => {
      const raw = await this.repo.overview(chainId);
      return toJsonSafe(raw) as Record<string, unknown>;
    });
  }

  async timeseries(filters: TimeseriesFilters) {
    const key = [
      "stats",
      "timeseries",
      filters.chainId ?? "all",
      filters.poolId ?? "all",
      filters.poolType ?? "all",
      filters.interval,
      filters.from.toISOString(),
      filters.to.toISOString(),
    ];
    return cached(key, TTL.short, async () => {
      const points = await this.repo.timeseries(filters);
      return {
        interval: filters.interval,
        from: filters.from.toISOString(),
        to: filters.to.toISOString(),
        points: points.map((p) => ({
          bucket: p.bucket.toISOString(),
          swapCount: p.swapCount,
          volumeToken0: p.volumeToken0.toFixed(),
          volumeToken1: p.volumeToken1.toFixed(),
          uniqueSenders: p.uniqueSenders,
        })),
      };
    });
  }

  async topPools(chainId: number | undefined, limit: number) {
    return cached(["stats", "top-pools", chainId ?? "all", limit], TTL.short, async () => {
      const rows = await this.repo.topPools(chainId, limit);
      return rows.map((p) => ({
        ...toJsonSafe(p) as Record<string, unknown>,
        permissions: describeBitmap(p.poolType === "CL" ? "CL" : "BIN", p.hooksRegistrationBitmap),
      }));
    });
  }

  async topHooks(chainId: number | undefined, limit: number) {
    return cached(["stats", "top-hooks", chainId ?? "all", limit], TTL.short, async () => {
      const rows = await this.repo.topHooks(chainId, limit);
      return rows.map((h) => toJsonSafe(h) as Record<string, unknown>);
    });
  }

  /**
   * Which callbacks pools actually register, per pool type.
   *
   * This is the chart the protocol most wants to look at: it says which parts
   * of the hook surface developers are using, and it only makes sense because
   * permissions are recorded per pool rather than baked into hook addresses.
   */
  async permissionHistogram(chainId?: number) {
    return cached(["stats", "permissions", chainId ?? "all"], TTL.short, async () => {
      const counts = await this.repo.permissionHistogram(chainId);
      return {
        CL: flagTable("CL").map((flag) => ({ ...flag, pools: counts.CL[flag.offset] ?? 0 })),
        BIN: flagTable("BIN").map((flag) => ({ ...flag, pools: counts.BIN[flag.offset] ?? 0 })),
      };
    });
  }

  async feeTiers(chainId?: number) {
    return cached(["stats", "fee-tiers", chainId ?? "all"], TTL.short, async () => {
      const rows = await this.repo.feeTierDistribution(chainId);
      return rows.map((r) => toJsonSafe(r) as Record<string, unknown>);
    });
  }
}

export type { Interval };
