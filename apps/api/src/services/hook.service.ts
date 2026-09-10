import type { PrismaClient } from "@prisma/client";
import { cached, TTL } from "../cache/cache.js";
import { ApiError } from "../lib/errors.js";
import {
  HookRepository,
  type HookListFilters,
  type HookWithRelations,
  type RegistryEntryWithRelations,
  type RegistryFilters,
} from "../repositories/hook.repository.js";
import { describeBitmap } from "./permissions.service.js";

/**
 * Hooks and the hook registry.
 *
 * Every bitmap that leaves this service is expanded into named permissions,
 * because a bare `0x08c0` is unreadable and because the expansion depends on
 * the pool type — bits 2-5 and 12-13 mean different things for CL and bin.
 */
export class HookService {
  private readonly repo: HookRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new HookRepository(prisma);
  }

  async listHooks(filters: HookListFilters) {
    return cached(["hooks", filters.chainId ?? "all", filters.limit, filters.offset], TTL.medium, async () => {
      const { items, total } = await this.repo.listHooks(filters);
      return { items: items.map((h) => this.toHookDto(h)), total, rows: items };
    });
  }

  async hookDetail(address: string, chainId?: number) {
    const hook = await this.repo.findHook(address, chainId);
    if (!hook) throw ApiError.notFound(`Hook ${address}`);
    return this.toHookDto(hook);
  }

  async listRegistry(filters: RegistryFilters) {
    const key = [
      "registry",
      filters.poolType ?? "all",
      String(filters.verified ?? "-"),
      String(filters.auditStatus ?? "-"),
      String(filters.kind ?? "-"),
      filters.chainId ?? "-",
      filters.tag ?? "-",
      filters.search ?? "-",
      (filters.requiredBits ?? []).join(","),
      filters.sort ?? "listedAt",
      filters.limit,
      filters.offset,
    ];
    return cached(key, TTL.long, async () => {
      const { items, total } = await this.repo.listRegistry(filters);
      return { items: items.map((e) => this.toEntryDto(e)), total };
    });
  }

  async registryEntry(slug: string) {
    const entry = await this.repo.findRegistryEntry(slug);
    if (!entry) throw ApiError.notFound(`Registry entry "${slug}"`);
    return this.toEntryDto(entry, { includeDescription: true });
  }

  async registryFacets() {
    return cached(["registry", "facets"], TTL.long, async () => {
      const tags = await this.repo.registryTags();
      return { tags };
    });
  }

  // -------------------------------------------------------------------------

  private toHookDto(hook: HookWithRelations) {
    return {
      id: hook.id,
      chain: hook.chain,
      address: hook.address,
      /**
       * `registrationBitmap` is what the contract itself reports;
       * `observedBitmaps` are the ones actually seen in pool keys. They can
       * differ, and that is not a bug: permissions live in the pool key, so one
       * hook address can legitimately back pools with different callback sets.
       */
      registrationBitmap: hook.registrationBitmap,
      observedBitmaps: hook.observedBitmaps,
      permissionViews: hook.observedBitmaps.map((bitmap) => ({
        bitmap,
        cl: describeBitmap("CL", bitmap),
        bin: describeBitmap("BIN", bitmap),
      })),
      poolCount: hook.poolCount,
      swapCount: hook.swapCount,
      firstSeenBlock: hook.firstSeenBlock,
      firstSeenAt: hook.firstSeenAt,
      listings: hook.registryEntries.map((d) => d.entry),
      dataSource: hook.dataSource.toLowerCase(),
    };
  }

  private toEntryDto(
    entry: RegistryEntryWithRelations,
    options: { includeDescription?: boolean } = {},
  ) {
    const poolType = entry.poolType === "CL" ? "CL" : "BIN";
    return {
      id: entry.id,
      slug: entry.slug,
      name: entry.name,
      author: entry.author,
      authorUrl: entry.authorUrl,
      summary: entry.summary,
      ...(options.includeDescription ? { description: entry.description } : {}),
      poolType: entry.poolType,
      permissions: describeBitmap(poolType, entry.declaredBitmap),
      audit: {
        status: entry.auditStatus,
        auditor: entry.auditor,
        reportUrl: entry.auditReportUrl,
      },
      verified: entry.verified,
      /**
       * `EXAMPLE` means the listing was written to demonstrate the registry
       * shape. It is not a real project and nothing is deployed behind it.
       */
      kind: entry.kind,
      repoUrl: entry.repoUrl,
      docsUrl: entry.docsUrl,
      licenseId: entry.licenseId,
      tags: entry.tags,
      hookFeePips: entry.hookFeePips,
      chains: entry.deployments.map((d) => ({
        chain: d.chain,
        address: d.address,
        observed: d.hook !== null,
        stats: d.hook ? { poolCount: d.hook.poolCount, swapCount: d.hook.swapCount } : null,
        notes: d.notes,
      })),
      listedAt: entry.listedAt,
      updatedAt: entry.updatedAt,
    };
  }
}
