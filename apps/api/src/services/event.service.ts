import type { PrismaClient } from "@prisma/client";
import { toPage, type Cursor, type Page } from "../lib/pagination.js";
import { EventRepository, type SwapFilters } from "../repositories/event.repository.js";

/**
 * Event feeds.
 *
 * Deliberately NOT cached. These are keyset-paginated append-only reads that
 * already cost one index seek, and caching a cursor-addressed page buys almost
 * nothing while making the freshest data — the reason anyone opens an explorer
 * — arbitrarily stale.
 */
export class EventService {
  private readonly repo: EventRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new EventRepository(prisma);
  }

  async swaps(filters: SwapFilters): Promise<Page<ReturnType<EventService["toSwapDto"]>>> {
    const rows = await this.repo.listSwaps(filters);
    const page = toPage(rows, filters.limit, (r) => r.blockTimestamp);
    return {
      ...page,
      items: page.items.map((r) => this.toSwapDto(r)),
    };
  }

  async liquidityChanges(filters: SwapFilters) {
    const rows = await this.repo.listLiquidityChanges(filters);
    const page = toPage(rows, filters.limit, (r) => r.blockTimestamp);
    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        chainId: r.chainId,
        pool: r.pool,
        poolType: r.poolType,
        changeType: r.changeType,
        sender: r.sender,
        salt: r.salt,
        cl: {
          tickLower: r.tickLower,
          tickUpper: r.tickUpper,
          liquidityDelta: r.liquidityDelta,
        },
        bin: {
          binIds: r.binIds,
          // Opaque on purpose — see the note on LiquidityChange.binAmounts.
          // Each word packs an (amount0, amount1) pair under PackedUint128Math;
          // it is surfaced raw rather than decoded to a possibly-wrong number.
          packedAmounts: r.binAmounts,
          packedCompositionFee: r.compositionFeeAmount,
          packedFeeToProtocol: r.feeAmountToProtocol,
          encoding: "PackedUint128Math bytes32 — not decoded by this API",
        },
        emittedBy: r.contract,
        topic0: r.topic0,
        txHash: r.txHash,
        blockNumber: r.blockNumber,
        blockTimestamp: r.blockTimestamp,
        logIndex: r.logIndex,
        dataSource: r.dataSource.toLowerCase(),
      })),
    };
  }

  async protocolFeeChanges(filters: {
    chainId?: number;
    poolId?: string;
    source?: never | undefined;
    limit: number;
    cursor?: Cursor;
  }) {
    const rows = await this.repo.listProtocolFeeChanges(filters);
    const page = toPage(rows, filters.limit, (r) => r.blockTimestamp);
    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        chainId: r.chainId,
        source: r.source,
        pool: r.pool,
        // Load-bearing, not cosmetic: ProtocolFeeUpdated is emitted with an
        // identical topic0 by both pool managers, so the emitting address is
        // the only field that says which pool type this row describes.
        emittedBy: r.contract,
        topic0: r.topic0,
        protocolFee: {
          packed: r.protocolFeeRaw,
          zeroForOnePips: r.protocolFeeZeroForOne,
          oneForZeroPips: r.protocolFeeOneForZero,
        },
        isSet: r.isSet,
        lpFeeTier: r.lpFeeTier,
        disabled: r.disabled,
        controller: r.controller,
        txHash: r.txHash,
        blockNumber: r.blockNumber,
        blockTimestamp: r.blockTimestamp,
        logIndex: r.logIndex,
        dataSource: r.dataSource.toLowerCase(),
      })),
    };
  }

  async vaultTokenEvents(filters: {
    chainId?: number;
    kind?: "TRANSFER" | "APPROVAL" | "OPERATOR_SET";
    currency?: string;
    limit: number;
    cursor?: Cursor;
  }) {
    const rows = await this.repo.listVaultTokenEvents(filters);
    const page = toPage(rows, filters.limit, (r) => r.blockTimestamp);
    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        chainId: r.chainId,
        kind: r.kind,
        caller: r.caller,
        from: r.from,
        to: r.to,
        owner: r.owner,
        spender: r.spender,
        operator: r.operator,
        approved: r.approved,
        currency: r.currency,
        amount: r.amount,
        emittedBy: r.contract,
        txHash: r.txHash,
        blockNumber: r.blockNumber,
        blockTimestamp: r.blockTimestamp,
        logIndex: r.logIndex,
        dataSource: r.dataSource.toLowerCase(),
      })),
    };
  }

  private toSwapDto(r: Awaited<ReturnType<EventRepository["listSwaps"]>>[number]) {
    return {
      id: r.id,
      chainId: r.chainId,
      pool: {
        id: r.pool.id,
        poolId: r.pool.poolId,
        poolType: r.pool.poolType,
        token0: r.pool.token0,
        token1: r.pool.token1,
        hooksAddress: r.pool.hooksAddress,
      },
      poolType: r.poolType,
      sender: r.sender,
      // Signed from the pool's point of view: the input side is positive.
      amount0: r.amount0,
      amount1: r.amount1,
      zeroForOne: r.zeroForOne,
      feePips: r.fee,
      protocolFeePacked: r.protocolFee,
      cl: { sqrtPriceX96: r.sqrtPriceX96, tick: r.tick, liquidity: r.liquidity },
      bin: { activeId: r.activeId },
      emittedBy: r.contract,
      topic0: r.topic0,
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      blockTimestamp: r.blockTimestamp,
      logIndex: r.logIndex,
      dataSource: r.dataSource.toLowerCase(),
    };
  }
}
