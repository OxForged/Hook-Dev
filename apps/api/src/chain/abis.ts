import { parseAbi, toFunctionSelector, type Hex } from "viem";

/**
 * ABIs the SDK does not ship.
 *
 * The SDK (`@latchprotocol/sdk`) is the source for core events
 * (`decodeProtocolLog`), LaunchpadKit (`LAUNCHPAD_KIT_ABI`) and LatchRegistry
 * (`LATCH_HOOK_REGISTRY_EVENTS_ABI`). Everything below is NOT in it, so it is
 * hand-declared here and diffed against the compiled Foundry artifacts by
 * `test/abis.test.ts` (skipped when the artifacts are not built).
 *
 * Every signature was also read out of the artifact on 2026-09-13:
 *   packages/hooks-revshare/foundry-out/RevShareHook.sol/RevShareHook.json
 *   packages/fees/foundry-out/LatchProtocolFeeControllerV2.sol/...
 *   packages/registry/foundry-out/LatchLaunchRegistry.sol/LatchLaunchRegistry.json
 */

export const REVSHARE_EVENTS_ABI = parseAbi([
  "event RevShareTaken(bytes32 indexed poolId, address indexed currency, uint256 lpDonated, uint256 toBeneficiaries, uint256 toDistributor)",
  "event Claimed(address indexed beneficiary, address indexed currency, address indexed to, uint256 amount)",
]);

export const FEE_CONTROLLER_V2_EVENTS_ABI = parseAbi([
  "event ProtocolFeesCollected(address indexed poolManager, address indexed currency, address indexed recipient, uint256 amount)",
]);

export const FEE_CONTROLLER_V2_FUNCTIONS_ABI = parseAbi([
  "function collect(address poolManager, address currency, uint256 amount, address recipient) returns (uint256)",
  "function sweep(address poolManager, address currency) returns (uint256)",
]);

export const COLLECT_SELECTOR: Hex = toFunctionSelector(
  "function collect(address poolManager, address currency, uint256 amount, address recipient)",
);
export const SWEEP_SELECTOR: Hex = toFunctionSelector("function sweep(address poolManager, address currency)");

export const LAUNCH_REGISTRY_EVENTS_ABI = parseAbi([
  "event LaunchRegistered(bytes32 indexed poolId, address indexed token, address indexed launchpad, address poolManager, address quote, address hooks, uint16 hookPermissions, uint24 fee, bool tokenIsCurrency0, address creator, address registrant, uint8 origin, uint64 timestamp)",
  "event LaunchTokenInfoUpdated(bytes32 indexed poolId, string name, string symbol, uint8 decimals, bytes32 codehash, bool readable)",
  "event LaunchMetadataUpdated(bytes32 indexed poolId, address indexed updater, string description, string websiteURI, string iconURI, string socialURI)",
  "event LaunchListingChanged(bytes32 indexed poolId, address indexed actor, uint8 previous, uint8 current, string reason)",
]);

/**
 * LaunchpadKitV2 (packages/launchpad/src/LaunchpadKitV2.sol, events declared in
 * src/interfaces/ILaunchpadKitV2.sol) and the two lockers
 * (src/LatchLPLocker.sol + interfaces/ILatchLPLocker.sol, src/LatchBinLPLocker.sol +
 * interfaces/ILatchBinLPLocker.sol). VENDORED here, not imported from
 * @latchprotocol/sdk: the SDK ships no kit v2 or locker ABI. Read out of the Foundry
 * artifacts (packages/launchpad/foundry-out/<Contract>.sol/<Contract>.json) on
 * 2026-09-14 and diffed against them by test/abis.test.ts. ABI types: `Currency` is
 * `address`, `PoolId` is `bytes32`, `LegKind` is `uint8` (0 CL, 1 Bin).
 *
 * `LaunchLegCreated` is emitted from the linked library `LaunchLegs` by DELEGATECALL,
 * so it carries the KIT's address. The lockers' `Claimed` is byte-identical to
 * RevShareHook's `Claimed`; decoding is keyed on the emitting address, never topic0.
 */
