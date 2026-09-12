// SPDX-License-Identifier: MIT
/**
 * The one read client this app uses.
 *
 * Endpoints come from `@latchprotocol/sdk`, where every URL was probed rather
 * than collected from a list, plus anything the tenant put in
 * `chain.rpcUrls`. Tenant endpoints go first: a keyed provider is always
 * preferable to a shared public one.
 *
 * `latchTransport` throws `UnknownChainError` for a chain it has no endpoints
 * for. That is on purpose and must not be softened into a default — a transport
 * that quietly points at the wrong network is how a testnet call lands on
 * mainnet.
 */

import { latchTransport } from "@latchprotocol/sdk";
import { createPublicClient, type Chain, type PublicClient } from "viem";

import { resolveConfig } from "../config/resolve";

let cached: PublicClient | null = null;

/** viem `Chain` for the configured network, built from the address book. */
export function activeChain(): Chain {
  const cfg = resolveConfig();
  return {
    id: cfg.core.chainId,
    name: cfg.core.name,
    nativeCurrency: cfg.nativeCurrency,
    rpcUrls: { default: { http: [...cfg.rpcUrls] } },
    blockExplorers: { default: { name: "Explorer", url: cfg.core.explorer } },
    testnet: !cfg.core.isMainnet,
  };
}

export function publicClient(): PublicClient {
  if (cached !== null) return cached;
  const cfg = resolveConfig();

  // Tenant endpoints are passed through the SDK's env override so they take the
  // same "private first, public as a safety net" ordering the SDK documents.
  const env: Record<string, string | undefined> =
    cfg.rpcUrls.length > 0 ? { [`LATCH_RPC_${cfg.core.chainId}`]: cfg.rpcUrls.join(",") } : {};

  cached = createPublicClient({
    chain: activeChain(),
    transport: latchTransport(cfg.core.chainId, { env, timeout: 12_000 }),
  });
  return cached;
}

export function explorerTx(hash: string): string {
  return `${resolveConfig().core.explorer}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${resolveConfig().core.explorer}/address/${address}`;
}
