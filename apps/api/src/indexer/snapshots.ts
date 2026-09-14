import { readContractClock, type ContractClockClient, type LatchDeployment } from "@latchprotocol/sdk";
import { Prisma, type PrismaClient } from "@prisma/client";
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, type Address, type Hex } from "viem";
import {
  BIN_POOL_MANAGER_VIEWS_ABI,
  CL_POOL_MANAGER_VIEWS_ABI,
  ERC20_VIEWS_ABI,
  REVSHARE_VIEWS_ABI,
  STOCK_TOKEN_PAUSE_ABI,
  STOCK_TOKEN_VIEWS_ABI,
} from "../chain/abis.js";
import { requireIndexedDeployment, revShareHooksFor } from "../chain/deployments.js";
import { decodePendingConfig, encodeGetPendingConfig, proposalStatus } from "../chain/pendingConfig.js";
import type { ChainRpc } from "../chain/rpc.js";
import { chainConfig } from "../config/chainConfig.js";
import { logger } from "../config/logger.js";
import { mapLimit } from "./indexer.js";

/**
 * State snapshots, read by the WORKER after an index pass and pinned to the
 * checkpoint block, so a snapshot and the logs it sits beside describe the same
 * chain state. Nothing here runs per HTTP request.
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN_REFRESH_MS = 60 * 60 * 1000;
const MAX_POOLS_PER_PASS = 500;

export function isRevert(e: unknown): boolean {
  return e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError) !== null;
}

const errText = (e: unknown) =>
  (e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e)).split("\n")[0]!.replace(/https?:\/\/\S+/g, "<url>").slice(0, 300);

export interface SnapshotSummary {
  chainId: number;
  atBlock: string | null;
  contractBlockNumber: string | null;
  tokens: number;
  pools: number;
  accruals: number;
  reconciliations: { verified: number; mismatch: number; unavailable: number; error: number };
  hazards: number;
  stockTokenChanges?: number;
}

const STOCK_OBSERVATION_HEARTBEAT_MS = 60 * 60 * 1000;

/**
 * Issuer state of every token that sits in an indexed pool: `tokenPaused()` and
 * `uiMultiplier()`. Read EVERY snapshot pass (not on the hourly token refresh),
 * because a pause is exactly the event an operator must see within a minute.
 * A token that answers neither is not a stock token and writes nothing.
 * Returns the number of CHANGED observations written.
 */
async function refreshStockTokens(prisma: PrismaClient, rpc: ChainRpc, chainId: number, B: bigint): Promise<number> {
  const pools = await prisma.pool.findMany({ where: { chainId }, select: { currency0: true, currency1: true } });
  const tokens = [...new Set(pools.flatMap((p) => [p.currency0, p.currency1]))].filter((t) => t !== ZERO);
  let changes = 0;
  await mapLimit(tokens, 4, async (token) => {
    const [paused, ui] = await Promise.allSettled([
      rpc.reads.readContract({ address: token as Address, abi: STOCK_TOKEN_PAUSE_ABI, functionName: "tokenPaused", blockNumber: B }),
      rpc.reads.readContract({ address: token as Address, abi: STOCK_TOKEN_VIEWS_ABI, functionName: "uiMultiplier", blockNumber: B }),
    ]);
    const pausedVal = paused.status === "fulfilled" ? Boolean(paused.value) : null;
    const uiVal = ui.status === "fulfilled" ? (ui.value as bigint) : null;
    const nonRevertErrors = [paused, ui].filter((r) => r.status === "rejected" && !isRevert(r.reason)).map((r) => errText((r as PromiseRejectedResult).reason));
    if (pausedVal === null && uiVal === null && nonRevertErrors.length === 0) return; // not a stock token

    const last = await prisma.stockTokenObservation.findFirst({ where: { chainId, token }, orderBy: { readAtBlock: "desc" } });
    const lastUi = last?.uiMultiplier?.toFixed() ?? null;
    const changed = last !== null && (last.tokenPaused !== pausedVal || lastUi !== (uiVal === null ? null : uiVal.toString()));
    const due = !last || changed || Date.now() - last.readAt.getTime() > STOCK_OBSERVATION_HEARTBEAT_MS || nonRevertErrors.length > 0;
    if (due) {
      await prisma.stockTokenObservation.create({
        data: {
          chainId,
          token,
          tokenPaused: pausedVal,
          uiMultiplier: uiVal === null ? null : uiVal.toString(),
          changed,
          previousPaused: last?.tokenPaused ?? null,
          previousUiMultiplier: last?.uiMultiplier ?? null,
          readAtBlock: B,
          readError: nonRevertErrors.length ? nonRevertErrors.join("; ").slice(0, 300) : null,
        },
      });
      if (changed) changes += 1;
    }
    await prisma.token.updateMany({ where: { chainId, address: token }, data: { tokenPaused: pausedVal, ...(uiVal === null ? {} : { uiMultiplier: uiVal.toString() }) } });
  });
  return changes;
}

