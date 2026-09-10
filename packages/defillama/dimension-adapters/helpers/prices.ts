/**
 * LOCAL HARNESS STUB - do not submit this file upstream.
 *
 * Byte-for-byte behaviour of upstream `helpers/prices.ts` as read on 2026-09-09,
 * minus the 300kB `coreAssets.json`. `addOneToken` is the helper dexs/AGENTS.md
 * requires for "one side of the swap only": it prefers the core-asset leg so a
 * thin long-tail token cannot set the USD value, and it takes the absolute value
 * of the amount, which matters because `Swap` amounts are signed `int128`.
 *
 * NOTE the upstream version does `amount = Number(amount)`. Latch's adapter hands
 * it bigints, so this copy keeps bigint precision when it can and only falls back
 * to Number for other inputs - documented divergence, and strictly safer. Upstream
 * would lose precision above 2^53, which AGENTS.md separately warns about.
 */

import type { Balances } from "../../harness/balances.js";
import coreAssets from "./coreAssets.json" with { type: "json" };

const coreAssetCache: Record<string, Set<string>> = {};

export function isCoreAsset(chain: string, address: string): boolean {
  if (!coreAssetCache[chain])
    coreAssetCache[chain] = new Set(
      Object.values(((coreAssets as any)[chain] ?? {}) as Record<string, string>).map((a) =>
        String(a).toLowerCase(),
      ),
    );
  return coreAssetCache[chain]!.has(address.toLowerCase());
}

export function addOneToken({
  chain,
  balances,
  token0,
  amount0,
  token1,
  amount1,
  label,
}: {
  balances: Balances;
  chain?: string;
  token0: string;
  amount0: any;
  token1: string;
  amount1: any;
  label?: string;
}): { token: string; amount: any } {
  if (!chain) chain = balances.chain;

  const a0 = normalize(amount0);
  const a1 = normalize(amount1);
  if (isCoreAsset(chain, token0)) {
    balances.add(token0, a0, label);
    return { token: token0, amount: a0 };
  }
  balances.add(token1, a1, label);
  return { token: token1, amount: a1 };

  function normalize(amount: any) {
    if (typeof amount === "bigint") return amount < 0n ? -amount : amount;
    const n = Number(amount);
    return n < 0 ? -n : n;
  }
}
