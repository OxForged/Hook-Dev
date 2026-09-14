import {
  concatHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hexToBigInt,
  hexToNumber,
  isAddress,
  maxUint128,
  parseAbi,
  size,
  sliceHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { UNIVERSAL_ROUTER_ABI } from "@latchprotocol/sdk";
import { decodeCall, type DecodedCall } from "../safeTx.js";
import { NATIVE, type Hop, type RouteCandidate } from "./route.js";

/**
 * The Safe batch for one treasury conversion, and an independent decoder for it.
 * Builds calldata only: no key, no client, no send path. The payload is signed by
 * the Safe owners in the Safe app, or not at all.
 *
 * Encoding is checked against the FORK'S source, not Uniswap's docs:
 *   packages/router/src/libraries/Commands.sol   INFI_SWAP 0x10, UNWRAP_WETH 0x0c
 *   packages/periphery/src/libraries/Actions.sol CL_SWAP_EXACT_IN_SINGLE 0x06,
 *     CL_SWAP_EXACT_IN 0x07, SETTLE_ALL 0x0c, TAKE 0x0e
 *   packages/periphery/src/pool-cl/interfaces/ICLRouterBase.sol
 *     CLSwapExactInputSingleParams (PoolKey, bool, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)
 *     CLSwapExactInputParams (Currency currencyIn, PathKey[] path, uint128 amountIn, uint128 amountOutMinimum)
 *   packages/periphery/src/libraries/PathKey.sol
 *     (Currency intermediateCurrency, uint24 fee, IHooks hooks, IPoolManager poolManager, bytes hookData, bytes32 parameters)
 * There is NO `minHopPriceX36` (or any per-hop price) field in this fork's
 * structs; that field belongs to a different router lineage. Encoding one in
 * would shift every later word and the router would decode garbage.
 */

export const COMMANDS = { INFI_SWAP: 0x10, UNWRAP_WETH: 0x0c } as const;
export const ACTIONS = { CL_SWAP_EXACT_IN_SINGLE: 0x06, CL_SWAP_EXACT_IN: 0x07, SETTLE_ALL: 0x0c, TAKE: 0x0e } as const;
/** ActionConstants: OPEN_DELTA = 0 (take the full credit), ADDRESS_THIS = address(2) (the router). */
export const OPEN_DELTA = 0n;
export const ADDRESS_THIS: Address = "0x0000000000000000000000000000000000000002";

export const ERC20_APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
export const PERMIT2_APPROVE_ABI = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
export const MULTISEND_ABI = parseAbi(["function multiSend(bytes transactions) payable"]);

const POOL_KEY = { name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "hooks", type: "address" }, { name: "poolManager", type: "address" }, { name: "fee", type: "uint24" }, { name: "parameters", type: "bytes32" }] } as const;
const SINGLE_PARAMS = [{ type: "tuple", components: [POOL_KEY, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }] as const;
const PATH_KEY = { name: "path", type: "tuple[]", components: [{ name: "intermediateCurrency", type: "address" }, { name: "fee", type: "uint24" }, { name: "hooks", type: "address" }, { name: "poolManager", type: "address" }, { name: "hookData", type: "bytes" }, { name: "parameters", type: "bytes32" }] } as const;
const MULTI_PARAMS = [{ type: "tuple", components: [{ name: "currencyIn", type: "address" }, PATH_KEY, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }] }] as const;
const ACTIONS_ROUTER_PARAMS = [{ name: "actions", type: "bytes" }, { name: "params", type: "bytes[]" }] as const;

/* ---------------------------------------------------------------------------
   Router plan
   --------------------------------------------------------------------------- */

export interface RouterPlan {
  commands: Hex;
  inputs: Hex[];
  deadline: bigint;
}

