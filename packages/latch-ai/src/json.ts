// SPDX-License-Identifier: MIT
/**
 * The boundary between our types and a model's context.
 *
 * Everything a tool returns crosses a `JSON.stringify` at some point, usually
 * inside a framework we do not control. Two things go wrong there and both are
 * silent: a `bigint` throws at stringify time, deep inside somebody else's
 * code; and an `undefined` field disappears, turning "not applicable" into
 * "absent" with no trace.
 *
 * {@link toJson} converts once, at our edge, with explicit rules:
 *
 * - `bigint` throws. Block numbers, timestamps and token amounts must be
 *   converted deliberately (to a decimal string) by the code that knows what
 *   they mean, because "1757" is a block, a second and a wei and only the call
 *   site can say which.
 * - `undefined` object properties are dropped; `undefined` array elements
 *   become `null`, so array positions are never silently renumbered.
 * - functions, symbols and class instances throw rather than serialise to `{}`.
 */

import type { JsonValue } from "./types.js";

export class NotJsonSerialisable extends Error {
  constructor(path: string, detail: string) {
    super(`value at ${path} cannot be sent to a model: ${detail}`);
    this.name = "NotJsonSerialisable";
  }
}

export function toJson(value: unknown, path = "$"): JsonValue {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new NotJsonSerialisable(path, `${String(value)} has no JSON representation`);
      }
      return value;
    case "bigint":
      throw new NotJsonSerialisable(
        path,
        "bigint must be converted explicitly (usually to a decimal string) by the code that knows what the number means",
      );
    case "undefined":
      throw new NotJsonSerialisable(path, "undefined is not a value; drop the key instead");
    case "function":
    case "symbol":
      throw new NotJsonSerialisable(path, `a ${typeof value} is not data`);
    default:
      break;
  }

  if (Array.isArray(value)) {
    return value.map((v, i) => (v === undefined ? null : toJson(v, `${path}[${i}]`)));
  }

  const proto: unknown = Object.getPrototypeOf(value as object);
  if (proto !== Object.prototype && proto !== null) {
    throw new NotJsonSerialisable(
      path,
      `${(value as object).constructor?.name ?? "class instance"} is not a plain object`,
    );
  }

  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue; // "not applicable" is expressed by absence
    out[k] = toJson(v, `${path}.${k}`);
  }
  return out;
}
