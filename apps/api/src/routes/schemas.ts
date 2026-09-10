import { z } from "zod";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";

/** Shared query-parameter primitives. */

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte 0x address")
  .transform((s) => s.toLowerCase());

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x value")
  .transform((s) => s.toLowerCase());

export const chainIdSchema = z.coerce.number().int().positive();

export const poolTypeSchema = z.enum(["CL", "BIN"]);

export const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

export const offsetPagination = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const cursorPagination = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  cursor: z.string().min(1).optional(),
});

/** ISO 8601 or unix seconds. */
export const timestampSchema = z
  .union([z.coerce.number().int().positive(), z.string().datetime()])
  .transform((v) => (typeof v === "number" ? new Date(v * 1000) : new Date(v)));

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

export const listPoolsQuery = offsetPagination.extend({
  chainId: chainIdSchema.optional(),
  poolType: poolTypeSchema.optional(),
  hook: z.union([addressSchema, z.literal("none")]).optional(),
  token: addressSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  hasHook: booleanish.optional(),
  sort: z.enum(["swapCount", "createdAt", "lastEventAt"]).default("swapCount"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export const poolParams = z.object({
  id: z.string().min(1).max(200),
});

export const poolDetailQuery = z.object({
  chainId: chainIdSchema.optional(),
});

export const listSwapsQuery = cursorPagination.extend({
  chainId: chainIdSchema.optional(),
  poolId: z.string().min(1).max(200).optional(),
  hook: addressSchema.optional(),
  sender: addressSchema.optional(),
  poolType: poolTypeSchema.optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
});

export const listLiquidityQuery = listSwapsQuery;

export const listFeeChangesQuery = cursorPagination.extend({
  chainId: chainIdSchema.optional(),
  poolId: z.string().min(1).max(200).optional(),
});

export const listVaultEventsQuery = cursorPagination.extend({
  chainId: chainIdSchema.optional(),
  kind: z.enum(["TRANSFER", "APPROVAL", "OPERATOR_SET"]).optional(),
  currency: addressSchema.optional(),
});

export const listHooksQuery = offsetPagination.extend({
  chainId: chainIdSchema.optional(),
});

export const hookParams = z.object({
  address: addressSchema,
});

export const hookQuery = z.object({
  chainId: chainIdSchema.optional(),
});

export const listRegistryQuery = offsetPagination.extend({
  poolType: poolTypeSchema.optional(),
  verified: booleanish.optional(),
  auditStatus: z.enum(["UNAUDITED", "IN_REVIEW", "AUDITED", "FORMALLY_VERIFIED"]).optional(),
  kind: z.enum(["EXAMPLE", "COMMUNITY", "VERIFIED"]).optional(),
  chainId: chainIdSchema.optional(),
  tag: z.string().trim().min(1).max(60).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  /** Comma-separated bit offsets, e.g. `bits=6,7,11`. */
  bits: z
    .string()
    .regex(/^\d{1,2}(,\d{1,2})*$/, "must be comma-separated bit offsets")
    .transform((s) => s.split(",").map(Number))
    .refine((arr) => arr.every((n) => n >= 0 && n <= 13), "bit offsets must be in [0, 13]")
    .optional(),
  sort: z.enum(["name", "listedAt", "audit"]).default("listedAt"),
});

export const registryParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,80}$/, "must be a lowercase slug"),
});

export const permissionsQuery = z.object({
  poolType: poolTypeSchema.default("CL"),
  /** Decimal or 0x-prefixed hex. */
  bitmap: z
    .string()
    .regex(/^(0x[0-9a-fA-F]{1,4}|\d{1,5})$/, "must be a uint16 in decimal or hex")
    .transform((s) => (s.startsWith("0x") ? Number.parseInt(s, 16) : Number.parseInt(s, 10)))
    .refine((n) => n >= 0 && n <= 0xffff, "bitmap must fit in uint16"),
});

export const statsQuery = z.object({
  chainId: chainIdSchema.optional(),
});

export const timeseriesQuery = z.object({
  chainId: chainIdSchema.optional(),
  poolId: z.string().min(1).max(200).optional(),
  poolType: poolTypeSchema.optional(),
  interval: z.enum(["hour", "day", "week"]).default("day"),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
});

export const topQuery = z.object({
  chainId: chainIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const ingestBody = z.object({
  chainId: chainIdSchema,
  fromBlock: z.coerce.bigint().optional(),
  toBlock: z.coerce.bigint().optional(),
  force: z.boolean().default(false),
  /** Run inline instead of enqueuing. Useful in development. */
  sync: z.boolean().default(false),
});