/**
 * UniversalRouter.execute(commands, inputs, deadline) for an exact-in swap of
 * `amountIn` along `route`, paid by the Safe through Permit2, proceeds to the
 * Safe as NATIVE:
 *
 *   INFI_SWAP [ swap(amountIn, amountOutMinimum = minOut),
 *               SETTLE_ALL(tokenIn, maxAmount = amountIn),
 *               TAKE(native -> Safe, full credit) ]                      route ends in native
 *   INFI_SWAP [ swap, SETTLE_ALL, TAKE(WETH -> router, full credit) ]
 *   UNWRAP_WETH(recipient = Safe, amountMin = minOut)                      route ends in WETH
 *
 * The min-out is enforced twice on a WETH route (in the swap and in the unwrap)
 * and once on a native route (in the swap); SETTLE_ALL caps what Permit2 can pull
 * at exactly amountIn.
 */
export function buildRouterPlan(p: { route: RouteCandidate; amountIn: bigint; minOut: bigint; recipient: Address; weth: Address; deadline: bigint }): RouterPlan {
  if (p.amountIn <= 0n || p.amountIn > maxUint128) throw new RangeError("amountIn must be in (0, 2^128)");
  if (p.minOut <= 0n || p.minOut > maxUint128) throw new RangeError("minOut must be in (0, 2^128)");
  if (!isAddress(p.recipient) || p.recipient.toLowerCase() === NATIVE) throw new Error("recipient must be a non-zero address");
  const hops = p.route.hops;
  const last = hops[hops.length - 1]!;
  const out = last.currencyOut;
  if (p.route.end === "native" && out !== NATIVE) throw new Error("route marked native does not end in the native currency");
  if (p.route.end === "weth" && out.toLowerCase() !== p.weth.toLowerCase()) throw new Error("route marked weth does not end in WETH");

  const swap = hops.length === 1 ? encodeSingle(hops[0]!, p.amountIn, p.minOut) : encodeMulti(p.route.tokenIn, hops, p.amountIn, p.minOut);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(p.route.tokenIn), p.amountIn]);
  const takeTo = p.route.end === "native" ? getAddress(p.recipient) : ADDRESS_THIS;
  const take = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [getAddress(out), takeTo, OPEN_DELTA]);
  const actions = encodePacked(["uint8", "uint8", "uint8"], [swap.action, ACTIONS.SETTLE_ALL, ACTIONS.TAKE]);
  const infi = encodeAbiParameters(ACTIONS_ROUTER_PARAMS, [actions, [swap.params, settle, take]]);
  if (p.route.end === "native") return { commands: encodePacked(["uint8"], [COMMANDS.INFI_SWAP]), inputs: [infi], deadline: p.deadline };
  const unwrap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(p.recipient), p.minOut]);
  return { commands: encodePacked(["uint8", "uint8"], [COMMANDS.INFI_SWAP, COMMANDS.UNWRAP_WETH]), inputs: [infi, unwrap], deadline: p.deadline };
}

function encodeSingle(h: Hop, amountIn: bigint, minOut: bigint) {
  const k = h.key;
  return {
    action: ACTIONS.CL_SWAP_EXACT_IN_SINGLE,
    params: encodeAbiParameters(SINGLE_PARAMS, [{ poolKey: { currency0: getAddress(k.currency0), currency1: getAddress(k.currency1), hooks: getAddress(k.hooks), poolManager: getAddress(k.poolManager), fee: k.fee, parameters: k.parameters }, zeroForOne: h.zeroForOne, amountIn, amountOutMinimum: minOut, hookData: "0x" }]),
  };
}

function encodeMulti(tokenIn: Address, hops: readonly Hop[], amountIn: bigint, minOut: bigint) {
  return {
    action: ACTIONS.CL_SWAP_EXACT_IN,
    params: encodeAbiParameters(MULTI_PARAMS, [{ currencyIn: getAddress(tokenIn), path: hops.map((h) => ({ intermediateCurrency: getAddress(h.currencyOut), fee: h.key.fee, hooks: getAddress(h.key.hooks), poolManager: getAddress(h.key.poolManager), hookData: "0x" as Hex, parameters: h.key.parameters })), amountIn, amountOutMinimum: minOut }]),
  };
}

