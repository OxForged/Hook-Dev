// SPDX-License-Identifier: MIT
/**
 * The shape of `latch.config.ts` — the one file a tenant edits.
 *
 * Everything a tenant needs to change to take this to market is here: the
 * chain, the fee wallet, the branding and which features are switched on.
 * Nothing else in the project should need touching, and in particular **no
 * Solidity**. A tenant who has to fork a contract to change a fee address is a
 * tenant maintaining a Solidity fork, which is the opposite of one click.
 *
 * Two things are deliberately NOT configurable here:
 *
 *   * Core addresses. `Vault` and the pool managers come from
 *     `src/config/deployments.ts`, which records what Latch has deployed and
 *     verified per chain. They are overridable (`contracts`) for a full fork,
 *     but a tenant on shared core should never need to.
 *   * Latch's protocol fee. It is set per pool by `protocolFeeController` on the
 *     shared pool manager, which Latch governance owns and core caps at
 *     `MAX_PROTOCOL_FEE = 4000` pips (0.4%). Your app can read it — see
 *     `src/lib/protocol.ts` — but it cannot change it.
 */

import type { Address } from "viem";

/** Chains where Latch's shared core is deployed. */
export type SupportedChainId = 4663 | 11155111;

/**
 * Contract addresses.
 *
 * Only supply these to override the address book, which is what a full fork
 * needs. On shared core, leave them out.
 */
export interface ContractOverrides {
  readonly vault?: Address;
  readonly clPoolManager?: Address;
  readonly binPoolManager?: Address;
  readonly universalRouter?: Address;
  readonly clPositionManager?: Address;
  readonly binPositionManager?: Address;
  readonly clQuoter?: Address;
  readonly permit2?: Address;
  readonly weth?: Address;
}

export interface ChainConfigInput {
  readonly id: SupportedChainId;

  /**
   * `LatchRegistry` — the shared marketplace of listed Latches (hook contracts).
   *
   * Read from here, never hardcoded anywhere else in the app: this contract has
   * been redeployed before and will be again, and a stale address in a source
   * file reads as a healthy empty registry rather than as a wrong one. Leave it
   * `null` and every registry surface renders "not configured" and says so.
   */
  readonly registry: Address | null;

  /**
   * `LaunchpadKit` — the one-call launch factory.
   *
   * `null` disables the launch surfaces with an honest "not configured" state.
   * `npm run latch:verify` fills this in from the address book when Latch has a
   * shared instance on your chain, or from your own deployment when you run one.
   */
  readonly launchpadKit: Address | null;

  /**
   * Extra RPC URLs, tried before the SDK's probed public list.
   *
   * Public endpoints rate-limit and disappear. Put a keyed provider here via an
   * env var; never commit the URL itself, because a provider key is embedded in
   * the path.
   */
  readonly rpcUrls?: readonly string[];

  readonly contracts?: ContractOverrides;
}

/**
 * Where the front end's revenue comes from.
 *
 * This is a fee on the swap OUTPUT, taken inside the same transaction as the
 * swap by `@latchprotocol/widgets` — a `TAKE_PORTION` action in the swap plan,
 * not an accounting entry settled later. It either happens atomically or the
 * whole transaction reverts.
 *
 * It stacks on top of, and is entirely separate from, the pool's LP fee and
 * Latch's protocol fee. Show all three; see `src/routes/Fees.tsx`.
 */
export interface FeeConfig {
  /** Address the fee is paid to. Required whenever `bps > 0`. */
  readonly wallet: Address | null;
  /**
   * Fee in basis points of the swap output. `@latchprotocol/widgets` refuses
   * anything above 100 bps (1%), so a value above that is a build-time error
   * rather than a business decision.
   */
  readonly bps: number;
  /**
   * Where in the call path the fee is taken.
   *
   * `take-portion` splits the vault credit before anything leaves the singleton,
   * so the router never custodies the fee. Use it unless you have a reason.
   */
  readonly mode?: "take-portion" | "pay-portion";
}

/** Colours. Every one of these becomes a CSS custom property on `:root`. */
export interface BrandColors {
  /** Primary action colour: buttons, active nav, focus rings. */
  readonly accent: string;
  /** Text drawn on top of `accent`. Pick for contrast, not for taste. */
  readonly onAccent: string;
  readonly background: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly text: string;
  readonly textMuted: string;
  readonly border: string;
  readonly positive: string;
  readonly negative: string;
}

export interface BrandLinks {
  readonly docs?: string;
  readonly x?: string;
  readonly discord?: string;
  readonly github?: string;
  readonly terms?: string;
}

export interface BrandConfig {
  /** Product name. Appears in the header, the title and wallet prompts. */
  readonly name: string;
  /** One line under the name. Keep it true — it sits above live on-chain data. */
  readonly tagline?: string;
  /** Path or URL to a logo. Rendered at 28px tall; SVG recommended. */
  readonly logoUrl?: string;
  readonly colors: BrandColors;
  /** CSS font stacks. Anything you self-host or load in `index.html`. */
  readonly fontFamily?: string;
  readonly monoFamily?: string;
  /** Corner radius for cards and buttons, in px. */
  readonly radius?: number;
  readonly links?: BrandLinks;
}

/**
 * Which surfaces exist.
 *
 * These gate navigation AND routing, so a disabled feature is unreachable
 * rather than merely unlinked. Switching one back on is a one-word edit; no
 * files are deleted by the scaffolder.
 */
export interface FeatureFlags {
  readonly swap: boolean;
  readonly pools: boolean;
  readonly launchpad: boolean;
}

/**
 * Tokens offered in the swap picker.
 *
 * There is no on-chain token registry, so this list is the app's own. Symbols
 * and decimals are read back from the token contracts at runtime and a mismatch
 * is surfaced rather than papered over — a token that lies about its symbol in
 * a config file is how a user swaps into the wrong asset.
 */
export interface TokenConfig {
  readonly address: Address;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logoUrl?: string;
}

export interface LatchDexConfig {
  readonly brand: BrandConfig;
  readonly chain: ChainConfigInput;
  readonly fee: FeeConfig;
  readonly features: FeatureFlags;
  readonly tokens: readonly TokenConfig[];
}

/**
 * Identity function that gives `latch.config.ts` its types.
 *
 * No validation happens here on purpose: it runs at module scope, and a config
 * error thrown before React mounts produces a blank page with a console
 * message. `resolveConfig` validates instead, and the app renders the failure.
 */
export function defineLatchDex(config: LatchDexConfig): LatchDexConfig {
  return config;
}
