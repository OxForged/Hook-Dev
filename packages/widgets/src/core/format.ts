// SPDX-License-Identifier: MIT
/**
 * Display formatting and user-input parsing.
 *
 * Parsing is the security-relevant half: a mis-parsed decimal string becomes a
 * wrong `amountIn`, and `parseUnits` will happily truncate extra decimal places.
 * {@link parseAmount} refuses ambiguous input instead of guessing.
 */

import { formatUnits, parseUnits } from "viem";

/** A rejected amount string, with a reason suitable for showing to a user. */
export interface AmountParseFailure {
  readonly ok: false;
  readonly reason:
    | "empty"
    | "not-a-number"
    | "negative"
    | "too-many-decimals"
    | "zero";
  readonly message: string;
}

/** A successfully parsed amount. */
export interface AmountParseSuccess {
  readonly ok: true;
  readonly value: bigint;
}

export type AmountParseResult = AmountParseSuccess | AmountParseFailure;

const NUMERIC = /^\d*(?:\.\d*)?$/;

/**
 * Parses a user-entered decimal string into the token's smallest unit.
 *
 * @param allowZero when `false` (default) a zero amount is rejected, since a
 * zero-amount swap is never what the user meant.
 */
export function parseAmount(
  input: string,
  decimals: number,
  allowZero = false,
): AmountParseResult {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed === ".") {
    return { ok: false, reason: "empty", message: "Enter an amount" };
  }
  if (trimmed.startsWith("-")) {
    return { ok: false, reason: "negative", message: "Amount must be positive" };
  }
  if (!NUMERIC.test(trimmed)) {
    return { ok: false, reason: "not-a-number", message: "Amount must be a number" };
  }
  const [, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    return {
      ok: false,
      reason: "too-many-decimals",
      message: `This token has ${decimals} decimals; ${fraction.length} were entered`,
    };
  }
  const value = parseUnits(trimmed, decimals);
  if (value === 0n && !allowZero) {
    return { ok: false, reason: "zero", message: "Enter an amount greater than zero" };
  }
  return { ok: true, value };
}

/**
 * Formats a smallest-unit amount for display.
 *
 * Trims trailing zeros and caps the visible fraction, but never rounds a value
 * up to a non-zero display when it is zero, and never shows `0` for a non-zero
 * dust amount - it shows `<0.0001` instead.
 */
export function formatAmount(
  value: bigint,
  decimals: number,
  maxFractionDigits = 6,
): string {
  if (value === 0n) return "0";
  const negative = value < 0n;
  const raw = formatUnits(negative ? -value : value, decimals);
  const [whole = "0", fraction = ""] = raw.split(".");
  const sign = negative ? "-" : "";

  if (fraction === "") return `${sign}${groupThousands(whole)}`;

  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  if (trimmed === "") {
    // Non-zero, but smaller than the display precision.
    if (whole === "0") {
      const epsilon = `0.${"0".repeat(Math.max(0, maxFractionDigits - 1))}1`;
      return `${sign}<${epsilon}`;
    }
    return `${sign}${groupThousands(whole)}`;
  }
  return `${sign}${groupThousands(whole)}.${trimmed}`;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a rate for display, e.g. `1 A = 1,234.5678 B`. */
export function formatRate(
  rate: number | null,
  symbolIn: string,
  symbolOut: string,
): string {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return "-";
  const digits = rate >= 1000 ? 2 : rate >= 1 ? 4 : 6;
  return `1 ${symbolIn} = ${rate.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  })} ${symbolOut}`;
}

/** Formats a bps value as a percentage string. */
export function formatPercentFromBps(bps: number | null): string {
  if (bps === null) return "unknown";
  const percent = bps / 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  return `${percent.toFixed(2)}%`;
}

/** Formats a pips value (1e6 = 100%) as a percentage string. */
export function formatPercentFromPips(pips: number): string {
  const percent = pips / 10_000;
  if (percent > 0 && percent < 0.001) return "<0.001%";
  return `${trimTrailingZeros(percent.toFixed(3))}%`;
}

function trimTrailingZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** Shortens an address for display: `0x1234...cdef`. */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Formats a remaining duration in seconds as a compact `1d 4h 3m` string. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

/** Formats a unix timestamp for display in the viewer's locale. */
export function formatTimestamp(unixSeconds: bigint | number): string {
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString();
}
