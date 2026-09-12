// SPDX-License-Identifier: MIT
/**
 * Headless launch participation.
 *
 * A launch is a pool with `LaunchGuardHook` attached, so buying into one is a
 * swap and this module owns exactly two things a swap does not have:
 *
 * 1. **The schedule.** `startBlock`, `decayBlocks`, and the fee decaying from
 *    `initialFeePips` to `finalFeePips` between them. All block-denominated,
 *    never time-denominated: the hook counts blocks, and converting to seconds
 *    would require a block time this package cannot know.
 * 2. **The gates.** `TradingNotOpen` before the open, and `BuyExceedsMaxPerTx`
 *    while the window is live. Both are evaluated here so the button can be
 *    disabled with the reason, rather than reverting inside the vault lock
 *    after the user has paid for the whole plan.
 *
 * There is no third thing. In particular there is no per-account state to load:
 * the hook cannot identify a buyer (see {@link ../callpath/launch.js}), so a
 * "your remaining allocation" row would be fiction with a number on it.
 */

import { useCallback, useMemo } from "react";
import type { Hex } from "viem";
import type { PoolId } from "@latchprotocol/sdk";
import type { LaunchInfo } from "../adapters/protocol.js";
import {
  evaluateLaunchBuy,
  launchScheduleAt,
  type LaunchBuyGate,
  type LaunchSchedule,
} from "../callpath/launch.js";
import { ChainConfigError } from "../config/chain.js";
import { useWidgetContext } from "../context/WidgetProvider.js";
import type { QuoteBreakdown } from "../core/math.js";
import { useAsyncResource, type AsyncResource, type AsyncStatus } from "./useAsyncResource.js";
import { useSwapExecute, type UseSwapExecuteResult } from "./useSwapExecute.js";
import { useSwapQuote } from "./useSwapQuote.js";

/**
 * The four states a launch surface can be in, plus the one where it works.
 *
 * They are kept distinct on purpose, because they call for four different
 * sentences and only one of them is the user's problem:
 *
 * - `loading` — a read is in flight.
 * - `error` — the read failed. The chain is unreachable or the address is not
 *   a `LaunchGuardHook`. Say so; never fall back to an example.
 * - `not-configured` — this chain's config carries no `launchGuardHook`
 *   address, because no `LaunchGuardHook` is deployed on it. Nothing is wrong
 *   and nothing will load.
 * - `empty` — the hook is there and answered, and no launch is registered for
 *   the pool (or for any configured pool).
 * - `ready` — a launch record was read.
 */
export type LaunchDataState = "loading" | "error" | "not-configured" | "empty" | "ready";

/**
 * `true` when the failure was "there is no launchpad on this chain" rather than
 * "the read broke".
 *
 * The adapters signal it by throwing `ChainConfigError` naming
 * `launchGuardHook`, which is the same mechanism every other missing-contract
 * path in this package uses.
 */
export function isLaunchpadNotConfigured(error: Error | null): boolean {
  return error instanceof ChainConfigError && error.contract === "launchGuardHook";
}

/** Maps an async resource onto {@link LaunchDataState}. */
export function resolveLaunchDataState(resource: {
  readonly status: AsyncStatus;
  readonly error: Error | null;
  readonly data: unknown;
}): LaunchDataState {
  if (resource.status === "error") {
    return isLaunchpadNotConfigured(resource.error) ? "not-configured" : "error";
  }
  if (resource.status === "loading" || resource.status === "idle") return "loading";
  if (resource.data === null) return "empty";
  if (Array.isArray(resource.data) && resource.data.length === 0) return "empty";
  return "ready";
}

/**
 * Every launch the adapter surfaces.
 *
 * Polled, because the schedule is a function of the block height and a stale
 * "opens in 12 blocks" is worse than no number.
 */
export function useLaunchList(): AsyncResource<readonly LaunchInfo[]> {
  const { adapter } = useWidgetContext();
  return useAsyncResource(
    useCallback(() => adapter.listLaunches(), [adapter]),
    [adapter],
    { refetchIntervalMs: 12_000 },
  );
}

/** One launch, by pool id. */
export function useLaunch(poolId: PoolId | null): AsyncResource<LaunchInfo | null> {
  const { adapter } = useWidgetContext();
  const loader = useCallback(async (): Promise<LaunchInfo | null> => {
    if (poolId === null) return null;
    return adapter.getLaunch(poolId);
  }, [adapter, poolId]);
  return useAsyncResource(loader, [adapter, poolId], {
    enabled: poolId !== null,
    refetchIntervalMs: 12_000,
  });
}

