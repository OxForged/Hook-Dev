// SPDX-License-Identifier: MIT
/**
 * Pools, read from the CL pool manager's own logs.
 *
 * There is no on-chain enumeration of pools — the singleton stores them by id
 * and never lists them — so `Initialize` events are the only complete source.
 * That has one consequence worth stating plainly on any screen built on this:
 * the list is only as complete as the log range scanned, and the scan starts at
 * the block Latch was deployed rather than at genesis.
 *
 * Every query is scoped by the EMITTING ADDRESS. Latch declares 34 events with
 * only 22 unique signatures because `ProtocolFees` is a shared base, so a
 * topic0-only filter silently merges CL and Bin activity into one list.
 */

import { getHooksRegistrationBitmap, getTickSpacing, type PoolKey } from "@latchprotocol/sdk";
import type { PoolInfo, TokenInfo } from "@latchprotocol/widgets";
import { parseAbi, type Address, type Hex } from "viem";

import { resolveConfig } from "../config/resolve";
import { publicClient } from "./client";
import { readTokenMeta } from "./tokens";

export const CL_INITIALIZE_EVENT = parseAbi([
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)",
]);

export const CL_SWAP_EVENT = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee, uint16 protocolFee)",
]);

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export interface PoolRecord {
  readonly id: Hex;
  readonly key: PoolKey;
  readonly currency0: Address;
  readonly currency1: Address;
  /** Null when the token's metadata could not be read. Rendered as the address. */
  readonly token0: TokenInfo | null;
  readonly token1: TokenInfo | null;
  readonly hooks: Address;
  readonly hasHook: boolean;
  /** Hook permission bitmap, decoded out of the pool key's `parameters`. */
  readonly hookBitmap: number;
  readonly lpFeePips: number;
  readonly tickSpacing: number;
  readonly createdAtBlock: bigint;
}

export interface PoolScan {
  readonly pools: readonly PoolRecord[];
  /** First block scanned. Print it — a total over a partial range is not a total. */
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

/** Every pool ever initialised on the shared CL manager, oldest first. */
export async function readPools(): Promise<PoolScan> {
  const cfg = resolveConfig();
  const client = publicClient();
  const fromBlock = cfg.core.deployedAtBlock;

  const [logs, toBlock] = await Promise.all([
    client.getLogs({
      address: cfg.contracts.clPoolManager,
      event: CL_INITIALIZE_EVENT[0],
      fromBlock,
      toBlock: "latest",
    }),
    client.getBlockNumber(),
  ]);

  const pools = await Promise.all(
    logs.map(async (log): Promise<PoolRecord> => {
      const currency0 = log.args.currency0 as Address;
      const currency1 = log.args.currency1 as Address;
      const hooks = log.args.hooks as Address;
      const parameters = log.args.parameters as Hex;

      const [token0, token1] = await Promise.all([
        currency0 === ZERO_ADDRESS ? nativeToken() : readTokenMeta(currency0),
        currency1 === ZERO_ADDRESS ? nativeToken() : readTokenMeta(currency1),
      ]);

      const key: PoolKey = {
        currency0,
        currency1,
        hooks,
        poolManager: cfg.contracts.clPoolManager,
        fee: Number(log.args.fee),
        parameters,
      };

      return {
        id: log.args.id as Hex,
        key,
        currency0,
        currency1,
        token0,
        token1,
        hooks,
        hasHook: hooks !== ZERO_ADDRESS,
        hookBitmap: getHooksRegistrationBitmap(parameters),
        lpFeePips: Number(log.args.fee),
        tickSpacing: getTickSpacing(parameters),
        createdAtBlock: log.blockNumber,
      };
    }),
  );

  return { pools, fromBlock, toBlock };
}

function nativeToken(): TokenInfo {
  const cfg = resolveConfig();
  return {
    address: ZERO_ADDRESS,
    symbol: cfg.nativeCurrency.symbol,
    name: cfg.nativeCurrency.name,
    decimals: cfg.nativeCurrency.decimals,
    isNative: true,
  };
}

/**
 * Pools in the shape `@latchprotocol/widgets` wants.
 *
 * A pool whose token metadata could not be read is DROPPED rather than filled
 * in with a placeholder symbol. A swap picker offering "???" against a real
 * token is an invitation to trade something the user cannot identify.
 */
export function toWidgetPools(pools: readonly PoolRecord[]): PoolInfo[] {
  const out: PoolInfo[] = [];
  for (const pool of pools) {
    if (pool.token0 === null || pool.token1 === null) continue;
    out.push({
      id: pool.id,
      key: pool.key,
      poolType: "CL",
      token0: pool.token0,
      token1: pool.token1,
      lpFeePips: pool.lpFeePips,
      tickSpacing: pool.tickSpacing,
      hooks: pool.hooks,
    });
  }
  return out;
}

export interface SwapRecord {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly poolId: Hex;
  readonly sender: Address;
  readonly amount0: bigint;
  readonly amount1: bigint;
  /** Composed swap fee in pips, as the pool charged it on this swap. */
  readonly feePips: number;
  /** Protocol slice in pips, as it was on this swap. */
  readonly protocolFeePips: number;
}

/**
 * Swaps on the shared CL manager, newest first.
 *
 * Each record carries the fee fields from ITS OWN log rather than the
 * controller's current setting: a fee change would otherwise silently rewrite
 * history, restating what past traders paid.
 */
export async function readSwaps(poolId?: Hex, limit = 50): Promise<readonly SwapRecord[]> {
  const cfg = resolveConfig();
  const client = publicClient();

  const logs = await client.getLogs({
    address: cfg.contracts.clPoolManager,
    event: CL_SWAP_EVENT[0],
    ...(poolId === undefined ? {} : { args: { id: poolId } }),
    fromBlock: cfg.core.deployedAtBlock,
    toBlock: "latest",
  });

  return logs
    .slice(-limit)
    .reverse()
    .map((log) => ({
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      poolId: log.args.id as Hex,
      sender: log.args.sender as Address,
      amount0: log.args.amount0 as bigint,
      amount1: log.args.amount1 as bigint,
      feePips: Number(log.args.fee),
      protocolFeePips: Number(log.args.protocolFee),
    }));
}
