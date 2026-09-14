import { keccak256, toHex, type Address, type Hex } from "viem";

/**
 * Treasury conversion: route candidates and the arithmetic that judges them.
 * PURE. No chain, no database: every input is a pool row the indexer wrote or a
 * number a chain read returned, so each rule here is unit-tested exactly.
 *
 * LATCH POOLS ONLY. The candidate set is built from pools whose `poolManager` is
 * the SDK's Latch CLPoolManager and nothing else. There is no other venue, no
 * fallback, and no code path that names one: a token without a Latch route to
 * native (or WETH) is simply "no-route" (CLAUDE.md "Infinity-only").
 */

export const NATIVE: Address = "0x0000000000000000000000000000000000000000";
const Q192 = 1n << 192n;
const PIPS = 1_000_000n;
const BPS = 10_000n;

export interface PoolRow {
  poolId: string;
  poolType: string;
  poolManager: string;
  currency0: string;
  currency1: string;
  hooks: string;
  fee: number;
  parameters: string;
}

export interface PoolKeyTuple {
  currency0: Address;
  currency1: Address;
  hooks: Address;
  poolManager: Address;
  fee: number;
  parameters: Hex;
}

export interface Hop {
  poolId: Hex;
  key: PoolKeyTuple;
  currencyIn: Address;
  currencyOut: Address;
  zeroForOne: boolean;
}

export type RouteEnd = "native" | "weth";

export interface RouteCandidate {
  /** keccak256 of the ordered pool ids and the end. Stable across requests for the same path. */
  id: Hex;
  tokenIn: Address;
  hops: Hop[];
  end: RouteEnd;
}

const lc = (a: string) => a.toLowerCase() as Address;

function keyOf(p: PoolRow): PoolKeyTuple {
  return { currency0: lc(p.currency0), currency1: lc(p.currency1), hooks: lc(p.hooks), poolManager: lc(p.poolManager), fee: p.fee, parameters: p.parameters.toLowerCase() as Hex };
}

function hop(p: PoolRow, currencyIn: string): Hop {
  const key = keyOf(p);
  const zeroForOne = lc(currencyIn) === key.currency0;
  return { poolId: p.poolId.toLowerCase() as Hex, key, currencyIn: lc(currencyIn), currencyOut: zeroForOne ? key.currency1 : key.currency0, zeroForOne };
}

export function routeId(hops: readonly Hop[], end: RouteEnd): Hex {
  return keccak256(toHex(`${hops.map((h) => h.poolId).join(">")}|${end}`));
}

/**
 * Every direct and one-intermediate-hop path from `token` to native or WETH over
 * the given pools, restricted to `latchClPoolManager`. Pools on any other
 * manager are dropped before anything else happens.
 */
export function enumerateRoutes(p: { pools: readonly PoolRow[]; token: string; weth: string; latchClPoolManager: string; maxCandidates?: number }): { candidates: RouteCandidate[]; consideredPools: number; droppedForeignPools: number } {
  const token = lc(p.token);
  const weth = lc(p.weth);
  const manager = lc(p.latchClPoolManager);
  const latch = p.pools.filter((x) => x.poolType === "CL" && lc(x.poolManager) === manager && lc(x.currency0) !== lc(x.currency1));
  const droppedForeignPools = p.pools.length - latch.length;
  const has = (x: PoolRow, c: string) => lc(x.currency0) === c || lc(x.currency1) === c;
  const other = (x: PoolRow, c: string) => (lc(x.currency0) === c ? lc(x.currency1) : lc(x.currency0));
  const endOf = (c: Address): RouteEnd | null => (c === NATIVE ? "native" : c === weth ? "weth" : null);
  if (token === NATIVE || token === weth) return { candidates: [], consideredPools: latch.length, droppedForeignPools };

  const out: RouteCandidate[] = [];
  const seen = new Set<string>();
  const push = (hops: Hop[]) => {
    const end = endOf(hops[hops.length - 1]!.currencyOut);
    if (!end) return;
    const id = routeId(hops, end);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, tokenIn: token, hops, end });
  };

  for (const a of latch) {
    if (!has(a, token)) continue;
    const mid = other(a, token);
    if (endOf(mid)) {
      push([hop(a, token)]);
      continue;
    }
    for (const b of latch) {
      if (b.poolId === a.poolId || !has(b, mid)) continue;
      const last = other(b, mid);
      if (last === token || !endOf(last)) continue;
      push([hop(a, token), hop(b, mid)]);
    }
  }
  // Direct routes first, then by id for determinism.
  out.sort((x, y) => x.hops.length - y.hops.length || (x.id < y.id ? -1 : 1));
  return { candidates: out.slice(0, p.maxCandidates ?? 24), consideredPools: latch.length, droppedForeignPools };
}

