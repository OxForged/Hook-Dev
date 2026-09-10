/**
 * A tiny JSON-RPC log reader that stands in for DefiLlama's `options.getLogs`.
 *
 * Local harness only. It exists so the adapter can be pointed at a real node -
 * today Sepolia, tomorrow a mainnet - and produce real numbers before it is
 * submitted anywhere. It implements the subset of `FetchGetLogsOptions` the Latch
 * adapter uses (`target`, `eventAbi`, `fromBlock`, `toBlock`, default
 * `onlyArgs: true`), and nothing else.
 *
 * Decoding uses viem's `parseAbiItem` / `decodeEventLog` rather than a hand-rolled
 * decoder, and is always given the ABI of the ONE contract the logs were scoped
 * to - never a merged ABI. That is the same discipline the adapter follows for the
 * topic0 collision.
 */

import {
  decodeEventLog,
  encodeEventTopics,
  parseAbiItem,
  type AbiEvent,
  type Hex,
} from "viem";
import type { FetchGetLogsOptions } from "../dimension-adapters/adapters/types.js";

export interface RpcOptions {
  url: string;
  /** Node-imposed cap on `eth_getLogs` ranges. Sepolia publicnode caps at 50k. */
  maxBlockRange?: number;
}

export class Rpc {
  #id = 0;
  constructor(private readonly opts: RpcOptions) {}

  async call<T = any>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.opts.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.#id, method, params }),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    // Never swallow an RPC error: a silent empty result would be reported as a
    // real zero.
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    return json.result as T;
  }

  async blockNumber(): Promise<number> {
    return Number(await this.call<Hex>("eth_blockNumber", []));
  }

  async blockTimestamp(block: number): Promise<number> {
    const b = await this.call<{ timestamp: Hex }>("eth_getBlockByNumber", [
      hex(block),
      false,
    ]);
    return Number(b.timestamp);
  }

  async rawLogs(params: {
    address: string | string[];
    topics?: (Hex | null)[];
    fromBlock: number;
    toBlock: number;
  }): Promise<any[]> {
    const step = this.opts.maxBlockRange ?? 10_000;
    const out: any[] = [];
    for (let from = params.fromBlock; from <= params.toBlock; from += step) {
      const to = Math.min(from + step - 1, params.toBlock);
      const logs = await this.call<any[]>("eth_getLogs", [
        {
          address: params.address,
          ...(params.topics ? { topics: params.topics } : {}),
          fromBlock: hex(from),
          toBlock: hex(to),
        },
      ]);
      out.push(...logs);
    }
    return out;
  }
}

/**
 * Build a `getLogs` with DefiLlama's signature, backed by a real node.
 *
 * `windowFromBlock`/`windowToBlock` are the measurement window; a call that passes
 * its own `fromBlock` (the genesis Initialize scan) overrides the floor, exactly as
 * upstream does.
 */
export function makeGetLogs(
  rpc: Rpc,
  windowFromBlock: number,
  windowToBlock: number,
): (params: FetchGetLogsOptions) => Promise<any[]> {
  return async ({ target, targets, eventAbi, fromBlock, toBlock, onlyArgs = true }) => {
    if (!eventAbi) throw new Error("harness getLogs: eventAbi is required");
    const address = targets ?? target;
    if (!address) throw new Error("harness getLogs: target/targets is required");

    const abiItem = parseAbiItem(eventAbi) as AbiEvent;
    const [topic0] = encodeEventTopics({ abi: [abiItem] }) as Hex[];

    const logs = await rpc.rawLogs({
      address,
      topics: [topic0!],
      fromBlock: fromBlock ?? windowFromBlock,
      toBlock: toBlock ?? windowToBlock,
    });

    return logs.map((log) => {
      const decoded = decodeEventLog({
        abi: [abiItem],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as Record<string, unknown>;
      return onlyArgs
        ? args
        : {
            ...args,
            blockNumber: Number(log.blockNumber),
            transactionHash: log.transactionHash,
            address: log.address,
          };
    });
  };
}

const hex = (n: number): Hex => `0x${n.toString(16)}`;
