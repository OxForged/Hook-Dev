/* ============================================================================
   Narrow ABIs for the revenue-share surface.

   Hand-written and deliberately small, in the same spirit as
   `packages/keeper/src/abi.ts`: the dapp can only ever call what is listed
   here. Every WRITE below is permissionless on chain — `settleBeneficiaries`,
   `applyPendingConfig`, `closeEpoch`, `rollover`, both `claim`s. No owner-only,
   guardian-only or distributor-only function appears in this file, and none
   should ever be added; owner actions are DISPLAYED by these screens as state
   and are never wired to a button.

   Custom errors are included on purpose. viem can only name a revert
   (`ContractFunctionRevertedError.data.errorName`) when the error is in the
   ABI it was given, and "the chain said EpochTooSoon(1757520000)" is a very
   different message from "the transaction would fail".

   THE TWO DISTRIBUTORS DO NOT SHARE AN EPOCH STRUCT. Both are nine fields, so
   a decoder given the wrong one succeeds and returns nonsense:

     Snapshot  amount0 amount1 claimed0 claimed1 totalVotingSupply timepoint
               closedAt expiresAt rolledOver
     Merkle    amount0 amount1 claimed0 claimed1 root              closedAt
               claimableAt expiresAt rolledOver

   Field 5 is a vote total in one and a merkle root in the other. Hence two
   separate ABIs here rather than the keeper's single shared one, and hence the
   type probe (`token()` answers only on Snapshot, `challengeDelay()` only on
   Merkle) before either is used.
   ============================================================================ */

import { parseAbi, parseAbiItem } from 'viem'

/* PoolKey is `(currency0, currency1, hooks, poolManager, fee, parameters)`.
   viem takes it as a positional tuple — see `keyTuple()` in ./revshare.ts. */

export const REV_SHARE_HOOK_ABI = parseAbi([
  /* --- reads ------------------------------------------------------------ */
  'function getConfig(bytes32 poolId) view returns ((address owner, uint24 feePips, uint16 lpDonateBps, uint16 beneficiaryBps, uint16 distributorBps, bool enabled, bool frozen))',
  'function getPendingConfig(bytes32 poolId) view returns ((uint48 effectiveBlock, (uint24 feePips, uint16 lpDonateBps, uint16 beneficiaryBps, uint16 distributorBps, address distributor, bool enabled) params))',
  'function getBeneficiaries(bytes32 poolId) view returns ((address recipient, uint96 weight)[])',
  'function totalWeight(bytes32 poolId) view returns (uint256)',
  'function poolOwner(bytes32 poolId) view returns (address)',
  'function pendingPoolOwner(bytes32 poolId) view returns (address)',
  'function distributorOf(bytes32 poolId) view returns (address)',
  'function pendingBeneficiary(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingDistributorShare(bytes32 poolId, address currency) view returns (uint256)',
  'function claimable(address recipient, address currency) view returns (uint256)',
  'function totalOwed(address currency) view returns (uint256)',
  'function backing(address currency) view returns (uint256)',
  'function paused() view returns (bool)',
  'function guardian() view returns (address)',
  'function poolManager() view returns (address)',
  'function vault() view returns (address)',
  'function CONFIG_DELAY_BLOCKS() view returns (uint48)',
  'function MAX_FEE_PIPS() view returns (uint24)',
  'function PIPS_DENOMINATOR() view returns (uint24)',
  'function SPLIT_DENOMINATOR() view returns (uint16)',
  'function MAX_BENEFICIARIES() view returns (uint256)',

  /* --- writes (permissionless, every one) -------------------------------- */
  'function settleBeneficiaries((address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters) key, address currency)',
  'function applyPendingConfig((address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters) key)',
  'function claim(address currency, address to) returns (uint256 amount)',

  /* --- events ------------------------------------------------------------ */
  'event RevShareTaken(bytes32 indexed poolId, address indexed currency, uint256 lpDonated, uint256 toBeneficiaries, uint256 toDistributor)',
  'event PoolClaimed(bytes32 indexed poolId, address indexed owner)',
  'event PoolOwnerChanged(bytes32 indexed poolId, address indexed from, address indexed to)',
  'event BeneficiariesSettled(bytes32 indexed poolId, address indexed currency, uint256 distributed, uint256 dust)',
  'event Claimed(address indexed beneficiary, address indexed currency, address indexed to, uint256 amount)',

  /* --- errors, so a revert can be reported by name ----------------------- */
  'error PoolNotConfigured(bytes32 poolId)',
  'error PoolAlreadyConfigured(bytes32 poolId)',
  'error NotPoolOwner(bytes32 poolId, address caller)',
  'error NoPendingConfig(bytes32 poolId)',
  'error PendingConfigNotDue(bytes32 poolId, uint48 effectiveBlock)',
  'error ConfigFrozen(bytes32 poolId)',
  'error HookMismatch(address declared)',
  'error PoolManagerMismatch(address declared)',
  'error PoolMustUseStaticFee()',
  'error NothingToClaim()',
  'error InvalidRecipient()',
  'error InsufficientBackedBalance(address currency, uint256 needed, uint256 available)',
  'error NativeNotAccepted()',
])

