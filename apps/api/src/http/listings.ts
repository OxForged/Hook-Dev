import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import express, { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { IconRejected, processIcon } from "../admin/icons.js";
import type { CaptchaVerifier } from "../admin/turnstile.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../lib/errors.js";
import { toJsonSafe } from "../lib/serialize.js";
import { checkRate, type RateLimitStore } from "../ratelimit/limiter.js";
import { sendIcon } from "./adminRoutes.js";
import { LISTING_BODY_LIMIT_BYTES } from "./middleware.js";

/**
 * Public ecosystem listing submissions and the approved directory.
 *
 *   POST /v1/listings                 submit (per-IP limited, optional Turnstile, icon processed)
 *   GET  /v1/listings                 APPROVED listings only; never the private contact
 *   GET  /v1/listings/:id/icon        the PROCESSED icon of an APPROVED listing
 *
 * Field limits mirror apps/web/src/routes/ecosystem/data/ecosystem.ts
 * (LISTING_LIMITS, ECOSYSTEM_CATEGORIES, LatchKind) and SubmitAppModal.tsx
 * (https-only URLs with a dotted host; lengths in code points). A test pins them.
 */

/** apps/web ecosystem.ts LISTING_LIMITS, 2026-09-14. */
export const LISTING_LIMITS = { name: 80, description: 280, url: 300, source: 300, categoryOther: 40, ownLatch: 200, iconSource: 300, contact: 200 } as const;
export const ECOSYSTEM_CATEGORIES = ["DEX", "Launchpad", "Quests", "Lending", "RWA", "Analytics", "Wallet", "Infrastructure"] as const;
export const CATEGORY_OTHER = "Other";
export const LATCH_KINDS = ["launch-guard", "rev-share", "permissioned-pool", "market-hours", "stock-pair", "own"] as const;

/** base64 of the largest accepted icon (256 KB PNG) plus field overhead. */
export { LISTING_BODY_LIMIT_BYTES };

const codePoints = (s: string) => Array.from(s).length;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

const text = (max: number, opts: { required: boolean; multiline?: boolean }) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => !opts.required || s.length > 0, "required")
    .refine((s) => codePoints(s) <= max, `${max} characters or fewer`)
    .refine((s) => !CONTROL.test(s) && (opts.multiline || !/[\r\n]/.test(s)), "control characters are not allowed");

/** SubmitAppModal.httpsError: https only, a host with a dot, not starting/ending with one. */
export function httpsUrlError(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a complete address";
  }
  if (u.protocol !== "https:") return "must start with https://";
  if (!u.hostname.includes(".") || u.hostname.startsWith(".") || u.hostname.endsWith(".")) return "needs a full domain";
  if (u.username || u.password) return "must not contain credentials";
  return null;
}

const httpsUrl = (max: number, required: boolean) =>
  text(max, { required }).superRefine((s, ctx) => {
    if (s === "") return;
    const e = httpsUrlError(s);
    if (e) ctx.addIssue({ code: "custom", message: e });
  });

export const submissionSchema = z
  .object({
    name: text(LISTING_LIMITS.name, { required: true }),
    description: text(LISTING_LIMITS.description, { required: true, multiline: true }),
    url: httpsUrl(LISTING_LIMITS.url, true),
    source: httpsUrl(LISTING_LIMITS.source, false).optional(),
    category: z.enum([...ECOSYSTEM_CATEGORIES, CATEGORY_OTHER]),
    categoryOther: text(LISTING_LIMITS.categoryOther, { required: false }).optional(),
    uses: z.array(z.enum(LATCH_KINDS)).min(1, "tick at least one Latch family").max(LATCH_KINDS.length),
    ownLatch: text(LISTING_LIMITS.ownLatch, { required: false }).optional(),
    chains: z.array(z.number().int().positive().max(2_147_483_647)).min(1, "tick at least one chain").max(32),
    iconSource: httpsUrl(LISTING_LIMITS.iconSource, false).optional(),
    contact: text(LISTING_LIMITS.contact, { required: false }).optional(),
    icon: z
      .object({
        contentType: z.enum(["image/png", "image/svg+xml"]),
        dataBase64: z.string().max(Math.ceil((256 * 1024 * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]+={0,2}$/, "not base64"),
      })
      .optional(),
    turnstileToken: z.string().max(2_048).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.category === CATEGORY_OTHER && !v.categoryOther) ctx.addIssue({ code: "custom", path: ["categoryOther"], message: "name the category" });
    if (new Set(v.uses).size !== v.uses.length) ctx.addIssue({ code: "custom", path: ["uses"], message: "duplicate entries" });
    if (new Set(v.chains).size !== v.chains.length) ctx.addIssue({ code: "custom", path: ["chains"], message: "duplicate entries" });
  });

export interface ListingsDeps {
  prisma: PrismaClient;
  rate: RateLimitStore;
  captcha: CaptchaVerifier;
  /** false: POST answers 404 (the default). GET of approved listings always works. */
  submissionsEnabled: boolean;
  submitPerHour: number;
  /** HMAC key for the stored IP hash (the API key pepper); the raw IP is never stored. */
  ipHashKey: string;
}

type H = (req: Request, res: Response) => Promise<void>;
const h = (fn: H): RequestHandler => (req, res, next) => fn(req, res).catch(next);

