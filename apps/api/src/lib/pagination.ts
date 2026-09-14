import { z } from "zod";
import { ApiError } from "./errors.js";

/**
 * Keyset pagination over (blockNumber, logIndex), newest first. Opaque cursor:
 * base64url of `${blockNumber}:${logIndex}`. Every page is one index seek; there
 * is no OFFSET on event feeds.
 */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(64).optional(),
});

export interface EventCursor {
  blockNumber: bigint;
  logIndex: number;
}

export function encodeCursor(c: EventCursor): string {
  return Buffer.from(`${c.blockNumber}:${c.logIndex}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): EventCursor {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const m = /^(\d{1,20}):(\d{1,6})$/.exec(text);
  if (!m) throw ApiError.badRequest("Malformed cursor");
  return { blockNumber: BigInt(m[1]!), logIndex: Number(m[2]) };
}

/** Prisma `where` fragment: rows strictly older than the cursor. */
export function beforeCursor(c: EventCursor | undefined): Record<string, unknown> {
  if (!c) return {};
  return {
    OR: [{ blockNumber: { lt: c.blockNumber } }, { blockNumber: c.blockNumber, logIndex: { lt: c.logIndex } }],
  };
}

export function toPage<T extends { blockNumber: bigint; logIndex: number }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, page: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null } };
}
