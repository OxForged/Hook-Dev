import { getDeployment } from "@latchprotocol/sdk";
import type { Prisma, PrismaClient } from "@prisma/client";
import { kitV2Addresses, type KitV2Addresses } from "../config/chainConfig.js";
import { ApiError } from "../lib/errors.js";
import { decStr } from "../lib/serialize.js";
import { formatUnitsExact, toBigInt } from "../lib/units.js";

/**
 * LaunchpadKitV2 + LatchLPLocker + LatchBinLPLocker reads. POSTGRES ONLY: every
 * figure is a log the indexer wrote (kit_v2_launches, kit_v2_launch_legs, lp_locks,
 * lp_fee_collections, fee_flows, contract_events). Token units only; no USD.
 *
 * "Not configured" (no kitV2 address for the chain) is an explicit answer, never an
 * empty list: an empty list would read as "no launches happened".
 *
 * CLOCKS. Kit v2 is timestamp-clocked. `startTime` and a launch fee's `effectiveAt`
 * are unix seconds and are compared only with a BLOCK TIMESTAMP (the last indexed
 * block's, stated beside the answer), never with any block number.
 */

export const NATIVE = "0x0000000000000000000000000000000000000000";
const iso = (unixSeconds: bigint) => new Date(Number(unixSeconds) * 1000).toISOString();

export type KitV2ConfigLookup = (chainId: number) => KitV2Addresses | null;

/* ---------------------------------------------------------------------------
   Launch fee state from events (pure)
   --------------------------------------------------------------------------- */

export interface LaunchFeeEventRow {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  blockTimestamp: Date;
  txHash: string;
  logIndex: number;
}

export interface LaunchFeeState {
  /** `_launchFeeWei` as the events leave it. null before the constructor's LaunchFeeChanged is indexed. */
  storedWei: string | null;
  pending: { feeWei: string; effectiveAt: string; effectiveAtIso: string; scheduledAt: { blockNumber: string; txHash: string } } | null;
  /**
   * What `launchFeeWei()` answers at `asOf`: the pending fee once `asOf >= effectiveAt`
   * (the increase applies BY ITSELF; the kit emits LaunchFeeChanged only when a later
   * owner call materialises it), otherwise the stored fee.
   */
  effectiveWei: string | null;
  /** "none" | "scheduled" (notice running) | "matured" (in force, not yet materialised by an event). */
  pendingStatus: "none" | "scheduled" | "matured";
  /** Unix seconds the answer is judged at: a block timestamp. */
  asOf: string;
  asOfIso: string;
  /** Events that disagree with the replayed state (a gap in indexing, or a different contract). Empty when consistent. */
  inconsistencies: string[];
  history: { event: string; args: Record<string, unknown>; blockNumber: string; blockTimestamp: string; txHash: string }[];
}

/**
 * Replays LaunchFeeIncreaseScheduled / LaunchFeeChanged / PendingLaunchFeeCancelled
 * in log order, mirroring LaunchpadKitV2:
 *   setLaunchFee(x <= current): [Changed(materialise)] [Cancelled] Changed(current, x)
 *   setLaunchFee(x >  current): [Changed(materialise)] Scheduled(current, x, now + notice)
 *   cancelPendingLaunchFee():   [Changed(materialise)] Cancelled
 * Every Changed leaves no pending increase; a Cancelled clears it; a Scheduled replaces it.
 */