/* ---------------------------------------------------------------------------
   Fees, mid price, impact
   --------------------------------------------------------------------------- */

/** ProtocolFeeLibrary: lower 12 bits zeroForOne, upper 12 bits oneForZero. */
export function directionalProtocolFee(protocolFee: number, zeroForOne: boolean): number {
  return zeroForOne ? protocolFee & 0xfff : (protocolFee >> 12) & 0xfff;
}

/** ProtocolFeeLibrary.calculateSwapFee: protocolFee + lpFee - protocolFee * lpFee / 1e6 (floor). */
export function swapFeePips(protocolFeeOneDirection: number, lpFee: number): number {
  const p = BigInt(protocolFeeOneDirection & 0xfff);
  const l = BigInt(lpFee & 0xffffff);
  return Number(p + l - (p * l) / PIPS);
}

export interface HopState {
  sqrtPriceX96: bigint;
  protocolFee: number;
  lpFee: number;
}

export interface ImpactResult {
  /** amountIn at every pool's mid price, no fees. Floor. */
  midOut: bigint;
  /** midOut after each pool's declared swap fee (slot0 lpFee + protocol fee). Floor. */
  feeAdjustedMidOut: bigint;
  /** Shortfall of the quote against feeAdjustedMidOut, in bps. Includes hook deltas and curve movement. Rounded UP when positive. */
  priceImpactBps: number;
  /** Shortfall of the quote against midOut (fees included), in bps. Rounded UP when positive. */
  totalCostBps: number;
  swapFeesPips: number[];
}

function bpsShortfall(reference: bigint, actual: bigint): number {
  if (reference === 0n) throw new RangeError("reference output is zero");
  const diff = reference - actual;
  if (diff <= 0n) return -Number((-diff * BPS) / reference);
  return Number((diff * BPS + reference - 1n) / reference);
}

/**
 * Price impact of a quote against the pools' mid prices. Exact integer ratios,
 * no floats. Throws when an amount is too small for the mid price to be
 * non-zero (impact cannot be measured, so the caller refuses).
 */
export function priceImpact(amountIn: bigint, hops: readonly Hop[], states: readonly HopState[], amountOut: bigint): ImpactResult {
  if (hops.length !== states.length || hops.length === 0) throw new RangeError("one state per hop");
  let num = amountIn;
  let den = 1n;
  let feeNum = 1n;
  let feeDen = 1n;
  const fees: number[] = [];
  hops.forEach((h, i) => {
    const s = states[i]!;
    if (s.sqrtPriceX96 <= 0n) throw new RangeError(`pool ${h.poolId} is not initialized (sqrtPriceX96 = 0)`);
    const p2 = s.sqrtPriceX96 * s.sqrtPriceX96;
    if (h.zeroForOne) {
      num *= p2;
      den *= Q192;
    } else {
      num *= Q192;
      den *= p2;
    }
    const fee = swapFeePips(directionalProtocolFee(s.protocolFee, h.zeroForOne), s.lpFee);
    fees.push(fee);
    feeNum *= PIPS - BigInt(fee);
    feeDen *= PIPS;
  });
  const midOut = num / den;
  const feeAdjustedMidOut = (num * feeNum) / (den * feeDen);
  if (midOut === 0n || feeAdjustedMidOut === 0n) throw new RangeError("amount too small: the mid-price output rounds to zero, so impact cannot be measured");
  return { midOut, feeAdjustedMidOut, priceImpactBps: bpsShortfall(feeAdjustedMidOut, amountOut), totalCostBps: bpsShortfall(midOut, amountOut), swapFeesPips: fees };
}

