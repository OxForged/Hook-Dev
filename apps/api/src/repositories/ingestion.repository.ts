import {
  decodeBinPoolParameters,
  decodeCLPoolParameters,
  isDynamicLPFee,
} from "@latchprotocol/sdk";
import { DataSource, Prisma, type PrismaClient } from "@prisma/client";
import type { Hex } from "viem";
import { normalizeAddress, type ContractRef } from "../chain/contracts.js";
import type {
  AppRegisteredEvent,
  DonateEvent,
  DynamicLpFeeEvent,
  LiquidityChangeEvent,
  PoolInitializedEvent,
  ProtocolEvent,
  ProtocolFeeChangeEvent,
  SwapEvent,
  VaultTokenEvent,
} from "../chain/decode.js";
import { logger } from "../config/logger.js";
import { addressRowId, clPositionRowId, poolRowId } from "../lib/ids.js";
import { toDecimal } from "../lib/serialize.js";

/**
 * Writes decoded events into Postgres.
 *
 * Two invariants shape everything here:
 *
 *   1. IDEMPOTENCE. Ingestion re-reads block ranges after a crash, a reorg, or
 *      an operator-triggered backfill. Every write is an upsert keyed on a
 *      deterministic id, so replaying a window is a no-op rather than a
 *      duplicate. Counters are the one exception and are handled below.
 *
 *   2. PROVENANCE. Every row records `dataSource` and the emitting `contract`
 *      address. The second is load-bearing, not decorative: `ProtocolFeeUpdated`
 *      and friends are byte-identical across the CL and bin managers, so the
 *      address is the only thing that says which pool type a row describes.
 *
 * Counter maintenance (`Pool.swapCount`, `volumeToken0`, ...) is deliberately
 * NOT idempotent — incrementing on replay would double-count. It is therefore
 * driven by `createMany({ skipDuplicates: true })`, whose reported count tells
 * us how many rows were genuinely new, and only those are folded into totals.
 */

export interface ApplyResult {
  written: number;
  skippedDuplicates: number;
}

type Tx = Prisma.TransactionClient;

