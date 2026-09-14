import { isDynamicLPFee } from "@latchprotocol/sdk";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../lib/errors.js";
import { executionPrice, formatUnitsExact, ratioToDecimal, toBigInt } from "../lib/units.js";

/**
 * DEX Screener HTTP adapter endpoints.
 *
 * Shape follows DEX Screener's "Adapter Specs": /latest-block, /asset, /pair,
 * /events. The official spec is a JS-rendered Notion page that could not be
 * fetched from this environment on 2026-09-13 (docs.dexscreener.com no longer
 * carries it; its DEX-listing page routes submissions to Discord). Field names
 * below were cross-checked against a public adapter implementing the same spec
 * (balancer/balancer-v3-dex-screener-api). VERIFY AGAINST THE SPEC DEX SCREENER
 * HANDS OVER AT SUBMISSION before announcing the endpoint.
 *
 * Rules applied:
 *   * latest-block is the last FULLY indexed block, never the chain head, so
 *     /events never serves a block the indexer has not completed.
 *   * Amounts are decimalized (token units) as exact decimal strings.
 *   * priceNative = asset1 per 1 asset0, the swap's execution price.
 *   * Events ordered by block, then transaction index, then log index.
 *   * Only swaps are emitted. CL ModifyLiquidity logs carry a liquidity delta, not
 *     token amounts, so join/exit amounts cannot be stated without computing them
 *     from ticks and price; they are omitted rather than approximated. `reserves`
 *     is omitted for the same reason (the Vault is a singleton; per-pool balances
 *     are not in any log).
 */

export class DexScreenerService {
  constructor(private readonly prisma: PrismaClient) {}

  async latestBlock(chainId: number) {
    const cp = await this.prisma.indexerCheckpoint.findUnique({ where: { chainId } });
    if (!cp) throw ApiError.notIndexed(chainId);
    return {
      block: { blockNumber: Number(cp.lastIndexedBlock), blockTimestamp: Math.floor(cp.lastIndexedBlockTimestamp.getTime() / 1000) },
    };
  }

  async asset(chainId: number, id: string) {
    const t = await this.prisma.token.findUnique({ where: { chainId_address: { chainId, address: id } } });
    if (!t || t.symbol === null || t.name === null) throw ApiError.notFound(`Asset ${id}`);
    return {
      asset: {
        id: t.address,
        name: t.name,
        symbol: t.symbol,
        ...(t.totalSupply !== null && t.decimals !== null ? { totalSupply: formatUnitsExact(toBigInt(t.totalSupply), t.decimals) } : {}),
      },
    };
  }

  async pair(chainId: number, id: string) {
    const p = await this.prisma.pool.findUnique({ where: { chainId_poolId: { chainId, poolId: id } } });
    if (!p) throw ApiError.notFound(`Pair ${id}`);
    const dynamic = isDynamicLPFee(p.fee);
    return {
      pair: {
        id: p.poolId,
        dexKey: "latch",
        asset0Id: p.currency0,
        asset1Id: p.currency1,
        createdAtBlockNumber: Number(p.blockNumber),
        createdAtBlockTimestamp: Math.floor(p.blockTimestamp.getTime() / 1000),
        createdAtTxnId: p.txHash,
        // Pips / 100 = bps. A dynamic-fee pool has no single fee to report.
        ...(dynamic ? {} : { feeBps: p.fee / 100 }),
        metadata: {
          poolType: p.poolType,
          poolManager: p.poolManager,
          hooks: p.hooks,
          dynamicFee: String(dynamic),
        },
      },
    };
  }

  async events(chainId: number, fromBlock: bigint, toBlock: bigint, maxRange: number) {
    const cp = await this.prisma.indexerCheckpoint.findUnique({ where: { chainId } });
    if (!cp) throw ApiError.notIndexed(chainId);
    if (toBlock < fromBlock) throw ApiError.badRequest("toBlock must be >= fromBlock");
    if (toBlock - fromBlock + 1n > BigInt(maxRange)) throw ApiError.badRequest(`Block range exceeds ${maxRange}`);
    const to = toBlock > cp.lastIndexedBlock ? cp.lastIndexedBlock : toBlock;
    if (to < fromBlock) return { events: [], servedToBlock: Number(cp.lastIndexedBlock) };

    const swaps = await this.prisma.swap.findMany({
      where: { chainId, blockNumber: { gte: fromBlock, lte: to } },
      orderBy: [{ blockNumber: "asc" }, { txIndex: "asc" }, { logIndex: "asc" }],
      include: { pool: { select: { currency0: true, currency1: true } } },
      take: 20_000,
    });
    if (swaps.length === 20_000) throw ApiError.badRequest("Range holds more than 20000 events; request a smaller range");
    const addrs = [...new Set(swaps.flatMap((s) => [s.pool.currency0, s.pool.currency1]))];
    const tokens = new Map(
      (await this.prisma.token.findMany({ where: { chainId, address: { in: addrs } }, select: { address: true, decimals: true } })).map((t) => [t.address, t.decimals]),
    );

    const events = [];
    let skipped = 0;
    for (const s of swaps) {
      const d0 = tokens.get(s.pool.currency0);
      const d1 = tokens.get(s.pool.currency1);
      const a0 = toBigInt(s.amount0);
      const a1 = toBigInt(s.amount1);
      const price = d0 != null && d1 != null ? executionPrice(a0, a1, d0, d1) : null;
      if (d0 == null || d1 == null || !price) {
        skipped += 1;
        continue;
      }
      const abs = (v: bigint) => (v < 0n ? -v : v);
      // Caller-side sign: negative = paid in.
      const leg0 = a0 < 0n ? { asset0In: formatUnitsExact(abs(a0), d0) } : { asset0Out: formatUnitsExact(a0, d0) };
      const leg1 = a1 < 0n ? { asset1In: formatUnitsExact(abs(a1), d1) } : { asset1Out: formatUnitsExact(a1, d1) };
      events.push({
        block: { blockNumber: Number(s.blockNumber), blockTimestamp: Math.floor(s.blockTimestamp.getTime() / 1000) },
        eventType: "swap",
        txnId: s.txHash,
        txnIndex: s.txIndex,
        eventIndex: s.logIndex,
        maker: s.txFrom ?? s.sender,
        pairId: s.poolId,
        ...leg0,
        ...leg1,
        priceNative: ratioToDecimal(price, 18),
      });
    }
    return { events, servedToBlock: Number(to), skippedWithoutDecimals: skipped };
  }
}
