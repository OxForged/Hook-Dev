// SPDX-License-Identifier: MIT
/**
 * Swap call-path construction - **including integrator fee attribution**.
 *
 * This is the file that turns `integrator: { referrer, feeBps }` into money.
 * The fee is not a post-hoc transfer and not an off-chain promise: it is a step
 * in the same plan as the swap, so it settles atomically with it.
 *
 * ## The two fee modes
 *
 * ### `take-portion` (default)
 *
 * ```text
 * UniversalRouter.execute([INFI_SWAP], [plan], deadline)
 *   plan:
 *     0. CL_SWAP_EXACT_IN_SINGLE   amountOutMinimum = minAmountOutGross
 *     1. SETTLE_ALL                pay currencyIn from the caller (via Permit2)
 *     2. TAKE_PORTION              feeBps of the output credit -> referrer
 *     3. TAKE_ALL                  the rest -> caller, floored at minAmountOutNet
 * ```
 *
 * The vault credit is split before anything leaves the singleton, so the router
 * never custodies the fee and there is no window in which it can be swept.
 *
 * ### `pay-portion`
 *
 * ```text
 * UniversalRouter.execute([INFI_SWAP, PAY_PORTION, SWEEP], [...], deadline)
 * ```
 *
 * The swap takes its whole output to the router, `PAY_PORTION` forwards the
 * fee, and `SWEEP` returns the remainder to the recipient. Use this when the
 * fee has to be taken across a plan the periphery cannot express alone.
 *
 * ## Two minimums, deliberately
 *
 * The swap action enforces `minAmountOutGross`; the final take/sweep enforces
 * `minAmountOutNet`. Because `x - floor(x * bps / 10_000)` is monotonically
 * non-decreasing in `x`, clearing the gross floor guarantees clearing the net
 * floor. Both are encoded so that neither the pool nor the fee step can quietly
 * erode the user's guarantee.
 */

import {
  encodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  type Address,
  type Hex,
} from "viem";
import { poolKeyToTuple, type PoolKey } from "@latchprotocol/sdk";
import {
  ACTIONS,
  ADDRESS_THIS,
  COMMANDS,
  MSG_SENDER,
  OPEN_DELTA,
  UNIVERSAL_ROUTER_ABI,
} from "./constants.js";
import { ActionPlan, plan } from "./plan.js";
import type { ResolvedIntegratorConfig } from "../config/integrator.js";
import { MAX_INTEGRATOR_FEE_BPS, calculateIntegratorFee } from "../config/integrator.js";

/** ABI shape of a `PoolKey` struct. */
export const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "hooks", type: "address" },
  { name: "poolManager", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "parameters", type: "bytes32" },
] as const;

const SWAP_EXACT_IN_SINGLE_PARAMS = [
  {
    name: "params",
    type: "tuple",
    components: [
      { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "swapDirection", type: "bool" },
      { name: "amountIn", type: "uint128" },
      { name: "amountOutMinimum", type: "uint128" },
      { name: "hookData", type: "bytes" },
    ],
  },
] as const;

const PATH_KEY_COMPONENTS = [
  { name: "intermediateCurrency", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "hooks", type: "address" },
  { name: "poolManager", type: "address" },
  { name: "hookData", type: "bytes" },
  { name: "parameters", type: "bytes32" },
] as const;

const SWAP_EXACT_IN_PARAMS = [
  {
    name: "params",
    type: "tuple",
    components: [
      { name: "currencyIn", type: "address" },
      { name: "path", type: "tuple[]", components: PATH_KEY_COMPONENTS },
      { name: "amountIn", type: "uint128" },
      { name: "amountOutMinimum", type: "uint128" },
    ],
  },
] as const;

const CURRENCY_AND_UINT256 = [
  { name: "currency", type: "address" },
  { name: "amount", type: "uint256" },
] as const;

const CURRENCY_ADDRESS_AND_UINT256 = [
  { name: "currency", type: "address" },
  { name: "recipient", type: "address" },
  { name: "amount", type: "uint256" },
] as const;

