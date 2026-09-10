// SPDX-License-Identifier: MIT
/**
 * Presentational primitives shared by the three styled widgets.
 *
 * Nothing here holds protocol state. Each piece is a thin, accessible shell
 * over native form elements: a real `<label>` for every input, a real `<button>`
 * for every action, and one polite live region per widget so a screen reader
 * hears quote and transaction changes without the focus moving.
 */

import {
  useEffect,
  useId,
  useMemo,
  type ChangeEvent,
  type ReactNode,
} from "react";
import type { TokenInfo } from "../adapters/protocol.js";
import { useWidgetContext } from "../context/WidgetProvider.js";
import { formatAmount } from "../core/format.js";
import { injectWidgetStyles } from "../styles/css.js";

/** Props for {@link WidgetShell}. */
export interface WidgetShellProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  /** Rendered at the top-right of the header, e.g. a settings control. */
  readonly headerAction?: ReactNode;
  readonly className?: string;
}

/**
 * The outer frame: theme attribute, stylesheet injection and the mock warning.
 *
 * The mock banner is rendered from `adapter.isMock` and takes no prop, so an
 * integrator cannot configure it away while still showing fabricated numbers.
 */
export function WidgetShell(props: WidgetShellProps): JSX.Element {
  const { theme, adapter } = useWidgetContext();

  useEffect(() => {
    injectWidgetStyles();
  }, []);

  return (
    <section
      className={`latch-widget${props.className ? ` ${props.className}` : ""}`}
      data-latch-theme={theme}
      aria-label={props.title}
    >
      <header className="latch-header">
        <div>
          <h2 className="latch-title">{props.title}</h2>
          {props.subtitle !== undefined ? (
            <p className="latch-subtitle">{props.subtitle}</p>
          ) : null}
        </div>
        {props.headerAction}
      </header>
      {adapter.isMock ? <MockBanner /> : null}
      {props.children}
    </section>
  );
}

/** Permanent, non-dismissible warning shown whenever the adapter is a mock. */
export function MockBanner(): JSX.Element {
  return (
    <div className="latch-mock-banner" role="note">
      <strong>Mock data</strong>
      <span>
        No contracts are deployed. Every price, balance and route shown here is
        simulated by the development adapter and is not a market quote.
      </span>
    </div>
  );
}

/** Props for {@link AmountField}. */
export interface AmountFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onValueChange?: (value: string) => void;
  readonly readOnly?: boolean;
  readonly token: TokenInfo | null;
  readonly tokens: readonly TokenInfo[];
  readonly onTokenChange?: (token: TokenInfo) => void;
  readonly balance?: bigint | null;
  readonly onUseMax?: () => void;
  readonly error?: string | null;
  readonly secondaryText?: string;
  readonly placeholder?: string;
}

