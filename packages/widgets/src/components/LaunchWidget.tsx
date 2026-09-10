// SPDX-License-Identifier: MIT
/**
 * Drop-in launch widget.
 *
 * A launch is mostly gates: a start time, an end time, a per-wallet cap and a
 * minimum. All of them are evaluated by `evaluateLaunchPurchase` and surfaced as
 * a specific reason, because "Sale has not started yet" on a disabled button is
 * a better user experience - and a cheaper one - than a reverted transaction.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Address } from "viem";
import { useWidgetContext } from "../context/WidgetProvider.js";
import { formatBps } from "../config/integrator.js";
import {
  formatAmount,
  formatDuration,
  formatTimestamp,
  parseAmount,
  shortAddress,
} from "../core/format.js";
import {
  buildLaunchSaleView,
  evaluateLaunchPurchase,
  useLaunch,
  useLaunchAccountState,
  useLaunchBuy,
  useLaunchList,
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
import type { LaunchInfo, LaunchPriceCurve } from "../adapters/protocol.js";

/** Props for {@link LaunchWidget}. */
export interface LaunchWidgetProps {
  /** Launchpad address. When omitted, the first launch the adapter lists is used. */
  readonly launchId?: Address;
  readonly title?: string;
  readonly onPurchaseConfirmed?: (hash: string) => void;
}

/** The styled launch widget. */
export function LaunchWidget(props: LaunchWidgetProps): JSX.Element {
  const { chain, integrator, adapter } = useWidgetContext();
  const list = useLaunchList();
  const fallbackId = list.data?.[0]?.id ?? null;
  const launchId = props.launchId ?? fallbackId;

  const launchResource = useLaunch(launchId);
  const accountResource = useAccount();
  const account = accountResource.data;
  const accountState = useLaunchAccountState(launchId, account);

  const launch = launchResource.data;
  const [amountText, setAmountText] = useState("");
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const handle = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(handle);
  }, []);

  const parsed =
    launch === null || amountText.trim() === ""
      ? null
      : parseAmount(amountText, launch.paymentToken.decimals);
  const amountIn = parsed !== null && parsed.ok ? parsed.value : null;

  const balance = useTokenBalance(launch?.paymentToken ?? null, account);

  const purchase = useLaunchBuy({
    launch,
    amountIn,
    ...(props.onPurchaseConfirmed ? { onSuccess: props.onPurchaseConfirmed } : {}),
  });

  const view = useMemo(
    () => (launch === null ? null : buildLaunchSaleView(launch, nowSeconds, adapter.isMock)),
    [launch, nowSeconds, adapter.isMock],
  );

  const gate = useMemo(() => {
    if (launch === null) return { reason: null, message: null } as const;
    return evaluateLaunchPurchase({
      launch,
      accountState: accountState.data,
      amountIn,
      balance: balance.data,
      nowSeconds,
    });
  }, [launch, accountState.data, amountIn, balance.data, nowSeconds]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (purchase.needsApproval) {
        void purchase.approve();
        return;
      }
      void purchase.execute();
    },
    [purchase],
  );

  if (launch === null || view === null) {
    return (
      <WidgetShell title={props.title ?? "Token launch"} subtitle={chain.name}>
        <StatusRegion
          message={
            launchResource.status === "loading"
              ? "Loading the sale"
              : launchResource.status === "error"
                ? (launchResource.error?.message ?? "Could not load the sale")
                : "No launch is configured."
          }
          tone={launchResource.status === "error" ? "error" : "neutral"}
        />
      </WidgetShell>
    );
  }

  const blocked = gate.reason !== null;
  const busy =
    purchase.step === "approving" ||
    purchase.step === "building" ||
    purchase.step === "awaiting-signature" ||
    purchase.step === "pending";

  const buttonLabel = purchase.needsApproval
    ? `Approve ${launch.paymentToken.symbol}`
    : account === null
      ? "Connect a wallet"
      : blocked
        ? (gate.message ?? "Unavailable")
        : `Buy ${launch.token.symbol}`;

  return (
    <WidgetShell
      title={props.title ?? `${launch.token.symbol} launch`}
      subtitle={`Latch Protocol · ${chain.name}`}
    >
      <SummaryList>
        <SummaryRow label="Status" value={launch.status} />
        <SummaryRow
          label={view.secondsUntilStart !== null ? "Starts in" : "Ends in"}
          value={
            view.secondsUntilStart !== null
              ? formatDuration(view.secondsUntilStart)
              : view.secondsUntilEnd !== null
                ? formatDuration(view.secondsUntilEnd)
                : `Ended ${formatTimestamp(launch.endTime)}`
          }
        />
      </SummaryList>

      <div className="latch-field">
        <span className="latch-label">
          Sold {formatAmount(launch.sold, launch.token.decimals)} /{" "}
          {formatAmount(launch.totalForSale, launch.token.decimals)} {launch.token.symbol}
        </span>
        <ProgressBar label="Sale progress" percent={view.progressPercent} />
        <div className="latch-meta">
          <span>{view.progressPercent.toFixed(1)}% sold</span>
          <span className="latch-meta-value">
            {formatAmount(launch.raised, launch.paymentToken.decimals)} /{" "}
            {formatAmount(launch.hardCap, launch.paymentToken.decimals)}{" "}
            {launch.paymentToken.symbol} raised
          </span>
        </div>
      </div>

      <PriceCurveChart curve={launch.priceCurve} progressPercent={view.progressPercent} />

      <form onSubmit={handleSubmit} noValidate>
        <AmountField
          label={`You pay (${launch.paymentToken.symbol})`}
          value={amountText}
          onValueChange={setAmountText}
          token={launch.paymentToken}
          tokens={[launch.paymentToken]}
          balance={balance.data}
          error={parsed !== null && !parsed.ok ? parsed.message : null}
          secondaryText={`Minimum ${formatAmount(launch.minPurchase, launch.paymentToken.decimals)} ${launch.paymentToken.symbol}`}
        />

        <SummaryList>
          <SummaryRow
            label="You receive"
            value={
              purchase.quote === null
                ? "-"
                : `${formatAmount(purchase.quote.tokensOut, launch.token.decimals)} ${launch.token.symbol}`
            }
          />
          <SummaryRow
            label="Wallet cap remaining"
            value={
              accountState.data === null || accountState.data.capRemaining === null
                ? "No cap"
                : `${formatAmount(accountState.data.capRemaining, launch.paymentToken.decimals)} ${launch.paymentToken.symbol}`
            }
          />
          {integrator.active ? (
            <SummaryRow
              label={`Integrator fee (${formatBps(integrator.feeBps)})`}
              value={shortAddress(integrator.referrer)}
              emphasis="fee"
              title="Attributed to the site hosting this widget, inside the purchase transaction."
            />
          ) : null}
        </SummaryList>

        <StatusRegion
          message={purchase.statusMessage !== "" ? purchase.statusMessage : (gate.message ?? "")}
          tone={
            purchase.step === "error"
              ? "error"
              : purchase.step === "success"
                ? "success"
                : blocked
                  ? "error"
                  : "neutral"
          }
        />

        <ActionButton
          type="submit"
          disabled={account === null || (blocked && !purchase.needsApproval) || busy}
          busy={busy}
        >
          {buttonLabel}
        </ActionButton>
      </form>

      <ErrorPanel error={purchase.error ?? purchase.quoteError} />
    </WidgetShell>
  );
}