export async function snapshotPass(prisma: PrismaClient, rpc: ChainRpc, chainId: number): Promise<SnapshotSummary> {
  const d = requireIndexedDeployment(chainId);
  const cp = await prisma.indexerCheckpoint.findUnique({ where: { chainId } });
  const summary: SnapshotSummary = {
    chainId,
    atBlock: null,
    contractBlockNumber: null,
    tokens: 0,
    pools: 0,
    accruals: 0,
    reconciliations: { verified: 0, mismatch: 0, unavailable: 0, error: 0 },
    hazards: 0,
  };
  if (!cp) return summary;
  const B = cp.lastIndexedBlock;
  summary.atBlock = B.toString();

  // --- contract clock (SDK) -------------------------------------------------
  // The block number CONTRACTS see. On Robinhood it is Ethereum L1's; every
  // contract-stored block number (launch startBlock, proposal effectiveBlock) is
  // compared against THIS, never against eth_blockNumber.
  let contractBlock: bigint | null = null;
  let clockMethod = "unavailable";
  try {
    const reading = await readContractClock(rpc.reads as unknown as ContractClockClient, chainId);
    contractBlock = reading.contractBlockNumber;
    clockMethod = reading.method;
    await prisma.indexerCheckpoint.update({
      where: { chainId },
      data: {
        contractBlockNumber: reading.contractBlockNumber,
        contractClockMethod: reading.method,
        contractClockRpcBlock: reading.rpcBlockNumber,
        contractClockTimestamp: new Date(Number(reading.timestamp) * 1000),
        contractClockReadAt: new Date(),
      },
    });
    summary.contractBlockNumber = contractBlock.toString();
  } catch (e) {
    logger.warn({ chainId, err: errText(e) }, "contract clock unreadable; launch phases and proposal status stay unknown");
  }

  summary.tokens = await refreshTokens(prisma, rpc, d, B);
  summary.stockTokenChanges = await refreshStockTokens(prisma, rpc, chainId, B);
  summary.pools = await refreshPoolStates(prisma, rpc, chainId, B);
  summary.accruals = await refreshAccruals(prisma, rpc, d, B);
  summary.reconciliations = await reconcileRevShare(prisma, rpc, d, B);
  summary.hazards = contractBlock === null ? 0 : await refreshPendingHazards(prisma, rpc, d, B, contractBlock, clockMethod);
  return summary;
}

