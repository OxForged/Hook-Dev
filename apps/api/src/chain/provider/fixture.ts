import { normalizeAddress } from "../contracts.js";
import { FIXTURE_CHAIN_ID, fixtureHeadBlock, fixtureLogs } from "../fixtures/devnet.js";
import type { ChainLogProvider, LogQuery, RawLog } from "./types.js";

/**
 * The mock side of the chain-data boundary.
 *
 * Serves the fixture timeline from ../fixtures/devnet.ts as though it were an
 * `eth_getLogs` result: same shape, same ordering, same block-range semantics,
 * so the ingestion service cannot tell the difference. It is the default
 * provider because LatchProtocol is not deployed anywhere.
 *
 * It intentionally does NOT pretend to be a real chain in one respect: the head
 * block stops advancing once the fixture timeline runs out. A poll job will
 * therefore reach the end and then do nothing, rather than inventing new
 * activity forever.
 */
export class FixtureChainLogProvider implements ChainLogProvider {
  readonly kind = "fixture" as const;
  readonly chainId: number;

  constructor(chainId: number = FIXTURE_CHAIN_ID) {
    this.chainId = chainId;
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return fixtureHeadBlock();
  }

  async getLogs(query: LogQuery): Promise<RawLog[]> {
    const wanted = new Set(query.contracts.map((c) => normalizeAddress(c.address)));
    if (wanted.size === 0) return [];

    return fixtureLogs().filter(
      (log) =>
        log.blockNumber >= query.fromBlock &&
        log.blockNumber <= query.toBlock &&
        wanted.has(normalizeAddress(log.address)),
    );
  }

  describe(): string {
    return `fixture provider (chain ${this.chainId}, ${fixtureLogs().length} synthetic logs up to block ${fixtureHeadBlock()})`;
  }
}
