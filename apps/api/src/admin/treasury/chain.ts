import {
  CL_QUOTER_ABI,
  CLOCK_MODE_CALLDATA,
  decodeRevSharePendingConfig,
  getContractClock,
  encodeGetPendingConfig,
  inferRevSharePendingShape,
  readContractClock,
  revShareProposalStatus,
  secondsUntil,
  type DurationClock,
  type RevShareHookRecord,
} from "@latchprotocol/sdk";
import {
  BaseError,
  decodeAbiParameters,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { describeRevert, revertDataOf } from "../simulate.js";
import { decodeMultiSend, encodeMultiSend } from "./batch.js";
import type { HookFacts, HopState, RouteCandidate } from "./route.js";

/**
 * Chain reads for treasury conversion. READ-ONLY: every method is an eth_call,
 * eth_getBalance, eth_getCode or eth_getStorageAt. There is no account object,
 * no key and no send method on the client type below, by construction.
 */

export interface TreasuryClient {
  call(args: { to?: Address; data: Hex; account?: Address; blockNumber?: bigint; stateOverride?: { address: Address; code?: Hex; balance?: bigint }[] }): Promise<{ data?: Hex | undefined }>;
  getBlock(): Promise<{ number: bigint | null; timestamp: bigint }>;
  getBlockNumber(): Promise<bigint>;
  getBalance(args: { address: Address; blockNumber?: bigint }): Promise<bigint>;
  getCode(args: { address: Address; blockNumber?: bigint }): Promise<Hex | undefined>;
  getStorageAt(args: { address: Address; slot: Hex; blockNumber?: bigint }): Promise<Hex | undefined>;
}

const ERC20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function allowance(address owner, address spender) view returns (uint256)"]);
const SLOT0 = parseAbi(["function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const REGISTRY = parseAbi(["function isRegistered(address hook) view returns (bool)", "function statusOf(address hook) view returns (uint8 verification, uint8 listing)"]);
const SAFE = parseAbi(["function VERSION() view returns (string)"]);
const QUOTER_ERRORS = parseAbi(["error NotEnoughLiquidity(bytes32 poolId)", "error UnexpectedCallSuccess()", "error NotSelf()"]);
const LISTINGS = ["Active", "Deprecated", "Malicious"] as const;
/** Safe v1.4.1 GuardManager: keccak256("guard_manager.guard.address"). */
export const SAFE_GUARD_SLOT: Hex = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";

export const shortErr = (e: unknown) => (e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e)).split("\n")[0]!.replace(/https?:\/\/\S+/g, "<url>").slice(0, 240);

async function read<T>(client: TreasuryClient, to: Address, abi: Abi, functionName: string, args: readonly unknown[], blockNumber?: bigint): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const r = await client.call({ to, data, blockNumber });
  return decodeFunctionResult({ abi, functionName, data: r.data ?? "0x" } as never) as T;
}

export interface ChainHead {
  blockNumber: bigint;
  timestamp: bigint;
  contractBlockNumber: bigint;
  contractClockMethod: string;
}

export class TreasuryReader {
  constructor(
    readonly client: TreasuryClient,
    readonly chainId: number,
  ) {}

  async head(): Promise<ChainHead> {
    const clock = await readContractClock(this.client as never, this.chainId);
    return { blockNumber: clock.rpcBlockNumber, timestamp: clock.timestamp, contractBlockNumber: clock.contractBlockNumber, contractClockMethod: clock.method };
  }

  async tokenState(token: Address, safe: Address, blockNumber: bigint) {
    const [symbol, decimals, balance] = await Promise.all([
      read<string>(this.client, token, ERC20 as unknown as Abi, "symbol", [], blockNumber).catch(() => null),
      read<number>(this.client, token, ERC20 as unknown as Abi, "decimals", [], blockNumber).then(Number),
      read<bigint>(this.client, token, ERC20 as unknown as Abi, "balanceOf", [safe], blockNumber),
    ]);
    return { symbol, decimals, balance };
  }

  async allowance(token: Address, owner: Address, spender: Address, blockNumber: bigint): Promise<bigint> {
    return read<bigint>(this.client, token, ERC20 as unknown as Abi, "allowance", [owner, spender], blockNumber);
  }

  nativeBalance(address: Address, blockNumber: bigint) {
    return this.client.getBalance({ address, blockNumber });
  }

  async slot0(poolManager: Address, poolId: Hex, blockNumber: bigint): Promise<HopState & { tick: number }> {
    const [sqrtPriceX96, tick, protocolFee, lpFee] = await read<[bigint, number, number, number]>(this.client, poolManager, SLOT0 as unknown as Abi, "getSlot0", [poolId], blockNumber);
    return { sqrtPriceX96, tick: Number(tick), protocolFee: Number(protocolFee), lpFee: Number(lpFee) };
  }

  /**
   * Exact-in quote from the Latch CLQuoter. The quoter EXECUTES the swap
   * (hooks included, so hook deltas are in the number) and unwinds it; it is
   * called with eth_call only.
   */
  async quote(quoter: Address, route: RouteCandidate, amountIn: bigint, blockNumber: bigint): Promise<{ status: "ok"; amountOut: bigint; gasEstimate: bigint } | { status: "reverted"; reason: string } | { status: "error"; error: string }> {
    const abi = CL_QUOTER_ABI as unknown as Abi;
    const single = route.hops.length === 1;
    const h0 = route.hops[0]!;
    const args = single
      ? [{ poolKey: { ...h0.key, currency0: getAddress(h0.key.currency0), currency1: getAddress(h0.key.currency1), hooks: getAddress(h0.key.hooks), poolManager: getAddress(h0.key.poolManager) }, zeroForOne: h0.zeroForOne, exactAmount: amountIn, hookData: "0x" }]
      : [{ exactCurrency: getAddress(route.tokenIn), path: route.hops.map((h) => ({ intermediateCurrency: getAddress(h.currencyOut), fee: h.key.fee, hooks: getAddress(h.key.hooks), poolManager: getAddress(h.key.poolManager), hookData: "0x", parameters: h.key.parameters })), exactAmount: amountIn }];
    const functionName = single ? "quoteExactInputSingle" : "quoteExactInput";
    try {
      const data = encodeFunctionData({ abi, functionName, args } as never);
      const r = await this.client.call({ to: quoter, data, blockNumber });
      const [amountOut, gasEstimate] = decodeFunctionResult({ abi, functionName, data: r.data ?? "0x" } as never) as [bigint, bigint];
      return { status: "ok", amountOut, gasEstimate };
    } catch (e) {
      const raw = revertDataOf(e);
      const msg = shortErr(e);
      if (raw === null && !/revert/i.test(msg)) return { status: "error", error: msg };
      let reason = msg;
      if (raw) {
        try {
          const d = decodeErrorResult({ abi: [...QUOTER_ERRORS, ...(abi.filter((x) => x.type === "error") as never[])], data: raw });
          reason = `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
        } catch {
          reason = `reverted with ${raw.slice(0, 10)}`;
        }
      }
      return { status: "reverted", reason };
    }
  }

  async registryFacts(registry: Address, hook: Address, blockNumber: bigint): Promise<HookFacts["registry"]> {
    try {
      const registered = await read<boolean>(this.client, registry, REGISTRY as unknown as Abi, "isRegistered", [hook], blockNumber);
      if (!registered) return { status: "read", registered: false, listing: null };
      // statusOf returns (verification, listing): listing is the SECOND word.
      const [, listing] = await read<[number, number]>(this.client, registry, REGISTRY as unknown as Abi, "statusOf", [hook], blockNumber);
      const n = Number(listing);
      return { status: "read", registered: true, listing: LISTINGS[n] ?? (`unknown(${n})` as const) };
    } catch (e) {
      return { status: "error", error: shortErr(e) };
    }
  }

  /**
   * RevShare pending config for a pool, decoded by the SHAPE the SDK address book
   * records for that hook address and judged on THAT hook's clock (contract
   * block number from readContractClock, or block.timestamp). Never by length.
   */
  async pendingFacts(record: RevShareHookRecord, poolId: Hex, head: ChainHead, deadlineSeconds: number): Promise<NonNullable<HookFacts["pending"]>> {
    try {
      const r = await this.client.call({ to: getAddress(record.address), data: encodeGetPendingConfig(poolId), blockNumber: head.blockNumber });
      const d = decodeRevSharePendingConfig(r.data ?? "0x", record.pendingShape);
      const now = { timestamp: head.timestamp, contractBlockNumber: head.contractBlockNumber };
      const status = revShareProposalStatus(d, now);
      let maturesWithinDeadline = false;
      if (status === "queued") {
        const secs = secondsUntil(d.durationClock as DurationClock, d.effective, now, getContractClock(this.chainId));
        // Unknown time-to-maturity is treated as "inside the deadline".
        maturesWithinDeadline = secs === null || secs <= deadlineSeconds;
      }
      return { status, shape: d.shape, effective: d.effective.toString(), expiry: d.expiry?.toString() ?? null, maturesWithinDeadline };
    } catch (e) {
      return { status: "error", error: shortErr(e) };
    }
  }

  /**
   * For a hook the address book does NOT know: does it expose RevShare's
   * getPendingConfig? A revert means no (null: not a RevShare-style hook). A
   * 7/8-word answer is decoded by the shape `inferRevSharePendingShape` derives
   * from CLOCK_MODE() and the length; an answer matching no known build is an
   * error (and the pool is refused), never a guess.
   */
  async probePendingFacts(hook: Address, poolId: Hex, head: ChainHead, deadlineSeconds: number): Promise<HookFacts["pending"]> {
    let raw: Hex;
    try {
      raw = (await this.client.call({ to: getAddress(hook), data: encodeGetPendingConfig(poolId), blockNumber: head.blockNumber })).data ?? "0x";
    } catch (e) {
      if (revertDataOf(e) !== null || /revert/i.test(shortErr(e))) return null;
      return { status: "error", error: shortErr(e) };
    }
    if (raw === "0x") return null;
    const words = (raw.length - 2) / 64;
    let clockMode: string | null = null;
    try {
      const r = await this.client.call({ to: getAddress(hook), data: CLOCK_MODE_CALLDATA, blockNumber: head.blockNumber });
      [clockMode] = decodeAbiParameters([{ type: "string" }], r.data ?? "0x");
    } catch (e) {
      if (!(revertDataOf(e) !== null || /revert/i.test(shortErr(e)))) return { status: "error", error: shortErr(e) };
    }
    const shape = inferRevSharePendingShape(clockMode, words);
    if (!shape) return { status: "error", error: `getPendingConfig answered ${words} words with CLOCK_MODE ${clockMode ?? "reverted"}: no known RevShareHook build` };
    return this.pendingFacts({ address: getAddress(hook), durationClock: shape === "timestamp-with-expiry" ? "timestamp" : "contract-block", pendingShape: shape, status: "retired", note: "inferred" }, poolId, head, deadlineSeconds);
  }

  async codeHash(address: Address, blockNumber: bigint): Promise<Hex | null> {
    const code = await this.client.getCode({ address, blockNumber });
    return code && code !== "0x" ? keccak256(code) : null;
  }

  async safeFacts(safe: Address, blockNumber: bigint): Promise<{ version: string | null; guard: Address | null; error: string | null }> {
    try {
      const [version, guardWord] = await Promise.all([
        read<string>(this.client, safe, SAFE as unknown as Abi, "VERSION", [], blockNumber).catch(() => null),
        this.client.getStorageAt({ address: safe, slot: SAFE_GUARD_SLOT, blockNumber }),
      ]);
      const guard = guardWord && BigInt(guardWord) !== 0n ? getAddress(`0x${guardWord.slice(-40)}`) : null;
      return { version, guard, error: null };
    } catch (e) {
      return { version: null, guard: null, error: shortErr(e) };
    }
  }

  /**
   * Simulates the Safe executing this batch: an eth_call to the SAFE's address
   * whose code is overridden (state override, this call only) with a 70-byte
   * stub that DELEGATECALLs MultiSendCallOnly with the same calldata, exactly as
   * Safe.execTransaction does for operation 1. The Safe's storage, token balances
   * and allowances are real; every inner CALL has msg.sender = the Safe. The stub
   * returns (SELFBALANCE before, SELFBALANCE after), so native received is
   * measured, not inferred. Empty calldata (ETH arriving from the router) is
   * accepted with STOP, as the Safe's receive() would.
   */
  async simulateBatch(p: { safe: Address; multiSend: Address; data: Hex; minOut: bigint; blockNumber: bigint }): Promise<ConversionSimulation> {
    const base = { simulatedAt: new Date().toISOString(), blockNumber: p.blockNumber.toString(), from: getAddress(p.safe) };
    const facts = await this.safeFacts(p.safe, p.blockNumber);
    const notSimulated = [
      "Safe.execTransaction itself: owner signatures, the 2-of-3 threshold and the nonce (the Safe's code is replaced by the stub for this call).",
      facts.guard ? `The Safe has a transaction guard set (${facts.guard}); its checkTransaction/checkAfterExecution were NOT run.` : facts.error ? `Whether a transaction guard is set (the guard slot read failed: ${facts.error}).` : "No transaction guard: the guard slot reads zero, so there is no guard check to simulate.",
      "SafeReceived event on incoming ETH (the stub accepts ETH silently; balances are unaffected).",
      "Gas: eth_call ran with the node's call gas cap, not a signed safeTxGas. Estimate gas in the Safe app.",
      "State between this block and execution. The min-out and the deadline bound what can change; nothing else does.",
    ];
    const simulated = [
      `All ${decodeMultiSend(p.data).length} inner calls in order, as CALLs from the Safe's address, in one eth_call at block ${p.blockNumber}, atomically (a revert in any call reverts the batch).`,
      "Real token balances and allowances of the Safe, the real Permit2, the real Latch UniversalRouter, Vault, pool managers and hooks.",
      "Native ETH received by the Safe, measured as SELFBALANCE after minus before.",
    ];
    try {
      const r = await this.client.call({ to: getAddress(p.safe), data: p.data, blockNumber: p.blockNumber, stateOverride: [{ address: getAddress(p.safe), code: safeDelegatecallStub(p.multiSend) }] });
      const [before, after] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], r.data ?? "0x");
      const received = after - before;
      return { ...base, method: "eth_call: MultiSend delegatecall under a Safe-code state override", status: "success", nativeBalanceBefore: before.toString(), nativeBalanceAfter: after.toString(), nativeReceived: received.toString(), meetsMinOut: received >= p.minOut, revert: null, error: null, safe: facts, simulated, notSimulated, steps: null };
    } catch (e) {
      const raw = revertDataOf(e);
      const msg = shortErr(e);
      const isRevert = raw !== null || /revert/i.test(msg);
      if (isRevert) {
        // MultiSendCallOnly v1.4.1 reverts with EMPTY data, so the reason is lost. Find
        // WHICH call failed by simulating ever-longer prefixes of the same batch.
        const inner = decodeMultiSend(p.data);
        const steps: NonNullable<ConversionSimulation["steps"]> = [];
        let failed = inner.length - 1;
        for (let k = 1; k < inner.length; k++) {
          try {
            await this.client.call({ to: getAddress(p.safe), data: encodeMultiSend(inner.slice(0, k).map((c) => ({ to: c.to, value: BigInt(c.value), data: c.data }))), blockNumber: p.blockNumber, stateOverride: [{ address: getAddress(p.safe), code: safeDelegatecallStub(p.multiSend) }] });
            steps.push({ index: k - 1, status: "success", detail: `calls 0..${k - 1} succeed as a batch` });
          } catch {
            failed = k - 1;
            break;
          }
        }
        steps.push({ index: failed, status: "reverted", detail: `the batch first reverts at inner call ${failed}; MultiSendCallOnly does not return the reason` });
        for (let i = failed + 1; i < inner.length; i++) steps.push({ index: i, status: "not-simulated", detail: "after the failing call" });
        return { ...base, method: "eth_call: MultiSend delegatecall under a Safe-code state override", status: "reverted", nativeBalanceBefore: null, nativeBalanceAfter: null, nativeReceived: null, meetsMinOut: null, revert: describeRevert(raw, `${msg} (at inner call ${failed})`), error: null, safe: facts, simulated, notSimulated, steps };
      }
      // The endpoint refused the override (or the chain is unreachable): fall back to
      // simulating the two approvals individually from the Safe. The swap depends on
      // both, so it is reported as NOT simulated rather than simulated against state
      // it would never see.
      const inner = decodeMultiSend(p.data);
      const steps: ConversionSimulation["steps"] = [];
      for (const [i, c] of inner.entries()) {
        if (i === 2) {
          steps.push({ index: i, status: "not-simulated", detail: "depends on calls 0 and 1 having executed; eth_call without a state override cannot carry their effects" });
          continue;
        }
        try {
          await this.client.call({ to: c.to, data: c.data, account: getAddress(p.safe), blockNumber: p.blockNumber });
          steps.push({ index: i, status: "success", detail: "eth_call from the Safe" });
        } catch (err) {
          steps.push({ index: i, status: revertDataOf(err) !== null || /revert/i.test(shortErr(err)) ? "reverted" : "unavailable", detail: shortErr(err) });
        }
      }
      return {
        ...base,
        method: "fallback: per-call eth_call from the Safe (state override unavailable)",
        status: "unavailable",
        nativeBalanceBefore: null,
        nativeBalanceAfter: null,
        nativeReceived: null,
        meetsMinOut: null,
        revert: null,
        error: `the batch could not be simulated as a whole: ${msg}`,
        safe: facts,
        simulated: ["Calls 0 and 1 individually from the Safe (see steps)."],
        notSimulated: ["Call 2, the swap, and therefore the native ETH the Safe would receive.", ...notSimulated],
        steps,
      };
    }
  }
}

export interface ConversionSimulation {
  method: string;
  status: "success" | "reverted" | "unavailable";
  from: Address;
  blockNumber: string;
  simulatedAt: string;
  nativeBalanceBefore: string | null;
  nativeBalanceAfter: string | null;
  nativeReceived: string | null;
  meetsMinOut: boolean | null;
  revert: ReturnType<typeof describeRevert>;
  error: string | null;
  safe: { version: string | null; guard: Address | null; error: string | null };
  simulated: string[];
  notSimulated: string[];
  steps: { index: number; status: "success" | "reverted" | "unavailable" | "not-simulated"; detail: string }[] | null;
}

/**
 * 70 bytes of runtime code for the simulation-only state override. Never deployed.
 *
 *   36 15 6044 57            if calldatasize == 0 goto STOP (accept ETH)
 *   47                       SELFBALANCE (before)
 *   36 6000 6000 37          calldatacopy(0, 0, calldatasize)
 *   6000 6000 36 6000 73<a>  delegatecall(gas, multiSend, 0, calldatasize, 0, 0)
 *   5a f4
 *   6037 57                  if success goto OK
 *   3d 6000 6000 3e 3d 6000 fd   revert with the returndata
 *   5b 6000 52 47 6020 52 6040 6000 f3   OK: return (before, SELFBALANCE)
 *   5b 00                    STOP
 */
export function safeDelegatecallStub(multiSend: Address): Hex {
  const a = getAddress(multiSend).slice(2).toLowerCase();
  return `0x36156044574736600060003760006000366000${"73"}${a}5af46037573d600060003e3d6000fd5b6000524760205260406000f35b00` as Hex;
}
