import { decodeProtocolFee, decodeProtocolLog, descriptorsForTopic } from "@latchprotocol/sdk";
import { decodeEventLog, type Hex } from "viem";
import { logger } from "../config/logger.js";
import {
  FEE_CONTROLLER_EVENTS_ABI,
  isSdkRole,
  normalizeAddress,
  type ContractRole,
} from "./contracts.js";
import type { RawLog } from "./provider/types.js";

/**
 * Log -> domain event.
 *
 * Decoding is ALWAYS driven by `(chainId, contractRole, topic0)`, never by
 * topic0 alone. See the collision note in ./contracts.ts: `ProtocolFeeUpdated`,
 * `Paused`, `Unpaused`, `OwnershipTransferred`, `ProtocolFeeControllerUpdated`
 * and `DynamicLPFeeUpdated` are byte-identical across contracts, so a
 * topic0-keyed dispatch would merge CL and bin activity into one bucket.
 *
 * The caller resolves an emitting address to a role (from the Chain's recorded
 * deployment addresses) and passes it in; a log from an unknown address is
 * never decoded.
 */

export type PoolTypeName = "CL" | "BIN";

export interface EventMeta {
  readonly chainId: number;
  readonly role: ContractRole;
  /** Emitting contract, lowercased. Persisted on every row. */
  readonly contract: Hex;
  readonly topic0: Hex;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly blockTimestamp: Date;
  readonly logIndex: number;
  /** `${chainId}-${txHash}-${logIndex}` — the primary key of the event row. */
  readonly id: string;
}

export interface PoolInitializedEvent {
  readonly kind: "PoolInitialized";
  readonly meta: EventMeta;
  readonly poolType: PoolTypeName;
  readonly poolId: Hex;
  readonly currency0: Hex;
  readonly currency1: Hex;
  readonly hooks: Hex;
  readonly fee: number;
  readonly parameters: Hex;
  /** CL only. */
  readonly sqrtPriceX96?: bigint;
  /** CL only. */
  readonly tick?: number;
  /** Bin only. */
  readonly activeId?: number;
}

export interface SwapEvent {
  readonly kind: "Swap";
  readonly meta: EventMeta;
  readonly poolType: PoolTypeName;
  readonly poolId: Hex;
  readonly sender: Hex;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly fee: number;
  readonly protocolFee: number;
  readonly sqrtPriceX96?: bigint;
  readonly tick?: number;
  readonly liquidity?: bigint;
  readonly activeId?: number;
}

export interface LiquidityChangeEvent {
  readonly kind: "LiquidityChange";
  readonly meta: EventMeta;
  readonly poolType: PoolTypeName;
  readonly poolId: Hex;
  readonly changeType: "ADD" | "REMOVE";
  readonly sender: Hex;
  readonly salt: Hex;
  readonly tickLower?: number;
  readonly tickUpper?: number;
  readonly liquidityDelta?: bigint;
  readonly binIds?: bigint[];
  /**
   * Packed per-bin amounts, kept as opaque 32-byte words.
   *
   * `Mint`/`Burn` emit `bytes32[] amounts` where each word packs an
   * (amount0, amount1) pair under `PackedUint128Math`. The packing is not
   * unpacked here — doing so correctly requires verifying the layout against
   * `BinHelper`/`PackedUint128Math`, and a wrong guess would silently produce
   * wrong volume numbers. Stored verbatim until that verification happens.
   */
  readonly binAmounts?: Hex[];
  readonly compositionFeeAmount?: Hex;
  readonly feeAmountToProtocol?: Hex;
}

export interface DonateEvent {
  readonly kind: "Donate";
  readonly meta: EventMeta;
  readonly poolType: PoolTypeName;
  readonly poolId: Hex;
  readonly sender: Hex;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly tick?: number;
  readonly binId?: number;
}

export interface DynamicLpFeeEvent {
  readonly kind: "DynamicLpFee";
  readonly meta: EventMeta;
  readonly poolType: PoolTypeName;
  readonly poolId: Hex;
  readonly dynamicLpFee: number;
}

