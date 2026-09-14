import { getDeployment } from "@latchprotocol/sdk";
import type { PrismaClient } from "@prisma/client";
import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Abi, type Address, type Hex } from "viem";
import { KIT_V2_FUNCTIONS_ABI } from "../chain/abis.js";
import { kitV2Addresses, type KitV2Addresses } from "../config/chainConfig.js";
import { ApiError } from "../lib/errors.js";
import { formatUnitsExact, toBigInt } from "../lib/units.js";
import { deriveLaunchFeeState, KitV2ReadService, LAUNCH_FEE_EVENTS, NATIVE, type KitV2ConfigLookup, type LaunchFeeState } from "../services/kitV2.js";
import { shortErr, type TreasuryClient } from "./treasury/chain.js";

/**
 * Admin reads for LaunchpadKitV2 and its lockers.
 *
 *   fee state   events replayed from Postgres (always) + the kit's own views read by
 *               eth_call at one pinned block (when ADMIN_SIMULATION_ENABLED gives this
 *               process a read-only client). The two are compared and a disagreement is
 *               reported, never resolved silently.
 *   accruals    what the protocol is OWED but has not claimed: kit feesOwed(Safe) in
 *               native, and per token on each locker (protocol shares + skims - claims),
 *               summed from events and, when readable, checked against the contract.
 *
 * Clock: the launch fee is timestamp-clocked; `effectiveAt` is compared only with a
 * block timestamp (the pinned block's for chain reads, the last indexed block's for
 * the event replay). Never with a block number.
 */

const LOCKER_VIEWS = parseAbi([
  "function claimable(address account, address currency) view returns (uint256)",
  "function protocolRecipient() view returns (address)",
  "function minProtocolBps() view returns (uint16)",
  "function maxProtocolBps() view returns (uint16)",
  "function maxIntegratorBps() view returns (uint16)",
]);

const iso = (unix: bigint) => new Date(Number(unix) * 1000).toISOString();
const lc = (a: string) => a.toLowerCase();

export interface KitChainRead {
  status: "read";
  blockNumber: string;
  blockTimestamp: string;
  blockTimestampIso: string;
  launchFeeWei: string;
  pendingLaunchFee: { feeWei: string; effectiveAt: string; effectiveAtIso: string } | null;
  maxLaunchFeeWei: string;
  launchFeeNoticeSeconds: number;
  maxIntegratorLaunchFeeWei: string;
  protocolFeeRecipient: string;
  owner: string;
  pendingOwner: string;
  feesOwedToSafe: string;
  totalFeesOwed: string;
  clLocker: string;
  binLocker: string;
}

export type KitChainState = KitChainRead | { status: "unavailable"; error: string };

async function view<T>(client: TreasuryClient, to: Address, abi: Abi, functionName: string, args: readonly unknown[], blockNumber: bigint): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const r = await client.call({ to, data, blockNumber });
  return decodeFunctionResult({ abi, functionName, data: (r.data ?? "0x") as Hex } as never) as T;
}

/** Every kit view the fee panel shows, at ONE block. Throws nothing: a failed read is "unavailable". */
export async function readKitChainState(client: TreasuryClient | null, kit: string, safe: string): Promise<KitChainState> {
  if (!client) return { status: "unavailable", error: "chain reads are disabled on this API process (ADMIN_SIMULATION_ENABLED=false)" };
  try {
    const block = await client.getBlock();
    if (block.number === null) return { status: "unavailable", error: "the RPC returned a pending block with no number" };
    const n = block.number;
    const to = getAddress(kit);
    const abi = KIT_V2_FUNCTIONS_ABI as unknown as Abi;
    const [fee, pending, cap, notice, intCap, recipient, owner, pendingOwner, owed, total, clLocker, binLocker] = await Promise.all([
      view<bigint>(client, to, abi, "launchFeeWei", [], n),
      view<[bigint, bigint]>(client, to, abi, "pendingLaunchFee", [], n),
      view<bigint>(client, to, abi, "maxLaunchFeeWei", [], n),
      view<number>(client, to, abi, "launchFeeNoticeSeconds", [], n),
      view<bigint>(client, to, abi, "maxIntegratorLaunchFeeWei", [], n),
      view<string>(client, to, abi, "protocolFeeRecipient", [], n),
      view<string>(client, to, abi, "owner", [], n),
      view<string>(client, to, abi, "pendingOwner", [], n),
      view<bigint>(client, to, abi, "feesOwed", [getAddress(safe)], n),
      view<bigint>(client, to, abi, "totalFeesOwed", [], n),
      view<string>(client, to, abi, "clLocker", [], n),
      view<string>(client, to, abi, "binLocker", [], n),
    ]);
    const [pFee, pAt] = pending;
    return {
      status: "read",
      blockNumber: n.toString(),
      blockTimestamp: block.timestamp.toString(),
      blockTimestampIso: iso(block.timestamp),
      launchFeeWei: fee.toString(),
      // pendingLaunchFee() answers (0, 0) for none AND for a matured increase (already in launchFeeWei()).
      pendingLaunchFee: pAt === 0n ? null : { feeWei: pFee.toString(), effectiveAt: pAt.toString(), effectiveAtIso: iso(pAt) },
      maxLaunchFeeWei: cap.toString(),
      launchFeeNoticeSeconds: Number(notice),
      maxIntegratorLaunchFeeWei: intCap.toString(),
      protocolFeeRecipient: lc(recipient),
      owner: lc(owner),
      pendingOwner: lc(pendingOwner),
      feesOwedToSafe: owed.toString(),
      totalFeesOwed: total.toString(),
      clLocker: lc(clLocker),
      binLocker: lc(binLocker),
    };
  } catch (e) {
    return { status: "unavailable", error: `kit views could not be read: ${shortErr(e)}` };
  }
}

