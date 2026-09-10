import { createPublicClient, http, type PublicClient, type Hex } from "viem";
import { logger } from "../../config/logger.js";
import { normalizeAddress } from "../contracts.js";
import type { ChainLogProvider, LogQuery, RawLog } from "./types.js";

/**
 * The live side of the chain-data boundary.
 *
 * This is a complete implementation — it is not a stub. It reads real logs over
 * `eth_getLogs` and resolves each log's block timestamp. What it lacks is
 * somewhere to point: no LatchProtocol contract is deployed on any chain yet, so
 * nothing configures it in practice.
 *
 * The moment a deployment exists, the switch is configuration only:
 *   1. record the Vault / pool manager addresses on the Chain row,
 *   2. set RPC_URL_<chainId>,
 *   3. set CHAIN_PROVIDER=auto (or rpc).
 * Nothing above `ChainLogProvider` changes.
 */
export class RpcChainLogProvider implements ChainLogProvider {
  readonly kind = "rpc" as const;
  readonly chainId: number;

  private readonly client: PublicClient;
  private readonly rpcUrl: string;
  /** blockNumber -> unix seconds. Bounded; one entry per block in a window. */
  private readonly timestampCache = new Map<bigint, bigint>();

  constructor(chainId: number, rpcUrl: string) {
    this.chainId = chainId;
    this.rpcUrl = rpcUrl;
    this.client = createPublicClient({
      transport: http(rpcUrl, { batch: true, retryCount: 3, timeout: 20_000 }),
    });
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getLogs(query: LogQuery): Promise<RawLog[]> {
    if (query.contracts.length === 0) return [];

    const addresses = query.contracts.map((c) => normalizeAddress(c.address));

    // One request for every watched address. Topics are deliberately NOT
    // filtered: the address is what disambiguates this protocol's events (see
    // the collision note in ../contracts.ts), and an address-scoped query is
    // already narrow enough.
    const logs = await this.client.getLogs({
      address: addresses as Hex[],
      fromBlock: query.fromBlock,
      toBlock: query.toBlock,
    });

    const blocks = [...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => b !== null))];
    await this.warmTimestamps(blocks);

    const out: RawLog[] = [];
    for (const log of logs) {
      if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
        // Pending logs have null positional fields. Nothing to index yet.
        continue;
      }
      const blockTimestamp = this.timestampCache.get(log.blockNumber);
      if (blockTimestamp === undefined) {
        logger.warn(
          { chainId: this.chainId, block: log.blockNumber.toString() },
          "no timestamp for block; skipping log",
        );
        continue;
      }
      out.push({
        address: normalizeAddress(log.address),
        topics: log.topics as readonly Hex[],
        data: log.data,
        blockNumber: log.blockNumber,
        blockTimestamp,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      });
    }

    out.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    );
    return out;
  }

  /**
   * Resolve block timestamps for the blocks a log batch touched.
   *
   * `eth_getLogs` does not return timestamps, and fetching one block per log
   * would be O(logs) round trips. Fetching one per distinct block is O(blocks),
   * and viem's HTTP batching collapses those into few requests.
   */
  private async warmTimestamps(blocks: readonly bigint[]): Promise<void> {
    const missing = blocks.filter((b) => !this.timestampCache.has(b));
    if (missing.length === 0) return;

    const results = await Promise.all(
      missing.map(async (blockNumber) => {
        const block = await this.client.getBlock({ blockNumber, includeTransactions: false });
        return [blockNumber, block.timestamp] as const;
      }),
    );

    for (const [blockNumber, timestamp] of results) {
      this.timestampCache.set(blockNumber, timestamp);
    }

    // Keep the cache from growing without bound across a long backfill.
    if (this.timestampCache.size > 20_000) {
      const keys = [...this.timestampCache.keys()].sort((a, b) => (a < b ? -1 : 1));
      for (const k of keys.slice(0, keys.length - 10_000)) this.timestampCache.delete(k);
    }
  }

  describe(): string {
    // Never log the URL itself: RPC endpoints usually carry an API key.
    let host = "unknown";
    try {
      host = new URL(this.rpcUrl).host;
    } catch {
      /* keep the placeholder */
    }
    return `rpc provider (chain ${this.chainId}, endpoint host ${host})`;
  }
}
