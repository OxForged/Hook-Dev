import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress } from "viem";
import { z } from "zod";

/**
 * Per-chain operational config (feeds, oracle-priced tokens, ops accounts) from
 * `config/chains/<chainId>.json`. Public addresses only. A chain without a file
 * simply has no feeds, no USD and no ops balances — never a default.
 */

const address = z
  .string()
  .refine((v) => isAddress(v), "not an address")
  .transform((v) => v.toLowerCase());

const ChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  notes: z.string().optional(),
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
        minWei: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .default([]),
});

export type ChainConfig = z.infer<typeof ChainConfigSchema>;

const here = dirname(fileURLToPath(import.meta.url));
/** src/config -> ../../config (also dist/config -> ../../config). */
export const CONFIG_DIR = resolve(here, "..", "..", "config", "chains");

const loaded = new Map<number, ChainConfig>();

export function chainConfig(chainId: number): ChainConfig {
  const hit = loaded.get(chainId);
  if (hit) return hit;
  const file = resolve(CONFIG_DIR, `${chainId}.json`);
  const cfg: ChainConfig = existsSync(file)
    ? ChainConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    : { chainId, feeds: [], pricedTokens: [], opsAccounts: [] };
  if (cfg.chainId !== chainId) throw new Error(`${file} declares chainId ${cfg.chainId}`);
  for (const t of cfg.pricedTokens) {
    if (!cfg.feeds.some((f) => f.label === t.feedLabel)) {
      throw new Error(`${file}: priced token ${t.token} names unknown feed ${t.feedLabel}`);
    }
  }
  loaded.set(chainId, cfg);
  return cfg;
}