/** `SnapshotEpochDistributor`. Field 5 of the epoch is `totalVotingSupply`. */
export const SNAPSHOT_DISTRIBUTOR_ABI = parseAbi([
  'function poolKey() view returns ((address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters))',
  'function poolId() view returns (bytes32)',
  'function hook() view returns (address)',
  'function token() view returns (address)',
  'function clockIsBlockNumber() view returns (bool)',
  'function clock() view returns (uint48)',
  'function minEpochDuration() view returns (uint64)',
  'function claimWindow() view returns (uint64)',
  'function epochCount() view returns (uint256)',
  'function lastCloseAt() view returns (uint64)',
  'function carryOver0() view returns (uint256)',
  'function carryOver1() view returns (uint256)',
  'function getEpoch(uint256 epochId) view returns ((uint256 amount0, uint256 amount1, uint256 claimed0, uint256 claimed1, uint256 totalVotingSupply, uint48 timepoint, uint64 closedAt, uint64 expiresAt, bool rolledOver))',
  'function claimableAmounts(uint256 epochId, address account) view returns (uint256 amount0, uint256 amount1)',
  'function claimed(uint256 epochId, address account) view returns (bool)',

  /* writes — all three permissionless; `claim` pays `account`, not the sender */
  'function closeEpoch() returns (uint256 epochId)',
  'function rollover(uint256 epochId)',
  'function claim(uint256 epochId, address account) returns (uint256 amount0, uint256 amount1)',

  'error EpochTooSoon(uint64 earliest)',
  'error NothingToDistribute()',
  'error NoVotingSupplyAtSnapshot(uint48 timepoint)',
  'error UnknownEpoch(uint256 epochId)',
  'error AlreadyClaimed(uint256 epochId, address account)',
  'error NothingToClaim(uint256 epochId, address account)',
  'error ClaimWindowClosed(uint256 epochId, uint64 expiresAt)',
  'error NotExpiredYet(uint256 epochId, uint64 expiresAt)',
  'error AlreadyRolledOver(uint256 epochId)',
])

/** `MerkleEpochDistributor`. Field 5 of the epoch is `root`, not a supply. */
export const MERKLE_DISTRIBUTOR_ABI = parseAbi([
  'function poolKey() view returns ((address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters))',
  'function poolId() view returns (bytes32)',
  'function hook() view returns (address)',
  'function guardian() view returns (address)',
  'function minEpochDuration() view returns (uint64)',
  'function challengeDelay() view returns (uint64)',
  'function claimWindow() view returns (uint64)',
  'function epochCount() view returns (uint256)',
  'function lastCloseAt() view returns (uint64)',
  'function carryOver0() view returns (uint256)',
  'function carryOver1() view returns (uint256)',
  'function getEpoch(uint256 epochId) view returns ((uint256 amount0, uint256 amount1, uint256 claimed0, uint256 claimed1, bytes32 root, uint64 closedAt, uint64 claimableAt, uint64 expiresAt, bool rolledOver))',
  'function isClaimed(uint256 epochId, uint256 index) view returns (bool)',

  /* writes — only the two permissionless ones. `claim` is NOT here: it needs a
     merkle proof and nothing on chain publishes the tree. See Epochs.tsx. */
  'function closeEpoch() returns (uint256 epochId)',
  'function rollover(uint256 epochId)',

  'error EpochTooSoon(uint64 earliest)',
  'error NothingToDistribute()',
  'error UnknownEpoch(uint256 epochId)',
  'error RootNotPosted(uint256 epochId)',
  'error ClaimNotOpenYet(uint256 epochId, uint64 claimableAt)',
  'error ClaimWindowClosed(uint256 epochId, uint64 expiresAt)',
  'error NotExpiredYet(uint256 epochId, uint64 expiresAt)',
  'error AlreadyRolledOver(uint256 epochId)',
])

/* ---------------------------------------------------------------------------
   Single events, for `getLogs`.

   Declared with `parseAbiItem` rather than plucked out of the arrays above so
   viem can type `log.args` by name. Keep each one byte-identical to its twin
   in the arrays — a mismatch would not fail to compile, it would silently
   filter on a different topic0 and return nothing.
   --------------------------------------------------------------------------- */

export const REV_SHARE_TAKEN_EVENT = parseAbiItem(
  'event RevShareTaken(bytes32 indexed poolId, address indexed currency, uint256 lpDonated, uint256 toBeneficiaries, uint256 toDistributor)',
)

export const POOL_CLAIMED_EVENT = parseAbiItem(
  'event PoolClaimed(bytes32 indexed poolId, address indexed owner)',
)

export const POOL_OWNER_CHANGED_EVENT = parseAbiItem(
  'event PoolOwnerChanged(bytes32 indexed poolId, address indexed from, address indexed to)',
)

/**
 * The CL pool manager's `Initialize` — the only on-chain record that carries a
 * pool's key next to its id. Note it does NOT carry `poolManager`: for a CL
 * pool the manager is the emitting contract, which is how `resolvePoolKey`
 * rebuilds the sixth field of the key.
 */
export const CL_INITIALIZE_EVENT = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)',
)

export const ERC20_META_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])