export function encodeRouterExecute(plan: RouterPlan): Hex {
  return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: "execute", args: [plan.commands, plan.inputs, plan.deadline] });
}

/* ---------------------------------------------------------------------------
   MultiSend
   --------------------------------------------------------------------------- */

export interface InnerCall {
  to: Address;
  value: bigint;
  data: Hex;
}

/** Safe MultiSend packing: uint8 operation (always 0: CALL) | address to | uint256 value | uint256 len | bytes data. */
export function encodeMultiSend(calls: readonly InnerCall[]): Hex {
  if (calls.length === 0) throw new Error("empty batch");
  const packed = concatHex(calls.map((c) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, getAddress(c.to), c.value, BigInt(size(c.data)), c.data])));
  return encodeFunctionData({ abi: MULTISEND_ABI, functionName: "multiSend", args: [packed] });
}

export interface DecodedInner {
  operation: number;
  to: Address;
  value: string;
  data: Hex;
}

/** Inverse of encodeMultiSend, from calldata. Throws on any malformed packing. */
export function decodeMultiSend(data: Hex): DecodedInner[] {
  const { functionName, args } = decodeFunctionData({ abi: MULTISEND_ABI, data });
  if (functionName !== "multiSend") throw new Error("not multiSend(bytes)");
  const tx = args[0] as Hex;
  const total = size(tx);
  const out: DecodedInner[] = [];
  let i = 0;
  while (i < total) {
    if (i + 85 > total) throw new Error("truncated MultiSend entry");
    const operation = hexToNumber(sliceHex(tx, i, i + 1));
    const to = getAddress(sliceHex(tx, i + 1, i + 21));
    const value = hexToBigInt(sliceHex(tx, i + 21, i + 53));
    const len = Number(hexToBigInt(sliceHex(tx, i + 53, i + 85)));
    if (i + 85 + len > total) throw new Error("MultiSend data length overruns the batch");
    const inner = len === 0 ? "0x" : sliceHex(tx, i + 85, i + 85 + len);
    out.push({ operation, to, value: value.toString(), data: inner });
    i += 85 + len;
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Router decode (independent of the encoder's inputs: reads the calldata)
   --------------------------------------------------------------------------- */

export interface DecodedRouterStep {
  command: string;
  commandByte: string;
  actions?: { action: string; actionByte: string; params: Record<string, unknown> }[];
  params?: Record<string, string>;
}

const COMMAND_NAMES = new Map<number, string>(Object.entries(COMMANDS).map(([k, v]) => [v, k]));
const ACTION_NAMES = new Map<number, string>(Object.entries(ACTIONS).map(([k, v]) => [v, k]));
const s = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));

export function decodeRouterExecute(data: Hex): { deadline: string | null; steps: DecodedRouterStep[] } {
  const d = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data });
  if (d.functionName !== "execute") throw new Error("not UniversalRouter.execute");
  const args = d.args as readonly unknown[];
  const commands = args[0] as Hex;
  const inputs = args[1] as readonly Hex[];
  const deadline = args.length > 2 ? s(args[2]) : null;
  const bytes = size(commands);
  if (bytes !== inputs.length) throw new Error("commands and inputs differ in length");
  const steps: DecodedRouterStep[] = [];
  for (let i = 0; i < bytes; i++) {
    const c = hexToNumber(sliceHex(commands, i, i + 1));
    const name = COMMAND_NAMES.get(c & 0x3f);
    if (!name || (c & 0x80) !== 0) throw new Error(`command 0x${c.toString(16)} is not one this builder emits`);
    if (c === COMMANDS.UNWRAP_WETH) {
      const [recipient, amountMin] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], inputs[i]!);
      steps.push({ command: name, commandByte: `0x${c.toString(16).padStart(2, "0")}`, params: { recipient: getAddress(recipient), amountMin: s(amountMin) } });
      continue;
    }
    const [actions, params] = decodeAbiParameters(ACTIONS_ROUTER_PARAMS, inputs[i]!);
    const n = size(actions);
    if (n !== params.length) throw new Error("actions and params differ in length");
    const decoded = [];
    for (let j = 0; j < n; j++) {
      const a = hexToNumber(sliceHex(actions, j, j + 1));
      const an = ACTION_NAMES.get(a);
      if (!an) throw new Error(`action 0x${a.toString(16)} is not one this builder emits`);
      const raw = params[j]!;
      let p: Record<string, unknown>;
      if (a === ACTIONS.CL_SWAP_EXACT_IN_SINGLE) {
        const [t] = decodeAbiParameters(SINGLE_PARAMS, raw);
        p = { poolKey: Object.fromEntries(Object.entries(t.poolKey).map(([k, v]) => [k, s(v)])), zeroForOne: s(t.zeroForOne), amountIn: s(t.amountIn), amountOutMinimum: s(t.amountOutMinimum), hookData: t.hookData };
      } else if (a === ACTIONS.CL_SWAP_EXACT_IN) {
        const [t] = decodeAbiParameters(MULTI_PARAMS, raw);
        p = { currencyIn: t.currencyIn, path: t.path.map((k) => Object.fromEntries(Object.entries(k).map(([x, v]) => [x, s(v)]))), amountIn: s(t.amountIn), amountOutMinimum: s(t.amountOutMinimum) };
      } else if (a === ACTIONS.SETTLE_ALL) {
        const [currency, maxAmount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], raw);
        p = { currency: getAddress(currency), maxAmount: s(maxAmount) };
      } else {
        const [currency, recipient, amount] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], raw);
        p = { currency: getAddress(currency), recipient: getAddress(recipient), amount: s(amount) };
      }
      decoded.push({ action: an, actionByte: `0x${a.toString(16).padStart(2, "0")}`, params: p });
    }
    steps.push({ command: name, commandByte: `0x${c.toString(16).padStart(2, "0")}`, actions: decoded });
  }
  return { deadline, steps };
}

