// SPDX-License-Identifier: MIT
/**
 * What the scaffolder needs to know, and what it refuses to guess.
 *
 * Two of these are load-bearing enough that a wrong value is worse than no
 * value, so neither has a default:
 *
 *   * `chainId` — the app reads and writes one chain. Latch's shared core is
 *     deployed on a specific list of them and nowhere else, and pointing a UI
 *     at a chain with no Vault produces a screen full of failed reads with no
 *     explanation. Picking one for the tenant would be picking wrong.
 *   * `feeWallet` — the address the front end's swap fee is paid to. A default
 *     here would either be the zero address (fee silently burned) or ours
 *     (fee silently ours). Both are unacceptable, so it is required whenever a
 *     non-zero fee is configured.
 */

import { ArgError } from "./util/args.js";

/** Chains where Latch's shared core is deployed. Keep in step with the template's address book. */
export const SUPPORTED_CHAINS: ReadonlyMap<number, string> = new Map([
  [4663, "Robinhood Chain"],
  [11155111, "Ethereum Sepolia"],
]);

/** Chain aliases accepted on the command line, so `--chain robinhood` works. */
const CHAIN_ALIASES: ReadonlyMap<string, number> = new Map([
  ["robinhood", 4663],
  ["robinhoodchain", 4663],
  ["4663", 4663],
  ["sepolia", 11155111],
  ["ethereumsepolia", 11155111],
  ["11155111", 11155111],
]);

export type FeatureFlag = "swap" | "pools" | "launchpad";

export const ALL_FEATURES: readonly FeatureFlag[] = ["swap", "pools", "launchpad"];

/** Named bundles, because "DEX only / launchpad only / both" is how tenants think. */
const FEATURE_BUNDLES: ReadonlyMap<string, readonly FeatureFlag[]> = new Map([
  ["dex", ["swap", "pools"]],
  ["launchpad", ["launchpad"]],
  ["both", ["swap", "pools", "launchpad"]],
  ["all", ["swap", "pools", "launchpad"]],
]);

export interface ScaffoldOptions {
  /** Directory the project is written to. */
  readonly directory: string;
  /** npm package name for the generated app. */
  readonly packageName: string;
  /** Human-facing product name, used in the UI and the browser title. */
  readonly appName: string;
  readonly chainId: number;
  readonly chainName: string;
  /** Recipient of the front end's swap fee. Zero address means no fee is taken. */
  readonly feeWallet: string;
  /** Front-end swap fee in basis points of the swap OUTPUT. */
  readonly feeBps: number;
  readonly features: readonly FeatureFlag[];
  /** Printed in the next-steps block. Not used to run anything. */
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun";
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * The client-side ceiling `@latchprotocol/widgets` enforces on an integrator fee.
 *
 * Mirrored here so the scaffolder rejects an impossible value at scaffold time
 * rather than at the moment a user presses Swap. If the two ever disagree the
 * widget is authoritative — it is the one that builds the calldata.
 */
export const MAX_FEE_BPS = 100;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Syntactic address validation only.
 *
 * The scaffolder has no runtime dependencies, so it cannot compute an EIP-55
 * checksum (that needs keccak). The generated app checks the checksum with
 * viem's `getAddress` at boot, and `npm run latch:verify` checks the address has
 * code on the configured chain. Both of those catch what this cannot.
 */
export function looksLikeAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

export function normalizeChain(input: string): number {
  const key = input.trim().toLowerCase().replace(/[\s_-]/g, "");
  const id = CHAIN_ALIASES.get(key);
  if (id === undefined) {
    const supported = [...SUPPORTED_CHAINS.entries()]
      .map(([chainId, name]) => `${name} (${chainId})`)
      .join(", ");
    throw new ArgError(
      `Unknown chain "${input}". Latch's shared core is deployed on: ${supported}. ` +
        "A full fork can target any EIP-1153 chain, but that is a different product — see the README.",
    );
  }
  return id;
}

export function normalizeFeatures(input: string): readonly FeatureFlag[] {
  const raw = input.trim().toLowerCase();
  const bundle = FEATURE_BUNDLES.get(raw);
  if (bundle !== undefined) return bundle;

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new ArgError("--features must name at least one feature");
  }

