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

/** OpenZeppelin TimelockController (v5). */
export const TIMELOCK_EVENTS_ABI = parseAbi([
  "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
  "event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)",
  "event CallSalt(bytes32 indexed id, bytes32 salt)",
  "event Cancelled(bytes32 indexed id)",
  "event MinDelayChange(uint256 oldDuration, uint256 newDuration)",
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
    "function cancel(bytes32)",
  ].map((sig) => [toFunctionSelector(sig), sig]),
);
