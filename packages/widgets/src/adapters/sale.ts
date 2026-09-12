// SPDX-License-Identifier: MIT
/**
 * Optional extension point: a third-party token sale.
 *
 * ## Nothing in Latch implements this, on purpose
 *
 * A Latch launch is a pool with `LaunchGuardHook` attached and a decaying LP
 * fee. Buying into one is an ordinary swap. There is no `buy`, no soft or hard
 * cap, no allocation, no claim, and no per-wallet limit anywhere in the
 * protocol — see {@link ../callpath/launch.js} for why a per-wallet limit is
 * not implementable at the hook layer at all.
 *
 * This package used to ship a `LAUNCHPAD_ABI` describing a sale contract with
 * all of those features. No deployed contract implemented it, so every byte of
 * calldata it produced was guaranteed to fail. It has been deleted.
 *
 * ## What replaces it
 *
 * The shape of an *answer*, not the shape of somebody's contract. If you run a
 * genuine sale contract, you implement {@link TokenSaleAdapter} against your own
 * ABI and hang it off `ProtocolAdapter.sale`. Your `buildBuy` returns a
 * {@link ../adapters/protocol.js | WidgetTransactionRequest} — the same
 * adapter-neutral `{to, data, value}` the rest of this package speaks — so this
 * package never has to guess at a function selector it cannot verify.
 *
 * That is the whole point of putting it here: an unverifiable ABI is a
 * liability wherever it lives, and the one place it is honest is behind an
 * interface the integrator fills in from a contract they actually deployed.
 *
 * Nothing in this package reads `ProtocolAdapter.sale`. The styled
 * `LaunchWidget` binds to `LaunchGuardHook` and to nothing else. Consuming
 * these types means building your own UI on top of them.
 */

import type { Address } from "viem";
import type { ResolvedIntegratorConfig } from "../config/integrator.js";
import type { DataSource, TokenInfo, WidgetTransactionRequest } from "./protocol.js";

/** Lifecycle of a third-party token sale. */
export type TokenSaleStatus =
  | "upcoming"
  | "live"
  | "paused"
  | "ended"
  | "sold-out"
  | "cancelled";

/** Shape of a sale's price curve, if it has one. */
export type TokenSalePriceCurve =
  | { readonly kind: "fixed"; readonly price: bigint }
  | { readonly kind: "linear"; readonly startPrice: bigint; readonly endPrice: bigint }
  | {
      readonly kind: "exponential";
      readonly startPrice: bigint;
      readonly endPrice: bigint;
      /** Curvature exponent, scaled to 1e18. */
      readonly exponent: bigint;
    };

/**
 * A sale, as your adapter reports it.
 *
 * Every field is optional-by-nullability where a sale might not have the
 * concept. Return `null` rather than zero: a UI can say "no cap" from `null`,
 * but `0n` reads as "cap reached".
 */
export interface TokenSaleInfo {
  /** The sale contract. */
  readonly id: Address;
  readonly token: TokenInfo;
  /** Currency buyers pay in. */
  readonly paymentToken: TokenInfo;
  readonly status: TokenSaleStatus;
  readonly totalForSale: bigint;
  readonly sold: bigint;
  readonly raised: bigint;
  readonly softCap: bigint | null;
  readonly hardCap: bigint | null;
  /** Unix seconds. */
  readonly startTime: bigint;
  readonly endTime: bigint;
  /** Maximum a single wallet may spend, in the payment currency. */
  readonly perWalletCap: bigint | null;
  readonly minPurchase: bigint;
  readonly priceCurve: TokenSalePriceCurve | null;
  readonly source: DataSource;
}

/** One account's standing in a sale. */
export interface TokenSaleAccountState {
  readonly saleId: Address;
  readonly account: Address;
  readonly spent: bigint;
  readonly allocated: bigint;
  /** Remaining spend allowed under the per-wallet cap. `null` when uncapped. */
  readonly capRemaining: bigint | null;
  readonly eligible: boolean;
  readonly ineligibleReason: string | null;
  readonly source: DataSource;
}

/** Quote for a sale purchase. */
export interface TokenSaleQuote {
  readonly sale: TokenSaleInfo;
  readonly amountIn: bigint;
  readonly tokensOut: bigint;
  /** Effective price paid, in payment units per whole token. */
  readonly effectivePrice: bigint;
  readonly source: DataSource;
}

/** Request to build a sale purchase transaction. */
export interface TokenSaleBuyRequest {
  readonly quote: TokenSaleQuote;
  readonly minTokensOut: bigint;
  readonly recipient: Address;
  readonly deadline: bigint;
  /**
   * The validated integrator config from the provider.
   *
   * Whether a sale contract can pay a referrer at all is a property of that
   * contract. If yours cannot, ignore this and do not silently drop the fee
   * into a transfer the user does not see.
   */
  readonly integrator: ResolvedIntegratorConfig;
}

/**
 * The seam. Implement it against your own sale contract.
 *
 * Every method may throw; the headless layer surfaces the error rather than
 * substituting a default.
 */
export interface TokenSaleAdapter {
  /** Identifies the implementation in error messages, e.g. `"acme-launchpad"`. */
  readonly kind: string;
  listSales(): Promise<readonly TokenSaleInfo[]>;
  getSale(id: Address): Promise<TokenSaleInfo | null>;
  getSaleAccountState(id: Address, account: Address): Promise<TokenSaleAccountState>;
  quoteBuy(sale: TokenSaleInfo, amountIn: bigint): Promise<TokenSaleQuote>;
  buildBuy(request: TokenSaleBuyRequest): Promise<WidgetTransactionRequest>;
}

/** Thrown by a host that wires a sale UI without wiring a sale adapter. */
export class NoSaleAdapterError extends Error {
  constructor() {
    super(
      "[@latchprotocol/widgets] no sale adapter is configured. Latch has no sale contract - " +
        "a launch is a pool with LaunchGuardHook attached, and buying into one is a swap. " +
        "Set ProtocolAdapter.sale only if you run your own sale contract.",
    );
    this.name = "NoSaleAdapterError";
  }
}

/** Narrowing helper, so a host can branch without a cast. */
export function hasSaleAdapter(
  adapter: { readonly sale?: TokenSaleAdapter },
): adapter is { readonly sale: TokenSaleAdapter } {
  return adapter.sale !== undefined;
}
