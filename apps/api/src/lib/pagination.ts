import { z } from "zod";
import { ApiError } from "./errors.js";

/**
 * Keyset ("cursor") pagination.
 *
 * Event tables are append-only and read newest-first, which is exactly the case
 * where OFFSET degrades: page 500 of a swap feed makes Postgres walk 500 pages
 * of index to throw them away. A cursor encodes the last row's sort key
 * instead, so every page is one index seek.
 *
 * The cursor is opaque to clients — base64url of `${timestampMs}|${id}` — and
 * ties are broken by id so the ordering is total.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Cursor {
  /** Sort value: unix ms of the row's ordering timestamp. */
  ts: number;
  /** Tie-breaker: the row's primary key. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.ts}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw ApiError.badRequest("Malformed cursor");
  }
  const sep = decoded.indexOf("|");
  if (sep <= 0) throw ApiError.badRequest("Malformed cursor");
  const ts = Number(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (!Number.isFinite(ts) || id.length === 0) throw ApiError.badRequest("Malformed cursor");
  return { ts, id };
}

/**
 * Prisma `where` fragment selecting rows strictly after a cursor in
 * descending (timestamp, id) order.
 */
export function keysetWhere(
  cursor: Cursor | undefined,
  timestampField: string,
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  const at = new Date(cursor.ts);
  return {
    OR: [
      { [timestampField]: { lt: at } },
      { AND: [{ [timestampField]: at }, { id: { lt: cursor.id } }] },
    ],
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Slice an over-fetched result set (limit + 1 rows) into a page plus a cursor.
 * `key` extracts the ordering timestamp from a row.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  key: (row: T) => Date,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ ts: key(last).getTime(), id: last.id }) : null,
  };
}
