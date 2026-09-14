import { PrismaClient } from "@prisma/client";
import type { Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySpan, ConcurrentPassError } from "../../src/indexer/indexer.js";
import type { WindowRows } from "../../src/indexer/rows.js";

/**
 * Against a REAL Postgres, migrated with `prisma migrate deploy`. Opt-in:
 *
 *   TEST_DATABASE_URL=postgresql://... npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://... npm test
 *
 * Skipped cleanly when TEST_DATABASE_URL is unset (CI's api step sets only
 * placeholder URLs, so it skips there). Uses chain id 999999, which is not a
 * Latch chain, and deletes only that chain's rows.
 */

const url = process.env.TEST_DATABASE_URL;
const CHAIN = 999_999;
const POOL = `0x${"ab".repeat(32)}`;

const empty = (): WindowRows => ({
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
});

const at = (block: bigint, logIndex: number) => ({ blockNumber: block, blockTimestamp: new Date(Number(block) * 1000), txHash: `0x${block.toString(16).padStart(64, "0")}`, txIndex: 0, logIndex });

function rowsWith(swapBlocks: bigint[]): WindowRows {
  const r = empty();
  r.pools.push({ id: `${CHAIN}-${POOL}`, chainId: CHAIN, poolId: POOL, poolType: "CL", poolManager: `0x${"11".repeat(20)}`, currency0: `0x${"22".repeat(20)}`, currency1: `0x${"33".repeat(20)}`, hooks: `0x${"00".repeat(20)}`, fee: 3000, parameters: `0x${"00".repeat(32)}`, hookBitmap: 0, tickSpacing: 60, ...at(100n, 0) });
  for (const b of swapBlocks) {
    r.swaps.push({
      id: `${CHAIN}-${at(b, 1).txHash}-1`, chainId: CHAIN, poolRowId: `${CHAIN}-${POOL}`, poolId: POOL, poolType: "CL", sender: `0x${"44".repeat(20)}`,
      amount0: "-1000000000000000000", amount1: "990000000000000000", zeroForOne: true, tokenIn: `0x${"22".repeat(20)}`, tokenOut: `0x${"33".repeat(20)}`,
      amountIn: "1000000000000000000", amountOut: "990000000000000000", fee: 3000, protocolFee: 0, feeTotal: "3000000000000000", feeProtocol: "0", feeLp: "3000000000000000",
      contract: `0x${"11".repeat(20)}`, ...at(b, 1),
    });
  }
  return r;
}

const cp = (expectedLast: bigint | null) => ({ expectedLast, lastHash: `0x${"cd".repeat(32)}` as Hex, lastTimestamp: new Date(), setHash: "test", head: 1_000n });

describe.skipIf(!url)("indexer range replacement against Postgres", () => {
  let prisma: PrismaClient;

  const wipe = async () => {
    await prisma.swap.deleteMany({ where: { chainId: CHAIN } });
    await prisma.pool.deleteMany({ where: { chainId: CHAIN } });
    await prisma.indexerCheckpoint.deleteMany({ where: { chainId: CHAIN } });
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("is idempotent: replaying a span leaves identical rows", async () => {
    await applySpan(prisma, CHAIN, 100n, 200n, rowsWith([150n, 160n]), cp(null));
    await applySpan(prisma, CHAIN, 100n, 200n, rowsWith([150n, 160n]), cp(200n));
    expect(await prisma.swap.count({ where: { chainId: CHAIN } })).toBe(2);
    expect(await prisma.pool.count({ where: { chainId: CHAIN } })).toBe(1);
  });

  it("repairs a reorg: a swap the chain no longer reports disappears on re-read", async () => {
    await applySpan(prisma, CHAIN, 100n, 200n, rowsWith([150n]), cp(200n));
    const left = await prisma.swap.findMany({ where: { chainId: CHAIN } });
    expect(left.map((s) => s.blockNumber)).toEqual([150n]);
  });

  it("refuses to advance a checkpoint another pass has moved", async () => {
    await expect(applySpan(prisma, CHAIN, 201n, 300n, empty(), cp(123n))).rejects.toBeInstanceOf(ConcurrentPassError);
    const c = await prisma.indexerCheckpoint.findUnique({ where: { chainId: CHAIN } });
    expect(c?.lastIndexedBlock).toBe(200n);
  });

  it("stores wide integers exactly", async () => {
    const s = await prisma.swap.findFirst({ where: { chainId: CHAIN } });
    expect(s?.amount0.toFixed()).toBe("-1000000000000000000");
  });
});