async function refreshTokens(prisma: PrismaClient, rpc: ChainRpc, d: LatchDeployment, B: bigint): Promise<number> {
  const chainId = d.chainId;
  const cfg = chainConfig(chainId);
  const [pools, launches] = await Promise.all([
    prisma.pool.findMany({ where: { chainId }, select: { currency0: true, currency1: true } }),
    prisma.launch.findMany({ where: { chainId }, select: { launchToken: true, quoteToken: true } }),
  ]);
  const addresses = new Set<string>([
    ...d.tokens.map((t) => t.address.toLowerCase()),
    ...cfg.pricedTokens.map((t) => t.token),
    ...pools.flatMap((p) => [p.currency0, p.currency1]),
    ...launches.flatMap((l) => [l.launchToken, l.quoteToken]),
  ]);
  const existing = new Map((await prisma.token.findMany({ where: { chainId } })).map((t) => [t.address, t]));
  const stale = [...addresses].filter((a) => {
    const t = existing.get(a);
    return !t || !t.readAt || Date.now() - t.readAt.getTime() > TOKEN_REFRESH_MS;
  });

  await mapLimit(stale, 4, async (address) => {
    const book = d.tokens.find((t) => t.address.toLowerCase() === address);
    const id = `${chainId}-${address}`;
    if (address === ZERO) {
      const data = { symbol: d.nativeCurrency.symbol, name: d.nativeCurrency.name, decimals: d.nativeCurrency.decimals, inAddressBook: true, isTestToken: false, readAtBlock: B, readAt: new Date(), readError: null };
      await prisma.token.upsert({ where: { id }, create: { id, chainId, address, ...data }, update: data });
      return;
    }
    const a = address as Address;
    const read = <T>(fn: "name" | "symbol" | "decimals" | "totalSupply") =>
      rpc.reads.readContract({ address: a, abi: ERC20_VIEWS_ABI, functionName: fn, blockNumber: B }) as Promise<T>;
    const [name, symbol, decimals, totalSupply, ui] = await Promise.allSettled([
      read<string>("name"),
      read<string>("symbol"),
      read<number>("decimals"),
      read<bigint>("totalSupply"),
      rpc.reads.readContract({ address: a, abi: STOCK_TOKEN_VIEWS_ABI, functionName: "uiMultiplier", blockNumber: B }),
    ]);
    const val = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    const errors = [name, symbol, decimals, totalSupply].filter((r) => r.status === "rejected").map((r) => errText((r as PromiseRejectedResult).reason));
    const data = {
      // The address book's decimals win: they were read off the contract and
      // reviewed. A token answering differently is flagged in readError.
      symbol: val(symbol) ?? book?.symbol ?? null,
      name: val(name) ?? book?.name ?? null,
      decimals: book?.decimals ?? (val(decimals) === null ? null : Number(val(decimals))),
      totalSupply: val(totalSupply) === null ? null : new Prisma.Decimal(String(val(totalSupply))),
      inAddressBook: Boolean(book),
      isTestToken: book?.isTestToken ?? null,
      uiMultiplier: val(ui) === null ? null : new Prisma.Decimal(String(val(ui))),
      readAtBlock: B,
      readAt: new Date(),
      readError:
        book && val(decimals) !== null && Number(val(decimals)) !== book.decimals
          ? `decimals() answered ${val(decimals)} but the SDK address book says ${book.decimals}`
          : errors.length
            ? errors.join("; ").slice(0, 500)
            : null,
    };
    await prisma.token.upsert({ where: { id }, create: { id, chainId, address, ...data }, update: data });
  });
  return stale.length;
}

async function refreshPoolStates(prisma: PrismaClient, rpc: ChainRpc, chainId: number, B: bigint): Promise<number> {
  const pools = await prisma.pool.findMany({
    where: { chainId },
    orderBy: { blockNumber: "desc" },
    take: MAX_POOLS_PER_PASS,
    select: { id: true, poolId: true, poolType: true, poolManager: true },
  });
  await mapLimit(pools, 4, async (p) => {
    const base = { chainId, readAtBlock: B, readAt: new Date() };
    try {
      let data: Prisma.PoolStateUncheckedCreateInput;
      if (p.poolType === "CL") {
        const [slot0, liquidity] = await Promise.all([
          rpc.reads.readContract({ address: p.poolManager as Address, abi: CL_POOL_MANAGER_VIEWS_ABI, functionName: "getSlot0", args: [p.poolId as Hex], blockNumber: B }),
          rpc.reads.readContract({ address: p.poolManager as Address, abi: CL_POOL_MANAGER_VIEWS_ABI, functionName: "getLiquidity", args: [p.poolId as Hex], blockNumber: B }),
        ]);
        data = { poolRowId: p.id, ...base, sqrtPriceX96: slot0[0].toString(), tick: slot0[1], protocolFee: slot0[2], lpFee: slot0[3], liquidity: liquidity.toString(), activeId: null, readError: null };
      } else {
        const slot0 = await rpc.reads.readContract({ address: p.poolManager as Address, abi: BIN_POOL_MANAGER_VIEWS_ABI, functionName: "getSlot0", args: [p.poolId as Hex], blockNumber: B });
        data = { poolRowId: p.id, ...base, activeId: slot0[0], protocolFee: slot0[1], lpFee: slot0[2], sqrtPriceX96: null, tick: null, liquidity: null, readError: null };
      }
      await prisma.poolState.upsert({ where: { poolRowId: p.id }, create: data, update: data });
    } catch (e) {
      // Keep the last good values; record why this read failed.
      await prisma.poolState.updateMany({ where: { poolRowId: p.id }, data: { readError: errText(e) } });
    }
  });
  return pools.length;
}

