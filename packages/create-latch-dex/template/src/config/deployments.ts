// SPDX-License-Identifier: MIT
/**
 * Latch's shared core, per chain.
 *
 * These are the contracts a tenant does NOT deploy. Your pools live in this
 * Vault and are managed by these pool managers; you deploy a front end and, if
 * you want one, a launchpad instance. That is the whole shared-core model.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ADDRESSES ARE IN A SOURCE FILE AND `registry` IS NOT
 * ---------------------------------------------------------------------------
 *
 * A `Vault` is immutable and permanent — its address will not change, and
 * baking it in means a tenant cannot mistype it. `LatchRegistry` is a
 * redeployable directory contract that has already been redeployed once, and a
 * stale registry address does not fail loudly: it answers `latchCount()` with a
 * number, renders as a healthy empty marketplace, and nothing anywhere says the
 * app is reading a retired contract. So the registry lives in
 * `latch.config.ts`, where a tenant sees it and can change it, and the same
 * goes for `launchpadKit`.
 *
 * Run `npm run latch:verify` to check every address here actually has code on
 * the chain you configured. An address book is a claim, not a fact.
 */

import type { Address } from "viem";

import type { SupportedChainId } from "./types.js";

export interface CoreDeployment {
  readonly chainId: SupportedChainId;
  readonly name: string;
  readonly explorer: string;
  /** Block the first Latch contract landed. Log scans start here, not at genesis. */
  readonly deployedAtBlock: bigint;
  /** `true` when this chain holds real value. Governs the warning banner, nothing else. */
  readonly isMainnet: boolean;

  readonly vault: Address;
  readonly clPoolManager: Address;
  readonly binPoolManager: Address;
  readonly universalRouter: Address;
  readonly clPositionManager: Address;
  readonly binPositionManager: Address;
  readonly clQuoter: Address;
  readonly permit2: Address;
  /** Canonical wrapped native token on this chain. */
  readonly weth: Address;
  /** Latch's own `RevShareHook` instance. Per-pool config; not a tenant deployment. */
  readonly revShareHook: Address;
}

export const LATCH_DEPLOYMENTS: Readonly<Record<SupportedChainId, CoreDeployment>> = {
  /* Robinhood Chain — Latch's first mainnet. Deployed 2026-09-11, verified on Sourcify. */
  4663: {
    chainId: 4663,
    name: "Robinhood Chain",
    explorer: "https://robinhoodchain.blockscout.com",
    deployedAtBlock: 60111836n,
    isMainnet: true,
    vault: "0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c",
    clPoolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66",
    binPoolManager: "0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979",
    universalRouter: "0x2220dF8ec6CABC7f2074bC1e56DA092B765f736c",
    clPositionManager: "0x957cc13b24a563cc92253213d9d5e6954c8db6a7",
    binPositionManager: "0x990f395003c35a0ab390e10b003972407f882399",
    clQuoter: "0xdfd14247f87d1e4fc82f0f441fb43bc8aa466114",
    /* Canonical Permit2, confirmed by reading code at the address. */
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    /* Canonical per docs.robinhood.com/chain/contracts. The usual predeploys
       0x4200..06 and 0xC02aaA.. have NO CODE on this chain, so do not reach for
       them out of habit. */
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    revShareHook: "0x23CE34E8199927DD270dddd8579c947542bDE446",
  },

  /* Ethereum Sepolia — testnet. Nothing here is worth anything. */
  11155111: {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    explorer: "https://sepolia.etherscan.io",
    deployedAtBlock: 11672600n,
    isMainnet: false,
    vault: "0xCe3d133eb486b448A53437A5073619FbE424d01B",
    clPoolManager: "0xb7C8a11E0B359616eD06256783aF57114841F738",
    binPoolManager: "0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3",
    universalRouter: "0xB647CEbd5b8d6bE38C198634828187F482f4874B",
    clPositionManager: "0xb3505d48A84651c104a02D41B2b9D8CB84dFEC33",
    binPositionManager: "0x965b1D98BB0cd4E0125D78AD17ea4d2D1d62AE6f",
    clQuoter: "0x4471e61fE697204908CA97CdF4810EeAf406e9C1",
    permit2: "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
    weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    revShareHook: "0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28",
  },
} as const;

/** Native currency metadata per chain. */
export const NATIVE_CURRENCY: Readonly<
  Record<SupportedChainId, { name: string; symbol: string; decimals: number }>
> = {
  4663: { name: "Ether", symbol: "ETH", decimals: 18 },
  11155111: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
} as const;

export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return chainId === 4663 || chainId === 11155111;
}