/* ---------------------------------------------------------------------------
   The Safe transaction
   --------------------------------------------------------------------------- */

export interface ConversionInnerCallView {
  index: number;
  label: string;
  to: Address;
  value: string;
  operation: 0;
  data: Hex;
  decoded: DecodedCall | null;
  router: ReturnType<typeof decodeRouterExecute> | null;
}

export interface ConversionSafeTx {
  kind: "safe";
  chainId: number;
  safe: Address;
  to: Address;
  value: "0";
  data: Hex;
  /** DELEGATECALL into the verified MultiSendCallOnly, which can only CALL. */
  operation: 1;
  safeTxGas: "0";
  baseGas: "0";
  gasPrice: "0";
  gasToken: Address;
  refundReceiver: Address;
  description: string;
  decoded: DecodedCall | null;
  innerCalls: ConversionInnerCallView[];
  warnings: string[];
}

export interface BuildConversionInput {
  chainId: number;
  safe: Address;
  token: Address;
  tokenSymbol: string;
  amountIn: bigint;
  minOut: bigint;
  route: RouteCandidate;
  permit2: Address;
  universalRouter: Address;
  weth: Address;
  multiSendCallOnly: Address;
  /** Chain time the deadline is measured from (latest block timestamp). */
  nowSeconds: bigint;
  deadlineSeconds: number;
}