/** One hop of a swap, resolved to the exact pool it will execute against. */
export interface SwapHop {
  readonly poolKey: PoolKey;
  readonly poolType: "CL" | "BIN";
  /** Input currency of this hop. */
  readonly currencyIn: Address;
  /** Output currency of this hop. */
  readonly currencyOut: Address;
  readonly hookData?: Hex;
}

/** Everything needed to encode a swap transaction. */
export interface BuildSwapCallArgs {
  readonly router: Address;
  readonly hops: readonly SwapHop[];
  readonly amountIn: bigint;
  readonly minAmountOutGross: bigint;
  readonly minAmountOutNet: bigint;
  /**
   * Quoted gross output, used only to report the expected fee back to the UI.
   * The chain always recomputes the fee from the realised output.
   */
  readonly expectedAmountOutGross?: bigint;
  readonly integrator: ResolvedIntegratorConfig;
  /** Who receives the output. Use the caller's own address for the normal case. */
  readonly recipient: Address;
  /** The account submitting the transaction, used to detect the sentinel case. */
  readonly sender: Address;
  readonly deadline: bigint;
}

/** A fully encoded swap transaction plus the trace used to explain it. */
export interface EncodedSwapCall {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly commands: Hex;
  readonly inputs: readonly Hex[];
  /** Human-readable dump of the periphery plan. */
  readonly planTrace: string;
  /** Populated whenever a fee step was encoded. */
  readonly integratorFee: {
    readonly referrer: Address;
    readonly feeBps: number;
    readonly currency: Address;
    readonly mode: "take-portion" | "pay-portion";
    /** Fee implied by the quoted output. The chain recomputes it on the real one. */
    readonly expectedAmount: bigint;
  } | null;
}

function isNative(currency: Address): boolean {
  return isAddressEqual(currency, "0x0000000000000000000000000000000000000000");
}

/** `true` when `currency0` is the input, i.e. the swap runs zero-for-one. */
function isZeroForOne(hop: SwapHop): boolean {
  return isAddressEqual(hop.poolKey.currency0, hop.currencyIn);
}

function assertHopsConnected(hops: readonly SwapHop[]): void {
  if (hops.length === 0) {
    throw new Error("[@latchprotocol/widgets] cannot encode a swap with no hops");
  }
  for (let i = 1; i < hops.length; i += 1) {
    const previous = hops[i - 1];
    const current = hops[i];
    if (previous === undefined || current === undefined) continue;
    if (!isAddressEqual(previous.currencyOut, current.currencyIn)) {
      throw new Error(
        `[@latchprotocol/widgets] route is not contiguous: hop ${i - 1} outputs ` +
          `${previous.currencyOut} but hop ${i} takes ${current.currencyIn}`,
      );
    }
  }
}

function assertUniformPoolType(hops: readonly SwapHop[]): "CL" | "BIN" {
  const first = hops[0];
  if (first === undefined) {
    throw new Error("[@latchprotocol/widgets] cannot encode a swap with no hops");
  }
  for (const hop of hops) {
    if (hop.poolType !== first.poolType) {
      throw new Error(
        "[@latchprotocol/widgets] a single swap action cannot mix CL and BIN hops. " +
          "Split the route into one action per pool type, or route through a single type.",
      );
    }
  }
  return first.poolType;
}

/** Encodes the single-hop swap action's parameters. */
function encodeSingleHop(hop: SwapHop, amountIn: bigint, minOut: bigint): Hex {
  return encodeAbiParameters(SWAP_EXACT_IN_SINGLE_PARAMS, [
    {
      poolKey: {
        currency0: hop.poolKey.currency0,
        currency1: hop.poolKey.currency1,
        hooks: hop.poolKey.hooks,
        poolManager: hop.poolKey.poolManager,
        fee: hop.poolKey.fee,
        parameters: hop.poolKey.parameters,
      },
      // CL calls this `zeroForOne`, BIN calls it `swapForY`; same bit, same meaning.
      swapDirection: isZeroForOne(hop),
      amountIn,
      amountOutMinimum: minOut,
      hookData: hop.hookData ?? "0x",
    },
  ]);
}

