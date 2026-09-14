import type { Prisma } from "@prisma/client";
import type { Hex } from "viem";
import { classifyTimelockCall, collectionVia, type IndexedEvent } from "../chain/decode.js";
import { splitSwap } from "../lib/units.js";

/**
 * Decoded events -> database rows for one block window. PURE: every input the
 * rows depend on (timestamps, pool currencies, tx inputs, protocol addresses) is
 * passed in, so the same window always produces byte-identical rows. That
 * determinism is what makes range replacement idempotent.
 */

export interface WindowContext {
  chainId: number;
  /** unix seconds per block number that carries a log. */
  timestamps: ReadonlyMap<bigint, bigint>;
  /** currency0/currency1 per pool id, from the DB plus Initialize events in this window. */
  poolCurrencies: ReadonlyMap<string, { currency0: Hex; currency1: Hex }>;
  /** Outer transaction input per tx hash (only for ProtocolFeesCollected txs). */
  txInputs: ReadonlyMap<string, Hex>;
  /** Outer transaction `from` per tx hash (swap txs). */
  txFrom: ReadonlyMap<string, Hex>;
  /** Addresses whose RevShare claims are protocol revenue (the governance Safe). */
  protocolBeneficiaries: ReadonlySet<string>;
  /** "custody" | "policy" per timelock address. */
  timelockTier: ReadonlyMap<string, string>;
}

export interface WindowRows {
  pools: Prisma.PoolCreateManyInput[];
  swaps: Prisma.SwapCreateManyInput[];
  liquidity: Prisma.LiquidityEventCreateManyInput[];
  feeUpdates: Prisma.PoolFeeUpdateCreateManyInput[];
  revShareTakes: Prisma.RevShareTakeCreateManyInput[];
  revShareClaims: Prisma.RevShareClaimCreateManyInput[];
  collections: Prisma.ProtocolFeeCollectionCreateManyInput[];
  launches: Prisma.LaunchCreateManyInput[];
  contractEvents: Prisma.ContractEventCreateManyInput[];
  timelockEvents: Prisma.TimelockEventCreateManyInput[];
  ledger: Prisma.RevenueLedgerEntryCreateManyInput[];
  /** Pool-scoped events whose pool was never initialised (should be zero). */
  orphans: number;
}

const s = (v: bigint) => v.toString();