/** Checks the chain read against the Ownership table, the config and the event replay. Pure. */
export function kitFeeChecks(p: { cfg: KitV2Addresses; safe: string; chain: KitChainState; events: LaunchFeeState | null }): { level: "ok" | "warn" | "high"; check: string; detail: string }[] {
  const out: { level: "ok" | "warn" | "high"; check: string; detail: string }[] = [];
  const c = p.chain;
  if (c.status !== "read") return out;
  const safe = lc(p.safe);
  out.push(c.owner === safe ? { level: "ok", check: "owner() is the Safe", detail: c.owner } : { level: "high", check: "owner() is not the Safe", detail: `owner() reads ${c.owner}; the Ownership table assigns LaunchpadKitV2 to the Safe ${safe}.` });
  if (c.pendingOwner !== NATIVE) out.push({ level: "high", check: "an ownership transfer is pending", detail: `pendingOwner() reads ${c.pendingOwner}. If accepted, the launch fee leaves the Safe.` });
  out.push(c.protocolFeeRecipient === safe ? { level: "ok", check: "protocolFeeRecipient() is the Safe", detail: c.protocolFeeRecipient } : { level: "high", check: "protocolFeeRecipient() is not the Safe", detail: `It is ${c.protocolFeeRecipient} and IMMUTABLE: every launch fee and every locker protocol share goes there. Ledger rows are written only for claims by the Safe, so this revenue would not appear.` });
  if (p.cfg.clLocker && c.clLocker !== p.cfg.clLocker) out.push({ level: "high", check: "clLocker() differs from config", detail: `The kit's clLocker() is ${c.clLocker}; config/chains says ${p.cfg.clLocker}. Lock events of the kit's real locker are not indexed.` });
  if (p.cfg.binLocker && c.binLocker !== p.cfg.binLocker) out.push({ level: "high", check: "binLocker() differs from config", detail: `The kit's binLocker() is ${c.binLocker}; config/chains says ${p.cfg.binLocker}.` });
  if (!p.cfg.clLocker || !p.cfg.binLocker) out.push({ level: "warn", check: "a locker slot is empty in config", detail: `The kit reads clLocker ${c.clLocker} and binLocker ${c.binLocker}; fill the empty slot(s) so their lock and fee events are indexed.` });
  const e = p.events;
  if (e && e.effectiveWei !== null) {
    // Compare at the SAME kind of clock: the event replay judged at the chain read's block timestamp.
    if (e.effectiveWei !== c.launchFeeWei) out.push({ level: "warn", check: "indexed fee events disagree with launchFeeWei()", detail: `Replayed events give ${e.effectiveWei} wei; the kit reads ${c.launchFeeWei} wei at block ${c.blockNumber}. The indexer may be behind the chain.` });
    const ePending = e.pendingStatus === "scheduled" ? e.pending : null;
    if ((ePending?.feeWei ?? null) !== (c.pendingLaunchFee?.feeWei ?? null)) out.push({ level: "warn", check: "indexed pending increase disagrees with pendingLaunchFee()", detail: `Events: ${ePending ? `${ePending.feeWei} wei at ${ePending.effectiveAt}` : "none"}; chain: ${c.pendingLaunchFee ? `${c.pendingLaunchFee.feeWei} wei at ${c.pendingLaunchFee.effectiveAt}` : "none"}.` });
  }
  return out;
}