export const KIT_V2_EVENTS_ABI = parseAbi([
  "event LaunchCreated(address indexed token, address indexed creator, address indexed tenant, address launcher, address operator, uint256 totalSupply, uint256 seedSupply, uint8 legCount, uint40 startTime, uint256 protocolFeeWei, address integrator, uint256 integratorFeeWei)",
  "event LaunchLegCreated(address indexed token, bytes32 indexed poolId, address indexed quote, uint8 kind, uint256 lockId, uint256 launchTokenSeeded, uint16 weightBps)",
  "event LaunchReconfigured(address indexed token, address indexed operator, uint40 startTime, uint32 decaySeconds, uint24 initialFeeBips, uint24 finalFeeBips, bool enabled)",
  "event LaunchFeeIncreaseScheduled(uint256 currentWei, uint256 newWei, uint64 effectiveAt)",
  "event LaunchFeeChanged(uint256 previousWei, uint256 newWei)",
  "event PendingLaunchFeeCancelled(uint256 cancelledWei, uint64 effectiveAt)",
  "event FeesCredited(address indexed account, uint256 amount)",
  "event FeesClaimed(address indexed account, address indexed to, uint256 amount)",
  "event TenantConfigured(address indexed tenant, address indexed integrator, uint16 integratorBps, uint96 integratorLaunchFeeWei, uint8 allowedPresets, uint8 allowedBinShapes, bool restrictQuotes, bool active)",
  "event TenantQuoteSet(address indexed tenant, address indexed quote, bool allowed)",
  "event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
]);

export const CL_LP_LOCKER_EVENTS_ABI = parseAbi([
  "event PositionLocked(uint256 indexed tokenId, bytes32 indexed poolId, address indexed creator, address integrator, uint16 creatorBps, uint16 integratorBps, uint16 protocolBps, uint128 liquidity, address from, address operator)",
  "event FeesCollected(uint256 indexed tokenId, address indexed currency, address indexed caller, uint256 amount, uint256 creatorShare, uint256 integratorShare, uint256 protocolShare)",
  "event Claimed(address indexed account, address indexed currency, address indexed to, uint256 amount)",
  "event Skimmed(address indexed currency, address indexed caller, uint256 amount)",
  "event CreatorTransferStarted(uint256 indexed tokenId, address indexed creator, address indexed pending)",
  "event CreatorTransferred(uint256 indexed tokenId, address indexed previousCreator, address indexed newCreator)",
]);

export const BIN_LP_LOCKER_EVENTS_ABI = parseAbi([
  "event BinsLocked(uint256 indexed lockId, bytes32 indexed poolId, address indexed creator, address integrator, uint16 creatorBps, uint16 integratorBps, uint16 protocolBps, uint24[] binIds, uint256[] shares, uint256[] principals, address from)",
  "event FeeSharesBurned(uint256 indexed lockId, address indexed caller, uint256[] binIds, uint256[] sharesBurned)",
  "event FeesCollected(uint256 indexed lockId, address indexed currency, address indexed caller, uint256 amount, uint256 creatorShare, uint256 integratorShare, uint256 protocolShare)",
  "event Claimed(address indexed account, address indexed currency, address indexed to, uint256 amount)",
  "event Skimmed(address indexed currency, address indexed caller, uint256 amount)",
  "event CreatorTransferStarted(uint256 indexed lockId, address indexed creator, address indexed pending)",
  "event CreatorTransferred(uint256 indexed lockId, address indexed previousCreator, address indexed newCreator)",
]);

/**
 * LaunchpadKitV2 functions the admin panel READS or PREPARES calldata for. Same
 * vendoring and artifact diff as KIT_V2_EVENTS_ABI. The owner's only functions are
 * setLaunchFee, cancelPendingLaunchFee and the Ownable2Step transfer
 * (test_ACCESS_ownerHasNoOtherPower); renounceOwnership reverts RenounceDisabled.
 */
