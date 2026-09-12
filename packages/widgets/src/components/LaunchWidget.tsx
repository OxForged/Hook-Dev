// SPDX-License-Identifier: MIT
/**
 * Drop-in launch widget: a launch-aware swap panel.
 *
 * A Latch launch is a pool with `LaunchGuardHook` attached and an LP fee that
 * decays from `initialFeePips` to `finalFeePips` over `decayBlocks` blocks.
 * Buying into one is an ordinary swap, so the bottom half of this component is
 * the swap path — the same router, the same plan, the same integrator fee step.
 *
 * The top half is the only part that is launch-specific, and it exists because
 * the thing a buyer needs to know before pressing Buy is *when* they are:
 *
 * - Trading may not be open. Before `startBlock` every swap reverts.
 * - The fee right now may be enormous. That is the sniper tax working as
 *   designed, and quoting it as though it were the pool's normal fee would
 *   invite people to pay 25% without noticing.
 * - `maxBuyPerTx` caps a TRANSACTION, not a wallet. The hook's own source says
 *   splitting a buy across transactions or wallets "is NOT prevented and cannot
 *   be", and a UI that showed it as "your remaining allocation" would be
 *   claiming a protection nobody has.
 *
 * Everything rendered here was read from the hook. Nothing is defaulted: where
 * a value is missing, the widget says which value and why.
 */

import { useCallback, useMemo, useState, type FormEvent } from "react";
import type { PoolId } from "@latchprotocol/sdk";
import { useWidgetContext } from "../context/WidgetProvider.js";
import { formatBps } from "../config/integrator.js";
import {
  formatAmount,
  formatPercentFromBps,
  formatPercentFromPips,
  formatRate,
  parseAmount,
  shortAddress,
} from "../core/format.js";
import {
  launchFeeAtBlock,
  type LaunchGuard,
  type LaunchSchedule,
} from "../callpath/launch.js";
import {
  buildLaunchView,
  resolveLaunchDataState,
  useLaunch,
  useLaunchBuy,
  useLaunchList,
  type LaunchDataState,
  type LaunchView,
} from "../hooks/useLaunch.js";
import { useAccount, useTokenBalance } from "../hooks/useTokens.js";
import {
  ActionButton,
  AmountField,
  ErrorPanel,
  ProgressBar,
  StatusRegion,
  SummaryList,
  SummaryRow,
  WidgetShell,
} from "./primitives.js";
import type { LaunchInfo } from "../adapters/protocol.js";

/** Props for {@link LaunchWidget}. */
export interface LaunchWidgetProps {
  /**
   * The launch pool, by pool id. When omitted, the first launch the adapter
   * lists is used.
   *
   * A pool id, not a contract address: `LaunchGuardHook` serves many pools and
   * keys everything it knows by `PoolId`.
   */
  readonly poolId?: PoolId;
  readonly title?: string;
  readonly onPurchaseConfirmed?: (hash: string) => void;
}

