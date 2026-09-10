/**
 * Deterministic row ids.
 *
 * `packages/sdk`'s indexer helpers build the same ids for a single-chain store
 * (`eventId`, `poolEntityId`, `addressId`). This API serves many chains from
 * one database, so every id is additionally prefixed with the chain id. Keep
 * these two conventions aligned: a subgraph id is this id with the
 * `${chainId}-` prefix stripped.
 */

const lower = (s: string) => s.toLowerCase();

export function chainScoped(chainId: number, ...parts: readonly (string | number)[]): string {
  return [chainId, ...parts].join("-");
}

/** Vault, PoolManager, Token and Hook rows. */
export function addressRowId(chainId: number, address: string): string {
  return chainScoped(chainId, lower(address));
}

/** Pool rows: `${chainId}-${poolId}`. */
export function poolRowId(chainId: number, poolId: string): string {
  return chainScoped(chainId, lower(poolId));
}

/** Any row derived from a single log. */
export function eventRowId(chainId: number, txHash: string, logIndex: number): string {
  return chainScoped(chainId, lower(txHash), logIndex);
}

/** Concentrated-liquidity position. */
export function clPositionRowId(
  chainId: number,
  poolId: string,
  owner: string,
  tickLower: number,
  tickUpper: number,
  salt: string,
): string {
  return chainScoped(chainId, lower(poolId), lower(owner), tickLower, tickUpper, lower(salt));
}

/** Liquidity-book position. */
export function binPositionRowId(
  chainId: number,
  poolId: string,
  owner: string,
  binId: bigint,
  salt: string,
): string {
  return chainScoped(chainId, lower(poolId), lower(owner), binId.toString(), lower(salt));
}
