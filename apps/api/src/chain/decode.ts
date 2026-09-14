import { decodeBinPoolParameters, decodeCLPoolParameters, decodeProtocolLog } from "@latchprotocol/sdk";
import { decodeEventLog, type Hex } from "viem";
import { COLLECT_SELECTOR, HAZARD_SELECTORS, KNOWN_SELECTORS, SWEEP_SELECTOR } from "./abis.js";
import { abiForRole, type WatchRole } from "./deployments.js";

/**
 * Log -> typed indexer event. Pure: no I/O, no clock, no database.
 *
 * Decoding is keyed on (emitting address -> role), never on topic0 alone:
 * ProtocolFeeUpdated, DynamicLPFeeUpdated, OwnershipTransferred and friends are
 * byte-identical across Latch contracts, and a third-party contract can emit any
 * signature we index. A log from an address with no role is never decoded.
 */

/** A log as fetched, before timestamps are joined. */
export interface RawLog {
  readonly address: Hex;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
}

export interface LogMeta {
  readonly chainId: number;
  readonly role: WatchRole;
  /** `${chainId}-${txHash}-${logIndex}` */
  readonly id: string;
  readonly contract: Hex;
  readonly blockNumber: bigint;
  readonly txHash: Hex;
  readonly txIndex: number;
  readonly logIndex: number;
}

export type IndexedEvent =
  | { kind: "PoolInitialized"; meta: LogMeta; poolType: "CL" | "BIN"; poolId: Hex; currency0: Hex; currency1: Hex; hooks: Hex; fee: number; parameters: Hex; hookBitmap: number; tickSpacing: number | null; binStep: number | null; sqrtPriceX96: bigint | null; tick: number | null; activeId: number | null }
  | { kind: "Swap"; meta: LogMeta; poolType: "CL" | "BIN"; poolId: Hex; sender: Hex; amount0: bigint; amount1: bigint; fee: number; protocolFee: number; sqrtPriceX96: bigint | null; liquidity: bigint | null; tick: number | null; activeId: number | null }
  | { kind: "Liquidity"; meta: LogMeta; poolId: Hex; liquidityKind: "MODIFY" | "MINT" | "BURN"; sender: Hex; salt: Hex; tickLower: number | null; tickUpper: number | null; liquidityDelta: bigint | null; binIds: string[]; packedAmounts: Hex[] }
  | { kind: "PoolFeeUpdate"; meta: LogMeta; poolId: Hex; feeKind: "PROTOCOL_FEE" | "DYNAMIC_LP_FEE"; value: number }
  | { kind: "RevShareTaken"; meta: LogMeta; poolId: Hex; currency: Hex; lpDonated: bigint; toBeneficiaries: bigint; toDistributor: bigint }
  | { kind: "RevShareClaimed"; meta: LogMeta; beneficiary: Hex; currency: Hex; to: Hex; amount: bigint }
  | { kind: "ProtocolFeesCollected"; meta: LogMeta; poolManager: Hex; currency: Hex; recipient: Hex; amount: bigint }
  | { kind: "LaunchCreated"; meta: LogMeta; poolId: Hex; launchToken: Hex; operator: Hex; quoteToken: Hex; startContractBlock: bigint; decayContractBlocks: number; initialFeeBips: number; finalFeeBips: number; maxBuyPerTx: bigint; launchTokenIsCurrency0: boolean; preset: number }
  | { kind: "Timelock"; meta: LogMeta; eventName: string; operationId: Hex | null; callIndex: number | null; target: Hex | null; value: bigint | null; data: Hex | null; predecessor: Hex | null; delaySeconds: bigint | null }
  | { kind: "Generic"; meta: LogMeta; eventName: string; subject: string | null; args: Record<string, unknown> };

export type DecodeResult =
  | { ok: true; event: IndexedEvent }
  | { ok: false; reason: "unknown-signature" | "not-indexed" | "malformed"; eventName?: string };

const lowerHex = (v: unknown): Hex => String(v).toLowerCase() as Hex;
const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v)));
const num = (v: unknown): number => Number(v);

const CORE_CONTRACT: Partial<Record<WatchRole, "Vault" | "CLPoolManager" | "BinPoolManager">> = {
  vault: "Vault",
  clPoolManager: "CLPoolManager",
  binPoolManager: "BinPoolManager",
};

export function logId(chainId: number, txHash: string, logIndex: number): string {
  return `${chainId}-${txHash.toLowerCase()}-${logIndex}`;
}

/** Integers -> decimal strings, recursively, so `args` is JSON-safe with no precision loss. */
export function jsonArgs(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonArgs);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonArgs(v)]));
  }
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
  return value;
}