/** Everything a launch UI needs, derived from one read. Pure. */
export interface LaunchView {
  readonly launch: LaunchInfo;
  /** The schedule as of the block the launch was read at. */
  readonly schedule: LaunchSchedule;
  /**
   * Where the fee the hook is charging sits between `initialFeePips` and
   * `finalFeePips`, in bps: `0` at the opening tax, `10_000` once settled.
   * `null` when the two ends are equal, where there is no span to be inside of.
   */
  readonly feeSpanProgressBps: number | null;
  /**
   * `currentFeePips` (read from the hook) minus the locally projected fee for
   * the same block.
   *
   * Expected to be exactly `0`: {@link ../callpath/launch.js | launchFeeAtBlock}
   * reproduces `LaunchGuardHook.feeAt` including its rounding. Anything else
   * means the two disagree, and a UI should show the chain's number and say the
   * projection is off rather than quietly preferring one.
   */
  readonly feeProjectionDriftPips: number | null;
}

/** Derives the presentational view of a launch. Pure. */
export function buildLaunchView(launch: LaunchInfo): LaunchView {
  const schedule = launchScheduleAt(launch.guard, launch.readAtBlock);
  const { initialFeePips, finalFeePips } = launch.guard;
  const span = initialFeePips - finalFeePips;
  const feeSpanProgressBps =
    span <= 0
      ? null
      : Math.max(
          0,
          Math.min(10_000, Math.round(((initialFeePips - launch.currentFeePips) * 10_000) / span)),
        );
  return {
    launch,
    schedule,
    feeSpanProgressBps,
    feeProjectionDriftPips:
      schedule.feePips === null ? null : launch.currentFeePips - schedule.feePips,
  };
}

/** Parameters for {@link useLaunchBuy}. */
export interface UseLaunchBuyParams {
  readonly launch: LaunchInfo | null;
  /** Input amount in the quote currency's smallest unit. */
  readonly amountIn: bigint | null;
  readonly slippageBps?: number;
  readonly recipient?: `0x${string}`;
  readonly onSuccess?: (hash: Hex) => void;
}

/** Result of {@link useLaunchBuy}. */
export interface UseLaunchBuyResult {
  /** The hook's gates, evaluated against the block the launch was read at. */
  readonly gate: LaunchBuyGate;
  /** Swap quote breakdown, or `null` while there is nothing to quote. */
  readonly breakdown: QuoteBreakdown | null;
  readonly quoteStatus: AsyncStatus;
  readonly quoteError: Error | null;
  readonly quoteIsRefreshing: boolean;
  /** Output units per input unit, for display only. */
  readonly rate: number | null;
  /** The swap execution controller. Approvals, signature, confirmation. */
  readonly execution: UseSwapExecuteResult;
  /** `true` when the gates pass and the swap layer is ready to send. */
  readonly canBuy: boolean;
}

/**
 * Quotes and executes a launch buy.
 *
 * Deliberately a thin composition of `useSwapQuote` and `useSwapExecute` rather
 * than a parallel implementation: a launch buy that took a different code path
 * from a swap would be a second call path to keep correct, and the second one
 * is always the one that rots.
 *
 * Quoting is suppressed while the hook would reject the swap. Quoting a trade
 * that reverts in `beforeSwap` gets a revert, not a price, and rendering that
 * as a failed quote would blame the pool for a closed gate.
 */
export function useLaunchBuy(params: UseLaunchBuyParams): UseLaunchBuyResult {
  const { launch, amountIn } = params;

  const gate = useMemo<LaunchBuyGate>(() => {
    if (launch === null) {
      return { reason: "not-configured", message: "No launch loaded", revert: null };
    }
    return evaluateLaunchBuy({
      guard: launch.guard,
      blockNumber: launch.readAtBlock,
      amountIn,
    });
  }, [launch, amountIn]);

  const quote = useSwapQuote({
    tokenIn: launch?.quoteToken ?? null,
    tokenOut: launch?.launchToken ?? null,
    amountIn,
    ...(params.slippageBps === undefined ? {} : { slippageBps: params.slippageBps }),
    enabled: launch !== null && gate.reason === null,
  });

  const execution = useSwapExecute({
    tokenIn: launch?.quoteToken ?? null,
    tokenOut: launch?.launchToken ?? null,
    amountIn,
    quote: quote.quote,
    breakdown: quote.breakdown,
    ...(params.recipient === undefined ? {} : { recipient: params.recipient }),
    ...(params.onSuccess === undefined ? {} : { onSuccess: params.onSuccess }),
  });

  return {
    gate,
    breakdown: quote.breakdown,
    quoteStatus: quote.status,
    quoteError: quote.error,
    quoteIsRefreshing: quote.isRefreshing,
    rate: quote.rate,
    execution,
    canBuy: gate.reason === null && execution.canExecute && quote.status === "success",
  };
}