export type ProtocolFeeChangeSourceName =
  | "POOL_MANAGER_PROTOCOL_FEE_UPDATED"
  | "POOL_MANAGER_CONTROLLER_UPDATED"
  | "CONTROLLER_DEFAULT_FEE_UPDATED"
  | "CONTROLLER_POOL_FEE_UPDATED"
  | "CONTROLLER_TIER_FEE_UPDATED"
  | "CONTROLLER_DYNAMIC_FEE_UPDATED"
  | "CONTROLLER_FEES_DISABLED_SET";

export interface ProtocolFeeChangeEvent {
  readonly kind: "ProtocolFeeChange";
  readonly meta: EventMeta;
  readonly source: ProtocolFeeChangeSourceName;
  readonly poolId?: Hex;
  readonly protocolFeeRaw?: number;
  readonly protocolFeeZeroForOne?: number;
  readonly protocolFeeOneForZero?: number;
  readonly isSet?: boolean;
  readonly lpFeeTier?: number;
  readonly disabled?: boolean;
  readonly controller?: Hex;
}

export interface AppRegisteredEvent {
  readonly kind: "AppRegistered";
  readonly meta: EventMeta;
  readonly app: Hex;
}

export interface VaultTokenEvent {
  readonly kind: "VaultToken";
  readonly meta: EventMeta;
  readonly tokenEventKind: "TRANSFER" | "APPROVAL" | "OPERATOR_SET";
  readonly caller?: Hex;
  readonly from?: Hex;
  readonly to?: Hex;
  readonly owner?: Hex;
  readonly spender?: Hex;
  readonly operator?: Hex;
  readonly approved?: boolean;
  readonly currency?: Hex;
  readonly amount?: bigint;
}

export type ProtocolEvent =
  | PoolInitializedEvent
  | SwapEvent
  | LiquidityChangeEvent
  | DonateEvent
  | DynamicLpFeeEvent
  | ProtocolFeeChangeEvent
  | AppRegisteredEvent
  | VaultTokenEvent;

// ---------------------------------------------------------------------------
// Argument coercion helpers
// ---------------------------------------------------------------------------

const asHex = (v: unknown): Hex => normalizeAddress(String(v));
const asRawHex = (v: unknown): Hex => String(v).toLowerCase() as Hex;
const asBigInt = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v)));
const asNumber = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const asBool = (v: unknown): boolean => Boolean(v);

function poolTypeForRole(role: ContractRole): PoolTypeName | undefined {
  if (role === "CLPoolManager") return "CL";
  if (role === "BinPoolManager") return "BIN";
  return undefined;
}

