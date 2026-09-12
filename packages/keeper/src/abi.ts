/* ============================================================================
   Minimal ABIs — only the members this keeper actually calls or reads.

   Deliberately hand-written and narrow rather than importing the full generated
   ABIs. A keeper holds a key that can send transactions; the smallest possible
   surface it knows how to call is a security property, not a size optimisation.
   If a function is not in this file, this process cannot call it, whatever a
   bug or a bad config asks it to do.

   Every entry here is PERMISSIONLESS on chain. There is no owner-only,
   curator-only or guardian-only function in this file, and none should ever be
   added - see README § "What a stolen keeper key buys an attacker".
   ============================================================================ */

import { keccak256, parseAbi, toHex, type Hex } from 'viem'

/** RevShareHook: the two permissionless maintenance calls, plus their guards. */
export const REV_SHARE_HOOK_ABI = parseAbi([
  // --- writes (both permissionless) ---
  'function settleBeneficiaries((address,address,address,address,uint24,bytes32) key, address currency)',
  'function applyPendingConfig((address,address,address,address,uint24,bytes32) key)',
  // --- reads used to decide whether the writes are worth sending ---
  'function pendingBeneficiary(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingDistributorShare(bytes32 poolId, address currency) view returns (uint256)',
  // `settleBeneficiaries` has TWO silent early returns: a zero pot, and an empty
  // roster (`_totalWeight == 0`). The job must read both or it will pay gas to do
  // nothing on a pool whose owner never set a roster.
  'function totalWeight(bytes32 poolId) view returns (uint256)',
  'function distributorOf(bytes32 poolId) view returns (address)',
  // `getPendingConfig` is deliberately NOT typed here. The struct it returns has
  // two shapes in the wild — 7 words on the hooks deployed before proposal expiry
  // existed (Robinhood 0x23CE…, Sepolia 0x1C86…), 8 words on the current source —
  // and they are not interchangeable. The job calls it raw and
  // `decodePendingConfig` switches on the returned length. See decode.ts.
])

/**
 * Selector-only entry for the raw `getPendingConfig` call. The declared return
 * type is never used to decode; it exists so the selector is computed from a
 * signature in this file rather than pasted in as a magic number.
 */
export const GET_PENDING_CONFIG_ABI = parseAbi([
  'function getPendingConfig(bytes32 poolId) view returns (bytes)',
])

/**
 * The two distributors share `closeEpoch`/`rollover` signatures and both
 * implement `IEpochDistributor.kind()`, which is how the keeper tells them
 * apart. `kind()` returns a domain-separated keccak constant, never zero, so an
 * EOA, a proxy to nothing, or an unrelated contract that happens to expose a
 * `token()` getter fails to match instead of being mistaken for a distributor.
 */
export const DISTRIBUTOR_ABI = parseAbi([
  // --- writes (both permissionless on both distributors) ---
  'function closeEpoch() returns (uint256 epochId)',
  'function rollover(uint256 epochId)',
  // --- identity ---
  'function kind() pure returns (bytes32)',
  // --- reads with identical shape on both distributors ---
  'function epochCount() view returns (uint256)',
  'function lastCloseAt() view returns (uint64)',
  'function minEpochDuration() view returns (uint64)',
  'function claimWindow() view returns (uint64)',
  'function carryOver0() view returns (uint256)',
  'function carryOver1() view returns (uint256)',
  // --- merkle only ---
  // The one view that knows which of the two rollover clocks governs an epoch.
  // `cancelRoot` moves one of them and `getEpoch` does not record that it did, so
  // a deadline recomputed off chain is eventually the wrong one. The snapshot
  // distributor has no such call; there `expiresAt` is the whole story.
  'function rolloverEligibleAt(uint256 epochId) view returns (uint64)',
  // --- custom errors ---
  // Present so viem DECODES a revert into a name instead of handing back a bare
  // 4-byte selector. These are the keeper's normal output, not exceptions:
  // `NothingToDistribute` every tick between epochs, `EpochTooSoon` every tick
  // inside the minimum duration. An operator reading "0x01663f24" learns nothing;
  // reading "NothingToDistribute()" learns the system is idle and healthy.
  'error NothingToDistribute()',
  'error EpochTooSoon(uint64 earliest)',
  'error AlreadyRolledOver(uint256 epochId)',
  'error NotExpiredYet(uint256 epochId, uint64 expiresAt)',
  'error ClaimWindowClosed(uint256 epochId, uint64 expiresAt)',
  'error UnknownEpoch(uint256 epochId)',
])

/**
 * `getEpoch` is the one call whose RETURN SHAPE DIFFERS between the two
 * distributors, so it gets two ABIs rather than one.
 *
 * Both structs are nine fields and both are all-static, so every field occupies
 * one 32-byte word and the positions line up. That is exactly what makes a
 * single shared ABI dangerous rather than merely wrong: decoding does not fail,
 * it silently reinterprets.
 *
 *   idx  snapshot                     merkle
 *   ---  ---------------------------  --------------------------
 *    4   totalVotingSupply (uint256)  root (bytes32)
 *    5   timepoint (uint48)           closedAt (uint64)
 *    6   closedAt (uint64)            claimableAt (uint64)
 *    7   expiresAt                    expiresAt
 *    8   rolledOver                   rolledOver
 *
 * The jobs in this package read only 0-3, 7 and 8, which agree on both — so
 * this was a latent fault, not an active misread. It stops being latent the
 * moment somebody reads `closedAt` and gets `claimableAt` on a merkle epoch.
 */
export const SNAPSHOT_EPOCH_ABI = parseAbi([
  'function getEpoch(uint256 epochId) view returns ((uint256,uint256,uint256,uint256,uint256,uint48,uint64,uint64,bool))',
])

export const MERKLE_EPOCH_ABI = parseAbi([
  'function getEpoch(uint256 epochId) view returns ((uint256,uint256,uint256,uint256,bytes32,uint64,uint64,uint64,bool))',
])

/** Which distributor a target is. `unknown` means `kind()` did not answer with a value this keeper recognises. */
export type DistributorKind = 'snapshot' | 'merkle' | 'unknown'

/**
 * The constants `IEpochDistributor.kind()` may return, computed here exactly as
 * `EpochDistributorKind` in `packages/hooks-revshare/src/interfaces/IEpochDistributor.sol`
 * computes them. The `.v1` suffix is load-bearing: a distributor that changes its
 * `Epoch` layout gets a NEW string, so this keeper fails to match it instead of
 * decoding a new layout with an old ABI.
 */
export const DISTRIBUTOR_KIND: Readonly<Record<Exclude<DistributorKind, 'unknown'>, Hex>> = {
  snapshot: keccak256(toHex('latch.revshare.distributor.snapshot.v1')),
  merkle: keccak256(toHex('latch.revshare.distributor.merkle.v1')),
}

/**
 * Indices that mean the same thing on BOTH distributors. Nothing above index 3
 * is listed except the two that genuinely agree — anything distributor-specific
 * has to go through the matching ABI and be named there, not guessed from here.
 */
export const EPOCH = {
  amount0: 0,
  amount1: 1,
  claimed0: 2,
  claimed1: 3,
  expiresAt: 7,
  rolledOver: 8,
} as const

/** Deliberately loose at 4-6: those positions do not share a meaning. */
export type EpochTuple = readonly [
  bigint, bigint, bigint, bigint, unknown, unknown, unknown, bigint, boolean,
]
