import { Prisma } from "@prisma/client";

/**
 * JSON serialisation for on-chain numbers.
 *
 * Two types in the Prisma result set have no JSON representation:
 *   - `bigint` (block numbers, counters) — `JSON.stringify` throws on it.
 *   - `Prisma.Decimal` (int128/uint160 amounts) — stringifies to an object.
 *
 * Both become decimal strings. A uint160 price does not fit in an IEEE-754
 * double, so emitting them as JSON numbers would silently corrupt values; the
 * client is expected to parse them with BigInt or a decimal library.
 */
export function toJsonSafe<T>(value: T): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === "bigint") return value.toString();

  if (value instanceof Date) return value.toISOString();

  if (Prisma.Decimal.isDecimal(value)) {
    return (value as Prisma.Decimal).toFixed();
  }

  if (Array.isArray(value)) return value.map(toJsonSafe);

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }

  return value;
}

/** Parse a decimal string into a Prisma.Decimal, rejecting anything non-integral. */
export function toDecimal(value: string | number | bigint): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

/** Convenience for reading a Decimal column back as a bigint. */
export function decimalToBigInt(value: Prisma.Decimal | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  return BigInt(value.toFixed(0));
}
