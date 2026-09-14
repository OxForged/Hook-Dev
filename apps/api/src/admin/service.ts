import {
  getDeployment,
  listingFromUint8,
  riskClassFromUint8,
  verificationFromUint8,
  type LatchDeployment,
} from "@latchprotocol/sdk";
import { Prisma, type PrismaClient, type RevenueSource } from "@prisma/client";
import { chainConfig } from "../config/chainConfig.js";
import { ApiError } from "../lib/errors.js";
import { decStr } from "../lib/serialize.js";
import { formatUnitsExact, ratioToDecimal, toBigInt } from "../lib/units.js";
import { ROLE_NAMES } from "../indexer/governance.js";
import type { ReadService } from "../services/read.js";
import { computeAlerts, countBySeverity, type AlertInputs } from "./alerts.js";
import { toCsv } from "./csv.js";
import { queuedAcceptOwnership } from "./alerts.js";
import { prepareExecuteOperation, RECORDED_ACCEPT_OWNERSHIP_OPERATIONS, safeAppUrl, type ExecuteOperationPayload } from "./safeTx.js";
import { groupTimelockOperations, type TimelockEventRow } from "./timelockOps.js";

/**
 * Every read the admin panel makes. Postgres only (plus ReadService's USD
 * derivation, also Postgres). Figures are raw integers AND token units with a
 * symbol; USD appears only where a Chainlink read prices a token, with its source
 * and time, and never multiplies a historical flow by a current price.
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const ADMIN_WINDOWS = { "24h": 86_400, "7d": 604_800, "30d": 2_592_000, all: null } as const;
export type AdminWindow = keyof typeof ADMIN_WINDOWS;

/** Every revenue line the protocol has or plans. Planned lines are NEVER rendered as zero. */
export const REVENUE_SOURCES: readonly {
  source: RevenueSource;
  label: string;
  status: "indexed" | "not-deployed";
  contract: string;
  note: string;
}[] = [
  { source: "PROTOCOL_FEE_COLLECTED", label: "Protocol fees collected via collect()", status: "indexed", contract: "LatchProtocolFeeControllerV2", note: "Owner-only (the Safe); recipient chosen per call. From ProtocolFeesCollected where the outer tx input is collect()." },
  { source: "PROTOCOL_FEE_SWEPT", label: "Fee-controller sweeps to treasury", status: "indexed", contract: "LatchProtocolFeeControllerV2", note: "Permissionless sweep(); pays only the stored treasury. The keeper calls it every 12 h." },
  { source: "REVSHARE_PROTOCOL_CLAIM", label: "RevShare roster payouts to the protocol", status: "indexed", contract: "RevShareHook (Latch's own deployments)", note: "Claimed events whose beneficiary is the governance Safe. An entitlement a pool owner granted, not an enforced fee." },
  { source: "LP_LOCKER_PROTOCOL_CLAIM", label: "LP locker: protocol share", status: "not-deployed", contract: "LatchLPLocker", note: "Not deployed on this chain and not in the SDK address book, so there is nothing to index. Not zero: unmeasured." },
  { source: "LP_LOCKER_INTEGRATOR_CLAIM", label: "LP locker: integrator share", status: "not-deployed", contract: "LatchLPLocker", note: "Not deployed on this chain and not in the SDK address book. Not zero: unmeasured." },
  { source: "KIT_LAUNCH_FEE", label: "Kit launch fees", status: "not-deployed", contract: "LaunchpadKit v2", note: "The deployed LaunchpadKit charges no launch fee; v2 (createLaunch fee) is not deployed. Not zero: unmeasured." },
];

/** Exact decimal string -> ratio. */
function decimalToRatio(s: string): { num: bigint; den: bigint } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`not a decimal: ${s}`);
  const frac = m[2] ?? "";
  return { num: BigInt(m[1]! + frac), den: 10n ** BigInt(frac.length) };
}

