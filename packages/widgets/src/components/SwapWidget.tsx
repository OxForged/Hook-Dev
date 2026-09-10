// SPDX-License-Identifier: MIT
/**
 * Drop-in swap widget.
 *
 * Everything below the presentation is the headless layer: `useSwapQuote` and
 * `useSwapExecute` do the work, this file only renders it. An integrator who
 * wants their own look imports those two hooks and deletes this component from
 * their bundle.
 *
 * The integrator fee, when configured, is shown as its own line in the summary.
 * That is a deliberate product decision, not a legal one: a fee the user can see
 * is a fee that does not become a scandal, and an integrator whose users trust
 * the widget keeps earning from it.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { TokenInfo } from "../adapters/protocol.js";
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
import { MAX_SLIPPAGE_BPS } from "../core/math.js";
import { useSwapExecute } from "../hooks/useSwapExecute.js";
import { useSwapQuote } from "../hooks/useSwapQuote.js";
import { useAccount, useTokenBalance, useTokenList } from "../hooks/useTokens.js";
import {
  ActionButton,
  AmountField,
  ErrorPanel,
  RouteSummary,
  StatusRegion,
  SummaryList,
  SummaryRow,
  WidgetShell,
} from "./primitives.js";

/** Props for {@link SwapWidget}. */
export interface SwapWidgetProps {
  /** Pre-selects the input token by address. */
  readonly defaultTokenIn?: string;
  /** Pre-selects the output token by address. */
  readonly defaultTokenOut?: string;
  readonly title?: string;
  /** Show the slippage control. Defaults to `true`. */
  readonly showSlippageControl?: boolean;
  readonly onSwapConfirmed?: (hash: string) => void;
}

const SLIPPAGE_PRESETS = [10, 50, 100] as const;