export function listingsRouter(deps: ListingsDeps): Router {
  const r = Router();

  r.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  });


  const limitSubmissions: RequestHandler = (req, res, next) => {
    if (!deps.submissionsEnabled) return next(ApiError.notFound("Listing submissions are not enabled on this API"));
    checkRate(deps.rate, `listing-submit:${req.ip ?? "unknown"}`, deps.submitPerHour, Date.now(), 3_600_000)
      .then((d) => {
        res.setHeader("RateLimit-Limit", String(d.limit));
        res.setHeader("RateLimit-Remaining", String(d.remaining));
        if (!d.allowed) {
          res.setHeader("Retry-After", String(d.retryAfterSeconds));
          return next(new ApiError(429, "RATE_LIMITED", "Too many submissions from this address; try again later"));
        }
        next();
      })
      .catch(next);
  };

  r.post(
    "/",
    limitSubmissions,
    express.json({ limit: LISTING_BODY_LIMIT_BYTES, strict: true }),
    h(async (req, res) => {
      const parsed = submissionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw ApiError.validation("Invalid submission", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      }
      const b = parsed.data;

      const captcha = await deps.captcha.verify(b.turnstileToken, req.ip);
      if (!captcha.ok) throw new ApiError(400, "CAPTCHA_FAILED", captcha.reason ?? "captcha failed");

      let iconAssetRef: string | null = null;
      if (b.icon) {
        const raw = Buffer.from(b.icon.dataBase64, "base64");
        let processed;
        try {
          processed = processIcon(b.icon.contentType, raw);
        } catch (e) {
          if (e instanceof IconRejected) throw ApiError.validation("Icon rejected", [{ path: "icon", message: e.reason }]);
          throw e;
        }
        const asset = await deps.prisma.listingAsset.create({
          data: { contentType: processed.contentType, bytes: new Uint8Array(processed.bytes), byteLength: processed.bytes.length, width: processed.width, height: processed.height, sha256: processed.sha256 },
        });
        iconAssetRef = asset.id;
      }

      const row = await deps.prisma.listingSubmission.create({
        data: {
          kind: "PROJECT",
          chainId: null,
          name: b.name,
          description: b.description,
          websiteUrl: b.url,
          sourceUrl: b.source || null,
          category: b.category,
          categoryOther: b.category === CATEGORY_OTHER ? (b.categoryOther ?? null) : null,
          uses: b.uses,
          ownLatch: b.uses.includes("own") ? b.ownLatch || null : null,
          chains: [...b.chains].sort((x, y) => x - y),
          iconSourceUrl: b.iconSource || null,
          iconAssetRef,
          contactPrivate: b.contact || null,
          submitterIpHash: req.ip ? createHmac("sha256", deps.ipHashKey).update(`listing-ip:${req.ip}`).digest("hex") : null,
          turnstileVerified: deps.captcha.enabled,
        },
      });
      logger.info({ listing: row.id }, "listing submitted");
      res.status(202).json({ id: row.id, status: row.status, note: "Received. Nothing is public until a Latch moderator approves it; the contact field is never published." });
    }),
  );

  const pageQ = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().min(0).max(100_000).default(0) });
  r.get(
    "/",
    h(async (req, res) => {
      const q = pageQ.safeParse(req.query);
      if (!q.success) throw ApiError.validation("Invalid query");
      const where = { status: "APPROVED" as const };
      const [items, total] = await Promise.all([
        deps.prisma.listingSubmission.findMany({ where, orderBy: [{ reviewedAt: "desc" }, { name: "asc" }], take: q.data.limit, skip: q.data.offset }),
        deps.prisma.listingSubmission.count({ where }),
      ]);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(
        toJsonSafe({
          total,
          provenance: "Submitted by the project · not verified by Latch Protocol",
          // An explicit allowlist of public fields. contactPrivate, submitterIpHash and reviewer never appear.
          items: items.map((l) => ({
            id: l.id,
            name: l.name,
            tagline: l.description,
            url: l.websiteUrl,
            source: l.sourceUrl,
            category: l.category === CATEGORY_OTHER ? `${CATEGORY_OTHER}: ${l.categoryOther ?? ""}`.trim() : l.category,
            uses: l.uses,
            ownLatch: l.ownLatch,
            chains: l.chains,
            iconUrl: l.iconAssetRef ? `/v1/listings/${l.id}/icon` : null,
            approvedAt: l.reviewedAt,
          })),
        }),
      );
    }),
  );

  r.get(
    "/:id/icon",
    h(async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!/^[a-z0-9]{10,40}$/.test(id)) throw ApiError.notFound("Icon");
      const l = await deps.prisma.listingSubmission.findUnique({ where: { id }, select: { status: true, iconAssetRef: true } });
      if (!l || l.status !== "APPROVED" || !l.iconAssetRef) throw ApiError.notFound("Icon");
      const asset = await deps.prisma.listingAsset.findUnique({ where: { id: l.iconAssetRef } });
      if (!asset) throw ApiError.notFound("Icon");
      res.setHeader("Cache-Control", "public, max-age=300");
      sendIcon(res, asset.contentType, Buffer.from(asset.bytes));
    }),
  );

  return r;
}
