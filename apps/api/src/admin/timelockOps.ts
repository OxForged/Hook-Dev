import type { Abi, Hex } from "viem";
import { TIMELOCK_CALL_DECODE_ABI } from "../chain/abis.js";
import { ROLE_NAMES } from "../indexer/governance.js";
import { decodeCall, type DecodedCall } from "./safeTx.js";

/**
 * TimelockController events -> operations. PURE.
 *
 * One operation = one id. `CallScheduled` rows carry its calls (one per index for
 * a batch), `CallSalt` its salt, `CallExecuted` / `Cancelled` its end state. The
 * ready time is the scheduling block's timestamp + delay, which is what
 * TimelockController stores (`block.timestamp + delay`).
 */

export interface TimelockEventRow {
  chainId: number;
  timelock: string;
  tier: string;
  eventName: string;
  operationId: string | null;
  callIndex: number | null;
  target: string | null;
  value: string | null;
  data: string | null;
  selector: string | null;
  functionSignature: string | null;
  predecessor: string | null;
  salt: string | null;
  delaySeconds: string | null;
  hazard: string | null;
  hazardNote: string | null;
  blockNumber: string;
  blockTimestamp: string;
  txHash: string;
  logIndex: number;
}

export type OperationStatus = "PENDING" | "READY" | "EXECUTED" | "CANCELLED";

export interface TimelockOperation {
  chainId: number;
  timelock: string;
  tier: string;
  operationId: string;
  status: OperationStatus;
  scheduledAt: { blockNumber: string; blockTimestamp: string; txHash: string };
  delaySeconds: string | null;
  readyAt: string | null;
  executedAt: { blockNumber: string; blockTimestamp: string; txHash: string } | null;
  cancelledAt: { blockNumber: string; blockTimestamp: string; txHash: string } | null;
  /** From the CallSalt event (OZ emits it only for a non-zero salt). Null when not indexed. */
  salt: string | null;
  predecessor: string | null;
  calls: {
    index: number;
    target: string;
    value: string;
    data: string;
    selector: string | null;
    functionSignature: string | null;
    decoded: DecodedCall | null;
    roleName: string | null;
    hazard: string | null;
    hazardNote: string | null;
  }[];
  hazards: string[];
}

const at = (r: TimelockEventRow) => ({ blockNumber: r.blockNumber, blockTimestamp: r.blockTimestamp, txHash: r.txHash });

export function groupTimelockOperations(rows: readonly TimelockEventRow[], now: Date = new Date()): { operations: TimelockOperation[]; delayChanges: { timelock: string; tier: string; newDelaySeconds: string | null; blockNumber: string; blockTimestamp: string; txHash: string }[] } {
  const sorted = [...rows].sort((a, b) => (BigInt(a.blockNumber) === BigInt(b.blockNumber) ? a.logIndex - b.logIndex : BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : 1));
  const ops = new Map<string, TimelockOperation>();
  // CallSalt is emitted after the CallScheduled rows of the same schedule call, but
  // keep salts by id regardless of order.
  const salts = new Map<string, string>();
  for (const r of sorted) if (r.eventName === "CallSalt" && r.operationId && r.salt) salts.set(`${r.timelock}:${r.operationId}`, r.salt);
  const delayChanges: { timelock: string; tier: string; newDelaySeconds: string | null; blockNumber: string; blockTimestamp: string; txHash: string }[] = [];
  const key = (r: TimelockEventRow) => `${r.timelock}:${r.operationId}`;

  for (const r of sorted) {
    if (r.eventName === "MinDelayChange") {
      delayChanges.push({ timelock: r.timelock, tier: r.tier, newDelaySeconds: r.delaySeconds, ...at(r) });
      continue;
    }
    if (!r.operationId) continue;
    let op = ops.get(key(r));
    if (r.eventName === "CallScheduled") {
      if (!op) {
        op = {
          chainId: r.chainId,
          timelock: r.timelock,
          tier: r.tier,
          operationId: r.operationId,
          status: "PENDING",
          scheduledAt: at(r),
          delaySeconds: r.delaySeconds,
          readyAt: r.delaySeconds === null ? null : new Date(new Date(r.blockTimestamp).getTime() + Number(r.delaySeconds) * 1000).toISOString(),
          executedAt: null,
          cancelledAt: null,
          salt: salts.get(key(r)) ?? null,
          predecessor: r.predecessor,
          calls: [],
          hazards: [],
        };
        ops.set(key(r), op);
      }
      const data = (r.data ?? "0x") as Hex;
      const decoded = decodeCall(TIMELOCK_CALL_DECODE_ABI as unknown as Abi, data);
      const roleArg = decoded?.args.find((a) => a.type === "bytes32" && (a.name === "role"));
      op.calls.push({
        index: r.callIndex ?? op.calls.length,
        target: r.target ?? "",
        value: r.value ?? "0",
        data,
        selector: r.selector,
        functionSignature: r.functionSignature,
        decoded,
        roleName: roleArg ? (ROLE_NAMES.get(String(roleArg.value).toLowerCase()) ?? null) : null,
        hazard: r.hazard,
        hazardNote: r.hazardNote,
      });
      if (r.hazard && !op.hazards.includes(r.hazard)) op.hazards.push(r.hazard);
    } else if (op && r.eventName === "CallExecuted") {
      op.executedAt = at(r);
    } else if (op && r.eventName === "Cancelled") {
      op.cancelledAt = at(r);
    }
  }

  for (const op of ops.values()) {
    op.calls.sort((a, b) => a.index - b.index);
    // A cancelled operation's on-chain timestamp is 0. It has no ready time: never
    // render it as executable (the "executable 1970" bug).
    if (op.cancelledAt) {
      op.status = "CANCELLED";
      op.readyAt = null;
    }
    else if (op.executedAt) op.status = "EXECUTED";
    else if (op.readyAt && new Date(op.readyAt).getTime() <= now.getTime()) op.status = "READY";
    else op.status = "PENDING";
  }
  const operations = [...ops.values()].sort((a, b) => (BigInt(b.scheduledAt.blockNumber) > BigInt(a.scheduledAt.blockNumber) ? 1 : -1));
  return { operations, delayChanges };
}