async function refreshAccruals(prisma: PrismaClient, rpc: ChainRpc, d: LatchDeployment, B: bigint): Promise<number> {
  const chainId = d.chainId;
  const pools = await prisma.pool.findMany({ where: { chainId }, select: { poolManager: true, currency0: true, currency1: true } });
  const pairs = new Map<string, { manager: string; currency: string; cl: boolean }>();
  for (const p of pools) {
    for (const c of [p.currency0, p.currency1]) {
      pairs.set(`${p.poolManager}:${c}`, { manager: p.poolManager, currency: c, cl: p.poolManager === d.clPoolManager.toLowerCase() });
    }
  }
  let written = 0;
  await mapLimit([...pairs.values()], 4, async ({ manager, currency, cl }) => {
    try {
      const amount = await rpc.reads.readContract({
        address: manager as Address,
        abi: cl ? CL_POOL_MANAGER_VIEWS_ABI : BIN_POOL_MANAGER_VIEWS_ABI,
        functionName: "protocolFeesAccrued",
        args: [currency as Address],
        blockNumber: B,
      });
      const last = await prisma.protocolFeeAccrualSnapshot.findFirst({
        where: { chainId, poolManager: manager, currency },
        orderBy: { readAtBlock: "desc" },
      });
      // A row per change (or hourly), not per poll: the ledger stays readable.
      if (!last || last.amount.toFixed() !== amount.toString() || Date.now() - last.readAt.getTime() > 3_600_000) {
        await prisma.protocolFeeAccrualSnapshot.create({ data: { chainId, poolManager: manager, currency, amount: amount.toString(), readAtBlock: B } });
        written += 1;
      }
    } catch (e) {
      logger.warn({ chainId, manager, currency, err: errText(e) }, "protocolFeesAccrued read failed");
    }
  });
  return written;
}

/**
 * RevShareHook.totalTaken(poolId, currency) is a lifetime counter incremented by
 * exactly lpDonated + toBeneficiaries + toDistributor in the call that emits
 * RevShareTaken. So the indexed logs up to block B must sum to the counter at B,
 * pool by pool — including pools with no logs at all. And every RevShareTaken
 * must share a transaction with a Swap. Same checks as the landing page.
 */
