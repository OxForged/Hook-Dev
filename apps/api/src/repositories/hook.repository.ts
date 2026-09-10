import { Prisma, type PrismaClient } from "@prisma/client";
import { addressRowId } from "../lib/ids.js";

/**
 * Two related but distinct things live here:
 *
 *   Hook               — a contract address observed in a pool key. Chain data.
 *   HookRegistryEntry  — a curated marketplace listing. Human-written metadata,
 *                        which exists whether or not the hook is deployed.
 *
 * They are joined through `HookRegistryDeployment`, so a listing can name an
 * address on several chains and light up as those deployments are observed.
 */

const HOOK_INCLUDE = {
  chain: { select: { id: true, slug: true, name: true } },
  registryEntries: {
    include: {
      entry: {
        select: {
          id: true,
          slug: true,
          name: true,
          author: true,
          summary: true,
          verified: true,
          auditStatus: true,
          kind: true,
        },
      },
    },
  },
} satisfies Prisma.HookInclude;

export type HookWithRelations = Prisma.HookGetPayload<{ include: typeof HOOK_INCLUDE }>;

const ENTRY_INCLUDE = {
  deployments: {
    include: {
      chain: { select: { id: true, slug: true, name: true, isTestnet: true, explorerUrl: true } },
      hook: { select: { id: true, address: true, poolCount: true, swapCount: true } },
    },
  },
} satisfies Prisma.HookRegistryEntryInclude;

export type RegistryEntryWithRelations = Prisma.HookRegistryEntryGetPayload<{
  include: typeof ENTRY_INCLUDE;
}>;

export interface HookListFilters {
  chainId?: number;
  limit: number;
  offset: number;
}

export interface RegistryFilters {
  poolType?: "CL" | "BIN";
  verified?: boolean;
  auditStatus?: Prisma.EnumAuditStatusFilter["equals"];
  kind?: Prisma.EnumRegistryListingKindFilter["equals"];
  chainId?: number;
  tag?: string;
  search?: string;
  /** Only listings whose declared bitmap has every one of these bits set. */
  requiredBits?: number[];
  sort?: "name" | "listedAt" | "audit";
  limit: number;
  offset: number;
}

export class HookRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listHooks(f: HookListFilters): Promise<{ items: HookWithRelations[]; total: number }> {
    const where: Prisma.HookWhereInput = f.chainId !== undefined ? { chainId: f.chainId } : {};
    const [items, total] = await Promise.all([
      this.prisma.hook.findMany({
        where,
        include: HOOK_INCLUDE,
        orderBy: [{ swapCount: "desc" }, { poolCount: "desc" }, { id: "asc" }],
        take: f.limit,
        skip: f.offset,
      }),
      this.prisma.hook.count({ where }),
    ]);
    return { items, total };
  }

  async findHook(address: string, chainId?: number): Promise<HookWithRelations | null> {
    if (chainId !== undefined) {
      return this.prisma.hook.findUnique({
        where: { id: addressRowId(chainId, address) },
        include: HOOK_INCLUDE,
      });
    }
    return this.prisma.hook.findFirst({
      where: { address: address.toLowerCase() },
      include: HOOK_INCLUDE,
    });
  }

  async listRegistry(
    f: RegistryFilters,
  ): Promise<{ items: RegistryEntryWithRelations[]; total: number }> {
    const and: Prisma.HookRegistryEntryWhereInput[] = [];

    if (f.poolType) and.push({ poolType: f.poolType });
    if (f.verified !== undefined) and.push({ verified: f.verified });
    if (f.auditStatus) and.push({ auditStatus: f.auditStatus });
    if (f.kind) and.push({ kind: f.kind });
    if (f.tag) and.push({ tags: { has: f.tag } });
    if (f.chainId !== undefined) and.push({ deployments: { some: { chainId: f.chainId } } });

    if (f.search) {
      const q = f.search.trim();
      and.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
          { author: { contains: q, mode: "insensitive" } },
          { tags: { has: q.toLowerCase() } },
        ],
      });
    }

    const where: Prisma.HookRegistryEntryWhereInput = and.length > 0 ? { AND: and } : {};

    const orderBy: Prisma.HookRegistryEntryOrderByWithRelationInput[] =
      f.sort === "name"
        ? [{ name: "asc" }]
        : f.sort === "audit"
          ? [{ auditStatus: "desc" }, { verified: "desc" }, { name: "asc" }]
          : [{ listedAt: "desc" }, { name: "asc" }];

    const [rows, total] = await Promise.all([
      this.prisma.hookRegistryEntry.findMany({
        where,
        include: ENTRY_INCLUDE,
        orderBy,
        // Bit filtering happens in application code (see below), so when it is
        // active we must fetch a wider slice before paginating.
        take: f.requiredBits?.length ? undefined : f.limit,
        skip: f.requiredBits?.length ? undefined : f.offset,
      }),
      this.prisma.hookRegistryEntry.count({ where }),
    ]);

    if (!f.requiredBits?.length) return { items: rows, total };

    // Postgres has no bitwise index we can exploit through Prisma's query API,
    // and the registry is small and curated (tens of rows, not millions), so a
    // post-filter is both correct and cheap. Revisit if it ever grows.
    const mask = f.requiredBits.reduce((acc, bit) => acc | (1 << bit), 0);
    const filtered = rows.filter((r) => (r.declaredBitmap & mask) === mask);
    return {
      items: filtered.slice(f.offset, f.offset + f.limit),
      total: filtered.length,
    };
  }

  async findRegistryEntry(slug: string): Promise<RegistryEntryWithRelations | null> {
    return this.prisma.hookRegistryEntry.findUnique({
      where: { slug },
      include: ENTRY_INCLUDE,
    });
  }

  /** Distinct tags across the registry, for filter chips. */
  async registryTags(): Promise<{ tag: string; count: number }[]> {
    const rows = await this.prisma.hookRegistryEntry.findMany({ select: { tags: true } });
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
}