export class AdminKitV2Service {
  readonly read: KitV2ReadService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: ((chainId: number) => TreasuryClient | null) | null,
    private readonly config: KitV2ConfigLookup = kitV2Addresses,
  ) {
    this.read = new KitV2ReadService(prisma, config);
  }

  private notConfigured(chainId: number) {
    return { chainId, configured: false as const, message: `No LaunchpadKitV2 address in config/chains/${chainId}.json (kitV2.kit). Kit v2 is not deployed on this chain, or its address has not been verified and recorded yet; nothing about it is indexed.` };
  }

  async launches(chainId: number, q: { limit: number; offset: number }) {
    const cfg = this.config(chainId);
    if (!cfg?.kit) return this.notConfigured(chainId);
    const [cp, list] = await Promise.all([this.prisma.indexerCheckpoint.findUnique({ where: { chainId } }), this.read.launches(chainId, q)]);
    const d = getDeployment(chainId);
    return {
      chainId,
      configured: true as const,
      contracts: { kit: cfg.kit, clLocker: cfg.clLocker, binLocker: cfg.binLocker, verification: cfg.verification },
      indexed: cp !== null,
      provenance: cp ? `kit_v2_launches, lp_locks: logs from block ${d?.deployedAtBlock ?? "?"} to ${cp.lastIndexedBlock} (${cp.lastIndexedBlockTimestamp.toISOString()})` : "this chain has not been indexed: launches are unmeasured, not zero",
      ...list,
    };
  }

  private async feeEvents(chainId: number, kit: string) {
    const rows = await this.prisma.contractEvent.findMany({ where: { chainId, contractKey: "launchpadKitV2", contract: kit, eventName: { in: [...LAUNCH_FEE_EVENTS] } }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] });
    return rows.map((r) => ({ eventName: r.eventName, args: r.args as Record<string, unknown>, blockNumber: r.blockNumber, blockTimestamp: r.blockTimestamp, txHash: r.txHash, logIndex: r.logIndex }));
  }

  /** Current fee, pending increase and when it lands, cap, notice; accruals owed to the protocol. */
  async feeState(chainId: number) {
    const cfg = this.config(chainId);
    if (!cfg?.kit) return this.notConfigured(chainId);
    const d = getDeployment(chainId);
    if (!d) throw ApiError.validation(`chain ${chainId} is not in the Latch address book`);
    const safe = lc(d.governanceSafe);
    const [cp, events, chain] = await Promise.all([this.prisma.indexerCheckpoint.findUnique({ where: { chainId } }), this.feeEvents(chainId, cfg.kit), readKitChainState(this.client?.(chainId) ?? null, cfg.kit, safe)]);
    const eventState = cp ? deriveLaunchFeeState(events, BigInt(Math.floor(cp.lastIndexedBlockTimestamp.getTime() / 1000))) : null;
    // For the cross-check, judge the same events at the chain read's own block timestamp.
    const atChainTime = chain.status === "read" ? deriveLaunchFeeState(events, BigInt(chain.blockTimestamp)) : null;
    const accruals = await this.accruals(chainId, cfg, safe, chain.status === "read" ? BigInt(chain.blockNumber) : null);
    return {
      chainId,
      configured: true as const,
      kit: cfg.kit,
      safe,
      nativeSymbol: d.nativeCurrency.symbol,
      rules: {
        decrease: "setLaunchFee(x) with x <= the fee in force applies in the block it executes and cancels any scheduled increase.",
        increase: "setLaunchFee(x) with x > the fee in force is scheduled: it becomes the fee BY ITSELF launchFeeNoticeSeconds later. A newer increase replaces it and restarts the notice.",
        cap: "maxLaunchFeeWei is immutable; above it setLaunchFee reverts LaunchFeeAboveCap.",
        retroactivity: "None: each launch pays the fee in force in its own block, recorded in its LaunchCreated.",
      },
      chain,
      events: eventState
        ? { ...eventState, provenance: `contract_events (LaunchFeeChanged, LaunchFeeIncreaseScheduled, PendingLaunchFeeCancelled) from block ${d.deployedAtBlock} to ${cp!.lastIndexedBlock}, judged at that block's timestamp` }
        : { status: "not-indexed" as const, message: "This chain has no indexer checkpoint: the fee history is unmeasured." },
      checks: kitFeeChecks({ cfg, safe, chain, events: atChainTime }),
      accruals,
    };
  }

  /**
   * Owed to the protocol and not yet claimed, per contract and token, from events:
   *   kit:     FeesCredited(Safe) - FeesClaimed(account = Safe)                  (native)
   *   lockers: sum(FeesCollected.protocolShare) + sum(Skimmed) - Claimed(Safe)   (per token)
   * Skims credit the locker's immutable protocolRecipient, assumed here to be the Safe;
   * the chain read of claimable(Safe, token) is shown beside it when available.
   */
  async accruals(chainId: number, cfg: KitV2Addresses, safe: string, atBlock: bigint | null) {
    const d = getDeployment(chainId);
    const contracts = [cfg.kit, cfg.clLocker, cfg.binLocker].filter((a): a is `0x${string}` => a !== null);
    const [cp, flows, collections] = await Promise.all([
      this.prisma.indexerCheckpoint.findUnique({ where: { chainId } }),
      contracts.length ? this.prisma.feeFlow.findMany({ where: { chainId, contract: { in: contracts } } }) : Promise.resolve([]),
      contracts.length ? this.prisma.lpFeeCollection.findMany({ where: { chainId, locker: { in: contracts } } }) : Promise.resolve([]),
    ]);
    if (!cp) return { status: "not-indexed" as const, message: "No indexer checkpoint: accruals are unmeasured, not zero." };
    const key = (contract: string, token: string) => `${contract}:${token}`;
    const acc = new Map<string, { contract: string; token: string; credited: bigint; claimed: bigint; skimmed: bigint }>();
    const entry = (contract: string, token: string) => {
      const k = key(contract, token);
      const e = acc.get(k) ?? { contract, token, credited: 0n, claimed: 0n, skimmed: 0n };
      acc.set(k, e);
      return e;
    };
    for (const f of flows) {
      if (f.kind === "CREDITED" && f.account === safe) entry(f.contract, f.token).credited += toBigInt(f.amount);
      else if (f.kind === "CLAIMED" && f.account === safe) entry(f.contract, f.token).claimed += toBigInt(f.amount);
      else if (f.kind === "SKIMMED") entry(f.contract, f.token).skimmed += toBigInt(f.amount);
    }
    for (const c of collections) entry(c.locker, c.currency).credited += toBigInt(c.protocolShare);
    const tokenRows = await this.prisma.token.findMany({ where: { chainId, address: { in: [...new Set([...acc.values()].map((e) => e.token))] } } });
    const meta = (t: string) => (t === NATIVE && d ? { symbol: d.nativeCurrency.symbol, decimals: d.nativeCurrency.decimals } : tokenRows.find((r) => r.address === t) ?? null);
    const client = this.client?.(chainId) ?? null;
    const items = [];
    for (const e of acc.values()) {
      const owed = e.credited + e.skimmed - e.claimed;
      const m = meta(e.token);
      const role = e.contract === cfg.kit ? "launchpadKitV2" : e.contract === cfg.clLocker ? "clLpLocker" : "binLpLocker";
      let onChain: { status: "read"; raw: string; atBlock: string; matchesEvents: boolean } | { status: "unavailable"; error: string } = { status: "unavailable", error: "chain reads are disabled or failed" };
      if (client && atBlock !== null) {
        try {
          const raw =
            role === "launchpadKitV2"
              ? await view<bigint>(client, getAddress(e.contract), KIT_V2_FUNCTIONS_ABI as unknown as Abi, "feesOwed", [getAddress(safe)], atBlock)
              : await view<bigint>(client, getAddress(e.contract), LOCKER_VIEWS as unknown as Abi, "claimable", [getAddress(safe), getAddress(e.token)], atBlock);
          onChain = { status: "read", raw: raw.toString(), atBlock: atBlock.toString(), matchesEvents: raw === owed };
        } catch (err) {
          onChain = { status: "unavailable", error: shortErr(err) };
        }
      }
      const fmt = (v: bigint) => ({ raw: v.toString(), units: m?.decimals != null ? formatUnitsExact(v, m.decimals) : null });
      items.push({ contract: e.contract, role, token: e.token, symbol: m?.symbol ?? null, credited: fmt(e.credited), skimmed: fmt(e.skimmed), claimed: fmt(e.claimed), owed: fmt(owed), onChain });
    }
    return {
      status: "indexed" as const,
      provenance: `Summed from fee_flows and lp_fee_collections since block ${d?.deployedAtBlock ?? "?"} to ${cp.lastIndexedBlock} (${cp.lastIndexedBlockTimestamp.toISOString()}). No cumulative counter is implied; the on-chain column is the contract's own balance where it could be read, at a later block than the events.`,
      definitions: {
        credited: "Kit: FeesCredited to the Safe. Lockers: FeesCollected.protocolShare (includes rounding dust).",
        skimmed: "Lockers only: Skimmed surplus, credited to the immutable protocolRecipient.",
        claimed: "Paid out of the contract for the Safe: these are the KIT_LAUNCH_FEE and LP_LOCKER_PROTOCOL_CLAIM ledger rows.",
        owed: "credited + skimmed - claimed: still inside the contract. Not revenue received.",
      },
      items,
    };
  }
}
