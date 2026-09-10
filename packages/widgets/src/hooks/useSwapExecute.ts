// SPDX-License-Identifier: MIT
/**
 * Headless swap execution: approvals, signature, confirmation.
 *
 * The integrator fee is threaded in here, not chosen here. The hook reads the
 * validated config from context and passes it to `adapter.buildSwap`, which
 * hands it to `buildSwapCall`, which encodes the `TAKE_PORTION` (or
 * `PAY_PORTION`) step. There is no code path that executes a swap while
 * dropping the fee, and none that executes one with an unvalidated fee.
 */

import { useCallback, useMemo, useState } from "react";
import type { Hex } from "viem";
import type {
  ApprovalRequirement,
  SwapQuoteResult,
  TokenInfo,
  WidgetTransactionRequest,
} from "../adapters/protocol.js";
import { WalletNotConnectedError } from "../adapters/protocol.js";
import { defaultDeadline } from "../config/chain.js";
import { useWidgetContext } from "../context/WidgetProvider.js";
import type { QuoteBreakdown } from "../core/math.js";
import { useAsyncResource } from "./useAsyncResource.js";

/** Where a swap is in its lifecycle. */
export type SwapExecutionStep =
  | "idle"
  | "needs-approval"
  | "approving"
  | "building"
  | "awaiting-signature"
  | "pending"
  | "success"
  | "error";

/** Parameters for {@link useSwapExecute}. */
export interface UseSwapExecuteParams {
  readonly tokenIn: TokenInfo | null;
  readonly tokenOut: TokenInfo | null;
  readonly amountIn: bigint | null;
  readonly quote: SwapQuoteResult | null;
  readonly breakdown: QuoteBreakdown | null;
  /** Defaults to the connected account. */
  readonly recipient?: `0x${string}`;
  /** Called once the swap transaction confirms. */
  readonly onSuccess?: (hash: Hex) => void;
  readonly onError?: (error: Error) => void;
}