export function decodeLog(chainId: number, role: WatchRole, log: RawLog): DecodeResult {
  const topic0 = log.topics[0];
  if (!topic0) return { ok: false, reason: "malformed" };

  let eventName: string;
  let args: Record<string, unknown>;
  const core = CORE_CONTRACT[role];
  if (core) {
    const decoded = decodeProtocolLog(core, { data: log.data, topics: log.topics as [] });
    if (!decoded) return { ok: false, reason: "unknown-signature" };
    eventName = decoded.eventName;
    args = decoded.args as Record<string, unknown>;
  } else {
    try {
      const decoded = decodeEventLog({ abi: abiForRole(role), data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      eventName = String(decoded.eventName);
      args = (decoded.args ?? {}) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "unknown-signature" };
    }
  }

  const meta: LogMeta = {
    chainId,
    role,
    id: logId(chainId, log.transactionHash, log.logIndex),
    contract: log.address.toLowerCase() as Hex,
    blockNumber: log.blockNumber,
    txHash: log.transactionHash.toLowerCase() as Hex,
    txIndex: log.transactionIndex,
    logIndex: log.logIndex,
  };

  try {
    const event = toEvent(meta, role, eventName, args);
    return event ? { ok: true, event } : { ok: false, reason: "not-indexed", eventName };
  } catch {
    return { ok: false, reason: "malformed", eventName };
  }
}

function toEvent(meta: LogMeta, role: WatchRole, name: string, a: Record<string, unknown>): IndexedEvent | null {
  switch (role) {
    case "clPoolManager":
    case "binPoolManager": {
      const poolType = role === "clPoolManager" ? "CL" : "BIN";
      switch (name) {
        case "Initialize": {
          const parameters = lowerHex(a.parameters);
          const decoded = poolType === "CL" ? decodeCLPoolParameters(parameters) : decodeBinPoolParameters(parameters);
          return {
            kind: "PoolInitialized",
            meta,
            poolType,
            poolId: lowerHex(a.id),
            currency0: lowerHex(a.currency0),
            currency1: lowerHex(a.currency1),
            hooks: lowerHex(a.hooks),
            fee: num(a.fee),
            parameters,
            hookBitmap: decoded.hooksRegistrationBitmap,
            tickSpacing: "tickSpacing" in decoded ? decoded.tickSpacing : null,
            binStep: "binStep" in decoded ? decoded.binStep : null,
            sqrtPriceX96: poolType === "CL" ? big(a.sqrtPriceX96) : null,
            tick: poolType === "CL" ? num(a.tick) : null,
            activeId: poolType === "BIN" ? num(a.activeId) : null,
          };
        }
        case "Swap":
          return {
            kind: "Swap",
            meta,
            poolType,
            poolId: lowerHex(a.id),
            sender: lowerHex(a.sender),
            amount0: big(a.amount0),
            amount1: big(a.amount1),
            fee: num(a.fee),
            protocolFee: num(a.protocolFee),
            sqrtPriceX96: poolType === "CL" ? big(a.sqrtPriceX96) : null,
            liquidity: poolType === "CL" ? big(a.liquidity) : null,
            tick: poolType === "CL" ? num(a.tick) : null,
            activeId: poolType === "BIN" ? num(a.activeId) : null,
          };
        case "ModifyLiquidity":
          if (poolType !== "CL") return null;
          return {
            kind: "Liquidity",
            meta,
            poolId: lowerHex(a.id),
            liquidityKind: "MODIFY",
            sender: lowerHex(a.sender),
            salt: lowerHex(a.salt),
            tickLower: num(a.tickLower),
            tickUpper: num(a.tickUpper),
            liquidityDelta: big(a.liquidityDelta),
            binIds: [],
            packedAmounts: [],
          };
        case "Mint":
        case "Burn":
          if (poolType !== "BIN") return null;
          return {
            kind: "Liquidity",
            meta,
            poolId: lowerHex(a.id),
            liquidityKind: name === "Mint" ? "MINT" : "BURN",
            sender: lowerHex(a.sender),
            salt: lowerHex(a.salt),
            tickLower: null,
            tickUpper: null,
            liquidityDelta: null,
            binIds: (a.ids as readonly unknown[]).map((x) => big(x).toString()),
            packedAmounts: (a.amounts as readonly unknown[]).map(lowerHex),
          };
        case "ProtocolFeeUpdated":
          return { kind: "PoolFeeUpdate", meta, poolId: lowerHex(a.id), feeKind: "PROTOCOL_FEE", value: num(a.protocolFee) };
        case "DynamicLPFeeUpdated":
          return { kind: "PoolFeeUpdate", meta, poolId: lowerHex(a.id), feeKind: "DYNAMIC_LP_FEE", value: num(a.dynamicLPFee) };
        default:
          return null;
      }
    }
    case "revShareHook":
      if (name === "RevShareTaken") {
        return {
          kind: "RevShareTaken",
          meta,
          poolId: lowerHex(a.poolId),
          currency: lowerHex(a.currency),
          lpDonated: big(a.lpDonated),
          toBeneficiaries: big(a.toBeneficiaries),
          toDistributor: big(a.toDistributor),
        };
      }
      if (name === "Claimed") {
        return {
          kind: "RevShareClaimed",
          meta,
          beneficiary: lowerHex(a.beneficiary),
          currency: lowerHex(a.currency),
          to: lowerHex(a.to),
          amount: big(a.amount),
        };
      }
      return null;
    case "feeController":
      if (name !== "ProtocolFeesCollected") return null;
      return {
        kind: "ProtocolFeesCollected",
        meta,
        poolManager: lowerHex(a.poolManager),
        currency: lowerHex(a.currency),
        recipient: lowerHex(a.recipient),
        amount: big(a.amount),
      };
    case "launchpadKit":
      if (name === "LaunchCreated") {
        return {
          kind: "LaunchCreated",
          meta,
          poolId: lowerHex(a.poolId),
          launchToken: lowerHex(a.launchToken),
          operator: lowerHex(a.operator),
          quoteToken: lowerHex(a.quoteToken),
          startContractBlock: big(a.startBlock),
          decayContractBlocks: num(a.decayBlocks),
          initialFeeBips: num(a.initialFeeBips),
          finalFeeBips: num(a.finalFeeBips),
          maxBuyPerTx: big(a.maxBuyPerTx),
          launchTokenIsCurrency0: Boolean(a.launchTokenIsCurrency0),
          preset: num(a.preset),
        };
      }
      if (name === "LaunchSeeded" || name === "LaunchReconfigured") {
        return { kind: "Generic", meta, eventName: name, subject: lowerHex(a.poolId), args: jsonArgs(a) as Record<string, unknown> };
      }
      if (name === "HookListed") {
        return { kind: "Generic", meta, eventName: name, subject: lowerHex(a.hook), args: jsonArgs(a) as Record<string, unknown> };
      }
      return null;
    case "registry": {
      const indexed = [
        "LatchRegistered",
        "LatchListingChanged",
        "LatchVerificationChanged",
        "LatchMetadataUpdated",
        "LatchStewardTransferred",
        "RoleGranted",
        "RoleRevoked",
      ];
      if (!indexed.includes(name)) return null;
      const subject = "hook" in a ? lowerHex(a.hook) : "account" in a ? lowerHex(a.account) : null;
      return { kind: "Generic", meta, eventName: name, subject, args: jsonArgs(a) as Record<string, unknown> };
    }
    case "launchRegistry":
      return { kind: "Generic", meta, eventName: name, subject: "poolId" in a ? lowerHex(a.poolId) : null, args: jsonArgs(a) as Record<string, unknown> };
    case "vault":
      if (name !== "AppRegistered") return null;
      return { kind: "Generic", meta, eventName: name, subject: lowerHex(a.app), args: jsonArgs(a) as Record<string, unknown> };
    case "timelockCustody":
    case "timelockPolicy":
      return {
        kind: "Timelock",
        meta,
        eventName: name,
        operationId: "id" in a ? lowerHex(a.id) : null,
        callIndex: "index" in a ? num(a.index) : null,
        target: "target" in a ? lowerHex(a.target) : null,
        value: "value" in a ? big(a.value) : null,
        data: "data" in a ? lowerHex(a.data) : null,
        predecessor: "predecessor" in a ? lowerHex(a.predecessor) : null,
        delaySeconds: "delay" in a ? big(a.delay) : "newDuration" in a ? big(a.newDuration) : null,
      };
  }
}

/** Selector, readable signature and CLAUDE.md hazard flag for a timelock call. */
export function classifyTimelockCall(data: Hex | null): {
  selector: Hex | null;
  functionSignature: string | null;
  hazard: string | null;
  hazardNote: string | null;
} {
  if (!data || data.length < 10) return { selector: null, functionSignature: null, hazard: null, hazardNote: null };
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const hz = HAZARD_SELECTORS.get(selector);
  if (hz) return { selector, functionSignature: hz.signature, hazard: hz.hazard, hazardNote: hz.note };
  return { selector, functionSignature: KNOWN_SELECTORS.get(selector) ?? null, hazard: null, hazardNote: null };
}

/** How a ProtocolFeesCollected came about, from the outer transaction's input. */
export function collectionVia(txInput: Hex | undefined): "COLLECT" | "SWEEP" | "INNER_CALL" {
  const sel = txInput?.slice(0, 10).toLowerCase();
  if (sel === COLLECT_SELECTOR) return "COLLECT";
  if (sel === SWEEP_SELECTOR) return "SWEEP";
  return "INNER_CALL";
}