export class AdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly read: ReadService,
  ) {}

  deployment(chainId: number): LatchDeployment {
    const d = getDeployment(chainId);
    if (!d) throw ApiError.validation(`chain ${chainId} is not in the Latch address book`);
    return d;
  }

  private async tokenMap(chainId: number, addresses: string[]) {
    const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
    if (uniq.length === 0) return new Map<string, { symbol: string | null; decimals: number | null; uiMultiplier: Prisma.Decimal | null; address: string }>();
    const rows = await this.prisma.token.findMany({ where: { chainId, address: { in: uniq } } });
    return new Map(rows.map((r) => [r.address, r]));
  }

  private units(raw: string | null, decimals: number | null | undefined): string | null {
    return raw !== null && decimals !== null && decimals !== undefined ? formatUnitsExact(BigInt(raw), decimals) : null;
  }

  /* -------------------------------------------------------------------------
     Alerts and overview
     ------------------------------------------------------------------------- */

  async alertInputs(chainId: number): Promise<AlertInputs> {
    const d = this.deployment(chainId);
    const cfg = chainConfig(chainId);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [cp, ownership, pending, ops, feeds, stockLatest, stockChanges, tlRows, recs, listings] = await Promise.all([
      this.prisma.indexerCheckpoint.findUnique({ where: { chainId } }),
      this.prisma.ownershipSnapshot.findMany({ where: { chainId } }),
      this.prisma.pendingConfigHazard.findMany({ where: { chainId } }),
      this.prisma.opsBalance.findMany({ where: { chainId } }),
      this.latestFeeds(chainId),
      this.latestStockObservations(chainId),
      this.prisma.stockTokenObservation.findMany({ where: { chainId, changed: true, readAt: { gte: since } }, orderBy: { readAt: "desc" }, take: 100 }),
      this.prisma.timelockEvent.findMany({ where: { chainId }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] }),
      this.prisma.reconciliation.findMany({ where: { chainId, status: "MISMATCH" } }),
      this.prisma.listingSubmission.count({ where: { status: "PENDING" } }),
    ]);
    const tokens = await this.tokenMap(chainId, stockLatest.map((s) => s.token));
    return {
      now: new Date(),
      chains: cp
        ? [{ chainId, lastIndexedBlock: cp.lastIndexedBlock.toString(), headBlock: cp.headBlock.toString(), headObservedAt: cp.headObservedAt.toISOString(), maxLagBlocks: cfg.indexerAlerts?.maxLagBlocks ?? null, maxHeadAgeSeconds: cfg.indexerAlerts?.maxHeadAgeSeconds ?? null }]
        : [],
      governance: [{ chainId, safe: d.governanceSafe, timelockCustody: d.timelockCustody, timelockPolicy: d.timelockPolicy }],
      ownership: ownership.map((r) => ({ chainId: r.chainId, contractKey: r.contractKey, address: r.address, check: r.check, observed: r.observed, expectedTier: r.expectedTier, expectedAddress: r.expectedAddress, matches: r.matches, readError: r.readError, readAtBlock: r.readAtBlock.toString(), readAt: r.readAt.toISOString() })),
      pendingConfigs: pending.map((p) => ({ chainId: p.chainId, hook: p.hook, poolId: p.poolId, shape: p.shape, status: p.status, effectiveContractBlock: p.effectiveContractBlock.toString(), expiryContractBlock: p.expiryContractBlock?.toString() ?? null, contractBlockNumber: p.contractBlockNumber.toString(), readError: p.readError, readAt: p.readAt.toISOString(), readAtBlock: p.readAtBlock.toString() })),
      opsBalances: ops.map((b) => ({ chainId: b.chainId, label: b.label, address: b.address, balanceWei: b.balanceWei.toFixed(), criticalWei: decStr(b.criticalWei), minWei: decStr(b.minWei), severity: b.severity, actionsAffordable: decStr(b.actionsAffordable), gasPriceWei: decStr(b.gasPriceWei), readAt: b.readAt.toISOString(), readAtBlock: b.readAtBlock.toString() })),
      feeds: feeds.map((f) => ({ chainId: f.chainId, label: f.label, proxy: f.proxy, heartbeatViolation: f.heartbeatViolation, stalenessSeconds: f.stalenessSeconds, heartbeatSeconds: f.heartbeatSeconds, error: f.error, readAt: f.readAt.toISOString() })),
      stockTokens: stockLatest.map((s) => ({
        chainId,
        token: s.token,
        symbol: tokens.get(s.token)?.symbol ?? null,
        tokenPaused: s.tokenPaused,
        uiMultiplier: s.uiMultiplier,
        readAt: s.readAt.toISOString(),
        readAtBlock: s.readAtBlock.toString(),
        recentChanges: stockChanges.filter((c) => c.token === s.token).map((c) => ({ readAt: c.readAt.toISOString(), previousPaused: c.previousPaused, tokenPaused: c.tokenPaused, previousUiMultiplier: decStr(c.previousUiMultiplier), uiMultiplier: decStr(c.uiMultiplier) })),
      })),
      timelockOps: groupTimelockOperations(tlRows.map(timelockRow)).operations,
      reconciliationMismatches: recs.map((r) => ({ chainId: r.chainId, kind: r.kind, subject: r.subject, detail: r.detail, atBlock: r.atBlock.toString() })),
      pendingListings: listings,
    };
  }

  async alerts(chainId: number) {
    const alerts = computeAlerts(await this.alertInputs(chainId));
    return { chainId, generatedAt: new Date().toISOString(), counts: countBySeverity(alerts), alerts };
  }

  private async latestFeeds(chainId: number) {
    return this.prisma.$queryRaw<{ chainId: number; label: string; proxy: string; description: string | null; answer: string | null; decimals: number | null; feedUpdatedAt: Date | null; heartbeatViolation: boolean | null; stalenessSeconds: number | null; heartbeatSeconds: number; error: string | null; readAt: Date; readAtBlock: bigint }[]>`
      SELECT DISTINCT ON (proxy) "chainId", label, proxy, description, answer::text AS answer, decimals, "feedUpdatedAt", "heartbeatViolation", "stalenessSeconds", "heartbeatSeconds", error, "readAt", "readAtBlock"
      FROM feed_observations WHERE "chainId" = ${chainId} ORDER BY proxy, "readAt" DESC`;
  }

  private async latestStockObservations(chainId: number) {
    return this.prisma.$queryRaw<{ token: string; tokenPaused: boolean | null; uiMultiplier: string | null; readAt: Date; readAtBlock: bigint; readError: string | null }[]>`
      SELECT DISTINCT ON (token) token, "tokenPaused", "uiMultiplier"::text AS "uiMultiplier", "readAt", "readAtBlock", "readError"
      FROM stock_token_observations WHERE "chainId" = ${chainId} ORDER BY token, "readAtBlock" DESC`;
  }

  async overview(chainId: number) {
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const [cp, alerts, ledger, accruals, listings, keys, usage] = await Promise.all([
      this.prisma.indexerCheckpoint.findUnique({ where: { chainId } }),
      this.alerts(chainId),
      this.prisma.revenueLedgerEntry.groupBy({ by: ["source", "token"], where: { chainId }, _sum: { amount: true }, _count: { _all: true } }),
      this.latestAccruals(chainId),
      this.prisma.listingSubmission.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.apiKey.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.apiUsageMonthly.aggregate({ where: { period }, _sum: { requests: true } }),
    ]);
    const tokens = await this.tokenMap(chainId, [...ledger.map((l) => l.token), ...accruals.map((a) => a.currency)]);
    const byToken = new Map<string, bigint>();
    for (const l of ledger) byToken.set(l.token, (byToken.get(l.token) ?? 0n) + toBigInt(l._sum.amount));
    return {
      chainId,
      generatedAt: now.toISOString(),
      indexer: cp
        ? { indexed: true, lastIndexedBlock: cp.lastIndexedBlock.toString(), lastIndexedBlockTimestamp: iso(cp.lastIndexedBlockTimestamp), headBlock: cp.headBlock.toString(), headObservedAt: iso(cp.headObservedAt), lagBlocks: (cp.headBlock > cp.lastIndexedBlock ? cp.headBlock - cp.lastIndexedBlock : 0n).toString(), contractBlockNumber: cp.contractBlockNumber?.toString() ?? null, contractClockReadAt: iso(cp.contractClockReadAt) }
        : { indexed: false },
      alerts: { counts: alerts.counts, top: alerts.alerts.slice(0, 12) },
      revenue: {
        provenance: cp ? `revenue_ledger, logs from block ${this.deployment(chainId).deployedAtBlock} to ${cp.lastIndexedBlock}` : "not indexed",
        received: [...byToken.entries()].map(([token, raw]) => ({ token, symbol: tokens.get(token)?.symbol ?? null, raw: raw.toString(), units: this.units(raw.toString(), tokens.get(token)?.decimals) })),
        uncollectedAccrued: accruals.map((a) => ({ poolManager: a.poolManager, token: a.currency, symbol: tokens.get(a.currency)?.symbol ?? null, raw: a.amount, units: this.units(a.amount, tokens.get(a.currency)?.decimals), readAtBlock: a.readAtBlock.toString(), readAt: iso(a.readAt) })),
        notDeployed: REVENUE_SOURCES.filter((s) => s.status === "not-deployed").map((s) => ({ source: s.source, label: s.label, note: s.note })),
      },
      moderation: Object.fromEntries(listings.map((l) => [l.status, l._count._all])),
      apiKeys: { byStatus: Object.fromEntries(keys.map((k) => [k.status, k._count._all])), requestsThisMonth: (usage._sum.requests ?? 0n).toString(), period },
    };
  }

  private async latestAccruals(chainId: number) {
    return this.prisma.$queryRaw<{ poolManager: string; currency: string; amount: string; readAtBlock: bigint; readAt: Date }[]>`
      SELECT DISTINCT ON ("poolManager", currency) "poolManager", currency, amount::text AS amount, "readAtBlock", "readAt"
      FROM protocol_fee_accrual_snapshots WHERE "chainId" = ${chainId}
      ORDER BY "poolManager", currency, "readAtBlock" DESC`;
  }

  /* -------------------------------------------------------------------------
     Revenue
     ------------------------------------------------------------------------- */

  private async revenueWhere(chainId: number, q: RevenueQuery): Promise<{ where: Prisma.RevenueLedgerEntryWhereInput; from: Date | null; to: Date | null; checkpoint: Awaited<ReturnType<ReadService["checkpoint"]>> }> {
    const cp = await this.read.checkpoint(chainId);
    let from: Date | null = q.from ?? null;
    const to: Date | null = q.to ?? null;
    if (!q.from && q.window && ADMIN_WINDOWS[q.window] !== null) from = new Date(cp.lastIndexedBlockTimestamp.getTime() - ADMIN_WINDOWS[q.window]! * 1000);
    const where: Prisma.RevenueLedgerEntryWhereInput = {
      chainId,
      ...(q.token ? { token: q.token } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(from || to ? { blockTimestamp: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
    return { where, from, to, checkpoint: cp };
  }

  async revenue(chainId: number, q: RevenueQuery) {
    const { where, from, to, checkpoint } = await this.revenueWhere(chainId, q);
    const time = from || to ? { blockTimestamp: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {};
    const [grouped, rows, total, accruals, collections, slices] = await Promise.all([
      this.prisma.revenueLedgerEntry.groupBy({ by: ["source", "token"], where, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.revenueLedgerEntry.findMany({ where, orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }], take: q.limit, skip: q.offset }),
      this.prisma.revenueLedgerEntry.count({ where }),
      this.latestAccruals(chainId),
      this.prisma.protocolFeeCollection.groupBy({ by: ["currency", "via"], where: { chainId, ...time, ...(q.token ? { currency: q.token } : {}) }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.swap.groupBy({ by: ["tokenIn"], where: { chainId, ...time, ...(q.token ? { tokenIn: q.token } : {}) }, _sum: { feeProtocol: true }, _count: { _all: true } }),
    ]);
    const tokens = await this.tokenMap(chainId, [...grouped.map((g) => g.token), ...rows.map((r) => r.token), ...accruals.map((a) => a.currency), ...collections.map((c) => c.currency), ...slices.map((s) => s.tokenIn)]);
    const tok = (a: string) => tokens.get(a);

    const usdFor = async (token: string, raw: string) => {
      if (!q.usd) return null;
      const t = tok(token);
      if (!t || t.decimals === null) return { value: null, reason: "token decimals not read" };
      const r = await this.read.usdFor(chainId, { address: token, uiMultiplier: t.uiMultiplier, decimals: t.decimals });
      if (!r.price) return { value: null, reason: r.reason };
      const p = decimalToRatio(r.price.usdPerToken);
      const value = ratioToDecimal({ num: BigInt(raw) * p.num, den: p.den * 10n ** BigInt(t.decimals) }, 12);
      return { value, source: r.price.source, feed: r.price.feed.label, feedUpdatedAt: r.price.feedUpdatedAt, readAtBlock: r.price.readAtBlock, method: `${r.price.method}; valued at the latest feed read, applies to this CURRENT balance only` };
    };

    const totalsBySource = [];
    for (const s of REVENUE_SOURCES) {
      if (s.status === "not-deployed") {
        totalsBySource.push({ ...s, byToken: null });
        continue;
      }
      if (q.source && q.source !== s.source) continue;
      const g = grouped.filter((x) => x.source === s.source);
      totalsBySource.push({
        ...s,
        byToken: g.map((x) => {
          const raw = toBigInt(x._sum.amount).toString();
          return { token: x.token, symbol: tok(x.token)?.symbol ?? null, decimals: tok(x.token)?.decimals ?? null, entries: x._count._all, raw, units: this.units(raw, tok(x.token)?.decimals) };
        }),
      });
    }

    const accruedItems = [];
    for (const a of accruals) {
      if (q.token && a.currency !== q.token) continue;
      accruedItems.push({ poolManager: a.poolManager, token: a.currency, symbol: tok(a.currency)?.symbol ?? null, raw: a.amount, units: this.units(a.amount, tok(a.currency)?.decimals), readAtBlock: a.readAtBlock.toString(), readAt: iso(a.readAt), usd: await usdFor(a.currency, a.amount) });
    }

    return {
      chainId,
      filters: { token: q.token ?? null, source: q.source ?? null, window: q.window ?? null, from: iso(from), to: iso(to), usd: q.usd },
      provenance: {
        source: "revenue_ledger (range-replaced with the logs it came from)",
        fromBlock: this.deployment(chainId).deployedAtBlock.toString(),
        toBlock: checkpoint.lastIndexedBlock.toString(),
        toBlockTimestamp: iso(checkpoint.lastIndexedBlockTimestamp),
        note: "Token units with symbols. Flows carry USD only if the ledger row was priced by an oracle when written (none are today); USD on accrued balances is the current feed value of a current balance.",
      },
      totalsBySource,
      protocolFees: {
        charged: { definition: "Swap-log protocol-fee slice: amountIn x protocolFee / 1e6 per swap. Not reconcilable exactly (per-step rounding).", byToken: slices.map((sl) => { const raw = toBigInt(sl._sum.feeProtocol).toString(); return { token: sl.tokenIn, symbol: tok(sl.tokenIn)?.symbol ?? null, swaps: sl._count._all, raw, units: this.units(raw, tok(sl.tokenIn)?.decimals) }; }) },
        collected: { definition: "ProtocolFeesCollected on the V2 controller, split by how it was called.", byTokenAndMethod: collections.map((c) => { const raw = toBigInt(c._sum.amount).toString(); return { token: c.currency, symbol: tok(c.currency)?.symbol ?? null, via: c.via, count: c._count._all, raw, units: this.units(raw, tok(c.currency)?.decimals) }; }) },
        accruedUncollected: { definition: "protocolFeesAccrued(currency) on each pool manager, latest snapshot. Not windowed.", items: accruedItems },
      },
      ledger: {
        total,
        limit: q.limit,
        offset: q.offset,
        items: rows.map((r) => ({
          id: r.id,
          source: r.source,
          token: r.token,
          symbol: tok(r.token)?.symbol ?? null,
          raw: r.amount.toFixed(),
          units: this.units(r.amount.toFixed(), tok(r.token)?.decimals),
          counterparty: r.counterparty,
          contract: r.contract,
          poolId: r.poolId,
          blockNumber: r.blockNumber.toString(),
          blockTimestamp: iso(r.blockTimestamp),
          txHash: r.txHash,
          logIndex: r.logIndex,
          usd: r.usdValue ? { value: r.usdValue, source: r.usdSource, pricedAt: iso(r.usdPricedAt) } : null,
        })),
      },
    };
  }

  static readonly CSV_MAX_ROWS = 50_000;

  async revenueCsv(chainId: number, q: RevenueQuery): Promise<{ csv: string; rows: number; toBlock: string; truncated: boolean }> {
    const { where, checkpoint } = await this.revenueWhere(chainId, q);
    const rows = await this.prisma.revenueLedgerEntry.findMany({ where, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }], take: AdminService.CSV_MAX_ROWS + 1 });
    const truncated = rows.length > AdminService.CSV_MAX_ROWS;
    const kept = rows.slice(0, AdminService.CSV_MAX_ROWS);
    const tokens = await this.tokenMap(chainId, kept.map((r) => r.token));
    const csv = toCsv(
      ["chainId", "source", "token", "symbol", "amountRaw", "amount", "counterparty", "contract", "poolId", "blockNumber", "blockTimestamp", "txHash", "logIndex", "usdValue", "usdSource", "usdPricedAt"],
      kept.map((r) => [r.chainId, r.source, r.token, tokens.get(r.token)?.symbol ?? "", r.amount.toFixed(), this.units(r.amount.toFixed(), tokens.get(r.token)?.decimals) ?? "", r.counterparty ?? "", r.contract, r.poolId ?? "", r.blockNumber, iso(r.blockTimestamp), r.txHash, r.logIndex, r.usdValue ?? "", r.usdSource ?? "", iso(r.usdPricedAt) ?? ""]),
    );
    return { csv, rows: kept.length, toBlock: checkpoint.lastIndexedBlock.toString(), truncated };
  }

  /* -------------------------------------------------------------------------
     Protocol activity
     ------------------------------------------------------------------------- */

  async protocol(chainId: number) {
    const cp = await this.read.checkpoint(chainId);
    const d = this.deployment(chainId);
    const [pools, poolSwaps, poolLast, launches, registryEvents, apps, volume] = await Promise.all([
      this.prisma.pool.findMany({ where: { chainId }, include: { state: true }, orderBy: { blockNumber: "desc" }, take: 200 }),
      this.prisma.swap.groupBy({ by: ["poolId", "tokenIn"], where: { chainId }, _count: { _all: true }, _sum: { amountIn: true, feeTotal: true, feeProtocol: true, feeLp: true } }),
      this.prisma.swap.groupBy({ by: ["poolId"], where: { chainId }, _max: { blockTimestamp: true, blockNumber: true }, _count: { _all: true } }),
      this.read.launches(chainId, { limit: 50, offset: 0 }),
      this.prisma.contractEvent.findMany({ where: { chainId, contractKey: "registry", eventName: { in: ["LatchRegistered", "LatchListingChanged", "LatchVerificationChanged", "LatchMetadataUpdated"] } }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] }),
      this.prisma.contractEvent.findMany({ where: { chainId, contractKey: "vault", eventName: "AppRegistered" }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] }),
      this.read.volume(chainId, { window: "all" }),
    ]);
    const tokens = await this.tokenMap(chainId, [...pools.flatMap((p) => [p.currency0, p.currency1]), ...poolSwaps.map((s) => s.tokenIn)]);
    const tok = (a: string) => tokens.get(a);

    const registry = new Map<string, { hook: string; name: string | null; riskClass: string | null; permissions: string | null; listing: string; verification: string; registeredAt: { blockNumber: string; txHash: string } | null; lastChangeReason: string | null }>();
    const safe = <T>(f: () => T): T | null => {
      try {
        return f();
      } catch {
        return null;
      }
    };
    for (const e of registryEvents) {
      const hook = e.subject ?? "";
      const a = e.args as Record<string, string>;
      const rec = registry.get(hook) ?? { hook, name: null, riskClass: null, permissions: null, listing: "Active", verification: "Unverified", registeredAt: null, lastChangeReason: null };
      if (e.eventName === "LatchRegistered") {
        rec.riskClass = safe(() => riskClassFromUint8(Number(a.riskClass)));
        rec.permissions = a.permissions ?? null;
        rec.registeredAt = { blockNumber: e.blockNumber.toString(), txHash: e.txHash };
      } else if (e.eventName === "LatchListingChanged") {
        rec.listing = safe(() => listingFromUint8(Number(a.current))) ?? `unknown(${a.current})`;
        rec.lastChangeReason = a.reason ?? null;
      } else if (e.eventName === "LatchVerificationChanged") {
        rec.verification = safe(() => verificationFromUint8(Number(a.current))) ?? `unknown(${a.current})`;
      } else if (e.eventName === "LatchMetadataUpdated") {
        rec.name = a.name ?? rec.name;
      }
      registry.set(hook, rec);
    }

    return {
      chainId,
      provenance: { toBlock: cp.lastIndexedBlock.toString(), toBlockTimestamp: iso(cp.lastIndexedBlockTimestamp), fromBlock: d.deployedAtBlock.toString(), note: "Summed from logs; no cumulative counter is implied." },
      pools: pools.map((p) => {
        const last = poolLast.find((x) => x.poolId === p.poolId);
        return {
          poolId: p.poolId,
          poolType: p.poolType,
          token0: { address: p.currency0, symbol: tok(p.currency0)?.symbol ?? null },
          token1: { address: p.currency1, symbol: tok(p.currency1)?.symbol ?? null },
          hooks: p.hooks === ZERO ? null : p.hooks,
          feeRaw: p.fee,
          swaps: last?._count._all ?? 0,
          lastSwapAt: iso(last?._max.blockTimestamp ?? null),
          byInputToken: poolSwaps.filter((s) => s.poolId === p.poolId).map((s) => {
            const f = (v: Prisma.Decimal | null) => this.units(toBigInt(v).toString(), tok(s.tokenIn)?.decimals);
            return { token: s.tokenIn, symbol: tok(s.tokenIn)?.symbol ?? null, swaps: s._count._all, volumeIn: f(s._sum.amountIn), feesTotal: f(s._sum.feeTotal), feesLp: f(s._sum.feeLp), feesProtocol: f(s._sum.feeProtocol), volumeInRaw: toBigInt(s._sum.amountIn).toString() };
          }),
          state: p.state ? { readAtBlock: p.state.readAtBlock.toString(), lpFeePips: p.state.lpFee, protocolFeePacked: p.state.protocolFee, readError: p.state.readError } : null,
          createdAt: { blockNumber: p.blockNumber.toString(), txHash: p.txHash },
        };
      }),
      volumeAllTime: volume.byToken,
      launches: { total: launches.total, items: launches.items },
      registry: {
        note: "Risk class is the one LatchRegistered recorded at registration (the hook's self-reported bitmap). Pool attestations are not indexed here, so a later LatchPermissionsUnderstated is not reflected. A listing is not an audit.",
        listings: [...registry.values()],
      },
      appRegistrations: apps.map((e) => ({ app: e.subject, blockNumber: e.blockNumber.toString(), txHash: e.txHash, note: "Vault.registerApp is irreversible." })),
    };
  }

  /* -------------------------------------------------------------------------
     Governance
     ------------------------------------------------------------------------- */

  async ownership(chainId: number) {
    const d = this.deployment(chainId);
    const [rows, inputs] = await Promise.all([this.prisma.ownershipSnapshot.findMany({ where: { chainId }, orderBy: [{ contractKey: "asc" }, { check: "asc" }] }), this.alertInputs(chainId)]);
    const alerts = computeAlerts({ ...inputs, pendingConfigs: [], opsBalances: [], feeds: [], stockTokens: [], reconciliationMismatches: [], pendingListings: 0, chains: [], timelockOps: [] });
    const contracts = new Map<string, { contractKey: string; address: string; expectedTier: string; expectedAddress: string | null; owner: unknown; pendingOwner: unknown; alert: unknown }>();
    for (const r of rows) {
      if (r.check !== "owner" && r.check !== "pendingOwner") continue;
      const c = contracts.get(r.contractKey) ?? { contractKey: r.contractKey, address: r.address, expectedTier: "", expectedAddress: null, owner: null, pendingOwner: null, alert: null };
      const cell = { observed: r.observed, expected: r.expectedAddress, expectedTier: r.expectedTier, matches: r.matches, readError: r.readError, readAtBlock: r.readAtBlock.toString(), readAt: iso(r.readAt) };
      if (r.check === "owner") {
        c.owner = cell;
        c.expectedTier = r.expectedTier;
        c.expectedAddress = r.expectedAddress;
      } else c.pendingOwner = cell;
      c.alert = alerts.find((a) => a.id.startsWith(`own:${chainId}:${r.contractKey}:`)) ?? null;
      contracts.set(r.contractKey, c);
    }
    return {
      chainId,
      source: "ownership_snapshots (worker governance pass, owner()/pendingOwner() read at a stated block)",
      addresses: { safe: d.governanceSafe, timelockCustody: d.timelockCustody, timelockPolicy: d.timelockPolicy },
      contracts: [...contracts.values()],
      otherChecks: rows.filter((r) => r.check !== "owner" && r.check !== "pendingOwner").map((r) => ({ contractKey: r.contractKey, address: r.address, check: r.check, observed: r.observed, expectedTier: r.expectedTier, expected: r.expectedAddress, matches: r.matches, readError: r.readError, readAtBlock: r.readAtBlock.toString(), readAt: iso(r.readAt) })),
      alerts: alerts.filter((a) => a.category === "governance"),
    };
  }

  private async operations(chainId: number) {
    const rows = await this.prisma.timelockEvent.findMany({ where: { chainId }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] });
    return groupTimelockOperations(rows.map(timelockRow));
  }

  async timelock(chainId: number) {
    const d = this.deployment(chainId);
    const { operations, delayChanges } = await this.operations(chainId);
    const handoverTargets = [
      ["vault", d.vault],
      ["clPoolManagerOwner", d.clPoolManagerOwner],
      ["binPoolManagerOwner", d.binPoolManagerOwner],
    ] as const;
    return {
      chainId,
      now: new Date().toISOString(),
      source: "timelock_events (CallScheduled, CallSalt, CallExecuted, Cancelled, MinDelayChange) on the SDK timelocks",
      timelocks: [
        { tier: "custody", address: d.timelockCustody },
        { tier: "policy", address: d.timelockPolicy },
      ],
      doNotQueue: ["renounceOwnership()", "updateDelay(uint256)"],
      custodyHandover: {
        note: "acceptOwnership() operations on the custody timelock, one per contract. The owner() read on the Ownership check is the proof, not these operations.",
        items: handoverTargets.map(([key, target]) => {
          const op = target ? queuedAcceptOwnership(operations, d.timelockCustody, target) : null;
          return { contractKey: key, target, operationId: op?.operationId ?? null, status: op?.status ?? "NOT_INDEXED", readyAt: op?.readyAt ?? null, saltIndexed: op?.salt !== null && op?.salt !== undefined };
        }),
      },
      operations,
      delayChanges,
    };
  }

  /**
   * execute(target, value, payload, predecessor, salt) for one queued single-call
   * operation, from indexed events. Refuses anything not READY (and anything
   * cancelled or done), and anything whose arguments do not re-hash to its id.
   */
  async executePayload(chainId: number, operationId: string, from: string): Promise<{ payload: ExecuteOperationPayload; operation: unknown }> {
    const d = this.deployment(chainId);
    const { operations } = await this.operations(chainId);
    const op = operations.find((o) => o.operationId.toLowerCase() === operationId.toLowerCase());
    if (!op) throw ApiError.notFound(`Timelock operation ${operationId} (not in indexed CallScheduled events)`);
    if (op.status === "CANCELLED") throw ApiError.conflict("Operation was cancelled; it can never execute");
    if (op.status === "EXECUTED") throw ApiError.conflict(`Operation already executed at block ${op.executedAt?.blockNumber}`);
    if (op.status !== "READY") throw ApiError.conflict(`Operation is not ready until ${op.readyAt}`);
    if (op.calls.length !== 1) throw ApiError.badRequest("Only single-call operations (schedule, not scheduleBatch) are supported by this builder");
    const call = op.calls[0]!;
    let salt = op.salt;
    let saltSource: ExecuteOperationPayload["saltSource"] = "indexed CallSalt event";
    if (!salt) {
      // OZ emits CallSalt only for a non-zero salt; try zero, then the CLAUDE.md record. Either must re-hash.
      const recorded = RECORDED_ACCEPT_OWNERSHIP_OPERATIONS.chainId === chainId ? RECORDED_ACCEPT_OWNERSHIP_OPERATIONS.operations.find((r) => r.id === op.operationId.toLowerCase()) : undefined;
      salt = recorded?.salt ?? `0x${"0".repeat(64)}`;
      saltSource = "CLAUDE.md record (verified by re-hash)";
    }
    const tierAddr = op.tier === "custody" ? d.timelockCustody : op.tier === "policy" ? d.timelockPolicy : op.timelock;
    try {
      const payload = prepareExecuteOperation({
        chainId,
        timelock: tierAddr,
        safe: d.governanceSafe,
        from,
        operationId: op.operationId,
        target: call.target,
        value: BigInt(call.value),
        data: call.data as `0x${string}`,
        predecessor: (op.predecessor ?? `0x${"0".repeat(64)}`) as `0x${string}`,
        salt: salt as `0x${string}`,
        saltSource,
        description: `${op.tier} timelock execute(${call.target}, ${call.value}, ${call.functionSignature ?? call.selector ?? "data"}, predecessor, salt)`,
      });
      return { payload, operation: op };
    } catch (e) {
      throw ApiError.conflict(e instanceof Error ? e.message : "could not build execute()");
    }
  }

  async roles(chainId: number) {
    const d = this.deployment(chainId);
    const cfg = chainConfig(chainId);
    const [events, checks] = await Promise.all([
      this.prisma.contractEvent.findMany({ where: { chainId, eventName: { in: ["RoleGranted", "RoleRevoked", "PausableRoleGranted", "PausableRoleRevoked"] } }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] }),
      this.prisma.ownershipSnapshot.findMany({ where: { chainId, NOT: { check: { in: ["owner", "pendingOwner"] } } } }),
    ]);
    const known = new Map<string, string>([
      [d.governanceSafe.toLowerCase(), "Governance Safe"],
      [d.timelockCustody.toLowerCase(), "Custody timelock (48 h)"],
      [d.timelockPolicy.toLowerCase(), "Policy timelock"],
      [ZERO, "address(0): anyone"],
      ...cfg.opsAccounts.map((a) => [a.address, a.label] as [string, string]),
    ]);
    const holders = new Map<string, { contractKey: string; contract: string; role: string; account: string; accountLabel: string | null; held: boolean; lastChange: { event: string; blockNumber: string; txHash: string } }>();
    for (const e of events) {
      const a = e.args as Record<string, string>;
      const role = e.eventName.startsWith("Pausable") ? "PAUSABLE_ROLE" : (ROLE_NAMES.get(String(a.role).toLowerCase()) ?? String(a.role));
      const account = String(a.account).toLowerCase();
      const k = `${e.contract}:${role}:${account}`;
      holders.set(k, { contractKey: e.contractKey, contract: e.contract, role, account, accountLabel: known.get(account) ?? null, held: e.eventName.endsWith("Granted"), lastChange: { event: e.eventName, blockNumber: e.blockNumber.toString(), txHash: e.txHash } });
    }
    return {
      chainId,
      source: "RoleGranted/RoleRevoked (registry, both timelocks) and PausableRoleGranted/Revoked (pool-manager owners) replayed from logs since the deployment block; guardian()/treasury()/hasRole() read by the governance pass.",
      holders: [...holders.values()].filter((h) => h.held),
      revoked: [...holders.values()].filter((h) => !h.held),
      currentReads: checks.map((r) => ({ contractKey: r.contractKey, address: r.address, check: r.check, observed: r.observed, observedLabel: r.observed ? (known.get(r.observed) ?? null) : null, expectedTier: r.expectedTier, matches: r.matches, readError: r.readError, readAtBlock: r.readAtBlock.toString(), readAt: iso(r.readAt) })),
      knownAccounts: [...known.entries()].map(([address, label]) => ({ address, label })),
    };
  }

  /* -------------------------------------------------------------------------
     Safety
     ------------------------------------------------------------------------- */

  async safety(chainId: number) {
    const cfg = chainConfig(chainId);
    const [pending, ops, feeds, stock, changes, cp] = await Promise.all([
      this.prisma.pendingConfigHazard.findMany({ where: { chainId }, orderBy: { status: "asc" } }),
      this.prisma.opsBalance.findMany({ where: { chainId } }),
      this.latestFeeds(chainId),
      this.latestStockObservations(chainId),
      this.prisma.stockTokenObservation.findMany({ where: { chainId, changed: true }, orderBy: { readAt: "desc" }, take: 50 }),
      this.prisma.indexerCheckpoint.findUnique({ where: { chainId } }),
    ]);
    const tokens = await this.tokenMap(chainId, [...stock.map((s) => s.token), ...changes.map((c) => c.token)]);
    const poolsByToken = await this.prisma.pool.findMany({ where: { chainId }, select: { poolId: true, currency0: true, currency1: true } });
    return {
      chainId,
      contractClock: cp?.contractBlockNumber ? { contractBlockNumber: cp.contractBlockNumber.toString(), method: cp.contractClockMethod, readAt: iso(cp.contractClockReadAt) } : null,
      pendingConfigs: {
        note: "Judged on the CONTRACT clock (Ethereum L1's block number on Robinhood), never eth_blockNumber. legacy = 0x23CE shape, no expiry; current = 0xfC00 shape with expiryBlock.",
        items: pending.map((p) => ({ hook: p.hook, poolId: p.poolId, shape: p.shape, status: p.status, effectiveContractBlock: p.effectiveContractBlock.toString(), expiryContractBlock: p.expiryContractBlock?.toString() ?? null, params: p.params, contractBlockNumber: p.contractBlockNumber.toString(), contractClockMethod: p.contractClockMethod, readAtBlock: p.readAtBlock.toString(), readAt: iso(p.readAt), readError: p.readError })),
      },
      opsBalances: {
        gasReference: cfg.gas ?? null,
        items: ops.map((b) => ({ label: b.label, address: b.address, purpose: b.purpose, balanceWei: b.balanceWei.toFixed(), balance: formatUnitsExact(toBigInt(b.balanceWei), 18), nativeSymbol: this.deployment(chainId).nativeCurrency.symbol, criticalWei: decStr(b.criticalWei), warnWei: decStr(b.minWei), gasPriceWei: decStr(b.gasPriceWei), gasPriceSource: b.gasPriceSource, actionsAffordable: decStr(b.actionsAffordable), severity: b.severity, rationale: b.rationale, readAtBlock: b.readAtBlock.toString(), readAt: iso(b.readAt) })),
      },
      feeds: feeds.map((f) => ({ label: f.label, proxy: f.proxy, description: f.description, answer: f.answer, decimals: f.decimals, feedUpdatedAt: iso(f.feedUpdatedAt), stalenessSeconds: f.stalenessSeconds, heartbeatSeconds: f.heartbeatSeconds, heartbeatViolation: f.heartbeatViolation, error: f.error, readAtBlock: f.readAtBlock.toString(), readAt: iso(f.readAt) })),
      stockTokens: {
        note: "Every token in an indexed pool that answers tokenPaused() or uiMultiplier(). tokenPaused() is the name from the PausableStockToken fixture; confirm against the live Stock implementation.",
        current: stock.map((s) => ({ token: s.token, symbol: tokens.get(s.token)?.symbol ?? null, tokenPaused: s.tokenPaused, uiMultiplier: s.uiMultiplier, pools: poolsByToken.filter((p) => p.currency0 === s.token || p.currency1 === s.token).map((p) => p.poolId), readAtBlock: s.readAtBlock.toString(), readAt: iso(s.readAt), readError: s.readError })),
        changes: changes.map((c) => ({ token: c.token, symbol: tokens.get(c.token)?.symbol ?? null, previousPaused: c.previousPaused, tokenPaused: c.tokenPaused, previousUiMultiplier: decStr(c.previousUiMultiplier), uiMultiplier: decStr(c.uiMultiplier), readAtBlock: c.readAtBlock.toString(), readAt: iso(c.readAt) })),
      },
    };
  }

  /* -------------------------------------------------------------------------
     Safe context
     ------------------------------------------------------------------------- */

  safeContext(chainId: number) {
    const d = this.deployment(chainId);
    const cfg = chainConfig(chainId);
    return {
      chainId,
      chainName: d.name,
      safe: d.governanceSafe,
      safeAppUrl: cfg.safeApp ? safeAppUrl(cfg.safeApp.shortName, d.governanceSafe) : null,
      safeAppSource: cfg.safeApp?.source ?? null,
      contracts: { vault: d.vault, clPoolManager: d.clPoolManager, binPoolManager: d.binPoolManager, clPoolManagerOwner: d.clPoolManagerOwner, binPoolManagerOwner: d.binPoolManagerOwner, feeController: d.feeController, registry: d.registry, timelockCustody: d.timelockCustody, timelockPolicy: d.timelockPolicy },
      note: "The panel prepares payloads and simulates them with eth_call. It never signs, never proposes to the Safe Transaction Service, and never sends.",
    };
  }
}

export interface RevenueQuery {
  token?: string;
  source?: RevenueSource;
  window?: AdminWindow;
  from?: Date;
  to?: Date;
  usd: boolean;
  limit: number;
  offset: number;
}

function timelockRow(r: Prisma.TimelockEventGetPayload<object>): TimelockEventRow {
  return {
    chainId: r.chainId,
    timelock: r.timelock,
    tier: r.tier,
    eventName: r.eventName,
    operationId: r.operationId,
    callIndex: r.callIndex,
    target: r.target,
    value: decStr(r.value),
    data: r.data,
    selector: r.selector,
    functionSignature: r.functionSignature,
    predecessor: r.predecessor,
    salt: r.salt,
    delaySeconds: r.delaySeconds?.toString() ?? null,
    hazard: r.hazard,
    hazardNote: r.hazardNote,
    blockNumber: r.blockNumber.toString(),
    blockTimestamp: r.blockTimestamp.toISOString(),
    txHash: r.txHash,
    logIndex: r.logIndex,
  };
}