async function reconcileRevShare(prisma: PrismaClient, rpc: ChainRpc, d: LatchDeployment, B: bigint) {
  const chainId = d.chainId;
  const counts = { verified: 0, mismatch: 0, unavailable: 0, error: 0 };
  const demo = d.demoPool ? await prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId: d.demoPool.id.toLowerCase() } }, select: { hooks: true } }) : null;
  const hooks = revShareHooksFor(d, demo?.hooks ?? null);

  const sums = await prisma.revShareTake.groupBy({
    by: ["hook", "poolId", "currency"],
    where: { chainId, blockNumber: { lte: B } },
    _sum: { lpDonated: true, toBeneficiaries: true, toDistributor: true },
  });
  const subjects = new Map<string, { hook: string; poolId: string; currency: string; sum: bigint }>();
  for (const r of sums) {
    const total = BigInt(r._sum.lpDonated?.toFixed() ?? "0") + BigInt(r._sum.toBeneficiaries?.toFixed() ?? "0") + BigInt(r._sum.toDistributor?.toFixed() ?? "0");
    subjects.set(`${r.hook}:${r.poolId}:${r.currency}`, { hook: r.hook, poolId: r.poolId, currency: r.currency, sum: total });
  }
  const hookedPools = await prisma.pool.findMany({
    where: { chainId, hooks: { in: hooks }, poolType: "CL", blockNumber: { lte: B } },
    select: { poolId: true, hooks: true, currency0: true, currency1: true },
  });
  for (const p of hookedPools) {
    for (const c of [p.currency0, p.currency1]) {
      const k = `${p.hooks}:${p.poolId}:${c}`;
      if (!subjects.has(k)) subjects.set(k, { hook: p.hooks, poolId: p.poolId, currency: c, sum: 0n });
    }
  }

  await mapLimit([...subjects.values()], 4, async (s) => {
    const id = `${chainId}-revshare.totalTaken-${s.hook}-${s.poolId}-${s.currency}`;
    const base = { chainId, kind: "revshare.totalTaken", subject: `${s.hook}:${s.poolId}:${s.currency}`, atBlock: B, observed: s.sum.toString(), checkedAt: new Date() };
    let data: Prisma.ReconciliationUncheckedCreateInput;
    try {
      const counter = await rpc.reads.readContract({ address: s.hook as Address, abi: REVSHARE_VIEWS_ABI, functionName: "totalTaken", args: [s.poolId as Hex, s.currency as Address], blockNumber: B });
      const ok = counter === s.sum;
      data = { id, ...base, expected: counter.toString(), status: ok ? "VERIFIED" : "MISMATCH", detail: ok ? null : "RevShareTaken logs do not sum to totalTaken at the same block" };
      counts[ok ? "verified" : "mismatch"] += 1;
    } catch (e) {
      const revert = isRevert(e);
      data = { id, ...base, expected: null, status: revert ? "UNAVAILABLE" : "ERROR", detail: revert ? "hook has no totalTaken (predates the counter)" : errText(e) };
      counts[revert ? "unavailable" : "error"] += 1;
    }
    await prisma.reconciliation.upsert({ where: { id }, create: data, update: data });
  });

  // Every cut must share a transaction with a Swap.
  const orphanRows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM revshare_takes t
    WHERE t."chainId" = ${chainId} AND t."blockNumber" <= ${B}
      AND NOT EXISTS (SELECT 1 FROM swaps s WHERE s."chainId" = t."chainId" AND s."txHash" = t."txHash")`;
  const orphans = Number(orphanRows[0]?.n ?? 0n);
  const id = `${chainId}-revshare.cutHasSwap-all`;
  const data = {
    id,
    chainId,
    kind: "revshare.cutHasSwap",
    subject: "all",
    atBlock: B,
    expected: "0",
    observed: String(orphans),
    status: orphans === 0 ? ("VERIFIED" as const) : ("MISMATCH" as const),
    detail: orphans === 0 ? null : `${orphans} RevShareTaken row(s) have no Swap in the same transaction: the log scan was short`,
    checkedAt: new Date(),
  };
  await prisma.reconciliation.upsert({ where: { id }, create: data, update: data });
  counts[orphans === 0 ? "verified" : "mismatch"] += 1;
  return counts;
}

async function refreshPendingHazards(
  prisma: PrismaClient,
  rpc: ChainRpc,
  d: LatchDeployment,
  B: bigint,
  contractBlock: bigint,
  clockMethod: string,
): Promise<number> {
  const chainId = d.chainId;
  const demo = d.demoPool ? await prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId: d.demoPool.id.toLowerCase() } }, select: { hooks: true } }) : null;
  const hooks = revShareHooksFor(d, demo?.hooks ?? null);
  const pools = await prisma.pool.findMany({ where: { chainId, hooks: { in: hooks } }, select: { poolId: true, hooks: true } });
  let armed = 0;
  await mapLimit(pools, 4, async (p) => {
    const id = `${chainId}-${p.hooks}-${p.poolId}`;
    try {
      const { data: ret } = await rpc.reads.call({ to: p.hooks as Address, data: encodeGetPendingConfig(p.poolId as Hex), blockNumber: B });
      if (!ret || ret === "0x") throw new Error("getPendingConfig returned no data");
      const decoded = decodePendingConfig(ret);
      const status = proposalStatus(decoded, contractBlock);
      if (status === "ARMED") armed += 1;
      const row = {
        chainId,
        hook: p.hooks,
        poolId: p.poolId,
        shape: decoded.shape,
        effectiveContractBlock: decoded.effectiveBlock,
        expiryContractBlock: decoded.expiryBlock,
        params: decoded.params as unknown as Prisma.InputJsonValue,
        status,
        contractBlockNumber: contractBlock,
        contractClockMethod: clockMethod,
        readAtBlock: B,
        readAt: new Date(),
        readError: null,
      };
      await prisma.pendingConfigHazard.upsert({ where: { id }, create: { id, ...row }, update: row });
    } catch (e) {
      // Never collapse a failed read into "no proposal": record the error.
      const failed = {
        chainId,
        hook: p.hooks,
        poolId: p.poolId,
        shape: "unknown",
        effectiveContractBlock: 0n,
        expiryContractBlock: null,
        params: {},
        status: "UNKNOWN" as const,
        contractBlockNumber: contractBlock,
        contractClockMethod: clockMethod,
        readAtBlock: B,
        readAt: new Date(),
        readError: errText(e),
      };
      await prisma.pendingConfigHazard.upsert({
        where: { id },
        create: { id, ...failed },
        update: { status: "UNKNOWN", readError: failed.readError, readAt: failed.readAt, readAtBlock: B },
      });
      logger.warn({ chainId, hook: p.hooks, poolId: p.poolId, err: errText(e) }, "getPendingConfig read failed");
    }
  });
  return armed;
}
