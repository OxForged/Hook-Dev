import { Prisma } from "@prisma/client";

/**
 * JSON serialisation for on-chain numbers: bigint and Prisma.Decimal become
 * decimal STRINGS, Dates ISO strings. A uint160 price does not survive an
 * IEEE-754 double, so no wide integer is ever emitted as a JSON number.
 */
export function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonSafe(v);
    return out;
  }
  return value;
}

export function decStr(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed();
}
