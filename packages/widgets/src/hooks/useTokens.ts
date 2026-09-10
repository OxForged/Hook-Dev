// SPDX-License-Identifier: MIT
/** Token, balance, pool and account resources. All headless. */

import { useCallback } from "react";
import type { Address } from "viem";
import type { PoolInfo, PoolState, TokenInfo } from "../adapters/protocol.js";
import { useWidgetContext } from "../context/WidgetProvider.js";
import { useAsyncResource, type AsyncResource } from "./useAsyncResource.js";

/** The tokens this deployment offers. */
export function useTokenList(): AsyncResource<readonly TokenInfo[]> {
  const { adapter } = useWidgetContext();
  return useAsyncResource(useCallback(() => adapter.listTokens(), [adapter]), [adapter]);
}

/** The connected account, or `null`. */
export function useAccount(): AsyncResource<Address | null> {
  const { adapter } = useWidgetContext();
  return useAsyncResource(useCallback(() => adapter.getAccount(), [adapter]), [adapter]);
}

/** Balance of `token` for `owner`. Idle until both are known. */
export function useTokenBalance(
  token: TokenInfo | null,
  owner: Address | null,
): AsyncResource<bigint> {
  const { adapter } = useWidgetContext();
  const loader = useCallback(async (): Promise<bigint> => {
    if (token === null || owner === null) return 0n;
    return adapter.getBalance(token, owner);
  }, [adapter, token, owner]);
  return useAsyncResource(loader, [adapter, token?.address ?? null, owner], {
    enabled: token !== null && owner !== null,
    refetchIntervalMs: 30_000,
  });
}

/** Every pool the adapter knows about. */
export function usePools(): AsyncResource<readonly PoolInfo[]> {
  const { adapter } = useWidgetContext();
  return useAsyncResource(useCallback(() => adapter.listPools(), [adapter]), [adapter]);
}

/** Live state for one pool. */
export function usePoolState(pool: PoolInfo | null): AsyncResource<PoolState | null> {
  const { adapter } = useWidgetContext();
  const loader = useCallback(async (): Promise<PoolState | null> => {
    if (pool === null) return null;
    return adapter.getPoolState(pool);
  }, [adapter, pool]);
  return useAsyncResource(loader, [adapter, pool?.id ?? null], { enabled: pool !== null });
}