/** The styled launch widget. */
export function LaunchWidget(props: LaunchWidgetProps): JSX.Element {
  const { chain, integrator } = useWidgetContext();

  const list = useLaunchList();
  const poolId = props.poolId ?? list.data?.[0]?.poolId ?? null;
  const launchResource = useLaunch(poolId);
  const launch = launchResource.data;

  const listState = resolveLaunchDataState(list);
  const launchState = resolveLaunchDataState(launchResource);
  const state: LaunchDataState =
    props.poolId !== undefined ? launchState : listState !== "ready" ? listState : launchState;

  const accountResource = useAccount();
  const account = accountResource.data;

  const [amountText, setAmountText] = useState("");
  const parsed =
    launch === null || amountText.trim() === ""
      ? null
      : parseAmount(amountText, launch.quoteToken.decimals);
  const amountIn = parsed !== null && parsed.ok ? parsed.value : null;

  const balance = useTokenBalance(launch?.quoteToken ?? null, account);

  const buy = useLaunchBuy({
    launch,
    amountIn,
    ...(props.onPurchaseConfirmed ? { onSuccess: props.onPurchaseConfirmed } : {}),
  });

  const view = useMemo<LaunchView | null>(
    () => (launch === null ? null : buildLaunchView(launch)),
    [launch],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (buy.execution.needsApproval) {
        void buy.execution.approve();
        return;
      }
      void buy.execution.execute();
    },
    [buy.execution],
  );

  const title = props.title ?? (launch === null ? "Launch" : `${launch.launchToken.symbol} launch`);
  const subtitle = `Latch Protocol · ${chain.name}`;

  if (launch === null || view === null) {
    return (
      <WidgetShell title={title} subtitle={subtitle}>
        <LaunchUnavailable
          state={state}
          chainName={chain.name}
          error={props.poolId !== undefined ? launchResource.error : (list.error ?? launchResource.error)}
        />
      </WidgetShell>
    );
  }

  const { schedule } = view;
  const insufficientBalance =
    amountIn !== null && balance.data !== null && amountIn > balance.data;

  const busy =
    buy.execution.step === "approving" ||
    buy.execution.step === "building" ||
    buy.execution.step === "awaiting-signature" ||
    buy.execution.step === "pending";

  const buttonLabel = buy.execution.needsApproval
    ? `Approve ${buy.execution.approvals[0]?.token.symbol ?? launch.quoteToken.symbol}`
    : account === null
      ? "Connect a wallet"
      : buy.gate.message !== null
        ? buy.gate.message
        : insufficientBalance
          ? `Insufficient ${launch.quoteToken.symbol}`
          : `Buy ${launch.launchToken.symbol}`;

  const canSubmit =
    account !== null &&
    !insufficientBalance &&
    (buy.execution.needsApproval || (buy.canBuy && (parsed === null || parsed.ok)));

  const statusMessage =
    buy.execution.statusMessage !== ""
      ? buy.execution.statusMessage
      : buy.gate.message !== null
        ? `${buy.gate.message}${buy.gate.revert === null ? "" : ` — the hook reverts ${buy.gate.revert}`}`
        : buy.quoteStatus === "loading"
          ? "Fetching a quote"
          : insufficientBalance
            ? `Insufficient ${launch.quoteToken.symbol}`
            : "";

  const statusTone =
    buy.execution.step === "error" ||
    buy.quoteStatus === "error" ||
    buy.gate.reason !== null ||
    insufficientBalance
      ? "error"
      : buy.execution.step === "success"
        ? "success"
        : "neutral";

  return (
    <WidgetShell title={title} subtitle={subtitle}>
      <LaunchSchedulePanel view={view} />

      <FeeDecayChart guard={launch.guard} schedule={schedule} />

      <MaxBuyNotice launch={launch} schedule={schedule} />

      <form onSubmit={handleSubmit} noValidate>
        <AmountField
          label={`You pay (${launch.quoteToken.symbol})`}
          value={amountText}
          onValueChange={setAmountText}
          token={launch.quoteToken}
          tokens={[launch.quoteToken]}
          balance={balance.data}
          error={
            parsed !== null && !parsed.ok
              ? parsed.message
              : insufficientBalance
                ? "Insufficient balance"
                : null
          }
        />

        <AmountField
          label={`You receive (${launch.launchToken.symbol})`}
          value={
            buy.breakdown === null
              ? ""
              : formatAmount(buy.breakdown.netAmountOut, launch.launchToken.decimals)
          }
          readOnly
          token={launch.launchToken}
          tokens={[launch.launchToken]}
          secondaryText={buy.quoteIsRefreshing ? "Updating quote..." : ""}
        />

        {buy.breakdown !== null ? (
          <SummaryList>
            <SummaryRow
              label="Rate"
              value={formatRate(buy.rate, launch.quoteToken.symbol, launch.launchToken.symbol)}
            />
            <SummaryRow
              label="Price impact"
              value={formatPercentFromBps(buy.breakdown.priceImpactBps)}
              severity={buy.breakdown.priceImpactSeverity}
            />
            <SummaryRow
              label="Launch fee charged"
              value={formatPercentFromPips(launch.currentFeePips)}
              title="The LP fee the hook is overriding this pool with right now. It goes to the pool's liquidity providers, not to the hook."
            />
            {integrator.active ? (
              <SummaryRow
                label={`Integrator fee (${formatBps(integrator.feeBps)})`}
                value={`${formatAmount(buy.breakdown.integratorFee, launch.launchToken.decimals)} ${launch.launchToken.symbol} → ${shortAddress(integrator.referrer)}`}
                emphasis="fee"
                title="Paid to the site hosting this widget, inside the same transaction as the buy."
              />
            ) : null}
            <SummaryRow
              label="Minimum received"
              value={`${formatAmount(buy.breakdown.minAmountOutNet, launch.launchToken.decimals)} ${launch.launchToken.symbol}`}
              title="Guaranteed floor after slippage and the integrator fee. The transaction reverts below this."
            />
          </SummaryList>
        ) : null}

        <StatusRegion message={statusMessage} tone={statusTone} />

        <ActionButton type="submit" disabled={!canSubmit} busy={busy}>
          {buttonLabel}
        </ActionButton>
      </form>

      <ErrorPanel error={buy.execution.error ?? buy.quoteError} />

      {buy.execution.txHash !== null ? (
        <p className="latch-footer">
          <span>Transaction</span>
          <span>{shortAddress(buy.execution.txHash)}</span>
        </p>
      ) : null}
    </WidgetShell>
  );
}