export class IngestionRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Apply a decoded batch. Runs in one transaction so a window is all-or-nothing
   * with respect to the cursor advance that follows it.
   */
  async applyBatch(
    chainId: number,
    events: readonly ProtocolEvent[],
    contracts: readonly ContractRef[],
  ): Promise<ApplyResult> {
    if (events.length === 0) return { written: 0, skippedDuplicates: 0 };

    return this.prisma.$transaction(
      async (tx) => {
        const result: ApplyResult = { written: 0, skippedDuplicates: 0 };

        // Pool creation must land before anything that references a pool, and
        // events arrive in block order, so a single ordered pass is correct.
        for (const event of events) {
          switch (event.kind) {
            case "AppRegistered":
              result.written += await this.applyAppRegistered(tx, event, contracts);
              break;
            case "PoolInitialized":
              result.written += await this.applyPoolInitialized(tx, event);
              break;
            case "Swap":
              result.written += await this.applySwap(tx, event);
              break;
            case "LiquidityChange":
              result.written += await this.applyLiquidityChange(tx, event);
              break;
            case "Donate":
              result.written += await this.applyDonate(tx, event);
              break;
            case "DynamicLpFee":
              result.written += await this.applyDynamicLpFee(tx, event);
              break;
            case "ProtocolFeeChange":
              result.written += await this.applyProtocolFeeChange(tx, event);
              break;
            case "VaultToken":
              result.written += await this.applyVaultToken(tx, event);
              break;
          }
        }

        return result;
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  // -------------------------------------------------------------------------
  // Reference data
  // -------------------------------------------------------------------------

  /** Ensure a Token row exists. Symbol/decimals are filled in by the seeder. */
  private async ensureToken(tx: Tx, chainId: number, address: Hex): Promise<string> {
    const id = addressRowId(chainId, address);
    await tx.token.upsert({
      where: { id },
      create: {
        id,
        chainId,
        address: normalizeAddress(address),
        isNative: /^0x0+$/.test(address),
        dataSource: this.dataSource,
      },
      update: {},
    });
    return id;
  }

  /**
   * Ensure a Hook row exists and record the bitmap this pool uses.
   *
   * `observedBitmaps` is an array because one hook address can back pools with
   * different permission sets — a direct consequence of permissions living in
   * the pool key rather than in the hook's address.
   */
  private async ensureHook(
    tx: Tx,
    chainId: number,
    address: Hex,
    bitmap: number,
    at: Date,
    block: bigint,
  ): Promise<string | null> {
    if (/^0x0+$/.test(address)) return null; // hookless pool

    const id = addressRowId(chainId, address);
    const existing = await tx.hook.findUnique({ where: { id }, select: { observedBitmaps: true } });

    if (!existing) {
      await tx.hook.create({
        data: {
          id,
          chainId,
          address: normalizeAddress(address),
          observedBitmaps: [bitmap],
          poolCount: 0,
          firstSeenBlock: block,
          firstSeenAt: at,
          dataSource: this.dataSource,
        },
      });

      // A registry listing may already name this address on this chain. Attach
      // it now that the hook has actually been observed, so the marketplace can
      // show real pool and swap counts against the listing without a re-seed.
      await tx.hookRegistryDeployment.updateMany({
        where: { chainId, address: normalizeAddress(address), hookId: null },
        data: { hookId: id },
      });

      return id;
    }

    if (!existing.observedBitmaps.includes(bitmap)) {
      await tx.hook.update({
        where: { id },
        data: { observedBitmaps: { push: bitmap } },
      });
    }
    return id;
  }

  /** Resolve a pool id to its row, or null when the Initialize was never seen. */
  private async findPool(tx: Tx, chainId: number, poolId: Hex) {
    return tx.pool.findUnique({
      where: { id: poolRowId(chainId, poolId) },
      select: { id: true, hookId: true, poolType: true },
    });
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private async applyAppRegistered(
    tx: Tx,
    event: AppRegisteredEvent,
    contracts: readonly ContractRef[],
  ): Promise<number> {
    const { meta } = event;
    const vaultId = addressRowId(meta.chainId, meta.contract);

    await tx.vault.upsert({
      where: { id: vaultId },
      create: {
        id: vaultId,
        chainId: meta.chainId,
        address: meta.contract,
        registeredAppCount: 0,
        deployedAtBlock: meta.blockNumber,
      },
      update: {},
    });

    const created = await tx.appRegistration.createMany({
      data: [
        {
          id: meta.id,
          chainId: meta.chainId,
          vaultId,
          app: event.app,
          txHash: meta.txHash,
          blockNumber: meta.blockNumber,
          blockTimestamp: meta.blockTimestamp,
          logIndex: meta.logIndex,
          contract: meta.contract,
          topic0: meta.topic0,
          dataSource: this.dataSource,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) return 0;

    await tx.vault.update({
      where: { id: vaultId },
      data: { registeredAppCount: { increment: 1 } },
    });

    // The registered app is a pool manager if we know it as one.
    const ref = contracts.find((c) => normalizeAddress(c.address) === event.app);
    if (ref && (ref.role === "CLPoolManager" || ref.role === "BinPoolManager")) {
      const pmId = addressRowId(meta.chainId, event.app);
      await tx.poolManager.upsert({
        where: { id: pmId },
        create: {
          id: pmId,
          chainId: meta.chainId,
          address: event.app,
          poolType: ref.role === "CLPoolManager" ? "CL" : "BIN",
          vaultId,
          deployedAtBlock: meta.blockNumber,
        },
        update: { vaultId },
      });
    }

    return 1;
  }

  private async applyPoolInitialized(tx: Tx, event: PoolInitializedEvent): Promise<number> {
    const { meta } = event;
    const id = poolRowId(meta.chainId, event.poolId);

    const existing = await tx.pool.findUnique({ where: { id }, select: { id: true } });
    if (existing) return 0;

    // Decoding the parameters word also validates it: the SDK throws when bits
    // above the pool type's config range are dirty, which is the same check
    // `ParametersHelper.checkUnusedBitsAllZero` performs on-chain.
    const decoded =
      event.poolType === "CL"
        ? decodeCLPoolParameters(event.parameters)
        : decodeBinPoolParameters(event.parameters);
    const bitmap = decoded.hooksRegistrationBitmap;

    const [token0Id, token1Id] = await Promise.all([
      this.ensureToken(tx, meta.chainId, event.currency0),
      this.ensureToken(tx, meta.chainId, event.currency1),
    ]);
    const hookId = await this.ensureHook(
      tx,
      meta.chainId,
      event.hooks,
      bitmap,
      meta.blockTimestamp,
      meta.blockNumber,
    );

    const poolManagerId = addressRowId(meta.chainId, meta.contract);
    await tx.poolManager.upsert({
      where: { id: poolManagerId },
      create: {
        id: poolManagerId,
        chainId: meta.chainId,
        address: meta.contract,
        poolType: event.poolType,
      },
      update: {},
    });

    const dynamic = isDynamicLPFee(event.fee);

    await tx.pool.create({
      data: {
        id,
        chainId: meta.chainId,
        poolId: event.poolId,
        poolType: event.poolType,
        poolManagerId,
        token0Id,
        token1Id,
        currency0: event.currency0,
        currency1: event.currency1,
        hookId,
        hooksAddress: event.hooks,
        feeRaw: event.fee,
        staticLpFee: dynamic ? null : event.fee,
        isDynamicFee: dynamic,
        parameters: event.parameters,
        hooksRegistrationBitmap: bitmap,
        tickSpacing: "tickSpacing" in decoded ? decoded.tickSpacing : null,
        binStep: "binStep" in decoded ? decoded.binStep : null,
        // A dynamic-fee pool starts at 0 and its hook sets the real value in
        // afterInitialize — see LPFeeLibrary.getInitialLPFee.
        currentLpFee: dynamic ? 0 : event.fee,
        sqrtPriceX96: event.sqrtPriceX96 !== undefined ? toDecimal(event.sqrtPriceX96) : null,
        tick: event.tick ?? null,
        activeId: event.activeId ?? null,
        createdAtBlock: meta.blockNumber,
        createdAtTimestamp: meta.blockTimestamp,
        createdAtTx: meta.txHash,
        lastEventAt: meta.blockTimestamp,
        dataSource: this.dataSource,
      },
    });

    await tx.poolManager.update({
      where: { id: poolManagerId },
      data: { poolCount: { increment: 1 } },
    });
    await tx.token.updateMany({
      where: { id: { in: [...new Set([token0Id, token1Id])] } },
      data: { poolCount: { increment: 1 } },
    });
    if (hookId) {
      await tx.hook.update({ where: { id: hookId }, data: { poolCount: { increment: 1 } } });
    }

    return 1;
  }

  private async applySwap(tx: Tx, event: SwapEvent): Promise<number> {
    const { meta } = event;
    const pool = await this.findPool(tx, meta.chainId, event.poolId);
    if (!pool) return this.orphan(event.kind, event.poolId, meta.chainId);

    // Signed from the pool's point of view: the input side is positive.
    const zeroForOne = event.amount0 > 0n;

    const created = await tx.swap.createMany({
      data: [
        {
          id: meta.id,
          chainId: meta.chainId,
          poolId: pool.id,
          poolType: event.poolType,
          hookId: pool.hookId,
          txHash: meta.txHash,
          blockNumber: meta.blockNumber,
          blockTimestamp: meta.blockTimestamp,
          logIndex: meta.logIndex,
          contract: meta.contract,
          topic0: meta.topic0,
          sender: event.sender,
          amount0: toDecimal(event.amount0),
          amount1: toDecimal(event.amount1),
          zeroForOne,
          fee: event.fee,
          protocolFee: event.protocolFee,
          sqrtPriceX96: event.sqrtPriceX96 !== undefined ? toDecimal(event.sqrtPriceX96) : null,
          tick: event.tick ?? null,
          liquidity: event.liquidity !== undefined ? toDecimal(event.liquidity) : null,
          activeId: event.activeId ?? null,
          dataSource: this.dataSource,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) return 0;

    const abs0 = event.amount0 < 0n ? -event.amount0 : event.amount0;
    const abs1 = event.amount1 < 0n ? -event.amount1 : event.amount1;

    await tx.pool.update({
      where: { id: pool.id },
      data: {
        swapCount: { increment: 1 },
        volumeToken0: { increment: toDecimal(abs0) },
        volumeToken1: { increment: toDecimal(abs1) },
        lastEventAt: meta.blockTimestamp,
        ...(event.sqrtPriceX96 !== undefined ? { sqrtPriceX96: toDecimal(event.sqrtPriceX96) } : {}),
        ...(event.tick !== undefined ? { tick: event.tick } : {}),
        ...(event.liquidity !== undefined ? { liquidity: toDecimal(event.liquidity) } : {}),
        ...(event.activeId !== undefined ? { activeId: event.activeId } : {}),
        ...(event.fee > 0 ? { currentLpFee: event.fee } : {}),
      },
    });

    if (pool.hookId) {
      await tx.hook.update({ where: { id: pool.hookId }, data: { swapCount: { increment: 1 } } });
    }

    return 1;
  }

  private async applyLiquidityChange(tx: Tx, event: LiquidityChangeEvent): Promise<number> {
    const { meta } = event;
    const pool = await this.findPool(tx, meta.chainId, event.poolId);
    if (!pool) return this.orphan(event.kind, event.poolId, meta.chainId);

    // CL positions are aggregated; bin positions are not, because the per-bin
    // share amounts live in the opaque `bytes32[] amounts` payload (see below).
    let positionId: string | null = null;
    if (
      event.poolType === "CL" &&
      event.tickLower !== undefined &&
      event.tickUpper !== undefined &&
      event.liquidityDelta !== undefined
    ) {
      positionId = clPositionRowId(
        meta.chainId,
        event.poolId,
        event.sender,
        event.tickLower,
        event.tickUpper,
        event.salt,
      );
    }

    // The position row must exist BEFORE the change row that references it, or
    // the positionId foreign key fails. Because the position is aggregate state
    // rather than an event fact, its liquidity is folded in below only when the
    // change row turns out to be new — so the create here starts at zero and
    // the single increment afterwards covers both the create and update paths.
    if (positionId) {
      await tx.liquidityPosition.upsert({
        where: { id: positionId },
        create: {
          id: positionId,
          chainId: meta.chainId,
          poolId: pool.id,
          poolType: "CL",
          owner: event.sender,
          salt: event.salt,
          tickLower: event.tickLower ?? null,
          tickUpper: event.tickUpper ?? null,
          liquidity: toDecimal(0),
          createdAtBlock: meta.blockNumber,
          lastUpdatedBlock: meta.blockNumber,
          dataSource: this.dataSource,
        },
        update: {},
      });
    }

    const created = await tx.liquidityChange.createMany({
      data: [
        {
          id: meta.id,
          chainId: meta.chainId,
          poolId: pool.id,
          poolType: event.poolType,
          hookId: pool.hookId,
          txHash: meta.txHash,
          blockNumber: meta.blockNumber,
          blockTimestamp: meta.blockTimestamp,
          logIndex: meta.logIndex,
          contract: meta.contract,
          topic0: meta.topic0,
          changeType: event.changeType,
          sender: event.sender,
          salt: event.salt,
          tickLower: event.tickLower ?? null,
          tickUpper: event.tickUpper ?? null,
          liquidityDelta:
            event.liquidityDelta !== undefined ? toDecimal(event.liquidityDelta) : null,
          positionId,
          binIds: event.binIds ?? [],
          // Stored verbatim. Each word packs an (amount0, amount1) pair under
          // PackedUint128Math; unpacking is NOT attempted because a wrong guess
          // at the layout would silently corrupt every bin volume number.
          binAmounts: event.binAmounts ?? [],
          compositionFeeAmount: event.compositionFeeAmount ?? null,
          feeAmountToProtocol: event.feeAmountToProtocol ?? null,
          dataSource: this.dataSource,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) return 0;

    // Applied only for a genuinely new change row, so replaying a block range
    // does not double-count a position's liquidity.
    if (positionId && event.liquidityDelta !== undefined) {
      await tx.liquidityPosition.update({
        where: { id: positionId },
        data: {
          liquidity: { increment: toDecimal(event.liquidityDelta) },
          lastUpdatedBlock: meta.blockNumber,
        },
      });
    }

    await tx.pool.update({
      where: { id: pool.id },
      data: { liquidityChangeCount: { increment: 1 }, lastEventAt: meta.blockTimestamp },
    });

    return 1;
  }

  private async applyDonate(tx: Tx, event: DonateEvent): Promise<number> {
    const { meta } = event;
    const pool = await this.findPool(tx, meta.chainId, event.poolId);
    if (!pool) return this.orphan(event.kind, event.poolId, meta.chainId);

    const created = await tx.donate.createMany({
      data: [
        {
          id: meta.id,
          chainId: meta.chainId,
          poolId: pool.id,
          poolType: event.poolType,
          hookId: pool.hookId,
          txHash: meta.txHash,
          blockNumber: meta.blockNumber,
          blockTimestamp: meta.blockTimestamp,
          logIndex: meta.logIndex,
          contract: meta.contract,
          topic0: meta.topic0,
          sender: event.sender,
          amount0: toDecimal(event.amount0),
          amount1: toDecimal(event.amount1),
          tick: event.tick ?? null,
          binId: event.binId ?? null,
          dataSource: this.dataSource,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) return 0;

    await tx.pool.update({
      where: { id: pool.id },
      data: { donateCount: { increment: 1 }, lastEventAt: meta.blockTimestamp },
    });
    return 1;
  }

  private async applyDynamicLpFee(tx: Tx, event: DynamicLpFeeEvent): Promise<number> {
    const { meta } = event;
    const pool = await tx.pool.findUnique({
      where: { id: poolRowId(meta.chainId, event.poolId) },
      select: { id: true, hookId: true, currentLpFee: true },
    });
    if (!pool) return this.orphan(event.kind, event.poolId, meta.chainId);

    const created = await tx.dynamicLpFeeUpdate.createMany({
      data: [
        {
          id: meta.id,
          chainId: meta.chainId,
          poolId: pool.id,
          hookId: pool.hookId,
          txHash: meta.txHash,
          blockNumber: meta.blockNumber,
          blockTimestamp: meta.blockTimestamp,
          logIndex: meta.logIndex,
          contract: meta.contract,
          topic0: meta.topic0,
          previousLpFee: pool.currentLpFee,
          dynamicLpFee: event.dynamicLpFee,
          dataSource: this.dataSource,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) return 0;

    await tx.pool.update({
      where: { id: pool.id },
      data: { currentLpFee: event.dynamicLpFee, lastEventAt: meta.blockTimestamp },
    });
    return 1;
  }

  private async applyProtocolFeeChange(tx: Tx, event: ProtocolFeeChangeEvent): Promise<number> {
    const { meta } = event;

    // Only pool-scoped sources resolve a pool; a default- or tier-level change
    // has no single pool.
    let poolRow: { id: string } | null = null;
    if (event.poolId) {
      poolRow = await tx.pool.findUnique({
        where: { id: poolRowId(meta.chainId, event.poolId) },
        select: { id: true },
      });
    }

    // Only the two pool-manager sources come from a PoolManager contract.
    const fromPoolManager =
      event.source === "POOL_MANAGER_PROTOCOL_FEE_UPDATED" ||
      event.source === "POOL_MANAGER_CONTROLLER_UPDATED";
    const poolManagerId = fromPoolManager ? addressRowId(meta.chainId, meta.contract) : null;

    if (poolManagerId) {
      const exists = await tx.poolManager.findUnique({
        where: { id: poolManagerId },
        select: { id: true },
      });
      if (!exists) {
        // A fee change can arrive before any pool exists on that manager.
        await tx.poolManager.create({
          data: {
            id: poolManagerId,
            chainId: meta.chainId,
            address: meta.contract,
            poolType: meta.role === "BinPoolManager" ? "BIN" : "CL",
          },
        });
      }
    }

    const created = await tx.protocolFeeChange.createMany({
      data: [
        {
          id: meta.id,
          chainId: meta.chainId,
          source: event.source,
          poolId: poolRow?.id ?? null,
          poolManagerId,
          txHash: meta.txHash,
          blockNumber: meta.blockNumber,
          blockTimestamp: meta.blockTimestamp,
          logIndex: meta.logIndex,
          contract: meta.contract,
          topic0: meta.topic0,
          protocolFeeRaw: event.protocolFeeRaw ?? null,
          protocolFeeZeroForOne: event.protocolFeeZeroForOne ?? null,
          protocolFeeOneForZero: event.protocolFeeOneForZero ?? null,
          isSet: event.isSet ?? null,
          lpFeeTier: event.lpFeeTier ?? null,
          disabled: event.disabled ?? null,
          controller: event.controller ?? null,
          dataSource: this.dataSource,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) return 0;

    if (poolRow && event.source === "POOL_MANAGER_PROTOCOL_FEE_UPDATED") {
      await tx.pool.update({
        where: { id: poolRow.id },
        data: {
          protocolFee: event.protocolFeeRaw ?? 0,
          protocolFeeZeroForOne: event.protocolFeeZeroForOne ?? 0,
          protocolFeeOneForZero: event.protocolFeeOneForZero ?? 0,
          lastEventAt: meta.blockTimestamp,
        },
      });
    }

    if (poolManagerId && event.source === "POOL_MANAGER_CONTROLLER_UPDATED") {
      await tx.poolManager.update({
        where: { id: poolManagerId },
        data: { protocolFeeController: event.controller ?? null },
      });
    }

    return 1;
  }

  private async applyVaultToken(tx: Tx, event: VaultTokenEvent): Promise<number> {
    const { meta } = event;
    const created = await tx.vaultTokenEvent.createMany({
      data: [
        {
          id: meta.id,
          chainId: meta.chainId,
          kind: event.tokenEventKind,
          txHash: meta.txHash,
          blockNumber: meta.blockNumber,
          blockTimestamp: meta.blockTimestamp,
          logIndex: meta.logIndex,
          contract: meta.contract,
          topic0: meta.topic0,
          caller: event.caller ?? null,
          from: event.from ?? null,
          to: event.to ?? null,
          owner: event.owner ?? null,
          spender: event.spender ?? null,
          operator: event.operator ?? null,
          approved: event.approved ?? null,
          currency: event.currency ?? null,
          amount: event.amount !== undefined ? toDecimal(event.amount) : null,
          dataSource: this.dataSource,
        },
      ],
      skipDuplicates: true,
    });
    return created.count;
  }

  /**
   * A pool-scoped event whose Initialize was never seen. Normal at the leading
   * edge of a partial backfill; a persistent stream of these means the start
   * block is wrong.
   */
  private orphan(kind: string, poolId: string, chainId: number): number {
    logger.debug({ kind, poolId, chainId }, "event references an unknown pool; skipping");
    return 0;
  }
}
