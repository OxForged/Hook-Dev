import { getDeployment, revShareHookRecord, type LatchDeployment } from "@latchprotocol/sdk";
import type { PrismaClient } from "@prisma/client";
import { getAddress, type Address, type Hex } from "viem";
import { chainConfig, type TreasuryConversionConfig } from "../../config/chainConfig.js";
import { ApiError } from "../../lib/errors.js";
import { formatUnitsExact, toBigInt } from "../../lib/units.js";
import type { ReadService } from "../../services/read.js";
import { safeAppUrl } from "../safeTx.js";
import { buildConversionSafeTx } from "./batch.js";
import { shortErr, TreasuryReader, type ChainHead, type TreasuryClient } from "./chain.js";
import { enumerateRoutes, judgeHook, minOutFor, NATIVE, priceImpact, type HookFacts, type HookVerdict, type PoolRow, type RouteCandidate } from "./route.js";

/**
 * Treasury conversion (CLAUDE.md "Treasury conversion, owner decision 2026-09-14").
 *
 *   view     Safe balances of ALLOWLISTED tokens (chain), ledger inflows (Postgres),
 *            optional Chainlink USD (worker feed reads), target native ETH.
 *   route    Latch CL pools only -> candidates -> hook policy -> CLQuoter quote ->
 *            price impact vs mid -> the best acceptable route, or an honest state.
 *   payload  the Safe MultiSendCallOnly batch for a fresh quote, simulated. Returned,
 *            never sent. There is no code path here that signs, proposes or sends.
 */

const iso = (unixSeconds: bigint) => new Date(Number(unixSeconds) * 1000).toISOString();
const lc = (a: string) => a.toLowerCase() as Address;

export type RouteStatus = "route" | "no-route" | "no-acceptable-route" | "unavailable";

export interface CandidateView {
  routeId: Hex;
  end: "native" | "weth";
  hops: { poolId: Hex; currencyIn: Address; currencyOut: Address; zeroForOne: boolean; hooks: Address | null; fee: number; hook: HookVerdict; slot0: { sqrtPriceX96: string; tick: number; protocolFee: number; lpFee: number } | { error: string } | null }[];
  quote: { amountOut: string; gasEstimate: string } | null;
  impact: { midOut: string; feeAdjustedMidOut: string; priceImpactBps: number; totalCostBps: number; swapFeesPips: number[] } | null;
  refusals: string[];
}

export interface RouteView {
  chainId: number;
  token: Address;
  symbol: string;
  decimals: number;
  status: RouteStatus;
  message: string;
  amountIn: string;
  amountInUnits: string;
  amountSource: "requested" | "safe-balance" | "probe-one-token";
  safeBalance: string | null;
  readAtBlock: string | null;
  quotedAt: string | null;
  contractClock: { contractBlockNumber: string; method: string } | null;
  consideredPools: number;
  best: (CandidateView & { minOut: string; minOutUnits: string; blockers: string[] }) | null;
  candidates: CandidateView[];
  policy: { maxPriceImpactBps: number; slippageBps: number; minValueWei: string; deadlineSeconds: number; maxQuoteAgeSeconds: number };
  venue: string;
}