/** Encodes the multi-hop swap action's parameters. */
function encodeMultiHop(hops: readonly SwapHop[], amountIn: bigint, minOut: bigint): Hex {
  const first = hops[0];
  if (first === undefined) throw new Error("[@latchprotocol/widgets] empty route");
  return encodeAbiParameters(SWAP_EXACT_IN_PARAMS, [
    {
      currencyIn: first.currencyIn,
      path: hops.map((hop) => ({
        intermediateCurrency: hop.currencyOut,
        fee: hop.poolKey.fee,
        hooks: hop.poolKey.hooks,
        poolManager: hop.poolKey.poolManager,
        hookData: hop.hookData ?? "0x",
        parameters: hop.poolKey.parameters,
      })),
      amountIn,
      amountOutMinimum: minOut,
    },
  ]);
}

/**
 * Builds the periphery action plan for a swap.
 *
 * Exported so integrators building their own router flows can reuse exactly the
 * plan the widgets use, fee step included.
 */
export function buildSwapPlan(args: BuildSwapCallArgs): {
  readonly plan: ActionPlan;
  readonly currencyIn: Address;
  readonly currencyOut: Address;
} {
  assertHopsConnected(args.hops);
  const poolType = assertUniformPoolType(args.hops);
  const first = args.hops[0];
  const last = args.hops[args.hops.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("[@latchprotocol/widgets] empty route");
  }
  const currencyIn = first.currencyIn;
  const currencyOut = last.currencyOut;

  assertFeeArgs(args);

  const single = args.hops.length === 1;
  const action = single
    ? poolType === "CL"
      ? ACTIONS.CL_SWAP_EXACT_IN_SINGLE
      : ACTIONS.BIN_SWAP_EXACT_IN_SINGLE
    : poolType === "CL"
      ? ACTIONS.CL_SWAP_EXACT_IN
      : ACTIONS.BIN_SWAP_EXACT_IN;

  const params = single
    ? encodeSingleHop(first, args.amountIn, args.minAmountOutGross)
    : encodeMultiHop(args.hops, args.amountIn, args.minAmountOutGross);

  const p = plan().add(
    action,
    params,
    `${poolType} swap exact-in${single ? " (single hop)" : ` (${args.hops.length} hops)`}`,
  );

  p.add(
    ACTIONS.SETTLE_ALL,
    encodeAbiParameters(CURRENCY_AND_UINT256, [currencyIn, args.amountIn]),
    "settle input currency from the caller",
  );

  const recipientIsSender = isAddressEqual(args.recipient, args.sender);
  const takeRecipient = recipientIsSender ? MSG_SENDER : args.recipient;

  if (args.integrator.feeMode === "pay-portion") {
    // The router needs custody of the output to run PAY_PORTION over its balance.
    p.add(
      ACTIONS.TAKE,
      encodeAbiParameters(CURRENCY_ADDRESS_AND_UINT256, [
        currencyOut,
        ADDRESS_THIS,
        OPEN_DELTA,
      ]),
      "take output to the router for the fee split",
    );
    return { plan: p, currencyIn, currencyOut };
  }

  if (args.integrator.active) {
    p.add(
      ACTIONS.TAKE_PORTION,
      encodeAbiParameters(CURRENCY_ADDRESS_AND_UINT256, [
        currencyOut,
        args.integrator.referrer,
        BigInt(args.integrator.feeBps),
      ]),
      `integrator fee: ${args.integrator.feeBps} bps of output to ${args.integrator.referrer}`,
    );
  }

  if (recipientIsSender) {
    p.add(
      ACTIONS.TAKE_ALL,
      encodeAbiParameters(CURRENCY_AND_UINT256, [currencyOut, args.minAmountOutNet]),
      "take remaining output to the caller, floored at minAmountOutNet",
    );
  } else {
    // TAKE cannot express a minimum; the swap action's amountOutMinimum
    // (minAmountOutGross) is what protects the user in this branch.
    p.add(
      ACTIONS.TAKE,
      encodeAbiParameters(CURRENCY_ADDRESS_AND_UINT256, [
        currencyOut,
        takeRecipient,
        OPEN_DELTA,
      ]),
      "take remaining output to the configured recipient",
    );
  }

  return { plan: p, currencyIn, currencyOut };
}

