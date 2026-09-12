// SPDX-License-Identifier: MIT
/**
 * Validating `latch.config.ts` into something the app can run on.
 *
 * Config errors are RETURNED, not thrown. A throw at module scope produces a
 * blank page and a console message, which is the worst possible failure for the
 * one file a tenant is expected to edit. Instead `App` renders the problems,
 * names the field, and says what to do — the same standard the rest of the app
 * holds itself to for on-chain reads.
 */

import { getAddress, isAddress, type Address } from "viem";

import config from "../../latch.config";
import { LATCH_DEPLOYMENTS, NATIVE_CURRENCY, isSupportedChain } from "./deployments";
import type { CoreDeployment } from "./deployments";
import type { BrandConfig, FeatureFlags, LatchDexConfig, TokenConfig } from "./types";

/** Ceiling `@latchprotocol/widgets` enforces on an integrator fee. Mirrored, not owned. */
export const MAX_FEE_BPS = 100;

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export interface ConfigProblem {
  /** Dotted path into `latch.config.ts`, e.g. `fee.wallet`. */
  readonly field: string;
  readonly message: string;
  /** `error` blocks the app. `warning` is rendered but does not block. */
  readonly severity: "error" | "warning";
}

export interface ResolvedConfig {
  readonly brand: BrandConfig;
  readonly features: FeatureFlags;
  readonly core: CoreDeployment;
  readonly nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Merged address book: the deployment, with any `contracts` override applied. */
  readonly contracts: CoreDeployment;
  readonly registry: Address | null;
  readonly launchpadKit: Address | null;
  readonly rpcUrls: readonly string[];
  readonly fee: {
    readonly wallet: Address;
    readonly bps: number;
    readonly mode: "take-portion" | "pay-portion";
    /** `false` when the app takes nothing. Rendered honestly rather than hidden. */
    readonly active: boolean;
  };
  readonly tokens: readonly TokenConfig[];
  readonly problems: readonly ConfigProblem[];
}

function checkAddress(
  value: unknown,
  field: string,
  problems: ConfigProblem[],
): Address | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !isAddress(value)) {
    problems.push({
      field,
      severity: "error",
      message: `not a valid address: ${JSON.stringify(value)}`,
    });
    return null;
  }
  return getAddress(value);
}

function resolveFee(
  raw: LatchDexConfig["fee"],
  problems: ConfigProblem[],
): ResolvedConfig["fee"] {
  const mode = raw.mode ?? "take-portion";
  const bps = raw.bps;

  if (!Number.isInteger(bps) || bps < 0) {
    problems.push({
      field: "fee.bps",
      severity: "error",
      message: `must be a whole, non-negative number of basis points, received ${String(bps)}`,
    });
    return { wallet: ZERO_ADDRESS, bps: 0, mode, active: false };
  }
  if (bps > MAX_FEE_BPS) {
    problems.push({
      field: "fee.bps",
      severity: "error",
      message:
        `${bps} bps exceeds the ${MAX_FEE_BPS} bps (1%) ceiling @latchprotocol/widgets enforces. ` +
        "That ceiling exists so an embedder cannot quietly take a third of a user's output.",
    });
    return { wallet: ZERO_ADDRESS, bps: 0, mode, active: false };
  }

  const wallet = checkAddress(raw.wallet, "fee.wallet", problems);

  if (bps > 0 && (wallet === null || wallet === ZERO_ADDRESS)) {
    problems.push({
      field: "fee.wallet",
      severity: "error",
      message:
        `fee.bps is ${bps} but fee.wallet is ${wallet === null ? "not set" : "the zero address"}. ` +
        "The fee would be forfeited, so the app refuses to run rather than silently earn nothing.",
    });
    return { wallet: ZERO_ADDRESS, bps: 0, mode, active: false };
  }

  if (bps === 0) {
    problems.push({
      field: "fee.bps",
      severity: "warning",
      message:
        "fee.bps is 0, so this front end earns nothing. That is a valid launch position — " +
        "set it above 0 when you are ready to charge.",
    });
    return { wallet: wallet ?? ZERO_ADDRESS, bps: 0, mode, active: false };
  }

  return { wallet: wallet ?? ZERO_ADDRESS, bps, mode, active: true };
}

