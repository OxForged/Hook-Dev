import { LATCH_DEPLOYMENTS, type LatchDeployment } from "@latchprotocol/sdk";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Hex } from "viem";
import { decodeLog, type IndexedEvent, type RawLog } from "../chain/decode.js";
import {
  addressSetHash,
  requireIndexedDeployment,
  revShareHooksFor,
  staticContractsFor,
  topicsForRole,
  type WatchRole,
} from "../chain/deployments.js";
import { LogSpanRefusedError, type ChainRpc } from "../chain/rpc.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { buildWindowRows, rowCount, type WindowRows } from "./rows.js";

/**
 * One index pass for one chain.
 *
 *   observe head -> safeHead = head - confirmations
 *   verify the checkpoint block's hash (deeper reorg -> rewind, recorded)
 *   start = checkpoint + 1 - REINDEX_WINDOW   (the trailing window is always re-read)
 *   for each span [from, to] up to safeHead:
 *     phase 1: eth_getLogs over the address-book contracts
 *     phase 2: eth_getLogs over Latch's own RevShareHooks (one is found in phase 1)
 *     join timestamps, tx inputs -> build rows (pure)
 *     ONE transaction: advisory lock, checkpoint guard, delete [from,to], insert, advance
 *
 * Idempotent by construction: replaying any span deletes and re-inserts the same
 * rows. Resumable: the checkpoint only moves inside the transaction that wrote
 * the span. Reorg-safe: confirmations keep most reorgs out, the re-read window
 * repairs shallow ones, the hash check catches deeper ones.
 *
 * Block numbers here are all the L2 LOG clock. Contract-stored block numbers are
 * only stored, never compared, in this file.
 */

export interface PassSummary {
  chainId: number;
  fromBlock: string | null;
  toBlock: string | null;
  headBlock: string;
  spans: number;
  logs: number;
  rows: number;
  orphans: number;
  reorg: boolean;
  endpointHost: string | null;
}

export class ConcurrentPassError extends Error {
  constructor(chainId: number) {
    super(`checkpoint for chain ${chainId} moved during the pass; another indexer is running`);
    this.name = "ConcurrentPassError";
  }
}

const ADVISORY_NAMESPACE = 0x4c41_5443; // "LATC"