function assertFeeArgs(args: BuildSwapCallArgs): void {
  const { integrator } = args;
  if (integrator.active) {
    if (integrator.feeBps <= 0 || integrator.feeBps > MAX_INTEGRATOR_FEE_BPS) {
      throw new RangeError(
        `[@latchprotocol/widgets] refusing to encode integrator feeBps ${integrator.feeBps}; ` +
          `expected 1..${MAX_INTEGRATOR_FEE_BPS}. This config should have been rejected by ` +
          "validateIntegratorConfig - do not construct ResolvedIntegratorConfig by hand.",
      );
    }
    if (isNative(integrator.referrer)) {
      throw new Error(
        "[@latchprotocol/widgets] refusing to encode an integrator fee to the zero address",
      );
    }
  }
  if (args.minAmountOutNet > args.minAmountOutGross) {
    throw new RangeError(
      `[@latchprotocol/widgets] minAmountOutNet (${args.minAmountOutNet}) exceeds ` +
        `minAmountOutGross (${args.minAmountOutGross}); the fee step can only reduce the output`,
    );
  }
  if (args.amountIn <= 0n) {
    throw new RangeError(`[@latchprotocol/widgets] amountIn must be positive: ${args.amountIn}`);
  }
}

/** Encodes the full `UniversalRouter.execute` call for a swap. */
export function buildSwapCall(args: BuildSwapCallArgs): EncodedSwapCall {
  const { plan: actionPlan, currencyIn, currencyOut } = buildSwapPlan(args);

  const commandBytes: number[] = [COMMANDS.INFI_SWAP];
  const inputs: Hex[] = [actionPlan.encode()];

  const usePayPortion = args.integrator.feeMode === "pay-portion";
  const recipientIsSender = isAddressEqual(args.recipient, args.sender);
  const sweepRecipient = recipientIsSender ? MSG_SENDER : args.recipient;

  if (usePayPortion) {
    if (args.integrator.active) {
      commandBytes.push(COMMANDS.PAY_PORTION);
      inputs.push(
        encodeAbiParameters(CURRENCY_ADDRESS_AND_UINT256, [
          currencyOut,
          args.integrator.referrer,
          BigInt(args.integrator.feeBps),
        ]),
      );
    }
    commandBytes.push(COMMANDS.SWEEP);
    inputs.push(
      encodeAbiParameters(CURRENCY_ADDRESS_AND_UINT256, [
        currencyOut,
        sweepRecipient,
        args.minAmountOutNet,
      ]),
    );
  }

  const commands = `0x${commandBytes
    .map((command) => command.toString(16).padStart(2, "0"))
    .join("")}` as Hex;

  const data = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: "execute",
    args: [commands, inputs, args.deadline],
  });

  const expectedFee = args.integrator.active
    ? calculateIntegratorFee(
        args.expectedAmountOutGross ?? args.minAmountOutGross,
        args.integrator.feeBps,
      )
    : 0n;

  return {
    to: args.router,
    data,
    value: isNative(currencyIn) ? args.amountIn : 0n,
    commands,
    inputs,
    planTrace: actionPlan.describe(),
    integratorFee: args.integrator.active
      ? {
          referrer: args.integrator.referrer,
          feeBps: args.integrator.feeBps,
          currency: currencyOut,
          mode: args.integrator.feeMode,
          expectedAmount: expectedFee,
        }
      : null,
  };
}

/** Positional pool-key tuple, re-exported so callers do not reach into the SDK. */
export { poolKeyToTuple };