/** Result of {@link useSwapExecute}. */
export interface UseSwapExecuteResult {
  readonly step: SwapExecutionStep;
  readonly error: Error | null;
  readonly txHash: Hex | null;
  readonly approvals: readonly ApprovalRequirement[];
  readonly needsApproval: boolean;
  readonly canExecute: boolean;
  /** One-line description of the current state, suitable for `aria-live`. */
  readonly statusMessage: string;
  /** The built transaction, exposed so a host can inspect or simulate it. */
  readonly preparedTransaction: WidgetTransactionRequest | null;
  approve(): Promise<void>;
  execute(): Promise<void>;
  reset(): void;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** Drives the approve-then-swap flow. */
export function useSwapExecute(params: UseSwapExecuteParams): UseSwapExecuteResult {
  const { adapter, chain, integrator } = useWidgetContext();
  const { tokenIn, tokenOut, amountIn, quote, breakdown } = params;

  const [step, setStep] = useState<SwapExecutionStep>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [prepared, setPrepared] = useState<WidgetTransactionRequest | null>(null);
  const [approvalToken, setApprovalToken] = useState(0);

  const accountResource = useAsyncResource(
    useCallback(() => adapter.getAccount(), [adapter]),
    [adapter],
  );
  const account = accountResource.data;

  const approvalLoader = useCallback(async (): Promise<readonly ApprovalRequirement[]> => {
    if (tokenIn === null || amountIn === null || account === null) return [];
    return adapter.getApprovalRequirements(tokenIn, account, amountIn);
  }, [adapter, tokenIn, amountIn, account]);

  const approvalResource = useAsyncResource<readonly ApprovalRequirement[]>(
    approvalLoader,
    [
      adapter,
      tokenIn?.address ?? null,
      amountIn === null ? null : amountIn.toString(),
      account,
      approvalToken,
    ],
    { enabled: tokenIn !== null && amountIn !== null && amountIn > 0n && account !== null },
  );

  const approvals = approvalResource.data ?? [];
  const needsApproval = approvals.length > 0;

  const canExecute =
    tokenIn !== null &&
    tokenOut !== null &&
    amountIn !== null &&
    amountIn > 0n &&
    quote !== null &&
    breakdown !== null &&
    account !== null &&
    !needsApproval &&
    (step === "idle" || step === "error" || step === "success");

  const approve = useCallback(async (): Promise<void> => {
    const next = approvals[0];
    if (next === undefined) return;
    setError(null);
    setStep("approving");
    try {
      const transaction = await adapter.buildApproval(next);
      const hash = await adapter.sendTransaction(transaction);
      await adapter.waitForTransaction(hash);
      setApprovalToken((token) => token + 1);
      setStep("idle");
    } catch (cause: unknown) {
      const wrapped = toError(cause);
      setError(wrapped);
      setStep("error");
      params.onError?.(wrapped);
    }
  }, [adapter, approvals, params]);

  const execute = useCallback(async (): Promise<void> => {
    if (tokenIn === null || tokenOut === null || amountIn === null) return;
    if (quote === null || breakdown === null) return;
    if (account === null) {
      const wrapped = new WalletNotConnectedError("swap");
      setError(wrapped);
      setStep("error");
      params.onError?.(wrapped);
      return;
    }

    setError(null);
    setTxHash(null);
    setStep("building");
    try {
      const transaction = await adapter.buildSwap({
        quote,
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOutGross: breakdown.minAmountOutGross,
        minAmountOutNet: breakdown.minAmountOutNet,
        // The validated config from context. Never a raw prop.
        integrator,
        recipient: params.recipient ?? account,
        deadline: defaultDeadline(chain),
      });
      setPrepared(transaction);

      setStep("awaiting-signature");
      const hash = await adapter.sendTransaction(transaction);
      setTxHash(hash);

      setStep("pending");
      const outcome = await adapter.waitForTransaction(hash);
      if (outcome.status === "reverted") {
        throw new Error(`Swap reverted on-chain (${hash})`);
      }
      setStep("success");
      params.onSuccess?.(hash);
    } catch (cause: unknown) {
      const wrapped = toError(cause);
      setError(wrapped);
      setStep("error");
      params.onError?.(wrapped);
    }
  }, [
    adapter,
    account,
    amountIn,
    breakdown,
    chain,
    integrator,
    params,
    quote,
    tokenIn,
    tokenOut,
  ]);

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setTxHash(null);
    setPrepared(null);
  }, []);

  const effectiveStep: SwapExecutionStep =
    step === "idle" && needsApproval ? "needs-approval" : step;

  const statusMessage = useMemo(
    () => describeStep(effectiveStep, approvals[0], error, adapter.isMock),
    [effectiveStep, approvals, error, adapter.isMock],
  );

  return {
    step: effectiveStep,
    error,
    txHash,
    approvals,
    needsApproval,
    canExecute,
    statusMessage,
    preparedTransaction: prepared,
    approve,
    execute,
    reset,
  };
}

function describeStep(
  step: SwapExecutionStep,
  pending: ApprovalRequirement | undefined,
  error: Error | null,
  isMock: boolean,
): string {
  const mockPrefix = isMock ? "Simulated (mock adapter): " : "";
  switch (step) {
    case "idle":
      return "";
    case "needs-approval":
      return pending === undefined
        ? "Approval required"
        : pending.kind === "erc20-to-permit2"
          ? `Approve ${pending.token.symbol} for Permit2 before swapping`
          : `Approve the router to spend ${pending.token.symbol} via Permit2`;
    case "approving":
      return `${mockPrefix}Waiting for the approval transaction to confirm`;
    case "building":
      return `${mockPrefix}Preparing the swap transaction`;
    case "awaiting-signature":
      return `${mockPrefix}Confirm the transaction in your wallet`;
    case "pending":
      return `${mockPrefix}Swap submitted, waiting for confirmation`;
    case "success":
      return `${mockPrefix}Swap confirmed`;
    case "error":
      return error === null ? "Something went wrong" : error.message;
    default:
      return "";
  }
}