export function buildConversionSafeTx(p: BuildConversionInput): { tx: ConversionSafeTx; deadline: bigint; plan: RouterPlan } {
  for (const [k, v] of Object.entries({ safe: p.safe, token: p.token, permit2: p.permit2, universalRouter: p.universalRouter, weth: p.weth, multiSendCallOnly: p.multiSendCallOnly })) {
    if (!isAddress(v) || v.toLowerCase() === NATIVE) throw new Error(`${k} must be a non-zero address`);
  }
  if (p.route.tokenIn.toLowerCase() !== p.token.toLowerCase()) throw new Error("route does not start at the token being converted");
  if (p.amountIn >= 1n << 160n) throw new RangeError("amount exceeds Permit2's uint160");
  const deadline = p.nowSeconds + BigInt(p.deadlineSeconds);
  if (deadline >= 1n << 48n) throw new RangeError("deadline exceeds Permit2's uint48 expiration");

  const approve = encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [getAddress(p.permit2), p.amountIn] });
  const permit = encodeFunctionData({ abi: PERMIT2_APPROVE_ABI, functionName: "approve", args: [getAddress(p.token), getAddress(p.universalRouter), p.amountIn, Number(deadline)] });
  const plan = buildRouterPlan({ route: p.route, amountIn: p.amountIn, minOut: p.minOut, recipient: p.safe, weth: p.weth, deadline });
  const execute = encodeRouterExecute(plan);
  const calls: InnerCall[] = [
    { to: p.token, value: 0n, data: approve },
    { to: p.permit2, value: 0n, data: permit },
    { to: p.universalRouter, value: 0n, data: execute },
  ];
  const data = encodeMultiSend(calls);

  // The views below are DECODED FROM `data`, not echoed from the inputs.
  const inner = decodeMultiSend(data);
  const labels = [
    `${p.tokenSymbol}.approve(Permit2, exactly ${p.amountIn}) — never unlimited`,
    `Permit2.approve(${p.tokenSymbol}, UniversalRouter, exactly ${p.amountIn}, expires ${deadline})`,
    `UniversalRouter.execute: swap through ${p.route.hops.length} Latch pool(s), min-out ${p.minOut} wei to the Safe${p.route.end === "weth" ? ", then UNWRAP_WETH" : ""}, deadline ${deadline}`,
  ];
  // execute is overloaded on the router; decodeCall labels by name, so give it only the
  // (bytes, bytes[], uint256) overload this batch uses, or the signature shown is wrong.
  const executeWithDeadline = (UNIVERSAL_ROUTER_ABI as unknown as Abi).filter((x) => x.type === "function" && x.name === "execute" && x.inputs.length === 3);
  const abis: Abi[] = [ERC20_APPROVE_ABI as unknown as Abi, PERMIT2_APPROVE_ABI as unknown as Abi, executeWithDeadline];
  const innerCalls: ConversionInnerCallView[] = inner.map((c, i) => ({
    index: i,
    label: labels[i] ?? "unexpected call",
    to: c.to,
    value: c.value,
    operation: 0,
    data: c.data,
    decoded: decodeCall(abis[i]!, c.data),
    router: i === 2 ? decodeRouterExecute(c.data) : null,
  }));

  const warnings = [
    "operation = 1 (DELEGATECALL). The target is Safe's MultiSendCallOnly v1.4.1, verified by code hash when this payload was built; it can only CALL, never delegatecall onward. Confirm the `to` address in the Safe app before signing.",
    "Nonce is not included: the Safe reads it at signing time.",
    `Expires at unix ${deadline}: after that the router deadline and the Permit2 allowance both lapse and the whole batch reverts. Rebuild rather than sign late.`,
    "Execute only after reviewing the simulation below. Nothing here has been sent anywhere.",
  ];
  return {
    deadline,
    plan,
    tx: {
      kind: "safe",
      chainId: p.chainId,
      safe: getAddress(p.safe),
      to: getAddress(p.multiSendCallOnly),
      value: "0",
      data,
      operation: 1,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: NATIVE,
      refundReceiver: NATIVE,
      description: `Convert ${p.amountIn} raw ${p.tokenSymbol} to native ETH through Latch pools; min-out ${p.minOut} wei to the Safe`,
      decoded: decodeCall(MULTISEND_ABI as unknown as Abi, data),
      innerCalls,
      warnings,
    },
  };
}
