import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Aggregates for the analytics surface.
 *
 * The time-series query is raw SQL on purpose. Prisma's `groupBy` cannot bucket
 * a timestamp, so the alternative is pulling every swap into Node and grouping
 * there — which is O(rows) memory for something Postgres does in one indexed
 * pass with `date_trunc`. The raw query is parameterised throughout; the only
 * value interpolated into the SQL text is `interval`, and it is restricted to a
 * closed set of literals below rather than taken from the request.
 */

export type Interval = "hour" | "day" | "week";

const ALLOWED_INTERVALS: Record<Interval, string> = {
  hour: "hour",
  day: "day",
  week: "week",
};

export interface TimeseriesPoint {
  bucket: Date;
  swapCount: number;
  volumeToken0: Prisma.Decimal;
  volumeToken1: Prisma.Decimal;
  uniqueSenders: number;
}

export interface TimeseriesFilters {
  chainId?: number;
  poolId?: string;
  poolType?: "CL" | "BIN";
  from: Date;
  to: Date;
  interval: Interval;
}

export class StatsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async overview(chainId?: number) {
    const chainFilter = chainId !== undefined ? { chainId } : {};

    const [pools, swaps, hooks, liquidityChanges, chains, hookedPools, lastSwap, poolAggregate] =
      await Promise.all([
        this.prisma.pool.count({ where: chainFilter }),
        this.prisma.swap.count({ where: chainFilter }),
        this.prisma.hook.count({ where: chainFilter }),
        this.prisma.liquidityChange.count({ where: chainFilter }),
        this.prisma.chain.count({ where: { enabled: true } }),
        this.prisma.pool.count({ where: { ...chainFilter, hookId: { not: null } } }),
        this.prisma.swap.findFirst({
          where: chainFilter,
          orderBy: { blockTimestamp: "desc" },
          select: { blockTimestamp: true, dataSource: true },
        }),
        this.prisma.pool.aggregate({
          where: chainFilter,
          _sum: { volumeToken0: true, volumeToken1: true },
        }),
      ]);

    const byPoolType = await this.prisma.pool.groupBy({
      by: ["poolType"],
      where: chainFilter,
      _count: { _all: true },
      _sum: { swapCount: true },
    });

    return {
      pools,
      swaps,
      hooks,
      liquidityChanges,
      chains,
      hookedPools,
      hooklessPools: pools - hookedPools,
      lastSwapAt: lastSwap?.blockTimestamp ?? null,
      volumeToken0: poolAggregate._sum.volumeToken0 ?? new Prisma.Decimal(0),
      volumeToken1: poolAggregate._sum.volumeToken1 ?? new Prisma.Decimal(0),
      byPoolType: byPoolType.map((row) => ({
        poolType: row.poolType,
        pools: row._count._all,
        swaps: row._sum.swapCount ?? 0n,
      })),
    };
  }

  async timeseries(f: TimeseriesFilters): Promise<TimeseriesPoint[]> {
    const unit = ALLOWED_INTERVALS[f.interval];
    if (!unit) throw new Error(`Unsupported interval: ${f.interval}`);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`s."blockTimestamp" >= ${f.from}`,
      Prisma.sql`s."blockTimestamp" <= ${f.to}`,
    ];
    if (f.chainId !== undefined) conditions.push(Prisma.sql`s."chainId" = ${f.chainId}`);
    if (f.poolType) {
      conditions.push(Prisma.sql`s."poolType" = ${f.poolType}::"PoolType"`);
    }
    if (f.poolId) conditions.push(Prisma.sql`s."poolId" = ${f.poolId}`);

    const where = Prisma.join(conditions, " AND ");

    // `unit` is one of three hard-coded literals, never user input.
    const rows = await this.prisma.$queryRaw<
      { bucket: Date; swap_count: bigint; volume0: Prisma.Decimal; volume1: Prisma.Decimal; senders: bigint }[]
    >(Prisma.sql`
      SELECT
        date_trunc(${unit}, s."blockTimestamp") AS bucket,
        COUNT(*)::bigint                        AS swap_count,
        COALESCE(SUM(ABS(s."amount0")), 0)      AS volume0,
        COALESCE(SUM(ABS(s."amount1")), 0)      AS volume1,
        COUNT(DISTINCT s."sender")::bigint      AS senders
      FROM "swaps" s
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    return rows.map((r) => ({
      bucket: r.bucket,
      swapCount: Number(r.swap_count),
      volumeToken0: r.volume0,
      volumeToken1: r.volume1,
      uniqueSenders: Number(r.senders),
    }));
  }

  async topPools(chainId: number | undefined, limit: number) {
    return this.prisma.pool.findMany({
      where: chainId !== undefined ? { chainId } : {},
      orderBy: [{ swapCount: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        poolId: true,
        chainId: true,
        poolType: true,
        swapCount: true,
        volumeToken0: true,
        volumeToken1: true,
        feeRaw: true,
        isDynamicFee: true,
        currentLpFee: true,
        hooksAddress: true,
        hooksRegistrationBitmap: true,
        dataSource: true,
        token0: { select: { symbol: true, address: true, decimals: true } },
        token1: { select: { symbol: true, address: true, decimals: true } },
      },
    });
  }

  async topHooks(chainId: number | undefined, limit: number) {
    return this.prisma.hook.findMany({
      where: chainId !== undefined ? { chainId } : {},
      orderBy: [{ swapCount: "desc" }, { poolCount: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        chainId: true,
        address: true,
        poolCount: true,
        swapCount: true,
        observedBitmaps: true,
        registrationBitmap: true,
        dataSource: true,
      },
    });
  }

  /** How many pools use each permission bit — the "which callbacks matter" chart. */
  async permissionHistogram(chainId?: number) {
    const pools = await this.prisma.pool.findMany({
      where: chainId !== undefined ? { chainId } : {},
      select: { poolType: true, hooksRegistrationBitmap: true },
    });

    const counts: Record<"CL" | "BIN", number[]> = {
      CL: new Array<number>(14).fill(0),
      BIN: new Array<number>(14).fill(0),
    };

    for (const pool of pools) {
      const row = counts[pool.poolType];
      for (let bit = 0; bit < 14; bit++) {
        if ((pool.hooksRegistrationBitmap & (1 << bit)) !== 0) row[bit] = (row[bit] ?? 0) + 1;
      }
    }
    return counts;
  }

  /** Fee-tier distribution, for the fee breakdown chart. */
  async feeTierDistribution(chainId?: number) {
    const rows = await this.prisma.pool.groupBy({
      by: ["feeRaw", "isDynamicFee"],
      where: chainId !== undefined ? { chainId } : {},
      _count: { _all: true },
      _sum: { swapCount: true },
      orderBy: { feeRaw: "asc" },
    });
    return rows.map((r) => ({
      feeRaw: r.feeRaw,
      isDynamicFee: r.isDynamicFee,
      pools: r._count._all,
      swaps: r._sum.swapCount ?? 0n,
    }));
  }
}