function resolveTokens(
  raw: readonly TokenConfig[],
  problems: ConfigProblem[],
): readonly TokenConfig[] {
  const seen = new Set<string>();
  const out: TokenConfig[] = [];

  raw.forEach((token, index) => {
    const address = checkAddress(token.address, `tokens[${index}].address`, problems);
    if (address === null) return;
    const key = address.toLowerCase();
    if (seen.has(key)) {
      problems.push({
        field: `tokens[${index}]`,
        severity: "warning",
        message: `${address} is listed twice; the duplicate is ignored`,
      });
      return;
    }
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) {
      problems.push({
        field: `tokens[${index}].decimals`,
        severity: "error",
        message: `decimals must be an integer in 0..36, received ${String(token.decimals)}`,
      });
      return;
    }
    seen.add(key);
    out.push({ ...token, address });
  });

  return out;
}

let cached: ResolvedConfig | null = null;

/** Validates the tenant config once and caches the result. */
export function resolveConfig(input: LatchDexConfig = config): ResolvedConfig {
  if (cached !== null && input === config) return cached;

  const problems: ConfigProblem[] = [];

  if (!isSupportedChain(input.chain.id)) {
    problems.push({
      field: "chain.id",
      severity: "error",
      message:
        `Latch's shared core is not deployed on chain ${String(input.chain.id)}. ` +
        "Supported: 4663 (Robinhood Chain), 11155111 (Ethereum Sepolia). " +
        "A full fork can target any EIP-1153 chain, but then you must also supply " +
        "chain.contracts — see the README.",
    });
  }

  const chainId = isSupportedChain(input.chain.id) ? input.chain.id : 4663;
  const core = LATCH_DEPLOYMENTS[chainId];

  /* Overrides exist for a full fork, which points the app at its own core. Each
     one is validated before it lands, so a typo becomes a named config problem
     rather than a read against an address with no code. */
  const overrides = input.chain.contracts ?? {};
  const merged: Record<string, unknown> = { ...core };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const checked = checkAddress(value, `chain.contracts.${key}`, problems);
    if (checked === null) continue;
    merged[key] = checked;
  }
  const contracts = merged as unknown as CoreDeployment;

  const registry = checkAddress(input.chain.registry, "chain.registry", problems);
  const launchpadKit = checkAddress(input.chain.launchpadKit, "chain.launchpadKit", problems);

  if (input.features.launchpad && launchpadKit === null) {
    problems.push({
      field: "chain.launchpadKit",
      severity: "warning",
      message:
        "features.launchpad is on but no LaunchpadKit address is configured, so the launch " +
        "surfaces will render 'not configured'. Run `npm run latch:verify` to fill it in, " +
        "or set features.launchpad to false.",
    });
  }

  const brandName = input.brand.name.trim();
  if (brandName.length === 0) {
    problems.push({ field: "brand.name", severity: "error", message: "must not be empty" });
  }

  const enabled = Object.values(input.features).filter(Boolean).length;
  if (enabled === 0) {
    problems.push({
      field: "features",
      severity: "error",
      message: "every feature is off, so the app has nothing to render",
    });
  }

  const resolved: ResolvedConfig = {
    brand: input.brand,
    features: input.features,
    core,
    contracts,
    nativeCurrency: NATIVE_CURRENCY[chainId],
    registry,
    launchpadKit,
    rpcUrls: input.chain.rpcUrls ?? [],
    fee: resolveFee(input.fee, problems),
    tokens: resolveTokens(input.tokens, problems),
    problems,
  };

  if (input === config) cached = resolved;
  return resolved;
}

export function hasBlockingProblem(resolved: ResolvedConfig): boolean {
  return resolved.problems.some((p) => p.severity === "error");
}
