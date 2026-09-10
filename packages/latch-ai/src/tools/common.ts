// SPDX-License-Identifier: MIT
/**
 * Shared plumbing for tool handlers: input coercion and error classification.
 *
 * The error classifier is the important half. A model cannot recover from an
 * error it cannot tell apart from an answer, and the specific confusion that
 * matters here is a transport failure being read as "not found". So RPC and
 * network failures get their own code and their own caveat telling the agent to
 * retry rather than conclude anything.
 */

import { isAddress, getAddress, type Address, type Hex } from "viem";

import { err, type ToolErr } from "../types.js";

export function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

export class InputError extends Error {}

export function requireAddressField(input: Record<string, unknown>, field: string): Address {
  const v = input[field];
  if (typeof v !== "string" || !isAddress(v)) {
    throw new InputError(
      `"${field}" must be a 0x-prefixed 20-byte address, received: ${JSON.stringify(v)}`,
    );
  }
  return getAddress(v);
}

export function optionalAddressField(
  input: Record<string, unknown>,
  field: string,
): Address | undefined {
  return input[field] === undefined ? undefined : requireAddressField(input, field);
}

export function requireBytes32Field(input: Record<string, unknown>, field: string): Hex {
  const v = input[field];
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new InputError(`"${field}" must be a 32-byte hex string, received: ${JSON.stringify(v)}`);
  }
  return v as Hex;
}

export function requireIntField(
  input: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  const v = input[field];
  if (v === undefined && fallback !== undefined) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new InputError(
      `"${field}" must be an integer between ${min} and ${max}, received: ${JSON.stringify(v)}`,
    );
  }
  return n;
}

/**
 * Accept a bitmap as a decimal number or a hex string.
 *
 * Both forms show up: a contract read gives a number, a human or a log line
 * gives `0x2440`. Accepting only one guarantees a class of tool-call failures
 * that look like the model's fault and are not.
 */
export function requireBitmapField(input: Record<string, unknown>, field: string): number {
  const v = input[field];
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string" && v.trim() !== "") {
    const t = v.trim();
    n = t.startsWith("0x") || t.startsWith("0X") ? Number.parseInt(t, 16) : Number(t);
  } else {
    throw new InputError(
      `"${field}" must be a uint16 permission bitmap, as a number or a 0x-prefixed hex string; received: ${JSON.stringify(v)}`,
    );
  }
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new InputError(
      `"${field}" must be an integer in [0, 65535] (it is a uint16); received: ${JSON.stringify(v)}`,
    );
  }
  return n;
}

export function requireEnumField<T extends string>(
  input: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const v = input[field];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new InputError(
      `"${field}" must be one of: ${allowed.join(", ")}; received: ${JSON.stringify(v)}`,
    );
  }
  return v as T;
}

const RPC_HINTS = [
  "fetch failed",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "socket hang up",
  "HttpRequestError",
  "TimeoutError",
  "rate limit",
  "429",
  "503",
];

/** First line of a viem error. The rest is a stack of context nobody reads. */
export function shortMessage(e: unknown): string {
  const raw = e instanceof Error ? (e.message ?? String(e)) : String(e);
  const first = raw.split("\n")[0] ?? raw;
  return first.trim();
}

/**
 * Turn a thrown error into a tool result.
 *
 * The classification rule that matters: anything that smells like transport
 * becomes `rpc_unavailable`, which carries a caveat saying explicitly that this
 * is NOT evidence of absence. Everything else is a contract-level error.
 */
export function toToolError(e: unknown): ToolErr {
  if (e instanceof InputError) {
    return err("invalid_input", e.message);
  }
  const msg = shortMessage(e);
  const full = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (RPC_HINTS.some((h) => full.includes(h))) {
    return err("rpc_unavailable", `Could not reach the chain: ${msg}`, [
      "This is a transport failure, not an answer. It does NOT mean the contract is absent, unlisted or inactive. Retry, or try a different RPC endpoint, before drawing any conclusion.",
    ]);
  }
  return err("contract_error", msg, [
    "The call reached a node but did not return a usable answer. Do not treat this as evidence about the contract.",
  ]);
}

/** Every bigint in a result becomes a decimal string; models handle those, and
 * `JSON.stringify` throws on a bigint. */
export function bigintToString(v: bigint): string {
  return v.toString(10);
}

/** Unix seconds to an ISO-8601 string, or null for the unset zero value. */
export function unixToIso(seconds: bigint): string | null {
  if (seconds === 0n) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}