function buildMeta(chainId: number, role: ContractRole, log: RawLog): EventMeta | undefined {
  const topic0 = log.topics[0];
  if (topic0 === undefined) return undefined;
  return {
    chainId,
    role,
    contract: normalizeAddress(log.address),
    topic0: topic0.toLowerCase() as Hex,
    txHash: log.transactionHash.toLowerCase() as Hex,
    blockNumber: log.blockNumber,
    blockTimestamp: new Date(Number(log.blockTimestamp) * 1000),
    logIndex: log.logIndex,
    id: `${chainId}-${log.transactionHash.toLowerCase()}-${log.logIndex}`,
  };
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export interface DecodeResult {
  /** The domain event, or undefined when the log is known but not modelled. */
  readonly event?: ProtocolEvent;
  /** Why a log produced no event. Used for ingestion-run counters. */
  readonly skipReason?: "unknown-signature" | "not-modelled" | "malformed";
  readonly eventName?: string;
}

/**
 * Decode one log that is known to have been emitted by `role`.
 *
 * Returns `{}` with a `skipReason` rather than throwing: an ingestion window
 * routinely contains events this API does not model (ownership transfers,
 * pause toggles), and one unrecognised log must not abort a batch.
 */
export function decodeLog(chainId: number, role: ContractRole, log: RawLog): DecodeResult {
  const meta = buildMeta(chainId, role, log);
  if (!meta) return { skipReason: "malformed" };

  let eventName: string;
  let args: Record<string, unknown>;

  if (isSdkRole(role)) {
    const decoded = decodeProtocolLog(role, { data: log.data, topics: log.topics as [] });
    if (!decoded) {
      // Either the signature is unknown, or it is known but belongs to a
      // different contract — which is exactly the collision case.
      const known = descriptorsForTopic(meta.topic0);
      return {
        skipReason: known.length > 0 ? "not-modelled" : "unknown-signature",
        eventName: known[0]?.eventName,
      };
    }
    eventName = decoded.eventName;
    args = decoded.args;
  } else {
    try {
      const decoded = decodeEventLog({
        abi: FEE_CONTROLLER_EVENTS_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      eventName = decoded.eventName as string;
      args = (decoded.args ?? {}) as unknown as Record<string, unknown>;
    } catch {
      return { skipReason: "unknown-signature" };
    }
  }

  try {
    const event = toDomainEvent(meta, role, eventName, args);
    return event ? { event, eventName } : { skipReason: "not-modelled", eventName };
  } catch (err) {
    logger.warn(
      { err, chainId, role, eventName, tx: meta.txHash, logIndex: meta.logIndex },
      "failed to map decoded log to a domain event",
    );
    return { skipReason: "malformed", eventName };
  }
}

function toDomainEvent(
  meta: EventMeta,
  role: ContractRole,
  eventName: string,
  args: Record<string, unknown>,
): ProtocolEvent | undefined {
  const poolType = poolTypeForRole(role);

  switch (eventName) {
    // --- Vault ------------------------------------------------------------
    case "AppRegistered":
      return { kind: "AppRegistered", meta, app: asHex(args.app) };

    case "Transfer":
      return {
        kind: "VaultToken",
        meta,
        tokenEventKind: "TRANSFER",
        caller: asHex(args.caller),
        from: asHex(args.from),
        to: asHex(args.to),
        currency: asHex(args.currency),
        amount: asBigInt(args.amount),
      };

    case "Approval":
      return {
        kind: "VaultToken",
        meta,
        tokenEventKind: "APPROVAL",
        owner: asHex(args.owner),
        spender: asHex(args.spender),
        currency: asHex(args.currency),
        amount: asBigInt(args.amount),
      };

    case "OperatorSet":
      return {
        kind: "VaultToken",
        meta,
        tokenEventKind: "OPERATOR_SET",
        owner: asHex(args.owner),
        operator: asHex(args.operator),
        approved: asBool(args.approved),
      };

    // --- Pool managers ----------------------------------------------------
    case "Initialize": {
      if (!poolType) return undefined;
      const base = {
        kind: "PoolInitialized" as const,
        meta,
        poolType,
        poolId: asRawHex(args.id),
        currency0: asHex(args.currency0),
        currency1: asHex(args.currency1),
        hooks: asHex(args.hooks),
        fee: asNumber(args.fee),
        parameters: asRawHex(args.parameters),
      };
      return poolType === "CL"
        ? { ...base, sqrtPriceX96: asBigInt(args.sqrtPriceX96), tick: asNumber(args.tick) }
        : { ...base, activeId: asNumber(args.activeId) };
    }

    case "Swap": {
      if (!poolType) return undefined;
      const amount0 = asBigInt(args.amount0);
      const amount1 = asBigInt(args.amount1);
      const base = {
        kind: "Swap" as const,
        meta,
        poolType,
        poolId: asRawHex(args.id),
        sender: asHex(args.sender),
        amount0,
        amount1,
        fee: asNumber(args.fee),
        protocolFee: asNumber(args.protocolFee),
      };
      return poolType === "CL"
        ? {
            ...base,
            sqrtPriceX96: asBigInt(args.sqrtPriceX96),
            liquidity: asBigInt(args.liquidity),
            tick: asNumber(args.tick),
          }
        : { ...base, activeId: asNumber(args.activeId) };
    }

    case "ModifyLiquidity": {
      if (poolType !== "CL") return undefined;
      const liquidityDelta = asBigInt(args.liquidityDelta);
      return {
        kind: "LiquidityChange",
        meta,
        poolType,
        poolId: asRawHex(args.id),
        changeType: liquidityDelta > 0n ? "ADD" : "REMOVE",
        sender: asHex(args.sender),
        salt: asRawHex(args.salt),
        tickLower: asNumber(args.tickLower),
        tickUpper: asNumber(args.tickUpper),
        liquidityDelta,
      };
    }

    case "Mint":
    case "Burn": {
      if (poolType !== "BIN") return undefined;
      const isMint = eventName === "Mint";
      return {
        kind: "LiquidityChange",
        meta,
        poolType,
        poolId: asRawHex(args.id),
        changeType: isMint ? "ADD" : "REMOVE",
        sender: asHex(args.sender),
        salt: asRawHex(args.salt),
        binIds: (args.ids as readonly unknown[]).map(asBigInt),
        binAmounts: (args.amounts as readonly unknown[]).map(asRawHex),
        ...(isMint
          ? {
              compositionFeeAmount: asRawHex(args.compositionFeeAmount),
              feeAmountToProtocol: asRawHex(args.feeAmountToProtocol),
            }
          : {}),
      };
    }

    case "Donate": {
      if (!poolType) return undefined;
      const base = {
        kind: "Donate" as const,
        meta,
        poolType,
        poolId: asRawHex(args.id),
        sender: asHex(args.sender),
        amount0: asBigInt(args.amount0),
        amount1: asBigInt(args.amount1),
      };
      return poolType === "CL"
        ? { ...base, tick: asNumber(args.tick) }
        : { ...base, binId: asNumber(args.binId) };
    }

    case "DynamicLPFeeUpdated": {
      if (!poolType) return undefined;
      return {
        kind: "DynamicLpFee",
        meta,
        poolType,
        poolId: asRawHex(args.id),
        dynamicLpFee: asNumber(args.dynamicLPFee),
      };
    }

    // --- Protocol fee governance -----------------------------------------
    // NOTE: reachable from BOTH pool managers with an identical topic0.
    // `meta.contract` is what separates them downstream.
    case "ProtocolFeeUpdated": {
      const raw = asNumber(args.protocolFee);
      const { zeroForOne, oneForZero } = decodeProtocolFee(raw);
      return {
        kind: "ProtocolFeeChange",
        meta,
        source: "POOL_MANAGER_PROTOCOL_FEE_UPDATED",
        poolId: asRawHex(args.id),
        protocolFeeRaw: raw,
        protocolFeeZeroForOne: zeroForOne,
        protocolFeeOneForZero: oneForZero,
      };
    }

    case "ProtocolFeeControllerUpdated":
      return {
        kind: "ProtocolFeeChange",
        meta,
        source: "POOL_MANAGER_CONTROLLER_UPDATED",
        controller: asHex(args.protocolFeeController),
      };

    // --- LatchProtocolFeeController ---------------------------------------
    case "DefaultFeeUpdated":
      return {
        kind: "ProtocolFeeChange",
        meta,
        source: "CONTROLLER_DEFAULT_FEE_UPDATED",
        protocolFeeZeroForOne: asNumber(args.zeroForOne),
        protocolFeeOneForZero: asNumber(args.oneForZero),
      };

    case "PoolFeeUpdated":
      return {
        kind: "ProtocolFeeChange",
        meta,
        source: "CONTROLLER_POOL_FEE_UPDATED",
        poolId: asRawHex(args.poolId),
        isSet: asBool(args.isSet),
        protocolFeeZeroForOne: asNumber(args.zeroForOne),
        protocolFeeOneForZero: asNumber(args.oneForZero),
      };

    case "TierFeeUpdated":
      return {
        kind: "ProtocolFeeChange",
        meta,
        source: "CONTROLLER_TIER_FEE_UPDATED",
        lpFeeTier: asNumber(args.lpFeeTier),
        isSet: asBool(args.isSet),
        protocolFeeZeroForOne: asNumber(args.zeroForOne),
        protocolFeeOneForZero: asNumber(args.oneForZero),
      };

    case "DynamicFeeUpdated":
      return {
        kind: "ProtocolFeeChange",
        meta,
        source: "CONTROLLER_DYNAMIC_FEE_UPDATED",
        isSet: asBool(args.isSet),
        protocolFeeZeroForOne: asNumber(args.zeroForOne),
        protocolFeeOneForZero: asNumber(args.oneForZero),
      };

    case "FeesDisabledSet":
      return {
        kind: "ProtocolFeeChange",
        meta,
        source: "CONTROLLER_FEES_DISABLED_SET",
        disabled: asBool(args.disabled),
      };

    // Known but not modelled: Paused, Unpaused, OwnershipTransferred,
    // OwnershipTransferStarted, SetMaxBinStep, SetMinBinSharesForDonate.
    default:
      return undefined;
  }
}
