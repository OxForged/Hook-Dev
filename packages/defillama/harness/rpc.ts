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

/** JSON-RPC error code some public nodes return for a per-minute quota. */
const RATE_LIMITED = -32029;
const MAX_RATE_LIMIT_RETRIES = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Rpc {
  #id = 0;
  constructor(private readonly opts: RpcOptions) {}

  async call<T = any>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.opts.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.#id, method, params }),
      });
      // The same quota can arrive as an HTTP 429 with no JSON body at all.
      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 10_000) + 500);
        continue;
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const json = (await res.json()) as {
        result?: T;
        error?: { code?: number; message: string; data?: { retry_after_ms?: number } };
      };
      if (!json.error) return json.result as T;
      // A quota response is not data. Wait it out the number of times a paced
      // live test can need, then fail loudly - never return an empty result.
      if (json.error.code === RATE_LIMITED && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep((json.error.data?.retry_after_ms ?? 10_000) + 500);
        continue;
      }
      // Never swallow an RPC error: a silent empty result would be reported as a
      // real zero.
      throw new Error(`${method}: ${json.error.message}`);
    }
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
