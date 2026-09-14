import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { FEE_CONTROLLER_V2_FUNCTIONS_ABI } from "../chain/abis.js";

/**
 * Safe transaction PAYLOADS for owners to sign elsewhere (Safe{Wallet}, a
 * hardware wallet, the Safe CLI). This module has no key, no client and no send
 * path, by construction: the admin API prepares, humans sign.
 *
 * `nonce` is deliberately absent. It must be read from the Safe at signing time;
 * a nonce baked in here would go stale the moment any other Safe tx lands, and a
 * signature over a stale nonce is either useless or, worse, valid later.
 */

export interface SafeTxPayload {
  chainId: number;
  safe: Address;
  to: Address;
  value: string;
  data: Hex;
  operation: 0;
  safeTxGas: "0";
  baseGas: "0";
  gasPrice: "0";
  gasToken: Address;
  refundReceiver: Address;
  description: string;
  warnings: string[];
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function buildSafeTransaction(p: { chainId: number; safe: string; to: string; data: Hex; value?: bigint; description: string; warnings?: string[] }): SafeTxPayload {
  if (!isAddress(p.safe) || !isAddress(p.to)) throw new Error("safe and to must be addresses");
  if (p.to.toLowerCase() === ZERO) throw new Error("refusing a Safe transaction to the zero address");
  return {
    chainId: p.chainId,
    safe: getAddress(p.safe),
    to: getAddress(p.to),
    value: (p.value ?? 0n).toString(),
    data: p.data,
    // CALL only. DELEGATECALL from the governance Safe runs foreign code with the
    // Safe's storage and authority; this builder never produces one.
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO,
    refundReceiver: ZERO,
    description: p.description,
    warnings: p.warnings ?? [],
  };
}

/**
 * LatchProtocolFeeControllerV2.collect(poolManager, currency, amount, recipient)
 * — owner-only on the controller (the Safe). amount 0 collects everything accrued.
 */
export function prepareCollectProtocolFees(p: {
  chainId: number;
  safe: string;
  feeController: string;
  poolManager: string;
  currency: string;
  amount: bigint;
  recipient: string;
}): SafeTxPayload {
  if (!isAddress(p.recipient) || p.recipient.toLowerCase() === ZERO) throw new Error("recipient must be a non-zero address");
  const data = encodeFunctionData({
    abi: FEE_CONTROLLER_V2_FUNCTIONS_ABI,
    functionName: "collect",
    args: [getAddress(p.poolManager), getAddress(p.currency), p.amount, getAddress(p.recipient)],
  });
  const warnings: string[] = [];
  if (p.recipient.toLowerCase() !== p.safe.toLowerCase()) {
    warnings.push("Recipient is not the governance Safe. CLAUDE.md: protocol fees go to the Safe; no separate treasury address.");
  }
  return buildSafeTransaction({
    chainId: p.chainId,
    safe: p.safe,
    to: p.feeController,
    data,
    description: `collect(${p.poolManager}, ${p.currency}, ${p.amount === 0n ? "all accrued" : p.amount.toString()}, ${p.recipient})`,
    warnings,
  });
}