/**
 * The four not-ready states, each with its own sentence.
 *
 * `not-configured` is the one worth being careful about. On a chain where no
 * `LaunchGuardHook` is deployed there is no address to read and none may be
 * invented, so the honest answer is that the feature is absent here — not that
 * something failed, and not an example launch.
 */
export function LaunchUnavailable(props: {
  readonly state: LaunchDataState;
  readonly chainName: string;
  readonly error: Error | null;
}): JSX.Element {
  switch (props.state) {
    case "loading":
      return <StatusRegion message="Reading the launch schedule from chain" tone="neutral" />;
    case "not-configured":
      return (
        <div className="latch-summary">
          <StatusRegion
            message={`No LaunchGuardHook is configured for ${props.chainName}.`}
            tone="neutral"
          />
          <p className="latch-subtitle">
            A launch is a pool with LaunchGuardHook attached. Without that hook&apos;s address
            there is nothing to read, and this widget will not guess one. Set{" "}
            <code>contracts.launchGuardHook</code> in the chain config once it is deployed here.
          </p>
        </div>
      );
    case "empty":
      return (
        <div className="latch-summary">
          <StatusRegion message="No launch is registered for this pool." tone="neutral" />
          <p className="latch-subtitle">
            The hook answered and holds no launch record. A pool id is only claimed when someone
            calls <code>configureLaunch</code>, and the hook refuses to let a pool be initialized
            before that happens.
          </p>
        </div>
      );
    case "error":
      return (
        <div className="latch-summary">
          <StatusRegion
            message={props.error?.message ?? "The launch could not be read from chain."}
            tone="error"
            assertive
          />
          <p className="latch-subtitle">
            Nothing is shown in place of the schedule. Retry when the chain is reachable.
          </p>
        </div>
      );
    default:
      return <StatusRegion message="Loading" tone="neutral" />;
  }
}

/** Block-denominated schedule, exactly as the hook stores it. */
export function LaunchSchedulePanel(props: { readonly view: LaunchView }): JSX.Element {
  const { launch, schedule, feeSpanProgressBps, feeProjectionDriftPips } = props.view;

  return (
    <>
      <SummaryList>
        <SummaryRow label="Phase" value={describePhase(schedule)} />
        <SummaryRow
          label="Fee right now"
          value={formatPercentFromPips(launch.currentFeePips)}
          title="Read from currentFee(poolId) on the hook."
        />
        <SummaryRow
          label="Fee schedule"
          value={
            schedule.initialFeePips === null || schedule.finalFeePips === null
              ? "unknown"
              : `${formatPercentFromPips(schedule.initialFeePips)} → ${formatPercentFromPips(schedule.finalFeePips)} over ${launch.guard.decayBlocks.toLocaleString()} blocks`
          }
        />
        <SummaryRow
          label="Opens at block"
          value={
            schedule.startBlock === null ? "unknown" : schedule.startBlock.toLocaleString()
          }
          title="Every swap before this block reverts TradingNotOpen."
        />
        <SummaryRow
          label={schedule.blocksUntilOpen !== null ? "Blocks until open" : "Blocks left in decay"}
          value={
            schedule.blocksUntilOpen !== null
              ? `${schedule.blocksUntilOpen.toLocaleString()} blocks`
              : schedule.blocksRemaining !== null
                ? `${schedule.blocksRemaining.toLocaleString()} blocks`
                : "none — the fee has settled"
          }
        />
        <SummaryRow
          label="Launch owner"
          value={shortAddress(launch.guard.owner)}
          title="Claimed by first call to configureLaunch. Non-transferable, and powerless from startBlock on."
        />
      </SummaryList>

      {feeSpanProgressBps !== null ? (
        <div className="latch-field">
          <span className="latch-label">Fee decay</span>
          <ProgressBar label="Fee decay progress" percent={feeSpanProgressBps / 100} />
          <div className="latch-meta">
            <span>{(feeSpanProgressBps / 100).toFixed(1)}% of the way to the final fee</span>
            <span className="latch-meta-value">
              read at block {launch.readAtBlock.toLocaleString()}
            </span>
          </div>
        </div>
      ) : null}

      {feeProjectionDriftPips !== null && feeProjectionDriftPips !== 0 ? (
        <StatusRegion
          message={
            `The hook reports ${formatPercentFromPips(launch.currentFeePips)} but this build ` +
            `projects ${formatPercentFromPips(launch.currentFeePips - feeProjectionDriftPips)} ` +
            "for the same block. The figure above is the chain's; the projected curve below may be wrong."
          }
          tone="error"
        />
      ) : null}
    </>
  );
}