export function buildWindowRows(ctx: WindowContext, events: readonly IndexedEvent[]): WindowRows {
  const rows: WindowRows = {
    pools: [],
    swaps: [],
    liquidity: [],
    feeUpdates: [],
    revShareTakes: [],
    revShareClaims: [],
    collections: [],
    launches: [],
    contractEvents: [],
    timelockEvents: [],
    ledger: [],
    orphans: 0,
  };

  for (const e of events) {
    const m = e.meta;
    const ts = ctx.timestamps.get(m.blockNumber);
    if (ts === undefined) throw new Error(`no timestamp for block ${m.blockNumber}`);
    const at = {
      blockNumber: m.blockNumber,
      blockTimestamp: new Date(Number(ts) * 1000),
      txHash: m.txHash,
      txIndex: m.txIndex,
      logIndex: m.logIndex,
    };
    const poolRowId = (poolId: string) => `${ctx.chainId}-${poolId}`;

    switch (e.kind) {
      case "PoolInitialized":
        rows.pools.push({
          id: poolRowId(e.poolId),
          chainId: ctx.chainId,
          poolId: e.poolId,
          poolType: e.poolType,
          poolManager: m.contract,
          currency0: e.currency0,
          currency1: e.currency1,
          hooks: e.hooks,
          fee: e.fee,
          parameters: e.parameters,
          hookBitmap: e.hookBitmap,
          tickSpacing: e.tickSpacing,
          binStep: e.binStep,
          initSqrtPriceX96: e.sqrtPriceX96 === null ? null : s(e.sqrtPriceX96),
          initTick: e.tick,
          initActiveId: e.activeId,
          ...at,
        });
        break;

      case "Swap": {
        const key = ctx.poolCurrencies.get(e.poolId);
        if (!key) {
          rows.orphans += 1;
          break;
        }
        const split = splitSwap(e.amount0, e.amount1, e.fee, e.protocolFee);
        rows.swaps.push({
          id: m.id,
          chainId: ctx.chainId,
          poolRowId: poolRowId(e.poolId),
          poolId: e.poolId,
          poolType: e.poolType,
          sender: e.sender,
          txFrom: ctx.txFrom.get(m.txHash) ?? null,
          amount0: s(e.amount0),
          amount1: s(e.amount1),
          zeroForOne: split?.zeroForOne ?? false,
          tokenIn: split ? (split.inputIndex === 0 ? key.currency0 : key.currency1) : key.currency0,
          tokenOut: split ? (split.inputIndex === 0 ? key.currency1 : key.currency0) : key.currency1,
          amountIn: s(split?.amountIn ?? 0n),
          amountOut: s(split?.amountOut ?? 0n),
          fee: e.fee,
          protocolFee: e.protocolFee,
          feeTotal: s(split?.feeTotal ?? 0n),
          feeProtocol: s(split?.feeProtocol ?? 0n),
          feeLp: s(split?.feeLp ?? 0n),
          sqrtPriceX96: e.sqrtPriceX96 === null ? null : s(e.sqrtPriceX96),
          liquidity: e.liquidity === null ? null : s(e.liquidity),
          tick: e.tick,
          activeId: e.activeId,
          contract: m.contract,
          ...at,
        });
        break;
      }

      case "Liquidity":
        if (!ctx.poolCurrencies.has(e.poolId)) {
          rows.orphans += 1;
          break;
        }
        rows.liquidity.push({
          id: m.id,
          chainId: ctx.chainId,
          poolRowId: poolRowId(e.poolId),
          poolId: e.poolId,
          kind: e.liquidityKind,
          sender: e.sender,
          salt: e.salt,
          tickLower: e.tickLower,
          tickUpper: e.tickUpper,
          liquidityDelta: e.liquidityDelta === null ? null : s(e.liquidityDelta),
          binIds: e.binIds,
          packedAmounts: e.packedAmounts,
          contract: m.contract,
          ...at,
        });
        break;

      case "PoolFeeUpdate":
        rows.feeUpdates.push({ id: m.id, chainId: ctx.chainId, poolId: e.poolId, kind: e.feeKind, value: e.value, contract: m.contract, ...at });
        break;

      case "RevShareTaken":
        rows.revShareTakes.push({
          id: m.id,
          chainId: ctx.chainId,
          hook: m.contract,
          poolId: e.poolId,
          currency: e.currency,
          lpDonated: s(e.lpDonated),
          toBeneficiaries: s(e.toBeneficiaries),
          toDistributor: s(e.toDistributor),
          ...at,
        });
        break;

      case "RevShareClaimed":
        rows.revShareClaims.push({
          id: m.id,
          chainId: ctx.chainId,
          hook: m.contract,
          beneficiary: e.beneficiary,
          currency: e.currency,
          to: e.to,
          amount: s(e.amount),
          ...at,
        });
        if (ctx.protocolBeneficiaries.has(e.beneficiary)) {
          rows.ledger.push({
            id: `${m.id}-ledger`,
            chainId: ctx.chainId,
            source: "REVSHARE_PROTOCOL_CLAIM",
            token: e.currency,
            amount: s(e.amount),
            counterparty: e.to,
            contract: m.contract,
            poolId: null,
            blockNumber: at.blockNumber,
            blockTimestamp: at.blockTimestamp,
            txHash: at.txHash,
            logIndex: at.logIndex,
          });
        }
        break;

      case "ProtocolFeesCollected": {
        const via = collectionVia(ctx.txInputs.get(m.txHash));
        rows.collections.push({
          id: m.id,
          chainId: ctx.chainId,
          controller: m.contract,
          poolManager: e.poolManager,
          currency: e.currency,
          recipient: e.recipient,
          amount: s(e.amount),
          via,
          ...at,
        });
        rows.ledger.push({
          id: `${m.id}-ledger`,
          chainId: ctx.chainId,
          source: via === "SWEEP" ? "PROTOCOL_FEE_SWEPT" : "PROTOCOL_FEE_COLLECTED",
          token: e.currency,
          amount: s(e.amount),
          counterparty: e.recipient,
          contract: m.contract,
          poolId: null,
          blockNumber: at.blockNumber,
          blockTimestamp: at.blockTimestamp,
          txHash: at.txHash,
          logIndex: at.logIndex,
        });
        break;
      }

      case "LaunchCreated":
        rows.launches.push({
          id: m.id,
          chainId: ctx.chainId,
          kit: m.contract,
          poolId: e.poolId,
          launchToken: e.launchToken,
          quoteToken: e.quoteToken,
          operator: e.operator,
          startContractBlock: e.startContractBlock,
          decayContractBlocks: e.decayContractBlocks,
          initialFeeBips: e.initialFeeBips,
          finalFeeBips: e.finalFeeBips,
          maxBuyPerTx: s(e.maxBuyPerTx),
          launchTokenIsCurrency0: e.launchTokenIsCurrency0,
          preset: e.preset,
          ...at,
        });
        break;

      case "Timelock": {
        const call = classifyTimelockCall(e.data);
        rows.timelockEvents.push({
          id: m.id,
          chainId: ctx.chainId,
          timelock: m.contract,
          tier: ctx.timelockTier.get(m.contract) ?? "unknown",
          eventName: e.eventName,
          operationId: e.operationId,
          callIndex: e.callIndex,
          target: e.target,
          value: e.value === null ? null : s(e.value),
          data: e.data,
          selector: call.selector,
          functionSignature: call.functionSignature,
          predecessor: e.predecessor,
          delaySeconds: e.delaySeconds,
          hazard: call.hazard,
          hazardNote: call.hazardNote,
          ...at,
        });
        break;
      }

      case "Generic":
        rows.contractEvents.push({
          id: m.id,
          chainId: ctx.chainId,
          contractKey: m.role,
          contract: m.contract,
          eventName: e.eventName,
          subject: e.subject,
          args: e.args as Prisma.InputJsonValue,
          ...at,
        });
        break;
    }
  }
  return rows;
}

export function rowCount(r: WindowRows): number {
  return (
    r.pools.length +
    r.swaps.length +
    r.liquidity.length +
    r.feeUpdates.length +
    r.revShareTakes.length +
    r.revShareClaims.length +
    r.collections.length +
    r.launches.length +
    r.contractEvents.length +
    r.timelockEvents.length +
    r.ledger.length
  );
}
