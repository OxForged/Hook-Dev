// SPDX-License-Identifier: MIT
/**
 * LatchProtocol SDK.
 *
 * Independently authored, MIT-licensed. It is derived from the protocol's
 * compiled ABIs, never from its Solidity sources, so building a hook against
 * this package carries no obligation from the core contracts' GPL licence.
 *
 * @packageDocumentation
 */

// --- core domain types -----------------------------------------------------
export * from "./types/currency.js";
export * from "./types/balanceDelta.js";
export * from "./types/fee.js";
export * from "./types/parameters.js";
export * from "./types/poolKey.js";

// --- hook permissions ------------------------------------------------------
export * from "./hooks/bitmap.js";

// --- events ----------------------------------------------------------------
export * as events from "./events/index.js";
export {
  ALL_EVENT_TOPICS,
  EVENT_DESCRIPTORS,
  EVENT_TOPICS,
  EVENT_COUNT,
  UNIQUE_EVENT_SIGNATURE_COUNT,
  LATCH_PROTOCOL_EVENTS_ABI,
  LATCH_PROTOCOL_EVENT_ABIS,
  decodeProtocolLog,
  descriptorFor,
  descriptorsForTopic,
  isProtocolEventTopic,
} from "./events/index.js";
export type {
  ContractName,
  EventDescriptor,
  LatchProtocolEvent,
  DecodedEventBase,
} from "./events/index.js";

// --- hook registry ---------------------------------------------------------
// The on-chain hook marketplace. Three independent axes - what a curator
// attested (Verification), whether the registry still recommends it (Listing),
// and what the code can do (RiskClass, derived from the bitmap alone).
export * as registry from "./registry/index.js";
export {
  LATCH_HOOK_REGISTRY_ABI,
  LATCH_HOOK_REGISTRY_EVENTS_ABI,
  LISTING_STATUSES,
  PERMISSION_SOURCES,
  RISK_CLASSES,
  VERIFICATION_LEVELS,
  classifyRiskClass,
  decodeLatchRecord,
  describeCapabilities,
  effectivePermissions,
  formatLatchTrust,
  hookPermissionState,
  isValidHookBitmap,
  listingFromUint8,
  listingToUint8,
  permissionSourceFromUint8,
  permissionsAreAttestable,
  riskClassFromUint8,
  riskClassOf,
  riskClassToUint8,
  summarizeLatch,
  verificationFromUint8,
  verificationRank,
  verificationToUint8,
} from "./registry/index.js";
export type {
  EffectivePermissions,
  HookCapabilities,
  LatchMetadata,
  HookPermissionState,
  LatchRecord,
  HookTrustSummary,
  HookWarning,
  Listing,
  PermissionSource,
  RawLatchRecord,
  RiskClass,
  Verification,
} from "./registry/index.js";

// --- launchpad -------------------------------------------------------------
export * as launchpad from "./launchpad/index.js";
export {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LAUNCHPAD_KIT_ABI,
  LAUNCH_GUARD_HOOK_ABI,
  /* The block-numbered kit and hook still deployed on Robinhood. Choose by
     `LatchDeployment.durationClocks`, never by trial decode. */
  LAUNCHPAD_KIT_BLOCK_ABI,
  LAUNCH_GUARD_HOOK_BLOCK_ABI,
} from "./launchpad/index.js";
/* Price, presets and parameter validation. `sqrtPriceForLaunch` is the
   function `LaunchParams.sqrtPriceX96`'s own docstring tells integrators to
   use — it was named by the contract before it existed here, which left the
   one parameter that is PERMANENT at `initialize` to hand-rolled Q64.96
   arithmetic. Shipping it in the first release rather than after somebody
   opens a pool at 10^12 times the intended price. */
