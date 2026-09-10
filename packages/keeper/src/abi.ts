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
  'function getPendingConfig(bytes32 poolId) view returns ((uint48,(uint24,uint16,uint16,uint16,address,bool)))',
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
  // --- shared reads ---
  'function epochCount() view returns (uint256)',
  'function lastCloseAt() view returns (uint64)',
  'function minEpochDuration() view returns (uint64)',
  'function claimWindow() view returns (uint64)',
  'function carryOver0() view returns (uint256)',
  'function carryOver1() view returns (uint256)',
  'function getEpoch(uint256 epochId) view returns ((uint256,uint256,uint256,uint256,uint256,uint48,uint64,uint64,bool))',
  // --- type probes, read-only, never sent ---
  'function token() view returns (address)',
  'function challengeDelay() view returns (uint64)',
])

/** Field order of the `Epoch` tuple above, so index math stays readable. */
export const EPOCH = {
  amount0: 0,
  amount1: 1,
  claimed0: 2,
  claimed1: 3,
  totalVotingSupply: 4,
  timepoint: 5,
  closedAt: 6,
  expiresAt: 7,
  rolledOver: 8,
} as const

export type EpochTuple = readonly [
  bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, boolean,
]
