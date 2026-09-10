/**
 * Database seed.
 *
 * Writes only the things that do NOT come from logs:
 *   - the Chain rows (including the fixture devnet the ingestion pipeline reads)
 *   - token metadata, which is not in any event
 *   - the hook registry, which is curated by hand
 *
 * Pools, swaps, hooks and liquidity are deliberately NOT seeded. They are
 * produced by running the ingestion pipeline over the fixture provider, so the
 * pipeline is exercised rather than bypassed:
 *
 *     npm run db:seed
 *     npm run dev            # the in-process worker backfills the fixtures
 *     # or, explicitly:
 *     curl -XPOST localhost:4000/api/v1/admin/ingest -H 'x-admin-token: ...' \
 *          -d '{"chainId":31337,"sync":true}' -H 'content-type: application/json'
 */

// Loaded directly rather than through src/config/env.ts: seeding needs only
// DATABASE_URL, and going through the full env schema would make the seed fail
// when REDIS_URL is not set.
import { config as loadDotenv } from "dotenv";
loadDotenv({ quiet: true });

import { AuditStatus, PoolType, PrismaClient, RegistryListingKind } from "@prisma/client";
import {
  FIXTURE_ADDRESSES,
  FIXTURE_CHAIN_ID,
  FIXTURE_CHAIN_SLUG,
  FIXTURE_START_BLOCK,
  FIXTURE_TOKENS,
} from "../src/chain/fixtures/devnet.js";
import { addressRowId } from "../src/lib/ids.js";

const prisma = new PrismaClient();

/**
 * Chains.
 *
 * `supportsEip1153` is the operational fact that decides which build of the
 * settlement layer a chain gets: Cancun chains run the tstore/tload backend,
 * pre-Cancun chains run the SSTORE-backed one. It is recorded per chain rather
 * than assumed, because Latch Protocol exists specifically to serve chains that
 * are behind.
 *
 * None of these is deployed. Real chains are seeded `enabled: false` so no poll
 * job starts against a chain with no contracts; flip that once addresses exist.
 */
const CHAINS = [
  {
    id: FIXTURE_CHAIN_ID,
    slug: FIXTURE_CHAIN_SLUG,
    name: "Fixture Devnet (not a real network)",
    shortName: "fixture",
    nativeCurrencySymbol: "FIXETH",
    nativeCurrencyDecimals: 18,
    explorerUrl: null,
    isTestnet: true,
    supportsEip1153: true,
    transientBackend: "EIP1153" as const,
    rpcUrlEnvKey: null,
    startBlock: FIXTURE_START_BLOCK,
    dataSource: "FIXTURE" as const,
    enabled: true,
  },
  {
    id: 8453,
    slug: "base",
    name: "Base",
    shortName: "base",
    nativeCurrencySymbol: "ETH",
    nativeCurrencyDecimals: 18,
    explorerUrl: "https://basescan.org",
    isTestnet: false,
    supportsEip1153: true,
    transientBackend: "EIP1153" as const,
    rpcUrlEnvKey: "RPC_URL_8453",
    startBlock: 0n,
    dataSource: "ONCHAIN" as const,
    enabled: false,
  },
  {
    id: 42161,
    slug: "arbitrum-one",
    name: "Arbitrum One",
    shortName: "arb1",
    nativeCurrencySymbol: "ETH",
    nativeCurrencyDecimals: 18,
    explorerUrl: "https://arbiscan.io",
    isTestnet: false,
    supportsEip1153: true,
    transientBackend: "EIP1153" as const,
    rpcUrlEnvKey: "RPC_URL_42161",
    startBlock: 0n,
    dataSource: "ONCHAIN" as const,
    enabled: false,
  },
  {
    // Seeded as the worked example of the pre-Cancun case. Verify a chain's
    // actual EIP-1153 support before deploying to it; this row is a placeholder,
    // not a claim about the network's current state.
    id: 1101,
    slug: "polygon-zkevm",
    name: "Polygon zkEVM",
    shortName: "zkevm",
    nativeCurrencySymbol: "ETH",
    nativeCurrencyDecimals: 18,
    explorerUrl: "https://zkevm.polygonscan.com",
    isTestnet: false,
    supportsEip1153: false,
    transientBackend: "STORAGE" as const,
    rpcUrlEnvKey: "RPC_URL_1101",
    startBlock: 0n,
    dataSource: "ONCHAIN" as const,
    enabled: false,
  },
];

