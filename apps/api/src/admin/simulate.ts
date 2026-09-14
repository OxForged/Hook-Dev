import { BaseError, decodeErrorResult, parseAbi, type Address, type Hex, type PublicClient } from "viem";

/**
 * eth_call simulation for prepared payloads. READ-ONLY: `eth_call` executes
 * against state and discards the result. There is no account object here, no
 * signature, and nothing that could become one — the "from" is just the
 * `from` field of the call.
 *
 * This is the second (and last) place the API process reads a chain, after
 * sign-in role checks. It runs only for an authenticated admin/curator request,
 * behind the admin rate limit, with a bounded timeout.
 */

export interface SimulationRequest {
  from: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface SimulationResult {
  status: "success" | "reverted" | "unavailable";
  from: Address;
  to: Address;
  blockNumber: string | null;
  returnData: Hex | null;
  revert: { name: string | null; args: string[]; raw: Hex | null; message: string } | null;
  error: string | null;
  simulatedAt: string;
  method: "eth_call";
}

export interface Simulator {
  simulate(req: SimulationRequest): Promise<SimulationResult>;
}

/** Custom errors the prepared calls can revert with (OZ v5 + LatchRegistry + LatchTimelock). */
export const KNOWN_ERRORS_ABI = parseAbi([
  "error OwnableUnauthorizedAccount(address account)",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error TimelockInsufficientDelay(uint256 delay, uint256 minDelay)",
  "error TimelockUnexpectedOperationState(bytes32 operationId, bytes32 expectedStates)",
  "error TimelockInvalidOperationLength(uint256 targets, uint256 payloads, uint256 values)",
  "error TimelockUnauthorizedCaller(address caller)",
  "error NotCuratorOrGuardian(address caller)",
  "error GuardianCannotRelist(uint8 current, uint8 requested)",
  "error LatchNotRegistered(address hook)",
  "error StringTooLong(uint256 length, uint256 max)",
]);

const errShort = (e: unknown) => (e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e)).split("\n")[0]!.replace(/https?:\/\/\S+/g, "<url>").slice(0, 300);

/** Find revert data anywhere in a viem error chain. */
export function revertDataOf(e: unknown): Hex | null {
  let found: Hex | null = null;
  const visit = (x: unknown, depth: number) => {
    if (!x || typeof x !== "object" || depth > 8 || found) return;
    const data = (x as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]*$/.test(data) && data.length >= 10) found = data as Hex;
    else if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") visit(data, depth + 1);
    visit((x as { cause?: unknown }).cause, depth + 1);
  };
  visit(e, 0);
  return found;
}

export function describeRevert(raw: Hex | null, message: string): SimulationResult["revert"] {
  if (!raw) return { name: null, args: [], raw: null, message };
  try {
    const d = decodeErrorResult({ abi: KNOWN_ERRORS_ABI, data: raw });
    return { name: d.errorName, args: (d.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a))), raw, message };
  } catch {
    return { name: null, args: [], raw, message };
  }
}

export class RpcSimulator implements Simulator {
  constructor(private readonly client: Pick<PublicClient, "call" | "getBlockNumber">) {}

  async simulate(req: SimulationRequest): Promise<SimulationResult> {
    const base = { from: req.from, to: req.to, simulatedAt: new Date().toISOString(), method: "eth_call" as const };
    let blockNumber: bigint;
    try {
      blockNumber = await this.client.getBlockNumber();
    } catch (e) {
      return { ...base, status: "unavailable", blockNumber: null, returnData: null, revert: null, error: `chain unreachable: ${errShort(e)}` };
    }
    try {
      const r = await this.client.call({ account: req.from, to: req.to, data: req.data, value: req.value ?? 0n, blockNumber });
      return { ...base, status: "success", blockNumber: blockNumber.toString(), returnData: r.data ?? "0x", revert: null, error: null };
    } catch (e) {
      const raw = revertDataOf(e);
      const msg = errShort(e);
      // A transport failure is not a revert. Only call it reverted with revert data or an explicit revert message.
      const isRevert = raw !== null || /revert/i.test(msg);
      if (!isRevert) return { ...base, status: "unavailable", blockNumber: blockNumber.toString(), returnData: null, revert: null, error: msg };
      return { ...base, status: "reverted", blockNumber: blockNumber.toString(), returnData: null, revert: describeRevert(raw, msg), error: null };
    }
  }
}
