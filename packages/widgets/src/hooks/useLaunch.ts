// SPDX-License-Identifier: MIT
/**
 * Headless launch (token sale) participation.
 *
 * A launch buy has three gates a swap does not: a time window, a per-wallet cap
 * and a minimum purchase. All three are evaluated here so the UI can disable
 * the button *and say why* - "Sale has not started" is a better failure than a
 * reverted transaction.
 */

import { useCallback, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import type {
  ApprovalRequirement,
  LaunchAccountState,
  LaunchBuyQuote,
  LaunchInfo,
} from "../adapters/protocol.js";
import { WalletNotConnectedError } from "../adapters/protocol.js";
import { defaultDeadline } from "../config/chain.js";
import { useWidgetContext } from "../context/WidgetProvider.js";
import { minimumReceived, progressPercent } from "../core/math.js";
import { useAsyncResource, type AsyncResource, type AsyncStatus } from "./useAsyncResource.js";

/** Lifecycle of a launch purchase. */
export type LaunchBuyStep =
  | "idle"
  | "needs-approval"
  | "approving"
  | "building"
  | "awaiting-signature"
  | "pending"
  | "success"
  | "error";

/** Why a purchase is currently not allowed. `null` means it is. */
export type LaunchBlockReason =
  | "not-started"
  | "ended"
  | "sold-out"
  | "cancelled"
  | "paused"
  | "wallet-cap-reached"
  | "below-minimum"
  | "exceeds-wallet-cap"
  | "exceeds-hard-cap"
  | "insufficient-balance"
  | "no-wallet"
  | null;

/** Everything a launch UI needs about the sale's current standing. */
export interface LaunchSaleView {
  readonly launch: LaunchInfo;
  /** Sale progress as a percentage of `totalForSale`. */
  readonly progressPercent: number;
  /** Raised as a percentage of the hard cap. */
  readonly raisedPercent: number;
  /** Seconds until the sale starts, or `null` if it already has. */
  readonly secondsUntilStart: number | null;
  /** Seconds until the sale ends, or `null` if it already has. */
  readonly secondsUntilEnd: number | null;
  readonly isMock: boolean;
}

/** Derives the presentational view of a sale. Pure. */
export function buildLaunchSaleView(
  launch: LaunchInfo,
  nowSeconds: number,
  isMock: boolean,
): LaunchSaleView {
  const start = Number(launch.startTime);
  const end = Number(launch.endTime);
  return {
    launch,
    progressPercent: progressPercent(launch.sold, launch.totalForSale),
    raisedPercent: progressPercent(launch.raised, launch.hardCap),
    secondsUntilStart: nowSeconds < start ? start - nowSeconds : null,
    secondsUntilEnd: nowSeconds < end ? end - nowSeconds : null,
    isMock,
  };
}

/** Evaluates every gate that could block a purchase. Pure and exhaustive. */
export function evaluateLaunchPurchase(args: {
  readonly launch: LaunchInfo;
  readonly accountState: LaunchAccountState | null;
  readonly amountIn: bigint | null;
  readonly balance: bigint | null;
  readonly nowSeconds: number;
}): { readonly reason: LaunchBlockReason; readonly message: string | null } {
  const { launch, accountState, amountIn, balance, nowSeconds } = args;

  if (launch.status === "cancelled") return { reason: "cancelled", message: "Sale was cancelled" };
  if (launch.status === "paused") return { reason: "paused", message: "Sale is paused" };
  if (nowSeconds < Number(launch.startTime)) {
    return { reason: "not-started", message: "Sale has not started yet" };
  }
  if (nowSeconds > Number(launch.endTime)) {
    return { reason: "ended", message: "Sale has ended" };
  }
  if (launch.sold >= launch.totalForSale) {
    return { reason: "sold-out", message: "Sale is sold out" };
  }
  if (accountState === null) {
    return { reason: "no-wallet", message: "Connect a wallet to participate" };
  }
  if (accountState.capRemaining !== null && accountState.capRemaining <= 0n) {
    return { reason: "wallet-cap-reached", message: "You have reached the per-wallet cap" };
  }
  if (amountIn === null || amountIn <= 0n) {
    return { reason: null, message: null };
  }
  if (amountIn < launch.minPurchase) {
    return { reason: "below-minimum", message: "Amount is below the minimum purchase" };
  }
  if (accountState.capRemaining !== null && amountIn > accountState.capRemaining) {
    return { reason: "exceeds-wallet-cap", message: "Amount exceeds your remaining wallet cap" };
  }
  if (launch.raised + amountIn > launch.hardCap) {
    return { reason: "exceeds-hard-cap", message: "Amount exceeds the sale's remaining capacity" };
  }
  if (balance !== null && amountIn > balance) {
    return { reason: "insufficient-balance", message: "Insufficient balance" };
  }
  return { reason: null, message: null };
}

/** Loads a launch by address. */
export function useLaunch(launchId: Address | null): AsyncResource<LaunchInfo | null> {
  const { adapter } = useWidgetContext();
  const loader = useCallback(async (): Promise<LaunchInfo | null> => {
    if (launchId === null) return null;
    return adapter.getLaunch(launchId);
  }, [adapter, launchId]);
  return useAsyncResource(loader, [adapter, launchId], {
    enabled: launchId !== null,
    refetchIntervalMs: 20_000,
  });
}

/** Every launch the adapter surfaces. */
export function useLaunchList(): AsyncResource<readonly LaunchInfo[]> {
  const { adapter } = useWidgetContext();
  return useAsyncResource(useCallback(() => adapter.listLaunches(), [adapter]), [adapter]);
}

/** The connected wallet's standing in a launch. */
export function useLaunchAccountState(
  launchId: Address | null,
  account: Address | null,
): AsyncResource<LaunchAccountState | null> {
  const { adapter } = useWidgetContext();
  const loader = useCallback(async (): Promise<LaunchAccountState | null> => {
    if (launchId === null || account === null) return null;
    return adapter.getLaunchAccountState(launchId, account);
  }, [adapter, launchId, account]);
  return useAsyncResource(loader, [adapter, launchId, account], {
    enabled: launchId !== null && account !== null,
    refetchIntervalMs: 20_000,
  });
}

/** Parameters for {@link useLaunchBuy}. */
export interface UseLaunchBuyParams {
  readonly launch: LaunchInfo | null;
  readonly amountIn: bigint | null;
  readonly slippageBps?: number;
  readonly recipient?: Address;
  readonly onSuccess?: (hash: Hex) => void;
}

/** Result of {@link useLaunchBuy}. */
export interface UseLaunchBuyResult {
  readonly quote: LaunchBuyQuote | null;
  readonly quoteStatus: AsyncStatus;
  readonly quoteError: Error | null;
  readonly step: LaunchBuyStep;
  readonly error: Error | null;
  readonly txHash: Hex | null;
  readonly approvals: readonly ApprovalRequirement[];
  readonly needsApproval: boolean;
  readonly statusMessage: string;
  approve(): Promise<void>;
  execute(): Promise<void>;
  reset(): void;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** Quotes and executes a launch purchase, threading the integrator referrer. */
export function useLaunchBuy(params: UseLaunchBuyParams): UseLaunchBuyResult {
  const { adapter, chain, integrator, defaultSlippageBps } = useWidgetContext();
  const { launch, amountIn } = params;
  const slippageBps = params.slippageBps ?? defaultSlippageBps;

  const [step, setStep] = useState<LaunchBuyStep>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [approvalToken, setApprovalToken] = useState(0);

  const accountResource = useAsyncResource(
    useCallback(() => adapter.getAccount(), [adapter]),
    [adapter],
  );
  const account = accountResource.data;

  const quoteLoader = useCallback(async (): Promise<LaunchBuyQuote | null> => {
    if (launch === null || amountIn === null || amountIn <= 0n) return null;
    return adapter.quoteLaunchBuy(launch, amountIn);
  }, [adapter, launch, amountIn]);

  const quoteResource = useAsyncResource<LaunchBuyQuote | null>(
    quoteLoader,
    [adapter, launch?.id ?? null, amountIn?.toString() ?? null],
    { enabled: launch !== null && amountIn !== null && amountIn > 0n },
  );

  const approvalLoader = useCallback(async (): Promise<readonly ApprovalRequirement[]> => {
    if (launch === null || amountIn === null || account === null) return [];
    return adapter.getApprovalRequirements(launch.paymentToken, account, amountIn);
  }, [adapter, launch, amountIn, account]);

  const approvalResource = useAsyncResource<readonly ApprovalRequirement[]>(
    approvalLoader,
    [adapter, launch?.id ?? null, amountIn?.toString() ?? null, account, approvalToken],
    { enabled: launch !== null && amountIn !== null && amountIn > 0n && account !== null },
  );
  const approvals = approvalResource.data ?? [];

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
      setError(toError(cause));
      setStep("error");
    }
  }, [adapter, approvals]);

  const execute = useCallback(async (): Promise<void> => {
    const quote = quoteResource.data;
    if (quote === null) return;
    if (account === null) {
      setError(new WalletNotConnectedError("buy into this launch"));
      setStep("error");
      return;
    }
    setError(null);
    setStep("building");
    try {
      const transaction = await adapter.buildLaunchBuy({
        quote,
        minTokensOut: minimumReceived(quote.tokensOut, slippageBps),
        recipient: params.recipient ?? account,
        deadline: defaultDeadline(chain),
        integrator,
      });
      setStep("awaiting-signature");
      const hash = await adapter.sendTransaction(transaction);
      setTxHash(hash);
      setStep("pending");
      const outcome = await adapter.waitForTransaction(hash);
      if (outcome.status === "reverted") throw new Error(`Purchase reverted (${hash})`);
      setStep("success");
      params.onSuccess?.(hash);
    } catch (cause: unknown) {
      setError(toError(cause));
      setStep("error");
    }
  }, [adapter, account, chain, integrator, params, quoteResource.data, slippageBps]);

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setTxHash(null);
  }, []);

  const effectiveStep: LaunchBuyStep =
    step === "idle" && approvals.length > 0 ? "needs-approval" : step;

  const statusMessage = useMemo(() => {
    const mockPrefix = adapter.isMock ? "Simulated (mock adapter): " : "";
    switch (effectiveStep) {
      case "needs-approval":
        return `Approve ${approvals[0]?.token.symbol ?? "the payment token"} before buying`;
      case "approving":
        return `${mockPrefix}Waiting for the approval to confirm`;
      case "building":
        return `${mockPrefix}Preparing the purchase`;
      case "awaiting-signature":
        return `${mockPrefix}Confirm the transaction in your wallet`;
      case "pending":
        return `${mockPrefix}Purchase submitted, waiting for confirmation`;
      case "success":
        return `${mockPrefix}Purchase confirmed`;
      case "error":
        return error === null ? "Something went wrong" : error.message;
      case "idle":
      default:
        return "";
    }
  }, [effectiveStep, approvals, error, adapter.isMock]);

  return {
    quote: quoteResource.data,
    quoteStatus: quoteResource.status,
    quoteError: quoteResource.error,
    step: effectiveStep,
    error,
    txHash,
    approvals,
    needsApproval: approvals.length > 0,
    statusMessage,
    approve,
    execute,
    reset,
  };
}