/**
 * A small inline chart of the sale's price curve.
 *
 * Drawn as an SVG path from the curve parameters, with the current position
 * marked. It is a shape, not a prediction: no axis labels imply a market price.
 */
export function PriceCurveChart(props: {
  readonly curve: LaunchPriceCurve;
  readonly progressPercent: number;
}): JSX.Element {
  const { curve } = props;
  const width = 320;
  const height = 72;
  const samples = 32;

  const points = useMemo(() => {
    const values: number[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      values.push(priceAtFraction(curve, t));
    }
    return values;
  }, [curve]);

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

  const markerX = (Math.max(0, Math.min(100, props.progressPercent)) / 100) * width;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="latch-curve"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Price curve: ${describeCurve(curve)}. Sale is ${props.progressPercent.toFixed(0)} percent complete.`}
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
      <figcaption className="latch-subtitle">{describeCurve(curve)}</figcaption>
    </figure>
  );
}

function priceAtFraction(curve: LaunchPriceCurve, t: number): number {
  if (curve.kind === "fixed") return Number(curve.price);
  const start = Number(curve.startPrice);
  const end = Number(curve.endPrice);
  if (curve.kind === "linear") return start + (end - start) * t;
  const exponent = Number(curve.exponent) / 1e18;
  return start + (end - start) * t ** (Number.isFinite(exponent) && exponent > 0 ? exponent : 2);
}

function describeCurve(curve: LaunchPriceCurve): string {
  switch (curve.kind) {
    case "fixed":
      return "Fixed price for the whole sale";
    case "linear":
      return "Price rises linearly as the sale fills";
    case "exponential":
      return "Price rises on a curve as the sale fills";
    default:
      return "";
  }
}

/** Re-exported so hosts can type a launch prop without reaching into adapters. */
export type { LaunchInfo };