  const out: FeatureFlag[] = [];
  for (const part of parts) {
    if (!(ALL_FEATURES as readonly string[]).includes(part)) {
      throw new ArgError(
        `Unknown feature "${part}". Use one of ${ALL_FEATURES.join(", ")}, ` +
          "or a bundle: dex, launchpad, both.",
      );
    }
    const flag = part as FeatureFlag;
    if (!out.includes(flag)) out.push(flag);
  }
  return out;
}

/**
 * Derives an npm-safe package name from a directory or product name.
 *
 * Falls back to `latch-dex` rather than emitting an invalid name — a
 * package.json npm refuses to read is a worse first impression than a generic
 * name the tenant renames in ten seconds.
 */
export function toPackageName(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-_.]+/, "")
    .replace(/[-_.]+$/, "");
  return slug.length === 0 ? "latch-dex" : slug.slice(0, 214);
}

/** A readable product name from a directory name: `acme-swap` becomes `Acme Swap`. */
export function toAppName(input: string): string {
  const words = input
    .trim()
    .replace(/[-_.]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return "Latch DEX";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export interface ResolveInput {
  readonly directory: string;
  readonly appName?: string | undefined;
  readonly chain?: string | undefined;
  readonly feeWallet?: string | undefined;
  readonly feeBps?: string | undefined;
  readonly features?: string | undefined;
  readonly packageManager?: string | undefined;
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Validates raw CLI input into a complete option set.
 *
 * Throws rather than filling a gap with a plausible-looking default. The one
 * exception is `feeBps`, which defaults to 0: a scaffold that silently starts
 * charging a tenant's users is worse than one that earns nothing until asked.
 */
export function resolveOptions(input: ResolveInput): ScaffoldOptions {
  const directory = input.directory.trim();
  if (directory.length === 0) {
    throw new ArgError("A project directory is required: create-latch-dex <directory>");
  }

  const chainId = normalizeChain(input.chain ?? "");
  const chainName = SUPPORTED_CHAINS.get(chainId);
  if (chainName === undefined) {
    throw new ArgError(`chain ${chainId} is in the alias table but not in SUPPORTED_CHAINS`);
  }

  const feeBpsRaw = input.feeBps ?? "0";
  const feeBps = Number(feeBpsRaw);
  if (!Number.isInteger(feeBps) || feeBps < 0) {
    throw new ArgError(
      `--fee-bps must be a whole number of basis points, received "${feeBpsRaw}". ` +
        "There is no sub-basis-point precision on chain.",
    );
  }
  if (feeBps > MAX_FEE_BPS) {
    throw new ArgError(
      `--fee-bps ${feeBps} exceeds the ${MAX_FEE_BPS} bps (${MAX_FEE_BPS / 100}%) ceiling ` +
        "@latchprotocol/widgets enforces on an integrator fee.",
    );
  }

  const feeWalletRaw = (input.feeWallet ?? "").trim();
  if (feeBps > 0 && feeWalletRaw.length === 0) {
    throw new ArgError(
      `--fee-bps is ${feeBps} but no --fee-wallet was given. A fee with no destination ` +
        "would be forfeited, so this is refused rather than defaulted.",
    );
  }
  const feeWallet = feeWalletRaw.length === 0 ? ZERO_ADDRESS : feeWalletRaw;
  if (!looksLikeAddress(feeWallet)) {
    throw new ArgError(`--fee-wallet is not a 20-byte hex address: "${feeWalletRaw}"`);
  }
  if (feeBps > 0 && feeWallet.toLowerCase() === ZERO_ADDRESS) {
    throw new ArgError(
      `--fee-bps is ${feeBps} but --fee-wallet is the zero address. The fee would be burned.`,
    );
  }

  const features = normalizeFeatures(input.features ?? "both");

  const packageManager = (input.packageManager ?? "npm").trim().toLowerCase();
  if (!PACKAGE_MANAGERS.has(packageManager)) {
    throw new ArgError(
      `--package-manager must be one of ${[...PACKAGE_MANAGERS].join(", ")}, received "${packageManager}"`,
    );
  }

  const dirBase = directory.split(/[\\/]/).filter((s) => s.length > 0).pop() ?? directory;
  const appName = (input.appName ?? "").trim() || toAppName(dirBase);

  return {
    directory,
    packageName: toPackageName(dirBase),
    appName,
    chainId,
    chainName,
    feeWallet,
    feeBps,
    features,
    packageManager: packageManager as ScaffoldOptions["packageManager"],
  };
}
