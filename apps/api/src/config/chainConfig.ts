import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress } from "viem";
import { z } from "zod";

/**
 * Per-chain operational config (feeds, oracle-priced tokens, ops accounts, alert
 * thresholds) from `config/chains/<chainId>.json`. Public addresses only. A chain
 * without a file simply has no feeds, no USD and no ops balances — never a default.
 *
 * Every threshold carries a `rationale` string and the schema REQUIRES it: a
 * number with no reason is a placeholder, and a placeholder threshold on a
 * canceller balance is how "it cannot cancel anything" goes unnoticed.
 */

const address = z
  .string()
  .refine((v) => isAddress(v), "not an address")
  .transform((v) => v.toLowerCase());

const uintString = z.string().regex(/^\d+$/);
const rationale = z.string().min(40, "a threshold needs a real rationale, not a placeholder");

const GasBudgetSchema = z.object({
  /** What one unit of this account's work is. */
  action: z.string().min(1),
  /** Gas units one action costs (execution + L1 data allowance on an L2). */
  gasUnits: uintString,
  /** Below this many affordable actions: CRITICAL. */
  criticalActions: z.number().int().positive(),
  /** Below this many affordable actions: WARN. */
  warnActions: z.number().int().positive(),
  rationale,
});

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex value").transform((v) => v.toLowerCase());

/**
 * Treasury conversion (CLAUDE.md "Treasury conversion, owner decision 2026-09-14").
 * Allowlisted tokens only, to native ETH, through Latch pools only, prepared as a
 * Safe batch the owners sign. The allowlist is CONFIG on purpose: a reviewed
 * commit, never an HTTP write, so no session (stolen or not) can widen what the
 * panel offers to sell.
 */
const TreasuryConversionSchema = z
  .object({
    target: z.literal("native"),
    allowlist: z
      .array(
        z.object({
          token: address,
          symbol: z.string().min(1).max(32),
          /** Checked against decimals() on chain at every read; a mismatch refuses the token. */
          decimals: z.number().int().min(0).max(36),
          /** Informational "conversion available" alert when the Safe holds more than this (raw units). */
          alertBalanceRaw: uintString.optional(),
          rationale,
        }),
      )
      .default([]),
    maxPriceImpactBps: z.number().int().min(0).max(10_000).default(100),
    slippageBps: z.number().int().min(0).max(5_000).default(50),
    /** Refuse a conversion whose GUARANTEED output (min-out, wei) is below this. */
    minValueWei: uintString,
    /** Router deadline and Permit2 expiration, both `chain time + deadlineSeconds`. */
    deadlineSeconds: z.number().int().min(300).max(7 * 86_400),
    /** A reviewed route older than this is stale and must be re-quoted before a payload is built. */
    maxQuoteAgeSeconds: z.number().int().min(10).max(3_600).default(180),
    /** The Safe MultiSendCallOnly the batch DELEGATECALLs. Re-verified by code hash on every build. */
    multiSendCallOnly: z.object({
      address,
      version: z.literal("1.4.1"),
      codeHash: hex32,
      verification: z.string().min(40, "record how the address was verified"),
    }),
    rationale,
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    for (const a of t.allowlist) {
      if (/^0x0{40}$/.test(a.token)) ctx.addIssue({ code: "custom", message: "the native currency is the target, not an allowlist entry" });
      if (seen.has(a.token)) ctx.addIssue({ code: "custom", message: `${a.token} is allowlisted twice` });
      seen.add(a.token);
    }
  });