export async function indexPass(prisma: PrismaClient, rpc: ChainRpc, chainId: number): Promise<PassSummary> {
  const d = requireIndexedDeployment(chainId);
  await syncChainRow(prisma, d);

  const head = await rpc.reads.getBlockNumber();
  const confirmations = BigInt(env.INDEX_CONFIRMATIONS);
  const safeHead = head > confirmations ? head - confirmations : 0n;
  const setHash = addressSetHash(d);

  const cp = await prisma.indexerCheckpoint.findUnique({ where: { chainId } });
  let expectedLast: bigint | null = cp?.lastIndexedBlock ?? null;
  let start: bigint;
  let reorg = false;

  if (!cp || cp.addressSetHash !== setHash) {
    if (cp) logger.warn({ chainId }, "watched address set changed; re-reading history from the deployment block");
    start = d.deployedAtBlock;
  } else {
    const block = await rpc.getBlockAny(cp.lastIndexedBlock);
    if (block.hash !== cp.lastIndexedBlockHash) {
      reorg = true;
      const rewindTo = cp.lastIndexedBlock - BigInt(env.INDEX_REORG_REWIND);
      const floor = d.deployedAtBlock - 1n;
      const target = rewindTo > floor ? rewindTo : floor;
      await prisma.reorgEvent.create({
        data: { chainId, atBlock: cp.lastIndexedBlock, storedHash: cp.lastIndexedBlockHash, observedHash: block.hash, rewoundTo: target },
      });
      logger.error({ chainId, atBlock: cp.lastIndexedBlock.toString(), rewoundTo: target.toString() }, "checkpoint block hash changed: reorg deeper than confirmations");
      start = target + 1n;
    } else {
      const window = BigInt(env.INDEX_REINDEX_WINDOW);
      const s = cp.lastIndexedBlock + 1n - window;
      start = s > d.deployedAtBlock ? s : d.deployedAtBlock;
    }
  }

  const summary: PassSummary = {
    chainId,
    fromBlock: null,
    toBlock: null,
    headBlock: head.toString(),
    spans: 0,
    logs: 0,
    rows: 0,
    orphans: 0,
    reorg,
    endpointHost: null,
  };

  const run = await prisma.indexerRun.create({ data: { chainId, kind: "INDEX", fromBlock: start, toBlock: safeHead } });
  try {
    let span = BigInt(env.INDEX_MAX_WINDOW);
    const minSpan = BigInt(env.INDEX_MIN_WINDOW);
    let from = start;
    while (from <= safeHead) {
      const to = from + span - 1n < safeHead ? from + span - 1n : safeHead;
      let fetched: FetchedSpan;
      try {
        fetched = await fetchSpan(prisma, rpc, d, from, to);
      } catch (err) {
        if (err instanceof LogSpanRefusedError && span > minSpan) {
          span = span / 2n > minSpan ? span / 2n : minSpan;
          logger.info({ chainId, span: span.toString() }, "narrowing eth_getLogs span");
          continue;
        }
        throw err;
      }
      const toBlock = await rpc.getBlockAny(to);

      await applySpan(prisma, chainId, from, to, fetched.rows, {
        expectedLast,
        lastHash: toBlock.hash,
        lastTimestamp: new Date(Number(toBlock.timestamp) * 1000),
        setHash,
        head,
      });
      expectedLast = to;
      summary.fromBlock ??= from.toString();
      summary.toBlock = to.toString();
      summary.spans += 1;
      summary.logs += fetched.logCount;
      summary.rows += rowCount(fetched.rows);
      summary.orphans += fetched.rows.orphans;
      summary.endpointHost = fetched.host;
      from = to + 1n;
    }

    await prisma.indexerCheckpoint.updateMany({ where: { chainId }, data: { headBlock: head, headObservedAt: new Date() } });
    await prisma.indexerRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", finishedAt: new Date(), logsFetched: summary.logs, rowsWritten: summary.rows, endpointHost: summary.endpointHost },
    });
    if (summary.orphans > 0) logger.warn({ chainId, orphans: summary.orphans }, "pool events without an Initialize were skipped");
    return summary;
  } catch (err) {
    await prisma.indexerRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: err instanceof Error ? err.message.slice(0, 500) : "unknown" },
    });
    throw err;
  }
}

interface FetchedSpan {
  rows: WindowRows;
  logCount: number;
  host: string;
}