export const KIT_V2_FUNCTIONS_ABI = parseAbi([
  "function setLaunchFee(uint256 newFeeWei)",
  "function cancelPendingLaunchFee()",
  "function launchFeeWei() view returns (uint256)",
  "function pendingLaunchFee() view returns (uint256 feeWei, uint64 effectiveAt)",
  "function maxLaunchFeeWei() view returns (uint256)",
  "function launchFeeNoticeSeconds() view returns (uint32)",
  "function maxIntegratorLaunchFeeWei() view returns (uint256)",
  "function protocolFeeRecipient() view returns (address)",
  "function feesOwed(address account) view returns (uint256)",
  "function totalFeesOwed() view returns (uint256)",
  "function clLocker() view returns (address)",
  "function binLocker() view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
]);

/** LaunchpadKitV2 custom errors the prepared owner calls can revert with. */
export const KIT_V2_ERRORS_ABI = parseAbi([
  "error LaunchFeeAboveCap(uint256 feeWei, uint256 capWei)",
  "error NoPendingLaunchFee()",
  "error RenounceDisabled()",
]);

/**
 * OpenZeppelin TimelockController (v5). RoleGranted/RoleRevoked come from its
 * AccessControl base and are how PROPOSER/EXECUTOR/CANCELLER holders are
 * enumerated (constructor grants emit them too).
 */
export const TIMELOCK_EVENTS_ABI = parseAbi([
  "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
  "event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)",
  "event CallSalt(bytes32 indexed id, bytes32 salt)",
  "event Cancelled(bytes32 indexed id)",
  "event MinDelayChange(uint256 oldDuration, uint256 newDuration)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
]);

/**
 * Timelock functions the admin panel PREPARES calldata for. Read from
 * packages/governance/foundry-out/LatchTimelock.sol/LatchTimelock.json 2026-09-14.
 */
export const TIMELOCK_FUNCTIONS_ABI = parseAbi([
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt) payable",
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) pure returns (bytes32)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function getTimestamp(bytes32 id) view returns (uint256)",
  "function getMinDelay() view returns (uint256)",
  "function cancel(bytes32 id)",
]);

export const OWNABLE2STEP_FUNCTIONS_ABI = parseAbi(["function acceptOwnership()"]);

/** CLPoolManagerOwner / BinPoolManagerOwner (packages/core PausableRole). */
export const POOL_MANAGER_OWNER_EVENTS_ABI = parseAbi([
  "event PausableRoleGranted(address indexed account)",
  "event PausableRoleRevoked(address indexed account)",
]);

/** LatchRegistry.setListing — Listing enum: 0 Active, 1 Deprecated, 2 Malicious (ILatchRegistry.sol). */
export const REGISTRY_FUNCTIONS_ABI = parseAbi([
  "function setListing(address hook, uint8 status, string reason)",
]);
export const REGISTRY_LISTING = { Active: 0, Deprecated: 1, Malicious: 2 } as const;
/** LatchRegistry.MAX_NOTE_BYTES. */
export const REGISTRY_MAX_NOTE_BYTES = 512;

/** `guardian()` on LatchProtocolFeeControllerV2 and RevShareHook; `treasury()` on the V2 controller. */
export const GUARDIAN_VIEWS_ABI = parseAbi([
  "function guardian() view returns (address)",
]);
export const TREASURY_VIEWS_ABI = parseAbi([
  "function treasury() view returns (address)",
]);

/** Views the snapshot jobs read. Worker-only: no HTTP route reaches these. */
export const CL_POOL_MANAGER_VIEWS_ABI = parseAbi([
  "function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 id) view returns (uint128 liquidity)",
  "function protocolFeesAccrued(address currency) view returns (uint256)",
]);

export const BIN_POOL_MANAGER_VIEWS_ABI = parseAbi([
  "function getSlot0(bytes32 id) view returns (uint24 activeId, uint24 protocolFee, uint24 lpFee)",
  "function protocolFeesAccrued(address currency) view returns (uint256)",
]);

export const REVSHARE_VIEWS_ABI = parseAbi([
  "function totalTaken(bytes32 poolId, address currency) view returns (uint256)",
]);

