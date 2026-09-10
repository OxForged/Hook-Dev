// SPDX-License-Identifier: MIT
/**
 * The narrowest ABI that answers the questions these tools ask.
 *
 * The registry ABI is NOT redeclared here - it is imported from
 * `@latchprotocol/sdk`, which generates it from the compiled artifact. Two
 * hand-maintained copies of one ABI is how a renamed function turns into a
 * silent decode failure.
 *
 * Everything else is hand-written and deliberately small. This module is the
 * complete list of calls this package is capable of making. A function that is
 * not here cannot be reached, whatever a model asks for. That property is the
 * point: the maintenance tools hold a key, and the set of things that key can
 * be pointed at should be readable in one screen.
 *
 * Every write signature below is PERMISSIONLESS on chain - anyone may call it
 * from any address. There is no owner-only, curator-only or guardian-only
 * function in this file and none may ever be added. See README.
 */

import { parseAbi } from "viem";

/** Reads used by `protocol_status`. */
export const VAULT_ABI = parseAbi([
  "function isAppRegistered(address) view returns (bool)",
  "function owner() view returns (address)",
]);

export const FEE_CONTROLLER_ABI = parseAbi([
  "function DEFAULT_FEE_PIPS() view returns (uint16)",
  "function MAX_PROTOCOL_FEE() view returns (uint16)",
  "function feesDisabled() view returns (bool)",
  "function guardian() view returns (address)",
  "function owner() view returns (address)",
]);

export const TIMELOCK_ABI = parseAbi(["function getMinDelay() view returns (uint256)"]);

/**
 * CL pool creation. Scoped by emitting address at every call site: Latch has 34
 * event declarations but only 22 unique signatures, so a topic0-only filter
 * merges CL and Bin activity into one wrong number.
 */
export const CL_INITIALIZE_EVENT = parseAbi([
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)",
]);

export const CL_SWAP_EVENT = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee, uint16 protocolFee)",
]);

/**
 * `getHooksRegistrationBitmap()` - the hook's own declaration of which
 * callbacks it holds. This is what the pool manager cross-checks at
 * initialization, and it is the only trustworthy source for a bitmap that is
 * not in the registry.
 */
export const HOOK_BITMAP_ABI = parseAbi([
  "function getHooksRegistrationBitmap() view returns (uint16)",
]);

// ---------------------------------------------------------------------------
// Maintenance. OPT-IN ONLY - see src/tools/maintenance.ts.
// ---------------------------------------------------------------------------

/** RevShareHook: two permissionless maintenance calls plus the reads that say
 * whether either is worth sending. */
export const REV_SHARE_HOOK_ABI = parseAbi([
  "function settleBeneficiaries((address,address,address,address,uint24,bytes32) key, address currency)",
  "function applyPendingConfig((address,address,address,address,uint24,bytes32) key)",
  "function pendingBeneficiary(bytes32 poolId, address currency) view returns (uint256)",
  "function getPendingConfig(bytes32 poolId) view returns ((uint48,(uint24,uint16,uint16,uint16,address,bool)))",
  "function distributorOf(bytes32 poolId) view returns (address)",
]);

/**
 * The epoch distributors. `SnapshotEpochDistributor` and `MerkleEpochDistributor`
 * share THESE signatures but have no common on-chain interface, so a caller
 * supplies the address and this ABI fits either.
 *
 * `getEpoch` is NOT here, because it is the one call whose return shape differs.
 * See `SNAPSHOT_EPOCH_ABI` / `MERKLE_EPOCH_ABI` below.
 */
export const DISTRIBUTOR_ABI = parseAbi([
  "function closeEpoch() returns (uint256 epochId)",
  "function rollover(uint256 epochId)",
  "function epochCount() view returns (uint256)",
  "function lastCloseAt() view returns (uint64)",
  "function minEpochDuration() view returns (uint64)",
  // Type probes, read-only. Exactly one of these answers on a given distributor.
  "function token() view returns (address)",
  "function challengeDelay() view returns (uint64)",
]);

/**
 * Two `getEpoch` ABIs, because the two distributors return DIFFERENT structs
 * that happen to share a shape.
 *
 * Both are nine all-static fields, so each occupies one 32-byte word and the
 * positions align. That is what makes one shared ABI dangerous rather than
 * merely wrong: the decode does not fail, it silently reinterprets.
 *
 *   idx  snapshot                     merkle
 *   ---  ---------------------------  --------------------------
 *    4   totalVotingSupply (uint256)  root (bytes32)
 *    5   timepoint (uint48)           closedAt (uint64)
 *    6   closedAt (uint64)            claimableAt (uint64)
 *    7   expiresAt                    expiresAt
 *    8   rolledOver                   rolledOver
 *
 * An agent reporting `closedAt` from a merkle epoch through the snapshot ABI
 * would state a wrong timestamp confidently, which is the exact failure this
 * package exists to avoid.
 */
export const SNAPSHOT_EPOCH_ABI = parseAbi([
  "function getEpoch(uint256 epochId) view returns ((uint256,uint256,uint256,uint256,uint256,uint48,uint64,uint64,bool))",
]);

export const MERKLE_EPOCH_ABI = parseAbi([
  "function getEpoch(uint256 epochId) view returns ((uint256,uint256,uint256,uint256,bytes32,uint64,uint64,uint64,bool))",
]);

/** Which distributor an address is. `unknown` means the probe was inconclusive. */
export type DistributorKind = "snapshot" | "merkle" | "unknown";

/**
 * Only the indices that mean the SAME thing on both distributors. Anything at
 * index 4-6 is distributor-specific and must be read through the matching ABI,
 * never looked up here.
 */
export const EPOCH_FIELD = {
  amount0: 0,
  amount1: 1,
  claimed0: 2,
  claimed1: 3,
  expiresAt: 7,
  rolledOver: 8,
} as const;

/**
 * Positions 4-6 are deliberately `unknown`: they hold different types AND
 * different meanings on the two distributors (uint256/uint48/uint64 vs
 * bytes32/uint64/uint64). Typing them as snapshot's shape would let a merkle
 * read compile while returning a wrong value, which is the whole failure this
 * split exists to prevent. Narrow them at the call site, against the ABI you
 * actually used.
 */
export type EpochTuple = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  unknown,
  unknown,
  unknown,
  bigint,
  boolean,
];