/** An amount input paired with a token selector and a balance line. */
export function AmountField(props: AmountFieldProps): JSX.Element {
  const inputId = useId();
  const selectId = useId();
  const errorId = useId();

  const handleAmount = (event: ChangeEvent<HTMLInputElement>): void => {
    props.onValueChange?.(event.target.value);
  };

  const handleToken = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = props.tokens.find((token) => token.address === event.target.value);
    if (next !== undefined) props.onTokenChange?.(next);
  };

  return (
    <div className="latch-field">
      <label className="latch-label" htmlFor={inputId}>
        {props.label}
      </label>
      <div className="latch-field-row">
        <input
          id={inputId}
          className="latch-amount-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={props.placeholder ?? "0.0"}
          value={props.value}
          readOnly={props.readOnly ?? false}
          onChange={handleAmount}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? errorId : undefined}
        />
        <label className="latch-visually-hidden" htmlFor={selectId}>
          {`${props.label} token`}
        </label>
        <select
          id={selectId}
          className="latch-select"
          value={props.token?.address ?? ""}
          onChange={handleToken}
          disabled={props.onTokenChange === undefined}
        >
          {props.token === null ? <option value="">Select</option> : null}
          {props.tokens.map((token) => (
            <option key={token.address} value={token.address}>
              {token.symbol}
            </option>
          ))}
        </select>
      </div>
      <div className="latch-meta">
        <span>{props.secondaryText ?? ""}</span>
        {props.balance !== undefined && props.balance !== null && props.token !== null ? (
          <span className="latch-meta-value">
            Balance {formatAmount(props.balance, props.token.decimals)}
            {props.onUseMax !== undefined ? (
              <>
                {" "}
                <button
                  type="button"
                  className="latch-chip"
                  style={{ display: "inline", flex: "none", padding: "0 6px" }}
                  onClick={props.onUseMax}
                >
                  Max
                </button>
              </>
            ) : null}
          </span>
        ) : (
          <span />
        )}
      </div>
      {props.error ? (
        <p id={errorId} className="latch-status" data-latch-tone="error">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

/** One label/value pair inside a summary block. */
export interface SummaryRowProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly emphasis?: "fee";
  readonly severity?: "low" | "elevated" | "high" | "severe" | "unknown";
  readonly title?: string;
}

/** A `<dt>`/`<dd>` pair. Must be rendered inside {@link SummaryList}. */
export function SummaryRow(props: SummaryRowProps): JSX.Element {
  return (
    <div
      className="latch-summary-row"
      data-latch-emphasis={props.emphasis}
      data-latch-severity={props.severity}
    >
      <dt title={props.title}>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

/** A definition list wrapper for {@link SummaryRow}s. */
export function SummaryList(props: { readonly children: ReactNode }): JSX.Element {
  return (
    <div className="latch-summary">
      <dl>{props.children}</dl>
    </div>
  );
}

/** Props for {@link StatusRegion}. */
export interface StatusRegionProps {
  readonly message: string;
  readonly tone?: "neutral" | "error" | "success";
  /** `assertive` for errors that need to interrupt; `polite` otherwise. */
  readonly assertive?: boolean;
}

/**
 * The widget's single live region.
 *
 * Quote refreshes and transaction transitions are announced here rather than by
 * moving focus, so a keyboard user is never yanked out of the amount field
 * mid-typing by a background re-quote.
 */
export function StatusRegion(props: StatusRegionProps): JSX.Element {
  return (
    <p
      className="latch-status"
      data-latch-tone={props.tone ?? "neutral"}
      role="status"
      aria-live={props.assertive === true ? "assertive" : "polite"}
    >
      {props.message}
    </p>
  );
}

/** Props for {@link ActionButton}. */
export interface ActionButtonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly type?: "button" | "submit";
  readonly variant?: "primary" | "secondary" | "danger";
}

/** The widget's primary call to action. */
export function ActionButton(props: ActionButtonProps): JSX.Element {
  return (
    <button
      type={props.type ?? "button"}
      className="latch-button"
      data-latch-variant={props.variant ?? "primary"}
      disabled={props.disabled === true || props.busy === true}
      aria-busy={props.busy === true ? true : undefined}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** A labelled progress bar backed by a real `progressbar` role. */
export function ProgressBar(props: {
  readonly label: string;
  readonly percent: number;
}): JSX.Element {
  const clamped = Math.max(0, Math.min(100, props.percent));
  return (
    <div
      className="latch-progress"
      role="progressbar"
      aria-label={props.label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="latch-progress-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** A radio-style segmented control. */
export function SegmentedControl<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}): JSX.Element {
  const groupLabelId = useId();
  return (
    <>
      <span id={groupLabelId} className="latch-visually-hidden">
        {props.label}
      </span>
      <div className="latch-tabs" role="tablist" aria-labelledby={groupLabelId}>
        {props.options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            className="latch-chip"
            aria-selected={option.value === props.value}
            tabIndex={option.value === props.value ? 0 : -1}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** Renders a route as a chain of token chips. */
export function RouteSummary(props: {
  readonly tokens: readonly string[];
  readonly detail?: string;
}): JSX.Element {
  const chips = useMemo(
    () =>
      props.tokens.flatMap((symbol, index) => {
        const chip = (
          <span key={`token-${symbol}-${index}`} className="latch-route-token">
            {symbol}
          </span>
        );
        return index === 0
          ? [chip]
          : [
              <span key={`arrow-${index}`} aria-hidden="true">
                {"→"}
              </span>,
              chip,
            ];
      }),
    [props.tokens],
  );

  return (
    <div className="latch-route">
      {chips}
      {props.detail !== undefined ? <span>{props.detail}</span> : null}
    </div>
  );
}

/** An error panel with `role="alert"`. */
export function ErrorPanel(props: { readonly error: Error | null }): JSX.Element | null {
  if (props.error === null) return null;
  return (
    <div className="latch-error" role="alert">
      {props.error.message}
    </div>
  );
}