export async function fetchSpan(
  prisma: PrismaClient,
  rpc: ChainRpc,
  d: LatchDeployment,
  from: bigint,
  to: bigint,
): Promise<FetchedSpan> {
  const chainId = d.chainId;
  const contracts = staticContractsFor(d);
  const roleOf = new Map<string, WatchRole>(contracts.map((c) => [c.address, c.role]));
  const topics = [...new Set(contracts.flatMap((c) => topicsForRole(c.role)))];

  const phase1 = await rpc.getLogs({ addresses: contracts.map((c) => c.address), topics, fromBlock: from, toBlock: to });
  const events: IndexedEvent[] = [];
  const decodeAll = (logs: RawLog[], role: (addr: string) => WatchRole | undefined) => {
    for (const log of logs) {
      const r = role(log.address);
      if (!r) continue;
      const res = decodeLog(chainId, r, log);
      if (res.ok) events.push(res.event);
      else if (res.reason === "malformed") logger.warn({ chainId, tx: log.transactionHash, logIndex: log.logIndex, eventName: res.eventName }, "malformed log skipped");
    }
  };
  decodeAll(phase1.logs, (a) => roleOf.get(a));

  // Phase 2: our RevShareHooks. The reference pool's hook comes from its
  // Initialize — in this span, or already in the database.
  let demoHooks: string | null = null;
  if (d.demoPool) {
    const demoId = d.demoPool.id.toLowerCase();
    const inSpan = events.find((e) => e.kind === "PoolInitialized" && e.poolId === demoId);
    if (inSpan && inSpan.kind === "PoolInitialized") demoHooks = inSpan.hooks;
    else {
      const row = await prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId: demoId } }, select: { hooks: true } });
      demoHooks = row?.hooks ?? null;
    }
  }
  const hooks = revShareHooksFor(d, demoHooks);
  const phase2 = await rpc.getLogs({ addresses: hooks, topics: topicsForRole("revShareHook"), fromBlock: from, toBlock: to });
  const hookSet = new Set<string>(hooks);
  decodeAll(phase2.logs, (a) => (hookSet.has(a) ? "revShareHook" : undefined));
  events.sort((a, b) => (a.meta.blockNumber === b.meta.blockNumber ? a.meta.logIndex - b.meta.logIndex : a.meta.blockNumber < b.meta.blockNumber ? -1 : 1));

  // Timestamps for every block carrying a log.
  const blocks = [...new Set(events.map((e) => e.meta.blockNumber))];
  const timestamps = new Map<bigint, bigint>();
  await mapLimit(blocks, 8, async (n) => {
    const b = await rpc.getBlockAny(n);
    timestamps.set(n, b.timestamp);
  });

  // Pool currencies: in-span Initialize plus the database.
  const poolCurrencies = new Map<string, { currency0: Hex; currency1: Hex }>();
  for (const e of events) if (e.kind === "PoolInitialized") poolCurrencies.set(e.poolId, { currency0: e.currency0, currency1: e.currency1 });
  const needed = [...new Set(events.flatMap((e) => (e.kind === "Swap" || e.kind === "Liquidity" ? [e.poolId] : [])))].filter((p) => !poolCurrencies.has(p));
  if (needed.length > 0) {
    const found = await prisma.pool.findMany({ where: { chainId, poolId: { in: needed } }, select: { poolId: true, currency0: true, currency1: true } });
    for (const p of found) poolCurrencies.set(p.poolId, { currency0: p.currency0 as Hex, currency1: p.currency1 as Hex });
  }

  // Outer transactions: `from` for swaps (the signer, not the router) and the
  // input for fee collections (collect() vs sweep()).
  const txInputs = new Map<string, Hex>();
  const txFrom = new Map<string, Hex>();
  const txs = [...new Set(events.filter((e) => e.kind === "ProtocolFeesCollected" || e.kind === "Swap").map((e) => e.meta.txHash))];
  await mapLimit(txs, 8, async (h) => {
    const tx = await rpc.reads.getTransaction({ hash: h });
    txInputs.set(h, tx.input);
    txFrom.set(h, tx.from.toLowerCase() as Hex);
  });

  const timelockTier = new Map<string, string>([
    [d.timelockCustody.toLowerCase(), "custody"],
    [d.timelockPolicy.toLowerCase(), "policy"],
  ]);

  const rows = buildWindowRows(
    {
      chainId,
      timestamps,
      poolCurrencies,
      txInputs,
      txFrom,
      protocolBeneficiaries: new Set([d.governanceSafe.toLowerCase()]),
      timelockTier,
    },
    events,
  );
  return { rows, logCount: phase1.logs.length + phase2.logs.length, host: phase1.host };
}

interface CheckpointAdvance {
  expectedLast: bigint | null;
  lastHash: string;
  lastTimestamp: Date;
  setHash: string;
  head: bigint;
}