const ChainConfigSchema = z
  .object({
    chainId: z.number().int().positive(),
    notes: z.string().optional(),
    safeApp: z.object({ shortName: z.string().regex(/^[a-z0-9-]{1,32}$/), source: z.string().min(1) }).optional(),
    gas: z.object({ referenceGasPriceWei: uintString, referenceSource: z.string().min(1) }).optional(),
    indexerAlerts: z
      .object({
        maxLagBlocks: z.number().int().positive(),
        maxHeadAgeSeconds: z.number().int().positive(),
        rationale,
      })
      .optional(),
    feeds: z
      .array(
        z.object({
          label: z.string().min(1),
          proxy: address,
          heartbeatSeconds: z.number().int().positive(),
          expectedDescription: z.string().optional(),
        }),
      )
      .default([]),
    pricedTokens: z
      .array(
        z.object({
          token: address,
          expectedSymbol: z.string().min(1),
          feedLabel: z.string().min(1),
          scaleByUiMultiplier: z.boolean(),
          notes: z.string().optional(),
        }),
      )
      .default([]),
    opsAccounts: z
      .array(
        z.object({
          label: z.string().min(1),
          address,
          purpose: z.string(),
          /** "canceller" | "ops" — which Ownership-table key this account is. */
          role: z.enum(["canceller", "ops"]).optional(),
          /** Legacy fixed threshold. Superseded by gasBudget; kept readable. */
          minWei: uintString.optional(),
          gasBudget: GasBudgetSchema.optional(),
        }),
      )
      .default([]),
    treasuryConversion: TreasuryConversionSchema.optional(),
  })
  .superRefine((cfg, ctx) => {
    for (const a of cfg.opsAccounts) {
      if (a.gasBudget && a.gasBudget.criticalActions > a.gasBudget.warnActions) {
        ctx.addIssue({ code: "custom", message: `${a.label}: criticalActions must be <= warnActions` });
      }
      if (a.gasBudget && !cfg.gas) ctx.addIssue({ code: "custom", message: `${a.label}: a gasBudget needs gas.referenceGasPriceWei as the fallback price` });
    }
  });

export type ChainConfig = z.infer<typeof ChainConfigSchema>;
export type GasBudget = z.infer<typeof GasBudgetSchema>;
export type TreasuryConversionConfig = z.infer<typeof TreasuryConversionSchema>;

const here = dirname(fileURLToPath(import.meta.url));
/** src/config -> ../../config (also dist/config -> ../../config). */
export const CONFIG_DIR = resolve(here, "..", "..", "config", "chains");

const loaded = new Map<number, ChainConfig>();

export function parseChainConfig(raw: unknown, chainId: number, file = "(inline)"): ChainConfig {
  const cfg = ChainConfigSchema.parse(raw);
  if (cfg.chainId !== chainId) throw new Error(`${file} declares chainId ${cfg.chainId}`);
  for (const t of cfg.pricedTokens) {
    if (!cfg.feeds.some((f) => f.label === t.feedLabel)) {
      throw new Error(`${file}: priced token ${t.token} names unknown feed ${t.feedLabel}`);
    }
  }
  return cfg;
}

export function chainConfig(chainId: number): ChainConfig {
  const hit = loaded.get(chainId);
  if (hit) return hit;
  const file = resolve(CONFIG_DIR, `${chainId}.json`);
  const cfg: ChainConfig = existsSync(file)
    ? parseChainConfig(JSON.parse(readFileSync(file, "utf8")), chainId, file)
    : { chainId, feeds: [], pricedTokens: [], opsAccounts: [] };
  loaded.set(chainId, cfg);
  return cfg;
}

/**
 * Thresholds for one ops account at a gas price. Pure, exact integers.
 * affordable = floor(balance / (gasUnits * gasPrice)).
 */
export function gasThresholds(balanceWei: bigint, budget: GasBudget, gasPriceWei: bigint) {
  const perAction = BigInt(budget.gasUnits) * gasPriceWei;
  const criticalWei = perAction * BigInt(budget.criticalActions);
  const warnWei = perAction * BigInt(budget.warnActions);
  const actionsAffordable = perAction === 0n ? null : balanceWei / perAction;
  const severity: "CRITICAL" | "WARN" | "OK" = balanceWei < criticalWei ? "CRITICAL" : balanceWei < warnWei ? "WARN" : "OK";
  return { perActionWei: perAction, criticalWei, warnWei, actionsAffordable, severity };
}
