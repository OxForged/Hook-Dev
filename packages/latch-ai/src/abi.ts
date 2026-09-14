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

import { keccak256, parseAbi, toHex, type Hex } from "viem";

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
  // `getPendingConfig` is deliberately NOT typed here. It has THREE shapes: 7 words
  // block-numbered with no expiry (Robinhood 0x23CE..E446, Sepolia 0x1C86..BE28),
  // 8 words block-numbered with expiry (Robinhood 0xfC00..2aD2) and 8 words in unix
  // seconds (the timestamp build). The two 8-word shapes have identical layouts, so
  // the shape comes from the SDK address book or a CLOCK_MODE() probe and the bytes
  // are decoded with the SDK's `decodeRevSharePendingConfig`. See tools/maintenance.ts.
  "function distributorOf(bytes32 poolId) view returns (address)",
]);

/**
 * Selector-only entry for the raw `getPendingConfig` call. The declared return
 * type is never used to decode; it exists so the selector is computed from a
 * signature in this file rather than pasted in as a magic number. Mirrors
 * `GET_PENDING_CONFIG_ABI` in `@latchprotocol/keeper`.
 */
export const GET_PENDING_CONFIG_ABI = parseAbi([
  "function getPendingConfig(bytes32 poolId) view returns (bytes)",
]);

/**
 * The epoch distributors. `SnapshotEpochDistributor` and `MerkleEpochDistributor`
 * share THESE signatures, and both implement `IEpochDistributor.kind()`, which is
 * how a caller tells them apart. `kind()` returns a domain-separated keccak
 * constant, never zero, so an EOA, a proxy to nothing, or an unrelated contract
 * that happens to expose a `token()` getter fails to match instead of being
 * mistaken for a distributor.
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
  // --- identity ---
  "function kind() pure returns (bytes32)",
  // --- merkle only ---
  // The one view that knows which of the two rollover clocks governs an epoch.
  // `cancelRoot` moves one of them and `getEpoch` does not record that it did, so
  // a deadline recomputed off chain is eventually the wrong one. The snapshot
  // distributor has no such call; there `expiresAt` is the whole story.
  "function rolloverEligibleAt(uint256 epochId) view returns (uint64)",
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

/** Which distributor an address is. `unknown` means `kind()` did not answer with a value this package recognises. */
export type DistributorKind = "snapshot" | "merkle" | "unknown";

/**
 * The constants `IEpochDistributor.kind()` may return, computed here exactly as
 * `EpochDistributorKind` in `packages/hooks-revshare/src/interfaces/IEpochDistributor.sol`
 * computes them, and exactly as `@latchprotocol/keeper` does. The `.v1` suffix is
 * load-bearing: a distributor that changes its `Epoch` layout gets a NEW string,
 * so this package fails to match it instead of decoding a new layout with an old
 * ABI.
 */
export const DISTRIBUTOR_KIND: Readonly<Record<Exclude<DistributorKind, "unknown">, Hex>> = {
  snapshot: keccak256(toHex("latch.revshare.distributor.snapshot.v1")),
  merkle: keccak256(toHex("latch.revshare.distributor.merkle.v1")),
};

/**
 * Map a `kind()` return value onto a distributor. Exact match only. Zero, an
 * unrecognised hash, or a value of the wrong width are all `unknown`, and
 * `unknown` means the caller must refuse - never fall back to a guess, and never
 * to the old `token()` / `challengeDelay()` selector probe.
 */
export function kindFromBytes32(value: unknown): DistributorKind {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) return "unknown";
  const v = value.toLowerCase();
  if (v === DISTRIBUTOR_KIND.snapshot.toLowerCase()) return "snapshot";
  if (v === DISTRIBUTOR_KIND.merkle.toLowerCase()) return "merkle";
  return "unknown";
}

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