export const ERC20_VIEWS_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

/** Robinhood stock token (beacon proxy over `Stock`). Read 2026-09-13 on NVDA. */
export const STOCK_TOKEN_VIEWS_ABI = parseAbi([
  "function uiMultiplier() view returns (uint256)",
]);

/**
 * `tokenPaused()` — the issuer's global pause. The name is taken from the
 * `PausableStockToken` fixture in packages/launchpad/test/utils/LockerFixture.sol,
 * which models the Stock token's issuer powers; it has NOT been read against the
 * live Stock implementation from here. A token that reverts on it records null
 * ("does not answer"), never false.
 */
export const STOCK_TOKEN_PAUSE_ABI = parseAbi([
  "function tokenPaused() view returns (bool)",
]);

export const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const OWNABLE_VIEWS_ABI = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
]);

export const ACCESS_CONTROL_VIEWS_ABI = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
]);

export const SAFE_VIEWS_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

/** Selectors CLAUDE.md puts on the permanent do-not-queue / review list. */
export const HAZARD_SELECTORS: ReadonlyMap<Hex, { signature: string; hazard: string; note: string }> = new Map(
  (
    [
      ["function renounceOwnership()", "renounceOwnership", "Permanent do-not-queue. Destroys owner powers irreversibly; use transferOwnership."],
      ["function updateDelay(uint256)", "updateDelay", "Timelock delay change. updateDelay(0) removes the tier; nothing re-validates the floor."],
      ["function registerApp(address)", "registerApp", "Vault.registerApp is irreversible and grants permanent fund access."],
      ["function grantRole(bytes32,address)", "grantRole", "Role grant. Inspect the role and account."],
      ["function revokeRole(bytes32,address)", "revokeRole", "Role revocation. A revoked CANCELLER leaves no veto."],
      ["function renounceRole(bytes32,address)", "renounceRole", "Role renunciation."],
      ["function setProtocolFeeController(address)", "setProtocolFeeController", "Replaces fee authority over every pool."],
      ["function transferPoolManagerOwnership(address)", "transferPoolManagerOwnership", "Moves pool-manager ownership."],
    ] as const
  ).map(([sig, hazard, note]) => [toFunctionSelector(sig), { signature: sig, hazard, note }]),
);

/** Well-known selectors for readable timelock rows (non-hazard). */
export const KNOWN_SELECTORS: ReadonlyMap<Hex, string> = new Map(
  [
    "function transferOwnership(address)",
    "function acceptOwnership()",
    "function setPaused(bool)",
    "function setGuardian(address)",
    "function collect(address,address,uint256,address)",
    "function setTreasury(address)",
    "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
    "function execute(address,uint256,bytes,bytes32,bytes32)",
    "function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)",
    "function executeBatch(address[],uint256[],bytes[],bytes32,bytes32)",
    "function cancel(bytes32)",
    "function sweep(address,address)",
    "function setListing(address,uint8,string)",
    "function unpausePoolManager()",
    "function pausePoolManager()",
  ].map((sig) => [toFunctionSelector(sig), sig]),
);

/**
 * ABI used to DECODE the arguments of a queued timelock call for display. Covers
 * the hazard list and the known list above; anything else shows selector + raw data.
 */
export const TIMELOCK_CALL_DECODE_ABI = parseAbi([
  "function renounceOwnership()",
  "function updateDelay(uint256 newDelay)",
  "function registerApp(address app)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
  "function renounceRole(bytes32 role, address callerConfirmation)",
  "function setProtocolFeeController(address controller)",
  "function transferPoolManagerOwnership(address newPoolManagerOwner)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function setPaused(bool paused)",
  "function setGuardian(address guardian)",
  "function collect(address poolManager, address currency, uint256 amount, address recipient)",
  "function sweep(address poolManager, address currency)",
  "function setTreasury(address treasury)",
  "function setListing(address hook, uint8 status, string reason)",
  "function cancel(bytes32 id)",
]);