export async function applySpan(
  prisma: PrismaClient,
  chainId: number,
  from: bigint,
  to: bigint,
  rows: WindowRows,
  cp: CheckpointAdvance,
): Promise<void> {
  const range = { chainId, blockNumber: { gte: from, lte: to } };
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Serialises passes per chain across processes.
      // `$executeRaw`: the function returns `void`, which $queryRaw cannot deserialise.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_NAMESPACE}::int, ${chainId}::int)`;
      const current = await tx.indexerCheckpoint.findUnique({ where: { chainId }, select: { lastIndexedBlock: true } });
      const currentLast = current?.lastIndexedBlock ?? null;
      if (currentLast !== cp.expectedLast) throw new ConcurrentPassError(chainId);

      await tx.revenueLedgerEntry.deleteMany({ where: range });
      await tx.swap.deleteMany({ where: range });
      await tx.liquidityEvent.deleteMany({ where: range });
      await tx.poolFeeUpdate.deleteMany({ where: range });
      await tx.revShareTake.deleteMany({ where: range });
      await tx.revShareClaim.deleteMany({ where: range });
      await tx.protocolFeeCollection.deleteMany({ where: range });
      await tx.launch.deleteMany({ where: range });
      await tx.contractEvent.deleteMany({ where: range });
      await tx.timelockEvent.deleteMany({ where: range });
      await tx.kitV2Launch.deleteMany({ where: range });
      await tx.kitV2LaunchLeg.deleteMany({ where: range });
      await tx.lpLock.deleteMany({ where: range });
      await tx.lpFeeCollection.deleteMany({ where: range });
      await tx.feeFlow.deleteMany({ where: range });
      // Pools: delete only those the chain no longer reports, so a re-read does
      // not cascade away swaps and state of pools that still exist.
      const keep = rows.pools.map((p) => p.id);
      await tx.pool.deleteMany({ where: { ...range, id: { notIn: keep } } });
      for (const p of rows.pools) {
        await tx.pool.upsert({ where: { id: p.id }, create: p, update: p });
      }

      if (rows.swaps.length) await tx.swap.createMany({ data: rows.swaps });
      if (rows.liquidity.length) await tx.liquidityEvent.createMany({ data: rows.liquidity });
      if (rows.feeUpdates.length) await tx.poolFeeUpdate.createMany({ data: rows.feeUpdates });
      if (rows.revShareTakes.length) await tx.revShareTake.createMany({ data: rows.revShareTakes });
      if (rows.revShareClaims.length) await tx.revShareClaim.createMany({ data: rows.revShareClaims });
      if (rows.collections.length) await tx.protocolFeeCollection.createMany({ data: rows.collections });
      if (rows.launches.length) await tx.launch.createMany({ data: rows.launches });
      if (rows.contractEvents.length) await tx.contractEvent.createMany({ data: rows.contractEvents });
      if (rows.timelockEvents.length) await tx.timelockEvent.createMany({ data: rows.timelockEvents });
      if (rows.ledger.length) await tx.revenueLedgerEntry.createMany({ data: rows.ledger });
      if (rows.kitV2Launches.length) await tx.kitV2Launch.createMany({ data: rows.kitV2Launches });
      if (rows.kitV2Legs.length) await tx.kitV2LaunchLeg.createMany({ data: rows.kitV2Legs });
      if (rows.lpLocks.length) await tx.lpLock.createMany({ data: rows.lpLocks });
      if (rows.lpFeeCollections.length) await tx.lpFeeCollection.createMany({ data: rows.lpFeeCollections });
      if (rows.feeFlows.length) await tx.feeFlow.createMany({ data: rows.feeFlows });

      await tx.indexerCheckpoint.upsert({
        where: { chainId },
        create: {
          chainId,
          lastIndexedBlock: to,
          lastIndexedBlockHash: cp.lastHash,
          lastIndexedBlockTimestamp: cp.lastTimestamp,
          addressSetHash: cp.setHash,
          headBlock: cp.head,
          headObservedAt: new Date(),
        },
        update: {
          lastIndexedBlock: to,
          lastIndexedBlockHash: cp.lastHash,
          lastIndexedBlockTimestamp: cp.lastTimestamp,
          addressSetHash: cp.setHash,
          headBlock: cp.head,
          headObservedAt: new Date(),
        },
      });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

export async function syncChainRow(prisma: PrismaClient, d: LatchDeployment): Promise<void> {
  const data = {
    key: d.key,
    name: d.name,
    isMainnet: d.isMainnet,
    deployedAtBlock: d.deployedAtBlock,
    contractBlockClock: d.contractBlockClock,
    contractBlockTimeCentis: d.contractBlockTimeCentis,
  };
  await prisma.chain.upsert({ where: { id: d.chainId }, create: { id: d.chainId, ...data }, update: data });
}

export async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export { LATCH_DEPLOYMENTS };
