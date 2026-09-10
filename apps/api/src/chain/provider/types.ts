import type { Hex } from "viem";
import type { ContractRef } from "../contracts.js";

/**
 * ============================================================================
 *  THE MOCK / LIVE BOUNDARY
 * ============================================================================
 *
 * This file is the entire seam between "reads a blockchain" and "reads a
 * fixture". Everything above it — the ingestion service, the decoders, the
 * repositories, the REST layer — is written against `ChainLogProvider` and has
 * no idea which implementation it is talking to.
 *
 * Two implementations exist:
 *
 *   FixtureChainLogProvider (./fixture.ts)
 *     Serves hand-written logs from ../fixtures. THE DEFAULT, because no
 *     LatchProtocol contract is deployed on any chain. Every row it produces is
 *     stamped `dataSource: FIXTURE` in the database and reported as
 *     `"fixture"` in API responses.
 *
 *   RpcChainLogProvider (./rpc.ts)
 *     Real `eth_getLogs` over viem. Fully implemented; it simply has nothing to
 *     point at yet. It activates the moment RPC_URL_<chainId> is set and the
 *     chain has Vault / pool manager addresses recorded.
 *
 * To go live: deploy, record the addresses, set the RPC URL, set
 * CHAIN_PROVIDER=auto. No code above this interface changes.
 */

export type ProviderKind = "fixture" | "rpc";

/** A log as returned by a provider, already joined to its block timestamp. */
export interface RawLog {
  /** Emitting contract, lowercased. Required to disambiguate colliding topic0s. */
  readonly address: Hex;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  /** Unix seconds. Providers are responsible for resolving this. */
  readonly blockTimestamp: bigint;
  readonly transactionHash: Hex;
  readonly logIndex: number;
}

export interface LogQuery {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  /** Restrict to these emitting addresses. Empty means "no contracts known". */
  readonly contracts: readonly ContractRef[];
}

export interface ChainLogProvider {
  readonly kind: ProviderKind;
  readonly chainId: number;

  /** Highest block this provider will serve logs up to. */
  getLatestBlockNumber(): Promise<bigint>;

  /**
   * Logs in `[fromBlock, toBlock]` emitted by the given contracts, ordered by
   * (blockNumber, logIndex) ascending.
   */
  getLogs(query: LogQuery): Promise<RawLog[]>;

  /** One-line description for logs and the /health/ready payload. */
  describe(): string;
}