export {
  LAUNCH_GUARD_LIMITS,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  PRESET,
  PRESET_NAMES,
  PRESET_PARAMS,
  Q96,
  Q192,
  assertLaunchParams,
  bigintSqrt,
  blocksToSeconds,
  buildLaunchParams,
  describeLaunch,
  formatPips,
  humanDuration,
  launchParamsToBlockTuple,
  launchParamsToTuple,
  parseDecimal,
  parsePreset,
  presetName,
  priceFromSqrtPriceX96,
  secondsToBlocks,
  sqrtPriceForLaunch,
  sqrtPriceX96FromPrice,
  sqrtPriceX96FromRatio,
  validateLaunchParams,
  InvalidPriceError,
  PriceOutOfRangeError,
} from "./launchpad/index.js";
export type {
  HookListingParams,
  LatchMetadataInput,
  BlockLaunchLimits,
  LaunchIssue,
  LaunchLimits,
  LaunchParams,
  TimestampLaunchLimits,
  LaunchPrice,
  LaunchPriceInput,
  LaunchSummary,
  PresetName,
  PresetParams,
  PresetValue,
  PriceInput,
  Rational,
  SeedParams,
} from "./launchpad/index.js";
/* LaunchpadKitV2 - NOT DEPLOYED anywhere yet (`LatchDeployment.launchpadV2` is
   all null). Locked CL + Bin launches: predict the token, build the leg keys,
   pick a single-sided CL range the kit accepts, build or pre-validate a Bin
   shape (rules R1-R6), quote the msg.value, and validate the whole call. */
export {
  BIN_LEG_MAX_INITIAL_FEE_PIPS,
  BIN_SHAPE,
  BIN_SHAPE_NAMES,
  BIN_WEIGHT_PRECISION,
  KIT_V2_BIN_HOOK_BITMAP,
  KIT_V2_BPS,
  KIT_V2_CL_HOOK_BITMAP,
  KIT_V2_DEPLOY_SCRIPT_CAPS,
  KIT_V2_LEG_FEE,
  KIT_V2_MAX_START_DELAY_SECONDS,
  LATCH_BIN_LP_LOCKER_ABI,
  LATCH_LP_LOCKER_ABI,
  LAUNCHPAD_KIT_V2_ABI,
  LAUNCHPAD_KIT_V2_REVERT_ABI,
  LAUNCH_LEGS_ABI,
  LAUNCH_TOKEN_FACTORY_ABI,
  LEG_KIND,
  MAX_TICK,
  MIN_TICK,
  binLegIds,
  buildBinShape,
  checkKitV2CLLeg,
  computeKitV2LegKey,
  computeLaunchValue,
  decodePendingLaunchFee,
  decodeTenantConfig,
  kitV2CLLaunchRange,
  kitV2LaunchSalt,
  kitV2LegSupplies,
  launchTokenIsCurrency0,
  predictLaunchTokenAddress,
  predictLaunchTokenChecked,
  readKitV2Caps,
  readLaunchTokenFactoryInputs,
  readLaunchValue,
  readPredictedLaunchToken,
  readTenantConfig,
  singleSidedLiquidity,
  sqrtRatioAtTick,
  tickAtSqrtRatio,
  validateBinDistribution,
  validateLaunchParamsV2,
} from "./launchpad/index.js";
export type {
  BinDistribution,
  BinShapeName,
  BinShapeViolation,
  BinLegParamsV2,
  CLLegParamsV2,
  CLLegProblem,
  DecodedTenantConfig,
  KitV2Caps,
  KitV2LegEnv,
  KitV2LegKey,
  LaunchParamsV2,
  LaunchResultV2,
  LaunchV2Issue,
  LaunchV2ValidationContext,
  LaunchValueQuote,
  LegKindName,
  LegParamsV2,
  PendingLaunchFee,
  PredictLaunchTokenArgs,
  ScheduleParamsV2,
  TenantConfigV2,
} from "./launchpad/index.js";

// --- trading: router, quoter, position manager ------------------------------
/* The three contracts a DEX front end calls. The address book named them long
   before the SDK could encode a call to any of them, which left integrators
   pasting interfaces out of a block explorer — a snapshot with no provenance,
   no failure when a signature changes, and a decode that returns a plausible
   number rather than an error. */
