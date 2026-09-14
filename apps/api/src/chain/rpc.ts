import { latchTransport, resolveEndpoints } from "@latchprotocol/sdk";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { env } from "../config/env.js";
import { hostOf, logger } from "../config/logger.js";
import type { RawLog } from "./decode.js";

/**
 * RPC access for the WORKER ONLY. No HTTP route imports this module.
 *
 * Endpoints come from the SDK (`resolveEndpoints`: `LATCH_RPC_<chainId>` from
 * the environment first, then the probed public list). Log reads follow the
 * approach `apps/web/src/lib/protocolActivity.ts` measured on Robinhood: ask
 * each endpoint for the WHOLE span in one request, fall through on refusal, and
 * remember the endpoint that answered. Spans shrink (halving) only when every
 * endpoint refuses. `rpc.mainnet.chain.robinhood.com` answered eth_getLogs for
 * 2,300,000 blocks in one request on 2026-09-13; others refuse far smaller.
 */

export interface ChainRpc {
  readonly chainId: number;
  /** Failover client for state reads (eth_call, getBlock, getBalance). */
  readonly reads: PublicClient;
  getLogs(params: { addresses: Hex[]; topics: Hex[]; fromBlock: bigint; toBlock: bigint }): Promise<{ logs: RawLog[]; host: string }>;
  /**
   * A block by number from ANY endpoint that has it. Public endpoints lag each
   * other by seconds; a "block not found" from one is not an answer, and viem's
   * fallback transport does not treat a null result as a failure.
   */
  getBlockAny(blockNumber: bigint): Promise<{ number: bigint; hash: Hex; timestamp: bigint }>;
  hosts(): string[];
}

const cache = new Map<number, ChainRpc>();

export function chainRpc(chainId: number): ChainRpc {
  const hit = cache.get(chainId);
  if (hit) return hit;
  const made = buildChainRpc(chainId, resolveEndpoints(chainId, process.env));
  cache.set(chainId, made);
  return made;
}

export function buildChainRpc(chainId: number, urls: readonly string[]): ChainRpc {
  if (urls.length === 0) throw new Error(`no RPC endpoints for chain ${chainId}`);
  const reads = createPublicClient({
    transport: latchTransport(chainId, { env: process.env, timeout: env.RPC_TIMEOUT_MS, retryCount: 2 }),
  }) as PublicClient;

  const single = new Map<string, PublicClient>();
  const clientFor = (url: string): PublicClient => {
    let c = single.get(url);
    if (!c) {
      // retryCount 0: a refusal must fall straight through to the next endpoint.
      c = createPublicClient({ transport: http(url, { timeout: env.RPC_TIMEOUT_MS, retryCount: 0 }) }) as PublicClient;
      single.set(url, c);
    }
    return c;
  };
  let preferred: string | undefined;

  return {
    chainId,
    reads,
    hosts: () => urls.map(hostOf),
    async getBlockAny(blockNumber) {
      const order = preferred ? [preferred, ...urls.filter((u) => u !== preferred)] : [...urls];
      const refusals: string[] = [];
      for (const url of order) {
        try {
          const b = await clientFor(url).getBlock({ blockNumber });
          if (b.hash && b.number !== null) return { number: b.number, hash: b.hash.toLowerCase() as Hex, timestamp: b.timestamp };
        } catch (err) {
          refusals.push(`${hostOf(url)}: ${shortError(err)}`);
        }
      }
      throw new Error(`no endpoint returned block ${blockNumber} (${refusals.slice(0, 3).join("; ")})`);
    },
    async getLogs({ addresses, topics, fromBlock, toBlock }) {
      const order = preferred ? [preferred, ...urls.filter((u) => u !== preferred)] : [...urls];
      const refusals: string[] = [];
      for (const url of order) {
        try {
          const raw = await clientFor(url).request({
            method: "eth_getLogs",
            params: [
              {
                address: addresses,
                topics: [topics],
                fromBlock: `0x${fromBlock.toString(16)}`,
                toBlock: `0x${toBlock.toString(16)}`,
              },
            ],
          });
          preferred = url;
          return { logs: normaliseLogs(raw as unknown[]), host: hostOf(url) };
        } catch (err) {
          refusals.push(`${hostOf(url)}: ${shortError(err)}`);
        }
      }
      logger.warn({ chainId, fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), refusals }, "every endpoint refused eth_getLogs span");
      throw new LogSpanRefusedError(fromBlock, toBlock, refusals);
    },
  };
}

export class LogSpanRefusedError extends Error {
  constructor(
    readonly fromBlock: bigint,
    readonly toBlock: bigint,
    readonly refusals: string[],
  ) {
    super(`no endpoint served eth_getLogs [${fromBlock}, ${toBlock}]`);
    this.name = "LogSpanRefusedError";
  }
}

function shortError(err: unknown): string {
  const msg = err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
  // First line only, and never anything that looks like a URL (it may carry a key).
  return (msg.split("\n")[0] ?? "").replace(/https?:\/\/\S+/g, "<url>").slice(0, 200);
}

interface JsonLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string | null;
  blockHash: string | null;
  transactionHash: string | null;
  transactionIndex: string | null;
  logIndex: string | null;
  removed?: boolean;
}

/** JSON-RPC log objects -> RawLog, dropping pending and removed entries, sorted. */
export function normaliseLogs(raw: unknown[]): RawLog[] {
  const out: RawLog[] = [];
  for (const item of raw as JsonLog[]) {
    if (item.removed) continue;
    if (item.blockNumber === null || item.transactionHash === null || item.logIndex === null || item.blockHash === null) continue;
    out.push({
      address: item.address.toLowerCase() as Hex,
      topics: item.topics.map((t) => t.toLowerCase() as Hex),
      data: item.data as Hex,
      blockNumber: BigInt(item.blockNumber),
      blockHash: item.blockHash.toLowerCase() as Hex,
      transactionHash: item.transactionHash.toLowerCase() as Hex,
      transactionIndex: item.transactionIndex === null ? 0 : Number(BigInt(item.transactionIndex)),
      logIndex: Number(BigInt(item.logIndex)),
    });
  }
  out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return out;
}