/** The styled swap widget. */
export function SwapWidget(props: SwapWidgetProps): JSX.Element {
  const { integrator, defaultSlippageBps, chain } = useWidgetContext();
  const tokenList = useTokenList();
  const accountResource = useAccount();
  const tokens = useMemo(() => tokenList.data ?? [], [tokenList.data]);

  const [tokenIn, setTokenIn] = useState<TokenInfo | null>(null);
  const [tokenOut, setTokenOut] = useState<TokenInfo | null>(null);
  const [amountText, setAmountText] = useState("");
  const [slippageBps, setSlippageBps] = useState(defaultSlippageBps);

  // Initial selection, once the token list arrives.
  useEffect(() => {
    if (tokens.length === 0) return;
    setTokenIn((current) => {
      if (current !== null) return current;
      const preferred = props.defaultTokenIn
        ? tokens.find(
            (token) => token.address.toLowerCase() === props.defaultTokenIn?.toLowerCase(),
          )
        : undefined;
      return preferred ?? tokens[0] ?? null;
    });
    setTokenOut((current) => {
      if (current !== null) return current;
      const preferred = props.defaultTokenOut
        ? tokens.find(
            (token) => token.address.toLowerCase() === props.defaultTokenOut?.toLowerCase(),
          )
        : undefined;
      return preferred ?? tokens[1] ?? null;
    });
  }, [tokens, props.defaultTokenIn, props.defaultTokenOut]);

  const parsed = useMemo(() => {
    if (tokenIn === null || amountText.trim() === "") return null;
    return parseAmount(amountText, tokenIn.decimals);
  }, [amountText, tokenIn]);

  const amountIn = parsed !== null && parsed.ok ? parsed.value : null;
  const amountError = parsed !== null && !parsed.ok ? parsed.message : null;

  const balance = useTokenBalance(tokenIn, accountResource.data);

  const quote = useSwapQuote({
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps,
  });

  const execution = useSwapExecute({
    tokenIn,
    tokenOut,
    amountIn,
    quote: quote.quote,
    breakdown: quote.breakdown,
    ...(props.onSwapConfirmed ? { onSuccess: props.onSwapConfirmed } : {}),
  });

  const switchTokens = useCallback(() => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountText("");
  }, [tokenIn, tokenOut]);

  const useMax = useCallback(() => {
    if (tokenIn === null || balance.data === null) return;
    setAmountText(formatAmount(balance.data, tokenIn.decimals, tokenIn.decimals));
  }, [tokenIn, balance.data]);

  const insufficientBalance =
    amountIn !== null && balance.data !== null && amountIn > balance.data;

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (execution.needsApproval) {
        void execution.approve();
        return;
      }
      void execution.execute();
    },
    [execution],
  );

  const breakdown = quote.breakdown;
  const outputText =
    breakdown === null || tokenOut === null
      ? ""
      : formatAmount(breakdown.netAmountOut, tokenOut.decimals);

  const routeTokens = useMemo(() => {
    if (quote.quote === null || quote.quote.route.length === 0) return [];
    const symbols = [quote.quote.route[0]?.tokenIn.symbol ?? ""];
    for (const step of quote.quote.route) symbols.push(step.tokenOut.symbol);
    return symbols.filter((symbol) => symbol !== "");
  }, [quote.quote]);

  const statusMessage =
    execution.statusMessage !== ""
      ? execution.statusMessage
      : quote.status === "loading"
        ? "Fetching a quote"
        : insufficientBalance
          ? `Insufficient ${tokenIn?.symbol ?? "balance"}`
          : quote.status === "success" && breakdown !== null && tokenOut !== null
            ? `Quote ready: about ${formatAmount(breakdown.netAmountOut, tokenOut.decimals)} ${tokenOut.symbol}`
            : "";

  const statusTone =
    execution.step === "error" || quote.status === "error" || insufficientBalance
      ? "error"
      : execution.step === "success"
        ? "success"
        : "neutral";

  const buttonLabel = execution.needsApproval
    ? `Approve ${execution.approvals[0]?.token.symbol ?? ""}`
    : accountResource.data === null
      ? "Connect a wallet"
      : insufficientBalance
        ? "Insufficient balance"
        : execution.step === "pending" || execution.step === "awaiting-signature"
          ? "Confirming..."
          : "Swap";

  const canSubmit =
    accountResource.data !== null &&
    !insufficientBalance &&
    (execution.needsApproval ||
      (execution.canExecute && quote.status === "success" && amountError === null));

  const busy =
    execution.step === "approving" ||
    execution.step === "building" ||
    execution.step === "awaiting-signature" ||
    execution.step === "pending";

  return (
    <WidgetShell
      title={props.title ?? "Swap"}
      subtitle={`Latch Protocol · ${chain.name}`}
    >
      <form onSubmit={handleSubmit} noValidate>
        <AmountField
          label="You pay"
          value={amountText}
          onValueChange={setAmountText}
          token={tokenIn}
          tokens={tokens}
          onTokenChange={setTokenIn}
          balance={balance.data}
          onUseMax={useMax}
          error={amountError ?? (insufficientBalance ? "Insufficient balance" : null)}
        />

        <div className="latch-switch-row">
          <button
            type="button"
            className="latch-icon-button"
            onClick={switchTokens}
            aria-label="Swap the input and output tokens"
            title="Switch tokens"
          >
            {"⇅"}
          </button>
        </div>

        <AmountField
          label="You receive"
          value={outputText}
          readOnly
          token={tokenOut}
          tokens={tokens}
          onTokenChange={setTokenOut}
          secondaryText={
            quote.isRefreshing ? "Updating quote..." : quote.isMock ? "Simulated" : ""
          }
        />

        {props.showSlippageControl !== false ? (
          <SlippageControl value={slippageBps} onChange={setSlippageBps} />
        ) : null}

        {breakdown !== null && tokenIn !== null && tokenOut !== null ? (
          <SummaryList>
            <SummaryRow
              label="Rate"
              value={formatRate(quote.rate, tokenIn.symbol, tokenOut.symbol)}
            />
            <SummaryRow
              label="Price impact"
              value={formatPercentFromBps(breakdown.priceImpactBps)}
              severity={breakdown.priceImpactSeverity}
              title="How much worse this trade's rate is than the pool's current rate."
            />
            <SummaryRow
              label="LP fee"
              value={formatPercentFromPips(breakdown.lpFeePips)}
            />
            {integrator.active ? (
              <SummaryRow
                label={`Integrator fee (${formatBps(integrator.feeBps)})`}
                value={`${formatAmount(breakdown.integratorFee, tokenOut.decimals)} ${tokenOut.symbol} → ${shortAddress(integrator.referrer)}`}
                emphasis="fee"
                title="Paid to the site hosting this widget, inside the same transaction as the swap."
              />
            ) : null}
            <SummaryRow
              label="Minimum received"
              value={`${formatAmount(breakdown.minAmountOutNet, tokenOut.decimals)} ${tokenOut.symbol}`}
              title="Guaranteed floor after slippage and the integrator fee. The transaction reverts below this."
            />
            <SummaryRow
              label="Slippage tolerance"
              value={formatPercentFromBps(breakdown.slippageBps)}
            />
          </SummaryList>
        ) : null}

        {routeTokens.length > 1 ? (
          <RouteSummary
            tokens={routeTokens}
            detail={
              quote.quote === null
                ? undefined
                : `${quote.quote.route.length} hop${quote.quote.route.length > 1 ? "s" : ""} · ${quote.quote.route[0]?.poolType ?? ""}`
            }
          />
        ) : null}

        <StatusRegion message={statusMessage} tone={statusTone} />

        <ActionButton type="submit" disabled={!canSubmit} busy={busy}>
          {buttonLabel}
        </ActionButton>
      </form>

      <ErrorPanel error={execution.error ?? quote.error} />

      {execution.txHash !== null ? (
        <p className="latch-footer">
          <span>Transaction</span>
          <span>{shortAddress(execution.txHash)}</span>
        </p>
      ) : null}
    </WidgetShell>
  );
}

function SlippageControl(props: {
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  const [customText, setCustomText] = useState("");

  const applyCustom = (text: string): void => {
    setCustomText(text);
    const percent = Number.parseFloat(text);
    if (!Number.isFinite(percent) || percent < 0) return;
    const bps = Math.round(percent * 100);
    if (bps > MAX_SLIPPAGE_BPS) return;
    props.onChange(bps);
  };

  return (
    <fieldset
      className="latch-field"
      style={{ border: "1px solid var(--latch-border)", margin: 0 }}
    >
      <legend className="latch-label" style={{ padding: "0 4px" }}>
        Slippage tolerance
      </legend>
      <div className="latch-field-row">
        {SLIPPAGE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="latch-chip"
            aria-pressed={props.value === preset}
            onClick={() => {
              setCustomText("");
              props.onChange(preset);
            }}
          >
            {formatPercentFromBps(preset)}
          </button>
        ))}
        <input
          className="latch-amount-input"
          style={{ fontSize: "var(--latch-font-size)", flex: "0 1 72px" }}
          type="text"
          inputMode="decimal"
          placeholder="Custom %"
          aria-label="Custom slippage tolerance, in percent"
          value={customText}
          onChange={(event) => applyCustom(event.target.value)}
        />
      </div>
    </fieldset>
  );
}
