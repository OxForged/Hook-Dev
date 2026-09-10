// SPDX-License-Identifier: MIT
/**
 * Launch (token sale) call path.
 *
 * ## Status: interface-first, unverified against a deployment
 *
 * There is no launchpad contract in this repository, so unlike the swap and
 * liquidity paths - which are encoded against the real periphery and router
 * sources - this ABI is a **proposed interface**, not a transcription of
 * deployed code. It is written down here so the widget has something concrete
 * to bind to, and so the shape of the integration is reviewable before the
 * contract exists.
 *
 * Treat it as a specification with two consequences:
 *
 * 1. When the launchpad ships, either it implements this interface or this file
 *    changes. Do not assume calldata built here will succeed against an
 *    arbitrary third-party sale contract.
 * 2. An integrator with a different launchpad should supply their own
 *    {@link ../adapters/protocol.js | ProtocolAdapter} implementation of
 *    `buildLaunchBuy` rather than bending this encoder.
 *
 * The integrator `referrer` is a first-class argument of `buy` for the same
 * reason it is a step in the swap plan: attribution that depends on a later
 * off-chain reconciliation is attribution that eventually stops being paid.
 */

import { encodeFunctionData, isAddressEqual, type Address, type Hex } from "viem";
import type { ResolvedIntegratorConfig } from "../config/integrator.js";
import { MAX_INTEGRATOR_FEE_BPS } from "../config/integrator.js";

/**
 * Proposed launchpad surface.
 *
 * `buy` is payable so a sale priced in the native asset needs no wrapper; sales
 * priced in an ERC-20 pull via allowance and are called with zero value.
 */
export const LAUNCHPAD_ABI = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "referrer", type: "address" },
      { name: "referrerFeeBps", type: "uint16" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "saleInfo",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "token", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "totalForSale", type: "uint256" },
      { name: "sold", type: "uint256" },
      { name: "raised", type: "uint256" },
      { name: "hardCap", type: "uint256" },
      { name: "softCap", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "perWalletCap", type: "uint256" },
      { name: "minPurchase", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "accountState",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "spent", type: "uint256" },
      { name: "allocated", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [{ name: "amountIn", type: "uint256" }],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
] as const;

/** Arguments for encoding a launch purchase. */
export interface BuildLaunchBuyArgs {
  readonly launchpad: Address;
  /** Payment currency; the zero address means the chain's native asset. */
  readonly paymentToken: Address;
  readonly amountIn: bigint;
  readonly minTokensOut: bigint;
  readonly recipient: Address;
  readonly integrator: ResolvedIntegratorConfig;
  readonly deadline: bigint;
}

/** An encoded launchpad purchase. */
export interface EncodedLaunchBuy {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly integratorFee: {
    readonly referrer: Address;
    readonly feeBps: number;
  } | null;
}

/** Encodes a `buy` call, threading the integrator referrer into the arguments. */
export function buildLaunchBuyCall(args: BuildLaunchBuyArgs): EncodedLaunchBuy {
  if (args.amountIn <= 0n) {
    throw new RangeError(`[@latchprotocol/widgets] amountIn must be positive: ${args.amountIn}`);
  }
  if (args.minTokensOut < 0n) {
    throw new RangeError(
      `[@latchprotocol/widgets] minTokensOut must not be negative: ${args.minTokensOut}`,
    );
  }
  if (args.integrator.active && args.integrator.feeBps > MAX_INTEGRATOR_FEE_BPS) {
    throw new RangeError(
      `[@latchprotocol/widgets] refusing to encode integrator feeBps ${args.integrator.feeBps}`,
    );
  }

  const isNativePayment = isAddressEqual(
    args.paymentToken,
    "0x0000000000000000000000000000000000000000",
  );

  const data = encodeFunctionData({
    abi: LAUNCHPAD_ABI,
    functionName: "buy",
    args: [
      args.amountIn,
      args.minTokensOut,
      args.recipient,
      // No fee means no referrer: the zero address, not the buyer, so a sale
      // contract can never mistake a self-referral for an attributed one.
      args.integrator.active
        ? args.integrator.referrer
        : "0x0000000000000000000000000000000000000000",
      args.integrator.active ? args.integrator.feeBps : 0,
      args.deadline,
    ],
  });

  return {
    to: args.launchpad,
    data,
    value: isNativePayment ? args.amountIn : 0n,
    integratorFee: args.integrator.active
      ? { referrer: args.integrator.referrer, feeBps: args.integrator.feeBps }
      : null,
  };
}
