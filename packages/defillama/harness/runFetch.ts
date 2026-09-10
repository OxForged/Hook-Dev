/**
 * Run a dimension adapter's `fetch` against a real node.
 *
 * Local harness only. It assembles the parts of `FetchOptions` the Latch adapter
 * reads and nothing more, so a missing field fails loudly here rather than
 * producing a plausible-looking number.
 */

import type { FetchOptions, FetchResultV2 } from "../dimension-adapters/adapters/types.js";
import { Balances } from "./balances.js";
import { makeGetLogs, Rpc } from "./rpc.js";

export interface RunOptions {
  chain: string;
  rpcUrl: string;
  fromBlock: number;
  toBlock: number;
  maxBlockRange?: number;
}

export async function runFetch(
  fetch: (options: FetchOptions) => Promise<FetchResultV2>,
  opts: RunOptions,
): Promise<FetchResultV2> {
  const rpc = new Rpc({ url: opts.rpcUrl, maxBlockRange: opts.maxBlockRange });
  const [fromTimestamp, toTimestamp] = await Promise.all([
    rpc.blockTimestamp(opts.fromBlock),
    rpc.blockTimestamp(opts.toBlock),
  ]);

  const notImplemented = (name: string) => () => {
    throw new Error(`harness: ${name} is not implemented - the adapter should not need it`);
  };

  const api = {
    chain: opts.chain,
    block: opts.toBlock,
    multiCall: notImplemented("api.multiCall"),
    call: notImplemented("api.call"),
  };

  const options: FetchOptions = {
    chain: opts.chain,
    createBalances: () => new Balances({ chain: opts.chain, timestamp: toTimestamp }),
    getLogs: makeGetLogs(rpc, opts.fromBlock, opts.toBlock),
    api,
    fromApi: { ...api, block: opts.fromBlock },
    toApi: { ...api, block: opts.toBlock },
    fromTimestamp,
    toTimestamp,
    startTimestamp: fromTimestamp,
    endTimestamp: toTimestamp,
    startOfDay: Math.floor(fromTimestamp / 86400) * 86400,
    dateString: new Date(fromTimestamp * 1000).toISOString().slice(0, 10),
    getFromBlock: async () => opts.fromBlock,
    getToBlock: async () => opts.toBlock,
  };

  return fetch(options);
}
