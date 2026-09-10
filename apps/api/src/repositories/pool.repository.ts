import { Prisma, type PrismaClient } from "@prisma/client";
import { poolRowId } from "../lib/ids.js";

export interface PoolListFilters {
  chainId?: number;
  poolType?: "CL" | "BIN";
  /** Hook contract address; "none" selects hookless pools. */
  hook?: string;
  /** Token address on either side. */
  token?: string;
  /** Free text over pool id, token symbols and hook address. */
  search?: string;
  hasHook?: boolean;
  sort?: "swapCount" | "createdAt" | "lastEventAt";
  direction?: "asc" | "desc";
  limit: number;
  offset: number;
}

const POOL_INCLUDE = {
  chain: { select: { id: true, slug: true, name: true, explorerUrl: true, dataSource: true } },
  poolManager: { select: { id: true, address: true, poolType: true } },
  token0: { select: { id: true, address: true, symbol: true, name: true, decimals: true, isNative: true } },
  token1: { select: { id: true, address: true, symbol: true, name: true, decimals: true, isNative: true } },
  hook: {
    select: {
      id: true,
      address: true,
      registrationBitmap: true,
      observedBitmaps: true,
      poolCount: true,
      swapCount: true,
    },
  },
} satisfies Prisma.PoolInclude;

export type PoolWithRelations = Prisma.PoolGetPayload<{ include: typeof POOL_INCLUDE }>;

export class PoolRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private buildWhere(f: PoolListFilters): Prisma.PoolWhereInput {
    const and: Prisma.PoolWhereInput[] = [];

    if (f.chainId !== undefined) and.push({ chainId: f.chainId });
    if (f.poolType) and.push({ poolType: f.poolType });

    if (f.hook) {
      and.push(
        f.hook.toLowerCase() === "none"
          ? { hookId: null }
          : { hooksAddress: f.hook.toLowerCase() },
      );
    }
    if (f.hasHook !== undefined) {
      and.push(f.hasHook ? { hookId: { not: null } } : { hookId: null });
    }

    if (f.token) {
      const t = f.token.toLowerCase();
      and.push({ OR: [{ currency0: t }, { currency1: t }] });
    }

    if (f.search) {
      const q = f.search.trim();
      and.push({
        OR: [
          { poolId: { contains: q.toLowerCase() } },
          { hooksAddress: { contains: q.toLowerCase() } },
          { token0: { symbol: { contains: q, mode: "insensitive" } } },
          { token1: { symbol: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private buildOrderBy(f: PoolListFilters): Prisma.PoolOrderByWithRelationInput[] {
    const direction = f.direction ?? "desc";
    switch (f.sort ?? "swapCount") {
      case "createdAt":
        return [{ createdAtTimestamp: direction }, { id: "asc" }];
      case "lastEventAt":
        return [{ lastEventAt: direction }, { id: "asc" }];
      default:
        return [{ swapCount: direction }, { id: "asc" }];
    }
  }

  async list(filters: PoolListFilters): Promise<{ items: PoolWithRelations[]; total: number }> {
    const where = this.buildWhere(filters);
    const [items, total] = await Promise.all([
      this.prisma.pool.findMany({
        where,
        include: POOL_INCLUDE,
        orderBy: this.buildOrderBy(filters),
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.pool.count({ where }),
    ]);
    return { items, total };
  }

  /** Accepts either a row id (`${chainId}-${poolId}`) or a bare pool id + chain. */
  async findOne(idOrPoolId: string, chainId?: number): Promise<PoolWithRelations | null> {
    const id =
      chainId !== undefined && !idOrPoolId.includes("-")
        ? poolRowId(chainId, idOrPoolId)
        : idOrPoolId.toLowerCase();

    const byId = await this.prisma.pool.findUnique({ where: { id }, include: POOL_INCLUDE });
    if (byId) return byId;

    // Fall back to a bare pool id when it is unambiguous across chains.
    if (idOrPoolId.startsWith("0x")) {
      const matches = await this.prisma.pool.findMany({
        where: { poolId: idOrPoolId.toLowerCase(), ...(chainId !== undefined ? { chainId } : {}) },
        include: POOL_INCLUDE,
        take: 2,
      });
      if (matches.length === 1) return matches[0]!;
    }
    return null;
  }

  /** Counts of the event rows attached to a pool, for the detail view. */
  async activityCounts(poolRowIdValue: string) {
    const [swaps, liquidityChanges, donates, feeChanges, dynamicFeeUpdates] = await Promise.all([
      this.prisma.swap.count({ where: { poolId: poolRowIdValue } }),
      this.prisma.liquidityChange.count({ where: { poolId: poolRowIdValue } }),
      this.prisma.donate.count({ where: { poolId: poolRowIdValue } }),
      this.prisma.protocolFeeChange.count({ where: { poolId: poolRowIdValue } }),
      this.prisma.dynamicLpFeeUpdate.count({ where: { poolId: poolRowIdValue } }),
    ]);
    return { swaps, liquidityChanges, donates, feeChanges, dynamicFeeUpdates };
  }
}