/**
 * Hook registry.
 *
 * EVERY entry below is `kind: EXAMPLE`. They exist to demonstrate the shape of
 * a listing — the permission bitmap, the audit fields, the multi-chain
 * deployment join — and describe no real project, team or deployed contract.
 * Authors are named "Example …" for the same reason.
 *
 * Bitmaps use the offsets from ICLHooks / IBinHooks:
 *   0 beforeInitialize   1 afterInitialize
 *   2 before/after add-liquidity (CL) or mint (bin)  3 …
 *   4 before/after remove-liquidity (CL) or burn (bin)  5 …
 *   6 beforeSwap         7 afterSwap
 *   8 beforeDonate       9 afterDonate
 *  10 beforeSwapReturnsDelta      11 afterSwapReturnsDelta
 *  12 afterAdd/MintReturnsDelta   13 afterRemove/BurnReturnsDelta
 */
const bit = (...offsets: number[]) => offsets.reduce((acc, o) => acc | (1 << o), 0);

const REGISTRY = [
  {
    slug: "example-dynamic-fee",
    name: "Example Dynamic Fee",
    author: "Example Labs",
    summary: "Re-prices the LP fee from realised volatility before every swap.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "Demonstrates a dynamic-fee hook. The pool is created with " +
      "`fee = LPFeeLibrary.DYNAMIC_FEE_FLAG (0x800000)`, which starts the pool at a 0 LP fee; " +
      "the hook sets an opening fee in `afterInitialize` and thereafter returns an override from " +
      "`beforeSwap` with the `OVERRIDE_FEE_FLAG (0x400000)` bit set.\n\n" +
      "Registers bits 1 and 6 only. It takes no value for itself, so none of the returns-delta " +
      "bits are set.",
    poolType: PoolType.CL,
    declaredBitmap: bit(1, 6),
    auditStatus: AuditStatus.UNAUDITED,
    verified: false,
    tags: ["fees", "volatility", "dynamic-fee"],
    licenseId: "MIT",
    hookFeePips: null,
    deployments: [{ chainId: FIXTURE_CHAIN_ID, address: FIXTURE_ADDRESSES.hookDynamicFee }],
  },
  {
    slug: "example-fee-taking",
    name: "Example Fee Taking",
    author: "Example Labs",
    summary: "Charges a hook-owned fee on every swap through the hookDelta path.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "Demonstrates the only mechanism by which a hook can pay itself: the `hookDelta` return " +
      "path. `afterSwap` returns an `int128` denominated in the unspecified currency, which the " +
      "pool manager books against the hook's own balance via " +
      "`IVault.accountAppBalanceDelta(currency0, currency1, delta, settler, hookDelta, hook)`.\n\n" +
      "The delta is only parsed because bit 11 (`afterSwapReturnsDelta`) is set — and bit 11 is " +
      "only valid because bit 7 (`afterSwap`) is set too. Setting 11 without 7 makes " +
      "`initialize()` revert with `Hooks.HookPermissionsValidationError`.\n\n" +
      "The core bounds what a hook may take: exceeding the swap amount reverts with " +
      "`Hooks.HookDeltaExceedsSwapAmount`.",
    poolType: PoolType.CL,
    declaredBitmap: bit(6, 7, 11),
    auditStatus: AuditStatus.IN_REVIEW,
    auditor: "Example Audit Co.",
    verified: false,
    tags: ["fees", "revenue", "hook-delta"],
    licenseId: "MIT",
    hookFeePips: 500,
    deployments: [{ chainId: FIXTURE_CHAIN_ID, address: FIXTURE_ADDRESSES.hookFeeTaking }],
  },
  {
    slug: "example-limit-order",
    name: "Example Limit Order Book",
    author: "Example Collective",
    summary: "Fills resting limit orders out of bin liquidity when the active bin crosses them.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "A liquidity-book hook. Orders rest as single-bin positions; `afterSwap` checks whether the " +
      "active bin has crossed any of them and settles the ones that have. `afterMint` and " +
      "`afterBurn` keep the hook's own order index in step with the underlying bin positions.\n\n" +
      "Note the naming difference from CL: bits 2-5 are mint/burn here, not add/remove liquidity. " +
      "Same offsets, different callbacks.",
    poolType: PoolType.BIN,
    declaredBitmap: bit(3, 5, 6, 7),
    auditStatus: AuditStatus.AUDITED,
    auditor: "Example Audit Co.",
    auditReportUrl: null,
    verified: true,
    tags: ["limit-orders", "bin", "trading"],
    licenseId: "GPL-2.0-or-later",
    hookFeePips: null,
    deployments: [{ chainId: FIXTURE_CHAIN_ID, address: FIXTURE_ADDRESSES.hookLimitOrder }],
  },
  {
    slug: "example-twap-oracle",
    name: "Example TWAP Oracle",
    author: "Example Research",
    summary: "Records a time-weighted price observation after each swap.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "Writes an observation in `afterSwap` and initialises its ring buffer in `afterInitialize`. " +
      "Returns no delta and overrides no fee, so it is a pure observer: bits 1 and 7 only.\n\n" +
      "A hook this simple is a good illustration of why permissions living in `poolKey.parameters` " +
      "matters. Under address-encoded permissions, adding a `beforeSwap` callback later would mean " +
      "mining a new salt and redeploying at a new address; here it is a bitmap change on newly " +
      "created pools.",
    poolType: PoolType.CL,
    declaredBitmap: bit(1, 7),
    auditStatus: AuditStatus.AUDITED,
    auditor: "Example Audit Co.",
    verified: true,
    tags: ["oracle", "twap", "infrastructure"],
    licenseId: "MIT",
    hookFeePips: null,
    deployments: [],
  },
  {
    slug: "example-allowlist-gate",
    name: "Example Allowlist Gate",
    author: "Example Compliance",
    summary: "Restricts who may add liquidity or swap, by checking a merkle allowlist.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "Reverts in `beforeSwap` and `beforeAddLiquidity` when the caller is not in the allowlist. " +
      "The proof travels in `hookData`, which the periphery passes through untouched.\n\n" +
      "Worth knowing: the `sender` a hook sees is the caller of the pool manager, which is " +
      "normally a router, not the end user. A gate that needs the end user's identity must take it " +
      "from `hookData` and verify a signature — not read `sender`.",
    poolType: PoolType.CL,
    declaredBitmap: bit(2, 6),
    auditStatus: AuditStatus.UNAUDITED,
    verified: false,
    tags: ["access-control", "compliance", "permissioned"],
    licenseId: "MIT",
    hookFeePips: null,
    deployments: [],
  },
  {
    slug: "example-lvr-rebate",
    name: "Example LVR Rebate",
    author: "Example Research",
    summary: "Skims part of an arbitrage swap and donates it back to in-range LPs.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "Takes a delta in `beforeSwap` (bit 10) and returns it to liquidity providers through " +
      "`donate`, as a sketch of loss-versus-rebalancing mitigation.\n\n" +
      "This is the most dangerous shape of hook in the registry: it both intercepts value and " +
      "moves it. `beforeSwapReturnsDelta` requires `beforeSwap`, and a delta that flips the swap " +
      "from exact-input to exact-output reverts with `Hooks.HookDeltaExceedsSwapAmount`. Listed " +
      "unaudited on purpose — treat it as a reference, not a dependency.",
    poolType: PoolType.CL,
    declaredBitmap: bit(6, 7, 10, 11),
    auditStatus: AuditStatus.UNAUDITED,
    verified: false,
    tags: ["mev", "lvr", "hook-delta", "research"],
    licenseId: "GPL-2.0-or-later",
    hookFeePips: 300,
    deployments: [],
  },
  {
    slug: "example-liquidity-lock",
    name: "Example Liquidity Lock",
    author: "Example Labs",
    summary: "Blocks liquidity removal until a per-position unlock timestamp.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "Records an unlock time in `afterAddLiquidity` and reverts in `beforeRemoveLiquidity` until " +
      "it passes. Positions are keyed by the `salt` field of `ModifyLiquidityParams`, which is what " +
      "lets one owner hold several distinct positions over the same tick range.",
    poolType: PoolType.CL,
    declaredBitmap: bit(3, 4),
    auditStatus: AuditStatus.UNAUDITED,
    verified: false,
    tags: ["liquidity", "vesting", "launch"],
    licenseId: "MIT",
    hookFeePips: null,
    deployments: [],
  },
  {
    slug: "example-bin-rebalancer",
    name: "Example Bin Rebalancer",
    author: "Example Collective",
    summary: "Recentres bin liquidity around the active bin after large moves.",
    description:
      "EXAMPLE LISTING — not a real project.\n\n" +
      "A liquidity-book manager hook. `afterSwap` notices when the active bin has drifted past a " +
      "threshold and queues a rebalance; `afterMint` and `afterBurn` track the shares it manages.\n\n" +
      "The per-bin amounts in `Mint`/`Burn` are packed `bytes32` words. This API stores them " +
      "verbatim rather than decoding them, because the packing has not been verified against " +
      "`PackedUint128Math`; a hook doing real accounting must verify it.",
    poolType: PoolType.BIN,
    declaredBitmap: bit(3, 5, 7),
    auditStatus: AuditStatus.IN_REVIEW,
    auditor: "Example Audit Co.",
    verified: false,
    tags: ["bin", "liquidity-management", "automation"],
    licenseId: "MIT",
    hookFeePips: null,
    deployments: [],
  },
];

