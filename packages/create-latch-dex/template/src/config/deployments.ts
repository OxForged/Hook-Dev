// SPDX-License-Identifier: MIT
/**
 * Latch's shared core, per chain.
 *
 * These are the contracts you do NOT deploy. Your pools live in this Vault and
 * are managed by these pool managers; you deploy a front end and, if you want
 * one, a launchpad instance. That is the whole shared-core model.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE NO LONGER HOLDS ANY ADDRESSES, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 *
 * It used to carry its own hand-typed table. So did Latch's own dapp. Two
 * copies of one truth is a drift machine: the two had ALREADY diverged before
 * anybody noticed — this copy knew nothing about the timelocks, the fee
 * controller, the quoters or the position descriptor, and there was no way to
 * tell from either file which one was behind.
 *
 * The table now lives in `@latchprotocol/sdk` (MIT, the same package this app
 * already depends on for ABIs, event decoding and probed RPC endpoints), and
 * both consumers import it. When Latch redeploys a contract you get the new
 * address by bumping the SDK — not by editing this file, and not by discovering
 * six months later that you were reading a retired one.
 *
 * Everything below is a RE-EXPORT under the names this project already used, so
 * nothing else in the template changes.
 *
 * ---------------------------------------------------------------------------
 * WHY `registry` AND `launchpadKit` STILL LIVE IN `latch.config.ts`
 * ---------------------------------------------------------------------------
 *
 * A `Vault` is immutable and permanent — its address will not change, and
 * baking it in means you cannot mistype it. `LatchRegistry` is a redeployable
 * directory contract that has already been redeployed once, and a stale
 * registry address does not fail loudly: it answers `latchCount()` with a
 * number, renders as a healthy empty marketplace, and nothing anywhere says the
 * app is reading a retired contract. So it stays in `latch.config.ts` where you
 * can see and change it, and the same goes for `launchpadKit`.
 *
 * The SDK marks exactly this class of address in `REDEPLOYABLE_CONTRACTS`, and
 * anything it does not yet have an address for reads `null` — never a zero
 * address, which is a value your code would happily call and get silence from.
 *
 * Run `npm run latch:verify` to check every address here actually has code on
 * the chain you configured. An address book is a claim, not a fact.
 */

import {
  LATCH_DEPLOYMENTS as SDK_DEPLOYMENTS,
  NATIVE_CURRENCY as SDK_NATIVE_CURRENCY,
  isLatchChainId,
  type LatchDeployment,
} from "@latchprotocol/sdk";

import type { SupportedChainId } from "./types.js";

/**
 * Every Latch contract on one chain, plus its token decimals and the reference
 * pool if it has one.
 *
 * A field typed `Address` is deployed on every supported chain. A field typed
 * `Address | null` genuinely does not exist somewhere — check it rather than
 * substituting a placeholder. `decimals` on a token is never optional: raw
 * units are what `sqrtPriceX96` encodes, so a 6-decimal quote assumed to be 18
 * misprices a pool by 10^12, permanently, at `initialize`.
 */
export type CoreDeployment = LatchDeployment;

export const LATCH_DEPLOYMENTS: Readonly<Record<SupportedChainId, CoreDeployment>> =
  SDK_DEPLOYMENTS;

/** Native currency metadata per chain. */
export const NATIVE_CURRENCY: Readonly<
  Record<SupportedChainId, { name: string; symbol: string; decimals: number }>
> = SDK_NATIVE_CURRENCY;

/**
 * Whether Latch's shared core is deployed on a chain.
 *
 * Delegated to the SDK rather than restated as a hardcoded comparison, so a
 * chain Latch adds becomes supported here by bumping the dependency.
 */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return isLatchChainId(chainId);
}