function describePhase(schedule: LaunchSchedule): string {
  switch (schedule.phase) {
    case "unclaimed":
      return "No launch configured";
    case "disabled":
      return "Guard disabled — fee pinned, no gate, no tax";
    case "pending":
      return "Not open yet";
    case "decaying":
      return "Open — launch tax decaying";
    case "settled":
      return "Open — fee settled";
    default:
      return "unknown";
  }
}

/**
 * The per-transaction cap, said the way the contract means it.
 *
 * This block is not decoration. `maxBuyPerTx` is the field most likely to be
 * mistaken for an allocation, and the hook is explicit that it is not one:
 * "Splitting a buy across N wallets or N transactions in the same block is NOT
 * prevented and cannot be."
 */
export function MaxBuyNotice(props: {
  readonly launch: LaunchInfo;
  readonly schedule: LaunchSchedule;
}): JSX.Element | null {
  const { launch, schedule } = props;
  if (schedule.maxBuyPerTx === null) {
    return (
      <SummaryList>
        <SummaryRow label="Per-transaction cap" value="None configured" />
      </SummaryList>
    );
  }
  const amount = `${formatAmount(schedule.maxBuyPerTx, launch.quoteToken.decimals)} ${launch.quoteToken.symbol}`;
  return (
    <>
      <SummaryList>
        <SummaryRow
          label="Per-transaction cap"
          value={schedule.maxBuyPerTxEnforced ? amount : `${amount} (not enforced right now)`}
          title="Checked by the hook on each individual swap."
        />
      </SummaryList>
      <p className="latch-subtitle">
        This caps one transaction. It is <strong>not</strong> a per-wallet cap and cannot be made
        into one: the hook only ever sees the router as the caller, so it cannot tell two buyers
        apart. Splitting a buy across several transactions or several wallets defeats it, and the
        cap stops applying once the decay window ends.
      </p>
    </>
  );
}

/**
 * The fee decay, plotted by evaluating the hook's own function.
 *
 * Each sample is {@link ../callpath/launch.js | launchFeeAtBlock}, an exact
 * mirror of `LaunchGuardHook.feeAt` including its integer flooring — so this is
 * the schedule, not an impression of it. No axis implies a price and no point
 * is a prediction: every value is what the contract will charge in that block.
 */
export function FeeDecayChart(props: {
  readonly guard: LaunchGuard;
  readonly schedule: LaunchSchedule;
}): JSX.Element | null {
  const { guard, schedule } = props;
  const width = 320;
  const height = 72;
  const samples = 48;

  const points = useMemo(() => {
    if (guard.decayBlocks <= 0) return [];
    const values: number[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const block = guard.startBlock + (BigInt(guard.decayBlocks) * BigInt(i)) / BigInt(samples);
      values.push(launchFeeAtBlock(guard, block) ?? guard.finalFeePips);
    }
    return values;
  }, [guard]);

  if (points.length === 0 || schedule.phase === "unclaimed" || schedule.phase === "disabled") {
    return null;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const path = points
    .map((value, index) => {
      const x = (index / samples) * width;
      const y = height - ((value - min) / span) * (height - 8) - 4;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const progressBps = schedule.decayProgressBps ?? 0;
  const markerX = (Math.max(0, Math.min(10_000, progressBps)) / 10_000) * width;
  const caption =
    `${formatPercentFromPips(guard.initialFeePips)} at the open, ` +
    `${formatPercentFromPips(guard.finalFeePips)} after ${guard.decayBlocks.toLocaleString()} blocks`;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="latch-curve"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Launch fee decay: ${caption}. Currently ${(progressBps / 100).toFixed(0)} percent through the window.`}
      >
        <path d={path} fill="none" stroke="var(--latch-accent)" strokeWidth={2} />
        <line
          x1={markerX}
          y1={0}
          x2={markerX}
          y2={height}
          stroke="var(--latch-border-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
      <figcaption className="latch-subtitle">{caption}</figcaption>
    </figure>
  );
}

/** Re-exported so hosts can type a launch prop without reaching into adapters. */
export type { LaunchInfo };
