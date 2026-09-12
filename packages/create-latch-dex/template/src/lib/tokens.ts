// SPDX-License-Identifier: MIT
/**
 * Token metadata, read from the token contracts.
 *
 * The config file lists which tokens the app offers; it does not get to decide
 * what they are called. Symbol, name and decimals are read on chain and a
 * disagreement with the config is REPORTED rather than silently preferred one
 * way or the other — a token whose config entry says USDC and whose contract
 * says something else is the single most dangerous row a swap UI can render.
 */

import type { TokenInfo } from "@latchprotocol/widgets";
import { erc20Abi, getAddress, type Address } from "viem";

import { resolveConfig } from "../config/resolve";
import { publicClient } from "./client";

export interface TokenMismatch {
  readonly address: Address;
  readonly field: "symbol" | "name" | "decimals";
  readonly configured: string;
  readonly onChain: string;
}

export interface TokenReadResult {
  readonly tokens: readonly TokenInfo[];
  /** Empty when every configured token matched its contract. */
  readonly mismatches: readonly TokenMismatch[];
  /** Tokens whose metadata could not be read at all: no code, or a reverting call. */
  readonly unreadable: readonly Address[];
}

/**
 * Reads every configured token, plus the chain's native asset.
 *
 * On-chain values win: they are what the contract will actually do. The
 * configured values survive only as the thing a mismatch is reported against.
 */
export async function readTokens(): Promise<TokenReadResult> {
  const cfg = resolveConfig();
  const client = publicClient();

  const native: TokenInfo = {
    address: "0x0000000000000000000000000000000000000000",
    symbol: cfg.nativeCurrency.symbol,
    name: cfg.nativeCurrency.name,
    decimals: cfg.nativeCurrency.decimals,
    isNative: true,
  };

  const mismatches: TokenMismatch[] = [];
  const unreadable: Address[] = [];
  const tokens: TokenInfo[] = [native];

  await Promise.all(
    cfg.tokens.map(async (configured) => {
      const address = getAddress(configured.address);
      try {
        const [symbol, name, decimals] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address, abi: erc20Abi, functionName: "name" }),
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
        ]);

        if (symbol !== configured.symbol) {
          mismatches.push({ address, field: "symbol", configured: configured.symbol, onChain: symbol });
        }
        if (name !== configured.name) {
          mismatches.push({ address, field: "name", configured: configured.name, onChain: name });
        }
        if (Number(decimals) !== configured.decimals) {
          mismatches.push({
            address,
            field: "decimals",
            configured: String(configured.decimals),
            onChain: String(decimals),
          });
        }

        tokens.push({
          address,
          symbol,
          name,
          decimals: Number(decimals),
          ...(configured.logoUrl === undefined ? {} : { logoUrl: configured.logoUrl }),
        });
      } catch {
        unreadable.push(address);
      }
    }),
  );

  return { tokens, mismatches, unreadable };
}

/** Metadata for one arbitrary address, used by the pool list. Never invents a symbol. */
export async function readTokenMeta(address: Address): Promise<TokenInfo | null> {
  const client = publicClient();
  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { address, symbol, name, decimals: Number(decimals) };
  } catch {
    return null;
  }
}