export function deriveLaunchFeeState(events: readonly LaunchFeeEventRow[], asOfUnix: bigint): LaunchFeeState {
  let stored: bigint | null = null;
  let pending: { feeWei: bigint; effectiveAt: bigint; blockNumber: bigint; txHash: string } | null = null;
  const inconsistencies: string[] = [];
  const at = (e: LaunchFeeEventRow) => `block ${e.blockNumber} log ${e.logIndex}`;
  const b = (v: unknown) => BigInt(String(v));
  for (const e of events) {
    if (e.eventName === "LaunchFeeChanged") {
      const prev = b(e.args.previousWei);
      if (stored !== null && prev !== stored) inconsistencies.push(`${at(e)}: LaunchFeeChanged.previousWei ${prev} but the replayed fee was ${stored}`);
      if (pending) {
        // With an increase pending, the kit emits LaunchFeeChanged only to materialise it (newWei = the
        // pending fee, at or after effectiveAt) or after PendingLaunchFeeCancelled. Anything else is a gap.
        const materialises = b(e.args.newWei) === pending.feeWei && BigInt(Math.floor(e.blockTimestamp.getTime() / 1000)) >= pending.effectiveAt;
        if (!materialises) inconsistencies.push(`${at(e)}: LaunchFeeChanged while an increase to ${pending.feeWei} was pending, with no PendingLaunchFeeCancelled before it`);
      }
      stored = b(e.args.newWei);
      pending = null;
    } else if (e.eventName === "LaunchFeeIncreaseScheduled") {
      const cur = b(e.args.currentWei);
      if (stored !== null && cur !== stored) inconsistencies.push(`${at(e)}: LaunchFeeIncreaseScheduled.currentWei ${cur} but the replayed fee was ${stored}`);
      if (stored === null) stored = cur;
      pending = { feeWei: b(e.args.newWei), effectiveAt: b(e.args.effectiveAt), blockNumber: e.blockNumber, txHash: e.txHash };
    } else if (e.eventName === "PendingLaunchFeeCancelled") {
      if (!pending) inconsistencies.push(`${at(e)}: PendingLaunchFeeCancelled with no replayed pending increase`);
      else if (b(e.args.cancelledWei) !== pending.feeWei || b(e.args.effectiveAt) !== pending.effectiveAt) inconsistencies.push(`${at(e)}: cancelled ${e.args.cancelledWei}@${e.args.effectiveAt} but the replayed pending was ${pending.feeWei}@${pending.effectiveAt}`);
      pending = null;
    }
  }
  const matured = pending !== null && asOfUnix >= pending.effectiveAt;
  return {
    storedWei: stored?.toString() ?? null,
    pending: pending ? { feeWei: pending.feeWei.toString(), effectiveAt: pending.effectiveAt.toString(), effectiveAtIso: iso(pending.effectiveAt), scheduledAt: { blockNumber: pending.blockNumber.toString(), txHash: pending.txHash } } : null,
    effectiveWei: matured ? pending!.feeWei.toString() : (stored?.toString() ?? null),
    pendingStatus: pending === null ? "none" : matured ? "matured" : "scheduled",
    asOf: asOfUnix.toString(),
    asOfIso: iso(asOfUnix),
    inconsistencies,
    history: events.map((e) => ({ event: e.eventName, args: e.args, blockNumber: e.blockNumber.toString(), blockTimestamp: e.blockTimestamp.toISOString(), txHash: e.txHash })),
  };
}

export const LAUNCH_FEE_EVENTS = ["LaunchFeeIncreaseScheduled", "LaunchFeeChanged", "PendingLaunchFeeCancelled"] as const;

/* ---------------------------------------------------------------------------
   Read service
   --------------------------------------------------------------------------- */

type Launch = Prisma.KitV2LaunchGetPayload<object>;
type Leg = Prisma.KitV2LaunchLegGetPayload<object>;
type Lock = Prisma.LpLockGetPayload<object>;
type TokenMeta = { symbol: string | null; decimals: number | null };