/**
 * Minimum output the router must deliver: quote x (1 - slippageBps / 10000),
 * rounded UP. Rounding never loosens the bound the Safe asked for, not even by
 * one wei; the cost is that an execution landing exactly on the boundary's
 * fractional wei reverts, which is the safe side for a treasury.
 */
export function minOutFor(quote: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new RangeError(`slippageBps must be an integer in [0, 10000], got ${slippageBps}`);
  if (quote < 0n) throw new RangeError("quote must be >= 0");
  const scaled = quote * (BPS - BigInt(slippageBps));
  return (scaled + BPS - 1n) / BPS;
}

/* ---------------------------------------------------------------------------
   Hook policy
   --------------------------------------------------------------------------- */

export type HookVerdict =
  | { ok: true; hook: Address | null; basis: string; warnings: string[] }
  | { ok: false; hook: Address; reason: string };

export interface HookFacts {
  hook: Address;
  /** Latch's own hook per the SDK address book (RevShareHook current or retired, LaunchGuardHook). */
  ownHook: string | null;
  registry: { status: "read"; registered: boolean; listing: "Active" | "Deprecated" | "Malicious" | `unknown(${number})` | null } | { status: "error"; error: string };
  /** Only for RevShare hooks. */
  pending: null | { status: "none" | "queued" | "armed" | "expired"; shape: string; effective: string; expiry: string | null; maturesWithinDeadline: boolean } | { status: "error"; error: string };
}

/**
 * The rules, in order:
 *  1. A hook the registry flags Malicious is refused, own hook or not.
 *  2. A hook the registry cannot be read for is refused (unknown is not "fine").
 *  3. A hook not in the registry is refused unless the SDK names it as Latch's own.
 *  4. A RevShare pool with an ARMED proposal is refused (CLAUDE.md §5): anyone can
 *     apply it in front of the swap. A queued one that matures inside the payload's
 *     deadline is refused for the same reason. An unreadable one is refused.
 */
export function judgeHook(f: HookFacts | null): HookVerdict {
  if (f === null) return { ok: true, hook: null, basis: "no hook", warnings: [] };
  if (f.registry.status === "error") return { ok: false, hook: f.hook, reason: `LatchRegistry could not be read for this hook (${f.registry.error}); an unreadable listing is not treated as clean` };
  if (f.registry.registered && f.registry.listing === "Malicious") return { ok: false, hook: f.hook, reason: "LatchRegistry lists this hook as Malicious" };
  if (f.registry.registered && f.registry.listing !== "Active" && f.registry.listing !== "Deprecated") return { ok: false, hook: f.hook, reason: `LatchRegistry listing is ${String(f.registry.listing)}` };
  if (!f.registry.registered && !f.ownHook) return { ok: false, hook: f.hook, reason: "hook is not in LatchRegistry and is not one of Latch's own hooks in the SDK address book" };
  const warnings: string[] = [];
  if (f.registry.registered && f.registry.listing === "Deprecated") warnings.push("LatchRegistry lists this hook as Deprecated.");
  if (f.pending) {
    if (f.pending.status === "error") return { ok: false, hook: f.hook, reason: `RevShare pending config could not be read (${f.pending.error}); unknown is never shown as "no proposal"` };
    if (f.pending.status === "armed") return { ok: false, hook: f.hook, reason: `RevShare proposal is ARMED (effective ${f.pending.effective}${f.pending.expiry ? `, applicable until ${f.pending.expiry}` : ", never expires"}): anyone can apply it in front of this swap` };
    if (f.pending.status === "queued" && f.pending.maturesWithinDeadline) return { ok: false, hook: f.hook, reason: `RevShare proposal matures at ${f.pending.effective}, inside this payload's deadline` };
    if (f.pending.status === "queued") warnings.push(`RevShare proposal queued, matures at ${f.pending.effective} (after the deadline).`);
  }
  return { ok: true, hook: f.hook, basis: f.registry.registered ? `LatchRegistry listing ${f.registry.listing}${f.ownHook ? `; ${f.ownHook}` : ""}` : `not registered; ${f.ownHook}`, warnings };
}
