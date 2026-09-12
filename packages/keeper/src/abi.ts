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

import { parseAbi } from 'viem'

/** RevShareHook: the two permissionless maintenance calls, plus their guards. */
export const REV_SHARE_HOOK_ABI = parseAbi([
  // --- writes (both permissionless) ---
  'function settleBeneficiaries((address,address,address,address,uint24,bytes32) key, address currency)',
  'function applyPendingConfig((address,address,address,address,uint24,bytes32) key)',
  // --- reads used to decide whether the writes are worth sending ---
  'function pendingBeneficiary(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingDistributorShare(bytes32 poolId, address currency) view returns (uint256)',
  // The tuple gained `uint48 expiryBlock` after `effectiveBlock` when the hook was
  // redeployed. A matured proposal now dies of old age instead of staying armed
  // forever. Reading this through the two-field shape does NOT error - it silently
  // returns `expiryBlock` as `params.feePips`, which is the same trap as decoding one
  // distributor's `getEpoch` through the other's ABI.
  'function getPendingConfig(bytes32 poolId) view returns ((uint48,uint48,(uint24,uint16,uint16,uint16,address,bool)))',
  'function distributorOf(bytes32 poolId) view returns (address)',
])

/**
 * The two distributors share `closeEpoch`/`rollover` signatures but NOT their
 * event signatures, and they have no common interface on chain. `kind()` does
 * not exist, so the keeper probes: `token()` answers only on the snapshot
 * distributor, `challengeDelay()` only on the merkle one. That probe is why
 * both selectors appear here.
 */
export const DISTRIBUTOR_ABI = parseAbi([
  // --- writes (both permissionless on both distributors) ---
  'function closeEpoch() returns (uint256 epochId)',
  'function rollover(uint256 epochId)',
  // --- reads with identical shape on both distributors ---
  'function epochCount() view returns (uint256)',
  'function lastCloseAt() view returns (uint64)',
  'function minEpochDuration() view returns (uint64)',
  'function claimWindow() view returns (uint64)',
  'function carryOver0() view returns (uint256)',
  'function carryOver1() view returns (uint256)',
  // --- type probes, read-only, never sent ---
  'function token() view returns (address)',
  'function challengeDelay() view returns (uint64)',
  // --- custom errors ---
  // Present so viem DECODES a revert into a name instead of handing back a bare
  // 4-byte selector. These are the keeper's normal output, not exceptions:
  // `NothingToDistribute` every tick between epochs, `EpochTooSoon` every tick
  // inside the minimum duration. An operator reading "0x01663f24" learns nothing;
  // reading "NothingToDistribute()" learns the system is idle and healthy.
  'error NothingToDistribute()',
  'error EpochTooSoon(uint64 earliest)',
  'error AlreadyRolledOver(uint256 epochId)',
  'error ClaimWindowClosed(uint256 epochId, uint64 expiresAt)',
  'error UnknownEpoch(uint256 epochId)',
  'error NothingToClaim(uint256 epochId, address account)',
  'error AlreadyClaimed(uint256 epochId, address account)',
  'error RolloverTooSoon(uint256 epochId, uint64 expiresAt)',
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

/** Which distributor a target is. `unknown` means the probe was inconclusive. */
export type DistributorKind = 'snapshot' | 'merkle' | 'unknown'

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