export * as trading from "./trading/index.js";
export {
  CL_POSITION_MANAGER_ABI,
  CL_QUOTER_ABI,
  UNIVERSAL_ROUTER_ABI,
  TradingAbis,
  applySlippage,
  applySlippageToInput,
  quoteExactInputSingle,
  quoteExactOutputSingle,
  zeroForOne,
} from "./trading/index.js";
export type { QuoteExactSingleParams } from "./trading/index.js";

// --- indexer model ---------------------------------------------------------
export * as indexer from "./indexer/index.js";

// Chain RPC endpoints and the auto-failover transport.
export * from "./chains/endpoints.js"
export * from "./chains/transport.js"
// The block number CONTRACTS see, which on an Arbitrum Nitro chain is not the
// one `eth_blockNumber` reports. Compare every contract-stored block number
// against `readContractBlockNumber`; keep `getBlockNumber` for log ranges.
export * from "./chains/clock.js"

// --- deployed addresses ----------------------------------------------------
// The address book: every deployed Latch contract, per chain, with token
// decimals. THE single source of truth — `apps/web/src/lib/chain.ts` and the
// `create-latch-dex` template both re-export this rather than restating it.
// `null` means not-yet-deployed and is never the zero address; see the module
// header for why that distinction is load-bearing.
export * as deployments from "./deployments/index.js";
export {
  LATCH_CHAIN_IDS,
  LATCH_DEPLOYMENTS,
  /**
   * Re-exported under a distinct name ON PURPOSE. `types/currency.ts` already
   * exports `NATIVE_CURRENCY` — the zero-address sentinel meaning "this pool leg
   * is the chain's native asset" — and this barrel star-exports that module.
   *
   * An explicit re-export silently WINS over a star export in both TypeScript
   * and ESM: no error, no warning, the star-exported binding just stops existing
   * at the root. Exporting the per-chain table under its own name here meant
   * `NATIVE_CURRENCY` resolved to an object, and `isNativeCurrency(NATIVE_CURRENCY)`
   * threw `toLowerCase is not a function` at the consumer rather than here.
   *
   * The table is unchanged and still `NATIVE_CURRENCY` on the `deployments`
   * namespace and the `./deployments` subpath. Guarded by `test/public-api.test.ts`.
   */
  NATIVE_CURRENCY as CHAIN_NATIVE_CURRENCIES,
  REDEPLOYABLE_CONTRACTS,
  explorerAddressUrl,
  explorerTxUrl,
  getDeployment,
  isLatchChainId,
  requireContract,
  requireDeployment,
  requireDurationClock,
  requireLaunchpadV2,
  revShareHookRecord,
  tokenByAddress,
  tokenBySymbol,
} from "./deployments/index.js";
export type {
  ContractKey,
  DurationClock,
  RevShareHookRecord,
  RevSharePendingShape,
  LatchChainId,
  LatchChainKey,
  LatchDeployment,
  LaunchpadV2Deployment,
  NativeCurrency,
  RedeployableContract,
  ReferencePool,
  TokenInfo,
} from "./deployments/index.js";

// --- RevShareHook pending configuration: three shapes, chosen by address -----
// `getPendingConfig` has a 7-word block shape, an 8-word block shape and an
// 8-word TIMESTAMP shape. The last two are indistinguishable by length, so the
// shape comes from `revShareHookRecord` (or the hook's own `CLOCK_MODE()`).
export {
  CLOCK_MODE_CALLDATA,
  REVSHARE_PENDING_CONFIG_WORDS,
  REVSHARE_SHAPE_CLOCK,
  RevSharePendingConfigShapeError,
  TIMESTAMP_CLOCK_MODE,
  decodeRevSharePendingConfig,
  encodeGetPendingConfig,
  inferRevSharePendingShape,
  revShareProposalStatus,
} from "./revshare/pendingConfig.js";
export type {
  DecodedRevSharePendingConfig,
  RevSharePendingParams,
  RevShareProposalStatus,
} from "./revshare/pendingConfig.js";
