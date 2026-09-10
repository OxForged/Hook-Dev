import { DataSource, IngestionRunStatus, type PrismaClient } from "@prisma/client";
import type { Hex } from "viem";
import { cursorId, normalizeAddress, type ContractRef, type ContractRole } from "../chain/contracts.js";
import { decodeLog, type ProtocolEvent } from "../chain/decode.js";
import {
  FIXTURE_ADDRESSES,
  FIXTURE_CHAIN_ID,
  FIXTURE_START_BLOCK,
} from "../chain/fixtures/devnet.js";
import { getChainLogProvider, type ChainLogProvider, type RawLog } from "../chain/provider/index.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cacheInvalidate } from "../cache/cache.js";
import { IngestionRepository } from "../repositories/ingestion.repository.js";

export interface IngestOptions {
  chainId: number;
  /** Defaults to the stored cursor, or the chain's startBlock on a cold start. */
  fromBlock?: bigint;
  /** Defaults to head minus INGEST_CONFIRMATIONS. */
  toBlock?: bigint;
  /** Re-read a range that has already been processed. Writes stay idempotent. */
  force?: boolean;
  jobId?: string;
  jobName?: string;
}

export interface IngestSummary {
  chainId: number;
  providerKind: string;
  fromBlock: string;
  toBlock: string;
  logsSeen: number;
  logsDecoded: number;
  logsSkipped: number;
  entitiesWritten: number;
  windows: number;
  /** True when the range was empty because the cursor is already at head. */
  upToDate: boolean;
}

/**
 * Drives one ingestion pass for one chain.
 *
 * The pipeline, end to end:
 *
 *   resolve contracts  ->  pick provider  ->  read cursor
 *     ->  for each block window:  getLogs  ->  decode  ->  apply  ->  advance cursor
 *
 * The provider is the only part that knows whether it is reading a chain or a
 * fixture (see chain/provider/types.ts). Everything downstream is identical in
 * both modes, which is the point: the fixture path is not a separate code path,
 * it is the same code path with a different byte source.
 */