export class TreasuryService {
  private readonly readers = new Map<number, TreasuryReader>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly read: ReadService,
    private readonly client: ((chainId: number) => TreasuryClient | null) | null,
  ) {}

  configFor(chainId: number): { d: LatchDeployment; cfg: TreasuryConversionConfig } | null {
    const d = getDeployment(chainId);
    if (!d) throw ApiError.validation(`chain ${chainId} is not in the Latch address book`);
    const cfg = chainConfig(chainId).treasuryConversion;
    return cfg ? { d, cfg } : null;
  }

  private reader(chainId: number): TreasuryReader | null {
    const hit = this.readers.get(chainId);
    if (hit) return hit;
    const c = this.client?.(chainId) ?? null;
    if (!c) return null;
    const r = new TreasuryReader(c, chainId);
    this.readers.set(chainId, r);
    return r;
  }

  private allowlisted(cfg: TreasuryConversionConfig, token: string) {
    const found = cfg.allowlist.find((a) => a.token === lc(token));
    const entry = found ? { ...found, token: lc(found.token) } : null;
    if (!entry) throw ApiError.badRequest(`${token} is not on the treasury conversion allowlist for this chain. The allowlist is config (config/chains/<chainId>.json), changed only by a reviewed commit.`);
    return entry;
  }

  /* -------------------------------------------------------------------------
     View
     ------------------------------------------------------------------------- */

  async view(chainId: number, usd: boolean) {
    const conf = this.configFor(chainId);
    if (!conf) return { chainId, configured: false as const, message: `No treasuryConversion block in config/chains/${chainId}.json: nothing on this chain is offered for conversion.` };
    const { d, cfg } = conf;
    const reader = this.reader(chainId);
    const tokens = cfg.allowlist.map((a) => a.token);
    const [ledger, cp, tokenRows] = await Promise.all([
      tokens.length ? this.prisma.revenueLedgerEntry.groupBy({ by: ["token", "source"], where: { chainId, token: { in: tokens } }, _sum: { amount: true }, _count: { _all: true } }) : Promise.resolve([]),
      this.prisma.indexerCheckpoint.findUnique({ where: { chainId } }),
      tokens.length ? this.prisma.token.findMany({ where: { chainId, address: { in: tokens } } }) : Promise.resolve([]),
    ]);

    let head: ChainHead | null = null;
    let headError: string | null = reader ? null : "chain reads are disabled on this API process (ADMIN_SIMULATION_ENABLED=false)";
    if (reader) {
      try {
        head = await reader.head();
      } catch (e) {
        headError = `chain unreachable: ${shortErr(e)}`;
      }
    }
    let native: { wei: string; units: string } | null = null;
    let nativeError: string | null = headError;
    if (reader && head) {
      try {
        const wei = await reader.nativeBalance(d.governanceSafe, head.blockNumber);
        native = { wei: wei.toString(), units: formatUnitsExact(wei, d.nativeCurrency.decimals) };
      } catch (e) {
        nativeError = shortErr(e);
      }
    }

    const items = [];
    for (const a of cfg.allowlist) {
      let balance: { raw: string; units: string; onChainSymbol: string | null; onChainDecimals: number; mismatch: string | null } | null = null;
      let balanceError: string | null = headError;
      if (reader && head) {
        try {
          const t = await reader.tokenState(lc(a.token), d.governanceSafe, head.blockNumber);
          const mismatch = t.decimals !== a.decimals ? `decimals() reads ${t.decimals}, config says ${a.decimals}: conversion refused until the config is corrected` : t.symbol !== null && t.symbol !== a.symbol ? `symbol() reads ${t.symbol}, config says ${a.symbol}` : null;
          balance = { raw: t.balance.toString(), units: formatUnitsExact(t.balance, t.decimals), onChainSymbol: t.symbol, onChainDecimals: t.decimals, mismatch };
          balanceError = null;
        } catch (e) {
          balanceError = shortErr(e);
        }
      }
      const rows = ledger.filter((l) => l.token === a.token);
      const inflowRaw = rows.reduce((s, r) => s + toBigInt(r._sum.amount), 0n);
      let usdView: unknown = null;
      if (usd && balance) {
        const row = tokenRows.find((t) => t.address === a.token);
        const r = await this.read.usdFor(chainId, { address: a.token, uiMultiplier: row?.uiMultiplier ?? null, decimals: a.decimals });
        usdView = r.price
          ? { usdPerToken: r.price.usdPerToken, source: r.price.source, feed: r.price.feed.label, feedUpdatedAt: r.price.feedUpdatedAt, readAt: r.price.readAt, uiMultiplier: r.price.uiMultiplier, method: `${r.price.method}; the current feed value of the current balance only` }
          : { usdPerToken: null, reason: r.reason };
      }
      items.push({
        token: lc(a.token),
        symbol: a.symbol,
        decimals: a.decimals,
        rationale: a.rationale,
        alertBalanceRaw: a.alertBalanceRaw ?? null,
        balance,
        balanceError,
        inflows: {
          raw: inflowRaw.toString(),
          units: formatUnitsExact(inflowRaw, a.decimals),
          entries: rows.reduce((s, r) => s + r._count._all, 0),
          bySource: rows.map((r) => ({ source: r.source, raw: toBigInt(r._sum.amount).toString(), entries: r._count._all })),
        },
        usd: usdView,
      });
    }

    return {
      chainId,
      configured: true as const,
      safe: d.governanceSafe,
      safeAppUrl: chainConfig(chainId).safeApp ? safeAppUrl(chainConfig(chainId).safeApp!.shortName, d.governanceSafe) : null,
      target: { currency: NATIVE, symbol: d.nativeCurrency.symbol, name: d.nativeCurrency.name, balance: native, balanceError: nativeError },
      policy: this.policy(cfg),
      venue: "Latch pools only: the SDK's CLPoolManager, quoted by the SDK's CLQuoter, executed by the SDK's UniversalRouter. No other venue is ever considered.",
      readAtBlock: head?.blockNumber.toString() ?? null,
      readAt: head ? iso(head.timestamp) : null,
      inflowsProvenance: cp ? `revenue_ledger, logs from block ${d.deployedAtBlock} to ${cp.lastIndexedBlock} (summed; no cumulative counter implied)` : "revenue_ledger: this chain has not been indexed, so inflows are unmeasured, not zero",
      indexed: cp !== null,
      allowlistNote: "The allowlist is config (config/chains/<chainId>.json), changed by a reviewed commit. It is never written over HTTP. Launch-token and memecoin revenue is held, never sold.",
      tokens: items,
    };
  }

  private policy(cfg: TreasuryConversionConfig) {
    return { maxPriceImpactBps: cfg.maxPriceImpactBps, slippageBps: cfg.slippageBps, minValueWei: cfg.minValueWei, deadlineSeconds: cfg.deadlineSeconds, maxQuoteAgeSeconds: cfg.maxQuoteAgeSeconds };
  }

  /* -------------------------------------------------------------------------
     Route
     ------------------------------------------------------------------------- */

  async route(chainId: number, token: string, requestedAmount: bigint | null): Promise<RouteView & { _internal?: { route: RouteCandidate; head: ChainHead; amountIn: bigint; minOut: bigint } }> {
    const conf = this.configFor(chainId);
    if (!conf) throw ApiError.notFound(`Treasury conversion config for chain ${chainId}`);
    const { d, cfg } = conf;
    const entry = this.allowlisted(cfg, token);
    const base = {
      chainId,
      token: entry.token,
      symbol: entry.symbol,
      decimals: entry.decimals,
      policy: this.policy(cfg),
      venue: `Latch CLPoolManager ${d.clPoolManager} only; CLQuoter ${d.clQuoter}`,
    };
    const reader = this.reader(chainId);
    const unavailable = (message: string): RouteView => ({ ...base, status: "unavailable", message, amountIn: requestedAmount?.toString() ?? "0", amountInUnits: formatUnitsExact(requestedAmount ?? 0n, entry.decimals), amountSource: "requested", safeBalance: null, readAtBlock: null, quotedAt: null, contractClock: null, consideredPools: 0, best: null, candidates: [] });
    if (!reader) return unavailable("chain reads are disabled on this API process (ADMIN_SIMULATION_ENABLED=false); no route can be quoted");

    let head: ChainHead;
    let tokenState: Awaited<ReturnType<TreasuryReader["tokenState"]>>;
    try {
      head = await reader.head();
      tokenState = await reader.tokenState(entry.token, d.governanceSafe, head.blockNumber);
    } catch (e) {
      return unavailable(`chain unreachable: ${shortErr(e)}`);
    }
    if (tokenState.decimals !== entry.decimals) return unavailable(`decimals() reads ${tokenState.decimals} but config says ${entry.decimals}; refusing to quote until config/chains/${chainId}.json is corrected`);

    const amountSource: RouteView["amountSource"] = requestedAmount !== null ? "requested" : tokenState.balance > 0n ? "safe-balance" : "probe-one-token";
    const amountIn = requestedAmount ?? (tokenState.balance > 0n ? tokenState.balance : 10n ** BigInt(entry.decimals));
    if (amountIn <= 0n) throw ApiError.badRequest("amount must be greater than zero");

    const pools = (await this.prisma.pool.findMany({ where: { chainId, poolType: "CL" } })) as unknown as PoolRow[];
    const { candidates, consideredPools } = enumerateRoutes({ pools, token: entry.token, weth: d.weth, latchClPoolManager: d.clPoolManager });
    const common = { ...base, amountIn: amountIn.toString(), amountInUnits: formatUnitsExact(amountIn, entry.decimals), amountSource, safeBalance: tokenState.balance.toString(), readAtBlock: head.blockNumber.toString(), quotedAt: iso(head.timestamp), contractClock: { contractBlockNumber: head.contractBlockNumber.toString(), method: head.contractClockMethod }, consideredPools };
    if (candidates.length === 0) {
      return { ...common, status: "no-route", message: `No Latch route from ${entry.symbol} to ${d.nativeCurrency.symbol}: none of the ${consideredPools} indexed Latch CL pool(s) connects ${entry.symbol} to native ${d.nativeCurrency.symbol} or WETH, directly or through one intermediate Latch pool. Nothing else is tried.`, best: null, candidates: [] };
    }

    const own = new Map<string, string>();
    for (const h of d.revShareHooks) own.set(lc(h.address), `Latch RevShareHook (${h.status}) in the SDK address book`);
    if (d.launchGuardHook) own.set(lc(d.launchGuardHook), "Latch LaunchGuardHook in the SDK address book");

    const hookCache = new Map<string, HookVerdict>();
    const views: (CandidateView & { amountOutBig: bigint | null })[] = [];
    for (const c of candidates) {
      const refusals: string[] = [];
      const hops: CandidateView["hops"] = [];
      const states = [];
      for (const h of c.hops) {
        const hook = h.key.hooks === NATIVE ? null : h.key.hooks;
        let verdict: HookVerdict;
        const ck = `${hook}:${h.poolId}`;
        if (hookCache.has(ck)) verdict = hookCache.get(ck)!;
        else {
          let facts: HookFacts | null = null;
          if (hook) {
            const record = revShareHookRecord(chainId, hook);
            facts = {
              hook,
              ownHook: own.get(hook) ?? null,
              registry: await reader.registryFacts(d.registry, hook, head.blockNumber),
              pending: record ? await reader.pendingFacts(record, h.poolId, head, cfg.deadlineSeconds) : await reader.probePendingFacts(hook, h.poolId, head, cfg.deadlineSeconds),
            };
          }
          verdict = judgeHook(facts);
          hookCache.set(ck, verdict);
        }
        if (!verdict.ok) refusals.push(`pool ${h.poolId.slice(0, 10)}…: ${verdict.reason}`);
        let slot0: CandidateView["hops"][number]["slot0"] = null;
        try {
          const s = await reader.slot0(d.clPoolManager, h.poolId, head.blockNumber);
          slot0 = { sqrtPriceX96: s.sqrtPriceX96.toString(), tick: s.tick, protocolFee: s.protocolFee, lpFee: s.lpFee };
          states.push(s);
          if (s.sqrtPriceX96 === 0n) refusals.push(`pool ${h.poolId.slice(0, 10)}… is not initialized`);
        } catch (e) {
          slot0 = { error: shortErr(e) };
          refusals.push(`pool ${h.poolId.slice(0, 10)}…: getSlot0 failed (${shortErr(e)})`);
        }
        hops.push({ poolId: h.poolId, currencyIn: h.currencyIn, currencyOut: h.currencyOut, zeroForOne: h.zeroForOne, hooks: hook, fee: h.key.fee, hook: verdict, slot0 });
      }
      let quote: CandidateView["quote"] = null;
      let amountOutBig: bigint | null = null;
      let impact: CandidateView["impact"] = null;
      // A refused pool is never quoted: the quoter would run its hook.
      if (refusals.length === 0) {
        const q = await reader.quote(d.clQuoter, c, amountIn, head.blockNumber);
        if (q.status === "ok") {
          quote = { amountOut: q.amountOut.toString(), gasEstimate: q.gasEstimate.toString() };
          amountOutBig = q.amountOut;
          try {
            const im = priceImpact(amountIn, c.hops, states, q.amountOut);
            impact = { midOut: im.midOut.toString(), feeAdjustedMidOut: im.feeAdjustedMidOut.toString(), priceImpactBps: im.priceImpactBps, totalCostBps: im.totalCostBps, swapFeesPips: im.swapFeesPips };
          } catch (e) {
            refusals.push(`price impact cannot be measured: ${shortErr(e)}`);
          }
        } else refusals.push(q.status === "reverted" ? `CLQuoter reverted: ${q.reason}` : `CLQuoter unreachable: ${q.error}`);
      }
      views.push({ routeId: c.id, end: c.end, hops, quote, impact, refusals, amountOutBig });
    }

    const acceptable = views.filter((v) => v.refusals.length === 0 && v.amountOutBig !== null).sort((a, b) => (b.amountOutBig! > a.amountOutBig! ? 1 : b.amountOutBig! < a.amountOutBig! ? -1 : 0));
    const strip = ({ amountOutBig: _drop, ...rest }: (typeof views)[number]) => rest;
    if (acceptable.length === 0) {
      return { ...common, status: "no-acceptable-route", message: `${candidates.length} Latch route(s) from ${entry.symbol} to ${d.nativeCurrency.symbol} exist, and every one was refused. The reasons are listed per route.`, best: null, candidates: views.map(strip) };
    }
    const top = acceptable[0]!;
    const minOut = minOutFor(top.amountOutBig!, cfg.slippageBps);
    const blockers: string[] = [];
    if (top.impact && top.impact.priceImpactBps > cfg.maxPriceImpactBps) blockers.push(`price impact ${top.impact.priceImpactBps} bps exceeds maxPriceImpactBps ${cfg.maxPriceImpactBps}`);
    if (amountIn > tokenState.balance) blockers.push(`amount ${amountIn} exceeds the Safe's ${entry.symbol} balance ${tokenState.balance}`);
    if (minOut < BigInt(cfg.minValueWei)) blockers.push(`guaranteed output (min-out) ${minOut} wei is below minValueWei ${cfg.minValueWei}`);
    const route = candidates.find((c) => c.id === top.routeId)!;
    return {
      ...common,
      status: "route",
      message: blockers.length ? `A Latch route exists, but converting this amount is refused: ${blockers.join("; ")}.` : `Latch route found through ${route.hops.length} pool(s).`,
      best: { ...strip(top), minOut: minOut.toString(), minOutUnits: formatUnitsExact(minOut, 18), blockers },
      candidates: views.map(strip),
      _internal: { route, head, amountIn, minOut },
    };
  }

  /* -------------------------------------------------------------------------
     Payload
     ------------------------------------------------------------------------- */

  async preparePayload(chainId: number, b: { token: string; amount: bigint; routeId: string; quotedAt: string }) {
    const conf = this.configFor(chainId);
    if (!conf) throw ApiError.notFound(`Treasury conversion config for chain ${chainId}`);
    const { d, cfg } = conf;
    const entry = this.allowlisted(cfg, b.token);
    const nowMs = Date.now();
    const reviewedAt = new Date(b.quotedAt).getTime();
    if (!Number.isFinite(reviewedAt)) throw ApiError.badRequest("quotedAt must be the ISO time of the route you reviewed");
    if (nowMs - reviewedAt > cfg.maxQuoteAgeSeconds * 1000) throw ApiError.conflict(`The route you reviewed was quoted at ${b.quotedAt}, more than ${cfg.maxQuoteAgeSeconds}s ago: it is stale. Re-quote and review it again.`);

    const r = await this.route(chainId, entry.token, b.amount);
    if (r.status === "unavailable") throw ApiError.unavailable(r.message);
    if (r.status !== "route" || !r.best || !r._internal) throw ApiError.conflict(r.message);
    const { route, head, amountIn, minOut } = r._internal;
    const headAge = nowMs / 1000 - Number(head.timestamp);
    if (headAge > cfg.maxQuoteAgeSeconds) throw ApiError.conflict(`The chain head this API read is ${Math.round(headAge)}s old (block ${head.blockNumber}); a quote on stale state is refused. Try again when the RPC is current.`);
    if (r.best.routeId.toLowerCase() !== b.routeId.toLowerCase()) throw ApiError.conflict(`The best acceptable Latch route changed since you reviewed it (now ${r.best.routeId}). Review the new route before preparing a payload.`);
    if (r.best.blockers.length) throw ApiError.conflict(`Conversion refused: ${r.best.blockers.join("; ")}.`);

    const reader = this.reader(chainId)!;
    const msc = getAddress(cfg.multiSendCallOnly.address);
    const hash = await reader.codeHash(msc, head.blockNumber).catch((e: unknown) => {
      throw ApiError.unavailable(`could not read MultiSendCallOnly code: ${shortErr(e)}`);
    });
    if (hash !== cfg.multiSendCallOnly.codeHash) throw ApiError.conflict(`MultiSendCallOnly at ${msc} has code hash ${hash ?? "none (no code)"}, not the verified ${cfg.multiSendCallOnly.codeHash}. Refusing to build a DELEGATECALL to it.`);

    const { tx, deadline } = buildConversionSafeTx({
      chainId,
      safe: d.governanceSafe,
      token: getAddress(entry.token),
      tokenSymbol: entry.symbol,
      amountIn,
      minOut,
      route,
      permit2: d.permit2,
      universalRouter: d.universalRouter,
      weth: d.weth,
      multiSendCallOnly: msc,
      nowSeconds: head.timestamp,
      deadlineSeconds: cfg.deadlineSeconds,
    });

    const existing = await reader.allowance(entry.token, d.governanceSafe, d.permit2, head.blockNumber).catch(() => null);
    if (existing !== null && existing > 0n) tx.warnings.push(`The Safe already allows Permit2 ${existing} raw ${entry.symbol}; approve() below REPLACES it with exactly ${amountIn}. Tokens that refuse a non-zero to non-zero approve will make the simulation revert.`);
    for (const h of r.best.hops) if (h.hook.ok) tx.warnings.push(...h.hook.warnings);

    const simulation = await reader.simulateBatch({ safe: d.governanceSafe, multiSend: msc, data: tx.data, minOut, blockNumber: head.blockNumber });
    if (simulation.status === "reverted") tx.warnings.unshift("SIMULATION REVERTED against current state. Do not sign this batch.");
    if (simulation.status === "success" && simulation.meetsMinOut === false) tx.warnings.unshift("Simulated native received is below min-out, yet the batch did not revert. Do not sign; report this.");

    const cc = chainConfig(chainId);
    const { _internal: _drop, ...routeView } = r;
    return {
      payload: tx,
      route: routeView,
      quote: { amountIn: amountIn.toString(), amountOut: r.best.quote!.amountOut, minOut: minOut.toString(), minOutUnits: r.best.minOutUnits, slippageBps: cfg.slippageBps, priceImpactBps: r.best.impact!.priceImpactBps, totalCostBps: r.best.impact!.totalCostBps, readAtBlock: head.blockNumber.toString(), quotedAt: iso(head.timestamp), deadline: deadline.toString(), deadlineAt: iso(deadline) },
      simulation,
      multiSendCallOnly: { address: msc, version: cfg.multiSendCallOnly.version, codeHash: hash, verifiedAtBlock: head.blockNumber.toString() },
      safeAppUrl: cc.safeApp ? safeAppUrl(cc.safeApp.shortName, d.governanceSafe) : null,
      note: "Prepared, not sent. Paste into the Safe app's transaction builder (or import the raw to/data/operation) and have two of three owners review the decoded calls and the simulation before signing.",
    };
  }

  /* -------------------------------------------------------------------------
     Alerts input
     ------------------------------------------------------------------------- */

  async alertRows(chainId: number): Promise<TreasuryAlertRow[]> {
    const conf = this.configFor(chainId);
    if (!conf || !this.reader(chainId)) return [];
    const out: TreasuryAlertRow[] = [];
    for (const a of conf.cfg.allowlist) {
      if (!a.alertBalanceRaw) continue;
      try {
        const r = await this.route(chainId, a.token, null);
        const balance = r.safeBalance ? BigInt(r.safeBalance) : 0n;
        if (balance <= BigInt(a.alertBalanceRaw)) continue;
        out.push({ chainId, token: a.token, symbol: a.symbol, balanceRaw: balance.toString(), balanceUnits: formatUnitsExact(balance, a.decimals), thresholdRaw: a.alertBalanceRaw, routeStatus: r.status, blockers: r.best?.blockers ?? [], minOutWei: r.best?.minOut ?? null, readAtBlock: r.readAtBlock, readAt: r.quotedAt });
      } catch {
        // An unreadable token produces no "conversion available" alert: that alert
        // may only ever be raised on a route that was actually read.
      }
    }
    return out;
  }
}

export interface TreasuryAlertRow {
  chainId: number;
  token: string;
  symbol: string;
  balanceRaw: string;
  balanceUnits: string;
  thresholdRaw: string;
  routeStatus: RouteStatus;
  blockers: string[];
  minOutWei: string | null;
  readAtBlock: string | null;
  readAt: string | null;
}
