// SPDX-License-Identifier: MIT
/**
 * Headless swap quoting.
 *
 * Returns the adapter's raw quote *and* the derived
 * {@link ../core/math.js | QuoteBreakdown}, which already has the integrator fee
 * split out. A custom UI built on this hook shows the integrator's cut - and
 * the user's true net - without having to know the fee mechanism exists.
 */

import { useCallback, useMemo, useState } from "react";
import type { SwapQuoteResult, TokenInfo } from "../adapters/protocol.js";
import { useWidgetContext } from "../context/WidgetProvider.js";
import {
  buildQuoteBreakdown,
  exchangeRate,
  MAX_SLIPPAGE_BPS,
  type QuoteBreakdown,
} from "../core/math.js";
import { useAsyncResource, type AsyncStatus } from "./useAsyncResource.js";

/** Parameters for {@link useSwapQuote}. */
export interface UseSwapQuoteParams {
  readonly tokenIn: TokenInfo | null;
  readonly tokenOut: TokenInfo | null;
  /** Input amount in the smallest unit, or `null` while the field is empty. */
  readonly amountIn: bigint | null;
  /** Overrides the provider's default slippage. */
  readonly slippageBps?: number;
  /** Re-quote interval. Quotes go stale; 15s is a sane default for a UI. */
  readonly refetchIntervalMs?: number;
  readonly enabled?: boolean;
}

/** Result of {@link useSwapQuote}. */
export interface UseSwapQuoteResult {
  readonly status: AsyncStatus;
  readonly quote: SwapQuoteResult | null;
  /** Fee-aware derivation of the quote. `null` until a quote arrives. */
  readonly breakdown: QuoteBreakdown | null;
  readonly error: Error | null;
  readonly isRefreshing: boolean;
  readonly updatedAt: number | null;
  /** True when the numbers came from the mock adapter and are not real. */
  readonly isMock: boolean;
  /** Output units per input unit, for display only. */
  readonly rate: number | null;
  readonly slippageBps: number;
  refetch(): void;
}

/** Quotes a swap and derives the fee-inclusive breakdown. */
export function useSwapQuote(params: UseSwapQuoteParams): UseSwapQuoteResult {
  const { adapter, integrator, defaultSlippageBps } = useWidgetContext();
  const { tokenIn, tokenOut, amountIn } = params;

  const slippageBps = params.slippageBps ?? defaultSlippageBps;
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new RangeError(
      `[@latchprotocol/widgets] slippageBps must be an integer in [0, ${MAX_SLIPPAGE_BPS}]: ${slippageBps}`,
    );
  }

  const enabled =
    (params.enabled ?? true) &&
    tokenIn !== null &&
    tokenOut !== null &&
    amountIn !== null &&
    amountIn > 0n &&
    tokenIn.address.toLowerCase() !== tokenOut.address.toLowerCase();

  const loader = useCallback(async (): Promise<SwapQuoteResult> => {
    if (tokenIn === null || tokenOut === null || amountIn === null) {
      throw new Error("useSwapQuote: called without a complete request");
    }
    return adapter.quoteSwap({ tokenIn, tokenOut, amountIn });
  }, [adapter, tokenIn, tokenOut, amountIn]);

  const resource = useAsyncResource<SwapQuoteResult>(
    loader,
    [
      adapter,
      tokenIn?.address ?? null,
      tokenOut?.address ?? null,
      amountIn === null ? null : amountIn.toString(),
    ],
    {
      enabled,
      refetchIntervalMs: params.refetchIntervalMs ?? 15_000,
    },
  );

  const breakdown = useMemo<QuoteBreakdown | null>(() => {
    if (resource.data === null) return null;
    return buildQuoteBreakdown({
      amountIn: resource.data.amountIn,
      grossAmountOut: resource.data.grossAmountOut,
      spotAmountOut: resource.data.spotAmountOut,
      lpFeeAmount: resource.data.lpFeeAmount,
      lpFeePips: resource.data.lpFeePips,
      slippageBps,
      integrator,
    });
  }, [resource.data, slippageBps, integrator]);

  const rate = useMemo(() => {
    if (breakdown === null || tokenIn === null || tokenOut === null) return null;
    return exchangeRate(
      breakdown.amountIn,
      tokenIn.decimals,
      breakdown.netAmountOut,
      tokenOut.decimals,
    );
  }, [breakdown, tokenIn, tokenOut]);

  return {
    status: resource.status,
    quote: resource.data,
    breakdown,
    error: resource.error,
    isRefreshing: resource.isRefreshing,
    updatedAt: resource.updatedAt,
    isMock: adapter.isMock,
    rate,
    slippageBps,
    refetch: resource.refetch,
  };
}

/** Tracks a slippage setting with validation, for UIs that expose the control. */
export function useSlippageSetting(initialBps?: number): {
  slippageBps: number;
  setSlippageBps(next: number): void;
  error: string | null;
} {
  const { defaultSlippageBps } = useWidgetContext();
  const [slippageBps, setValue] = useState(initialBps ?? defaultSlippageBps);
  const [error, setError] = useState<string | null>(null);

  const setSlippageBps = useCallback((next: number) => {
    if (!Number.isInteger(next) || next < 0) {
      setError("Slippage must be a whole number of basis points");
      return;
    }
    if (next > MAX_SLIPPAGE_BPS) {
      setError(`Slippage above ${MAX_SLIPPAGE_BPS / 100}% is not accepted`);
      return;
    }
    setError(null);
    setValue(next);
  }, []);

  return { slippageBps, setSlippageBps, error };
}