export class KitV2ReadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: KitV2ConfigLookup = kitV2Addresses,
  ) {}

  /** The configured contracts, or a 404 that says so. */
  requireConfigured(chainId: number): KitV2Addresses & { kit: `0x${string}` } {
    const c = this.config(chainId);
    if (!c?.kit) throw ApiError.notFound(`LaunchpadKitV2 for chain ${chainId} (no kitV2.kit address in config/chains/${chainId}.json, so nothing is indexed; this is "not configured", not "no launches")`);
    return c as KitV2Addresses & { kit: `0x${string}` };
  }

  configured(chainId: number): KitV2Addresses | null {
    return this.config(chainId);
  }

  private async tokens(chainId: number, addresses: string[]): Promise<Map<string, TokenMeta>> {
    const d = getDeployment(chainId);
    const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
    const rows = uniq.length ? await this.prisma.token.findMany({ where: { chainId, address: { in: uniq } } }) : [];
    const map = new Map<string, TokenMeta>(rows.map((r) => [r.address, { symbol: r.symbol, decimals: r.decimals }]));
    // Native is the chain's own currency as the SDK records it, not a token read.
    if (d) map.set(NATIVE, { symbol: d.nativeCurrency.symbol, decimals: d.nativeCurrency.decimals });
    return map;
  }

  private amount(raw: Prisma.Decimal | bigint | string | null, token: string, tokens: Map<string, TokenMeta>) {
    if (raw === null) return null;
    const r = typeof raw === "string" ? BigInt(raw) : typeof raw === "bigint" ? raw : toBigInt(raw);
    const t = tokens.get(token.toLowerCase());
    return { token: token.toLowerCase(), symbol: t?.symbol ?? null, raw: r.toString(), units: t?.decimals != null ? formatUnitsExact(r, t.decimals) : null };
  }

  private async legsAndLocks(chainId: number, cfg: KitV2Addresses, launches: Launch[]) {
    const tokens = launches.map((l) => l.token);
    const legs = tokens.length ? await this.prisma.kitV2LaunchLeg.findMany({ where: { chainId, kit: cfg.kit ?? undefined, token: { in: tokens } }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] }) : [];
    const poolIds = [...new Set(legs.map((l) => l.poolId))];
    const locks = poolIds.length ? await this.prisma.lpLock.findMany({ where: { chainId, poolId: { in: poolIds } } }) : [];
    return { legs, locks };
  }

  /** The lock a leg names: same pool, same kind, same lock id, and (when configured) the configured locker of that kind. */
  private lockFor(cfg: KitV2Addresses, leg: Leg, locks: Lock[]): Lock | null {
    const locker = leg.kind === "CL" ? cfg.clLocker : cfg.binLocker;
    return locks.find((k) => k.poolId === leg.poolId && k.lockerKind === leg.kind && k.lockId.equals(leg.lockId) && (locker === null || k.locker === locker)) ?? null;
  }

  private splitView(k: Lock | null, lockerConfigured: boolean) {
    if (!k) {
      return {
        status: lockerConfigured ? ("not-indexed" as const) : ("locker-not-configured" as const),
        note: lockerConfigured ? "The kit recorded this lock id, but no lock event from the configured locker is indexed for it." : "This leg's locker has no address in config, so its lock events are not indexed.",
      };
    }
    return {
      status: "indexed" as const,
      locker: k.locker,
      lockerKind: k.lockerKind,
      lockId: k.lockId.toFixed(),
      frozenAtCreation: { creatorBps: k.creatorBps, integratorBps: k.integratorBps, protocolBps: k.protocolBps, integrator: k.integrator },
      creatorAtLock: k.creator,
      creatorNote: "The split and integrator never change. Only the creator can rotate (CreatorTransferred); this is the creator named at lock.",
      liquidityAtLock: decStr(k.liquidity),
      bins: k.lockerKind === "BIN" ? k.binIds.map((id, i) => ({ binId: id, shares: k.shares[i] ?? null, principal: k.principals[i] ?? null })) : null,
      lockedAt: { blockNumber: k.blockNumber, blockTimestamp: k.blockTimestamp, txHash: k.txHash },
    };
  }

  private launchView(chainId: number, cfg: KitV2Addresses, l: Launch, legs: Leg[], locks: Lock[], tokens: Map<string, TokenMeta>) {
    const start = l.startTime;
    return {
      kit: l.kit,
      token: l.token,
      launchToken: tokens.get(l.token) ?? { symbol: null, decimals: null },
      creator: l.creator,
      tenant: l.tenant === NATIVE ? null : l.tenant,
      launcher: l.launcher,
      operator: l.operator,
      totalSupply: this.amount(l.totalSupply, l.token, tokens),
      seedSupply: this.amount(l.seedSupply, l.token, tokens),
      legCount: l.legCount,
      schedule: {
        clock: "block.timestamp (Kit v2 is timestamp-clocked; startTime is unix seconds, never a block number)",
        startTime: start.toString(),
        startTimeIso: iso(start),
        note: "startTime as written at creation. LaunchReconfigured events (history) may have moved it before trading opened.",
      },
      launchFees: {
        frozenAtCreation: true,
        protocol: this.amount(l.protocolFeeWei, NATIVE, tokens),
        integrator: l.integrator === NATIVE ? null : l.integrator,
        integratorFee: this.amount(l.integratorFeeWei, NATIVE, tokens),
      },
      legs: legs
        .filter((g) => g.token === l.token)
        .map((g) => {
          const locker = g.kind === "CL" ? cfg.clLocker : cfg.binLocker;
          return {
            poolId: g.poolId,
            kind: g.kind,
            quote: { address: g.quote, ...(tokens.get(g.quote) ?? { symbol: null, decimals: null }) },
            weightBps: g.weightBps,
            lockId: g.lockId.toFixed(),
            launchTokenSeeded: this.amount(g.launchTokenSeeded, l.token, tokens),
            lock: this.splitView(this.lockFor(cfg, g, locks), locker !== null),
          };
        }),
      createdAt: { blockNumber: l.blockNumber, blockTimestamp: l.blockTimestamp, txHash: l.txHash },
    };
  }

  async launches(chainId: number, q: { limit: number; offset: number; creator?: string; tenant?: string }) {
    const cfg = this.requireConfigured(chainId);
    const where: Prisma.KitV2LaunchWhereInput = { chainId, kit: cfg.kit, ...(q.creator ? { creator: q.creator } : {}), ...(q.tenant ? { tenant: q.tenant } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.kitV2Launch.findMany({ where, orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }], take: q.limit, skip: q.offset }),
      this.prisma.kitV2Launch.count({ where }),
    ]);
    const { legs, locks } = await this.legsAndLocks(chainId, cfg, rows);
    const tokens = await this.tokens(chainId, [...rows.map((r) => r.token), ...legs.map((g) => g.quote)]);
    return { kit: cfg.kit, total, limit: q.limit, offset: q.offset, items: rows.map((l) => this.launchView(chainId, cfg, l, legs, locks, tokens)) };
  }

  private async detail(chainId: number, cfg: KitV2Addresses & { kit: string }, l: Launch) {
    const { legs, locks } = await this.legsAndLocks(chainId, cfg, [l]);
    const tokens = await this.tokens(chainId, [l.token, ...legs.map((g) => g.quote)]);
    const history = await this.prisma.contractEvent.findMany({
      where: { chainId, contractKey: "launchpadKitV2", contract: cfg.kit, subject: l.token, eventName: "LaunchReconfigured" },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: 200,
    });
    return {
      ...this.launchView(chainId, cfg, l, legs, locks, tokens),
      reconfigurations: history.map((e) => ({ args: e.args, blockNumber: e.blockNumber, blockTimestamp: e.blockTimestamp, txHash: e.txHash })),
    };
  }

  async launchByToken(chainId: number, token: string) {
    const cfg = this.requireConfigured(chainId);
    const l = await this.prisma.kitV2Launch.findFirst({ where: { chainId, kit: cfg.kit, token } });
    if (!l) throw ApiError.notFound(`Kit v2 launch of token ${token}`);
    return this.detail(chainId, cfg, l);
  }

  async launchByPool(chainId: number, poolId: string) {
    const cfg = this.requireConfigured(chainId);
    const leg = await this.prisma.kitV2LaunchLeg.findFirst({ where: { chainId, kit: cfg.kit, poolId } });
    if (!leg) throw ApiError.notFound(`Kit v2 launch leg for pool ${poolId}`);
    const l = await this.prisma.kitV2Launch.findFirst({ where: { chainId, kit: cfg.kit, token: leg.token } });
    if (!l) throw ApiError.notFound(`Kit v2 launch of token ${leg.token} (its leg is indexed, its LaunchCreated is not)`);
    return { matchedPoolId: poolId, ...(await this.detail(chainId, cfg, l)) };
  }

  /**
   * Per leg: the split frozen at lock, and every FeesCollected on that lock summed per
   * currency. creator + integrator + protocol == collected exactly (the protocol takes
   * rounding dust), which this checks row by row.
   */
  async launchFees(chainId: number, token: string) {
    const cfg = this.requireConfigured(chainId);
    const l = await this.prisma.kitV2Launch.findFirst({ where: { chainId, kit: cfg.kit, token } });
    if (!l) throw ApiError.notFound(`Kit v2 launch of token ${token}`);
    const { legs, locks } = await this.legsAndLocks(chainId, cfg, [l]);
    const pairs = legs.map((g) => ({ g, k: this.lockFor(cfg, g, locks) }));
    const lockers = [...new Set(pairs.flatMap((p) => (p.k ? [p.k.locker] : [])))];
    const collections = lockers.length ? await this.prisma.lpFeeCollection.findMany({ where: { chainId, locker: { in: lockers } }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] }) : [];
    const tokens = await this.tokens(chainId, [l.token, ...legs.map((g) => g.quote), ...collections.map((c) => c.currency)]);
    return {
      token: l.token,
      kit: l.kit,
      launchFees: { protocol: this.amount(l.protocolFeeWei, NATIVE, tokens), integrator: this.amount(l.integratorFeeWei, NATIVE, tokens), integratorAddress: l.integrator === NATIVE ? null : l.integrator, frozenAtCreation: true },
      legs: pairs.map(({ g, k }) => {
        const mine = k ? collections.filter((c) => c.locker === k.locker && c.lockId.equals(k.lockId)) : [];
        const byCurrency = new Map<string, { collections: number; amount: bigint; creator: bigint; integrator: bigint; protocol: bigint; unbalanced: number }>();
        for (const c of mine) {
          const e = byCurrency.get(c.currency) ?? { collections: 0, amount: 0n, creator: 0n, integrator: 0n, protocol: 0n, unbalanced: 0 };
          const [a, cr, ig, pr] = [toBigInt(c.amount), toBigInt(c.creatorShare), toBigInt(c.integratorShare), toBigInt(c.protocolShare)];
          e.collections += 1;
          e.amount += a;
          e.creator += cr;
          e.integrator += ig;
          e.protocol += pr;
          if (cr + ig + pr !== a) e.unbalanced += 1;
          byCurrency.set(c.currency, e);
        }
        return {
          poolId: g.poolId,
          kind: g.kind,
          lockId: g.lockId.toFixed(),
          lock: this.splitView(k, (g.kind === "CL" ? cfg.clLocker : cfg.binLocker) !== null),
          collected: [...byCurrency.entries()].map(([currency, e]) => ({
            currency,
            symbol: tokens.get(currency)?.symbol ?? null,
            collections: e.collections,
            total: this.amount(e.amount, currency, tokens),
            creator: this.amount(e.creator, currency, tokens),
            integrator: this.amount(e.integrator, currency, tokens),
            protocol: this.amount(e.protocol, currency, tokens),
            sharesSumToTotal: e.unbalanced === 0,
          })),
        };
      }),
      definitions: {
        collected: "Sum of the locker's FeesCollected for this lock, per currency. Collection is permissionless; fees still inside a position (CL) or a bin (Bin) are not counted until someone collects.",
        claims: "Claims are per account and currency across every lock of a locker (Claimed does not name a lock), so they are not attributed to a launch here.",
      },
    };
  }
}