async function seedChains() {
  for (const chain of CHAINS) {
    await prisma.chain.upsert({
      where: { id: chain.id },
      create: chain,
      update: {
        slug: chain.slug,
        name: chain.name,
        shortName: chain.shortName,
        supportsEip1153: chain.supportsEip1153,
        transientBackend: chain.transientBackend,
        rpcUrlEnvKey: chain.rpcUrlEnvKey,
        explorerUrl: chain.explorerUrl,
      },
    });
  }
  console.log(`  chains: ${CHAINS.length}`);
}

/** Token symbols and decimals are not in any log, so they are seeded. */
async function seedTokens() {
  for (const token of FIXTURE_TOKENS) {
    const id = addressRowId(FIXTURE_CHAIN_ID, token.address);
    await prisma.token.upsert({
      where: { id },
      create: {
        id,
        chainId: FIXTURE_CHAIN_ID,
        address: token.address.toLowerCase(),
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        isNative: token.isNative,
        dataSource: "FIXTURE",
      },
      update: { symbol: token.symbol, name: token.name, decimals: token.decimals },
    });
  }
  console.log(`  tokens: ${FIXTURE_TOKENS.length}`);
}

async function seedRegistry() {
  for (const entry of REGISTRY) {
    const { deployments, ...fields } = entry;

    const saved = await prisma.hookRegistryEntry.upsert({
      where: { slug: entry.slug },
      create: {
        ...fields,
        // Every seeded listing is illustrative. Nothing here is a real project.
        kind: RegistryListingKind.EXAMPLE,
      },
      update: {
        ...fields,
        kind: RegistryListingKind.EXAMPLE,
      },
    });

    for (const deployment of deployments) {
      await prisma.hookRegistryDeployment.upsert({
        where: { entryId_chainId: { entryId: saved.id, chainId: deployment.chainId } },
        create: {
          entryId: saved.id,
          chainId: deployment.chainId,
          address: deployment.address.toLowerCase(),
          // Linked to the observed Hook row lazily, below, once ingestion has
          // actually seen the address in a pool key.
          hookId: null,
          notes: "Fixture deployment. No contract exists at this address on any chain.",
        },
        update: { address: deployment.address.toLowerCase() },
      });
    }
  }
  console.log(`  registry entries: ${REGISTRY.length}`);
}

/**
 * Join listings to observed hooks.
 *
 * Idempotent and safe to re-run: after an ingestion pass the Hook rows exist,
 * and this attaches them so `/api/v1/registry` can report per-chain pool and
 * swap counts for a listing.
 */
async function linkObservedHooks() {
  const deployments = await prisma.hookRegistryDeployment.findMany({
    where: { address: { not: null }, hookId: null },
  });

  let linked = 0;
  for (const deployment of deployments) {
    if (!deployment.address) continue;
    const hook = await prisma.hook.findUnique({
      where: { id: addressRowId(deployment.chainId, deployment.address) },
      select: { id: true },
    });
    if (hook) {
      await prisma.hookRegistryDeployment.update({
        where: { id: deployment.id },
        data: { hookId: hook.id },
      });
      linked += 1;
    }
  }
  console.log(`  linked listings to observed hooks: ${linked}`);
}

async function main() {
  console.log("Seeding Latch Protocol API database...");
  await seedChains();
  await seedTokens();
  await seedRegistry();
  await linkObservedHooks();
  console.log(
    "\nDone. Nothing is deployed: run the ingestion pipeline to populate pools and swaps\n" +
      "from the fixture provider (`npm run dev`, or POST /api/v1/admin/ingest with sync:true).",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