export class IngestionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Contracts to watch on a chain, read from the recorded deployment topology.
   *
   * The role attached to each address is what makes decoding possible at all:
   * six event signatures are shared across contracts, so `(address -> role)` is
   * the only way to attribute a log. An address with no role is never decoded.
   */
  async resolveContracts(chainId: number): Promise<ContractRef[]> {
    const [vaults, managers, chain] = await Promise.all([
      this.prisma.vault.findMany({ where: { chainId }, select: { address: true } }),
      this.prisma.poolManager.findMany({ where: { chainId }, select: { address: true, poolType: true } }),
      this.prisma.chain.findUnique({ where: { id: chainId }, select: { dataSource: true } }),
    ]);

    const isFixtureChain =
      chainId === FIXTURE_CHAIN_ID && chain?.dataSource === DataSource.FIXTURE;

    const refs: ContractRef[] = [];

    // Cold start: the Vault and pool managers are themselves discovered from
    // logs (`AppRegistered`, `Initialize`), so on the very first pass there is
    // nothing in the database to resolve. On the fixture chain the topology is
    // known statically, so seed it and let ingestion take over from there.
    //
    // The check is on the underlying rows, not on `refs.length` — the fee
    // controller below is resolvable without them and would otherwise mask a
    // genuinely empty topology.
    if (vaults.length === 0 && managers.length === 0 && isFixtureChain) {
      return [
        { chainId, role: "Vault", address: FIXTURE_ADDRESSES.vault, label: "Vault" },
        { chainId, role: "CLPoolManager", address: FIXTURE_ADDRESSES.clPoolManager, label: "CLPoolManager" },
        { chainId, role: "BinPoolManager", address: FIXTURE_ADDRESSES.binPoolManager, label: "BinPoolManager" },
        { chainId, role: "FeeController", address: FIXTURE_ADDRESSES.feeController, label: "LatchProtocolFeeController" },
      ];
    }

    for (const v of vaults) {
      refs.push({ chainId, role: "Vault", address: normalizeAddress(v.address), label: "Vault" });
    }
    for (const m of managers) {
      const role: ContractRole = m.poolType === "CL" ? "CLPoolManager" : "BinPoolManager";
      refs.push({ chainId, role, address: normalizeAddress(m.address), label: role });
    }

    // The fee controller is not modelled as a first-class entity (it holds no
    // pool state), so its address comes from whichever pool manager points at
    // it, or from the fixture topology.
    const controller = await this.prisma.poolManager.findFirst({
      where: { chainId, protocolFeeController: { not: null } },
      select: { protocolFeeController: true },
    });
    const controllerAddress =
      controller?.protocolFeeController ?? (isFixtureChain ? FIXTURE_ADDRESSES.feeController : null);
    if (controllerAddress) {
      refs.push({
        chainId,
        role: "FeeController",
        address: normalizeAddress(controllerAddress),
        label: "LatchProtocolFeeController",
      });
    }

    // Dedupe: a Vault and a manager cannot share an address, but a controller
    // could in principle be one of them.
    const seen = new Set<string>();
    return refs.filter((r) => {
      const key = `${r.role}:${r.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async ingest(options: IngestOptions): Promise<IngestSummary> {
    const { chainId } = options;

    const chain = await this.prisma.chain.findUnique({ where: { id: chainId } });
    if (!chain) throw new Error(`Unknown chain ${chainId}`);
    if (!chain.enabled && !options.force) {
      throw new Error(`Chain ${chainId} is disabled; pass force to ingest anyway`);
    }

    const contracts = await this.resolveContracts(chainId);
    const provider = getChainLogProvider(chainId, contracts);

    // Provenance follows the provider, not the chain row: a fixture read must
    // stamp FIXTURE even if the chain is nominally a real network.
    const dataSource = provider.kind === "fixture" ? DataSource.FIXTURE : DataSource.ONCHAIN;
    const repo = new IngestionRepository(this.prisma, dataSource);

    const head = await provider.getLatestBlockNumber();
    const safeHead = head > BigInt(env.INGEST_CONFIRMATIONS)
      ? head - BigInt(env.INGEST_CONFIRMATIONS)
      : 0n;

    const fromBlock = options.fromBlock ?? (await this.resumeBlock(chainId, contracts, chain.startBlock));
    const toBlock = options.toBlock ?? safeHead;

    const summary: IngestSummary = {
      chainId,
      providerKind: provider.kind,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      logsSeen: 0,
      logsDecoded: 0,
      logsSkipped: 0,
      entitiesWritten: 0,
      windows: 0,
      upToDate: fromBlock > toBlock,
    };

    if (contracts.length === 0) {
      logger.warn({ chainId }, "no contracts recorded for chain; nothing to ingest");
      return summary;
    }
    if (summary.upToDate) {
      logger.debug({ chainId, fromBlock: summary.fromBlock }, "ingestion already at head");
      return summary;
    }

    const run = await this.prisma.ingestionRun.create({
      data: {
        chainId,
        jobId: options.jobId ?? null,
        jobName: options.jobName ?? "manual",
        providerKind: provider.kind,
        status: IngestionRunStatus.RUNNING,
        fromBlock,
        toBlock,
      },
    });

    try {
      const windowSize = BigInt(env.INGEST_BLOCK_RANGE);
      for (let start = fromBlock; start <= toBlock; start += windowSize) {
        const end = start + windowSize - 1n > toBlock ? toBlock : start + windowSize - 1n;
        summary.windows += 1;

        const stats = await this.ingestWindow(provider, repo, contracts, chainId, start, end);
        summary.logsSeen += stats.logsSeen;
        summary.logsDecoded += stats.logsDecoded;
        summary.logsSkipped += stats.logsSkipped;
        summary.entitiesWritten += stats.written;

        // Advance cursors per window, so a crash mid-backfill resumes from the
        // last completed window rather than from the start.
        await this.advanceCursors(chainId, contracts, end, provider.kind);
      }

      await this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: IngestionRunStatus.COMPLETED,
          finishedAt: new Date(),
          logsSeen: summary.logsSeen,
          logsDecoded: summary.logsDecoded,
          logsSkipped: summary.logsSkipped,
          entitiesWritten: summary.entitiesWritten,
        },
      });

      if (summary.entitiesWritten > 0) {
        await cacheInvalidate([]);
      }

      logger.info({ ...summary }, "ingestion pass complete");
      return summary;
    } catch (err) {
      await this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: IngestionRunStatus.FAILED,
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
          logsSeen: summary.logsSeen,
          logsDecoded: summary.logsDecoded,
          logsSkipped: summary.logsSkipped,
          entitiesWritten: summary.entitiesWritten,
        },
      });
      throw err;
    }
  }

  private async ingestWindow(
    provider: ChainLogProvider,
    repo: IngestionRepository,
    contracts: readonly ContractRef[],
    chainId: number,
    fromBlock: bigint,
    toBlock: bigint,
  ) {
    const logs = await provider.getLogs({ fromBlock, toBlock, contracts });

    // (address -> role). THE disambiguator: topic0 is not unique across this
    // protocol's contracts, so a log with no known emitting address is dropped
    // rather than guessed at.
    const roleByAddress = new Map<string, ContractRole>(
      contracts.map((c) => [normalizeAddress(c.address), c.role]),
    );

    const events: ProtocolEvent[] = [];
    let logsSkipped = 0;

    for (const log of logs as readonly RawLog[]) {
      const role = roleByAddress.get(normalizeAddress(log.address));
      if (!role) {
        logsSkipped += 1;
        continue;
      }
      const result = decodeLog(chainId, role, log);
      if (result.event) events.push(result.event);
      else logsSkipped += 1;
    }

    const applied = await repo.applyBatch(chainId, events, contracts);

    return {
      logsSeen: logs.length,
      logsDecoded: events.length,
      logsSkipped,
      written: applied.written,
    };
  }

  /** Lowest cursor across the watched contracts, so no contract is skipped. */
  private async resumeBlock(
    chainId: number,
    contracts: readonly ContractRef[],
    startBlock: bigint,
  ): Promise<bigint> {
    const cursors = await this.prisma.ingestionCursor.findMany({
      where: { id: { in: contracts.map((c) => cursorId(chainId, c.address)) } },
      select: { lastProcessedBlock: true },
    });

    if (cursors.length < contracts.length) {
      // At least one contract has never been read: start from the beginning.
      return chainId === FIXTURE_CHAIN_ID && startBlock === 0n ? FIXTURE_START_BLOCK : startBlock;
    }

    let lowest: bigint | undefined;
    for (const c of cursors) {
      if (lowest === undefined || c.lastProcessedBlock < lowest) lowest = c.lastProcessedBlock;
    }
    return (lowest ?? startBlock) + 1n;
  }

  private async advanceCursors(
    chainId: number,
    contracts: readonly ContractRef[],
    block: bigint,
    providerKind: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      contracts.map((c) => {
        const id = cursorId(chainId, c.address);
        return this.prisma.ingestionCursor.upsert({
          where: { id },
          create: {
            id,
            chainId,
            contract: normalizeAddress(c.address),
            label: c.label,
            lastProcessedBlock: block,
            lastRunAt: new Date(),
            providerKind,
          },
          update: { lastProcessedBlock: block, lastRunAt: new Date(), providerKind },
        });
      }),
    );
  }

  /** Snapshot of ingestion state, surfaced by /health/ready and /api/v1/status. */
  async status(chainId?: number) {
    const where = chainId === undefined ? {} : { chainId };
    const [cursors, lastRuns] = await Promise.all([
      this.prisma.ingestionCursor.findMany({ where, orderBy: { chainId: "asc" } }),
      this.prisma.ingestionRun.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);
    return { cursors, recentRuns: lastRuns };
  }
}

/** Convenience for callers that only have an address string. */
export function asHex(address: string): Hex {
  return normalizeAddress(address);
}
