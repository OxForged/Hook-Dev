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
  RISK_CLASSES,
  VERIFICATION_LEVELS,
  classifyRiskClass,
  decodeHookRecord,
  describeCapabilities,
  formatHookTrust,
  hookPermissionState,
  isValidHookBitmap,
  listingFromUint8,
  listingToUint8,
  permissionsAreAttestable,
  riskClassFromUint8,
  riskClassOf,
  riskClassToUint8,
  summarizeHook,
  verificationFromUint8,
  verificationRank,
  verificationToUint8,
} from "./registry/index.js";
export type {
  HookCapabilities,
  HookMetadata,
  HookPermissionState,
  HookRecord,
  HookTrustSummary,
  HookWarning,
  Listing,
  RawHookRecord,
  RiskClass,
  Verification,
} from "./registry/index.js";

// --- launchpad -------------------------------------------------------------
export * as launchpad from "./launchpad/index.js";
export {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LAUNCHPAD_KIT_ABI,
  LAUNCH_GUARD_HOOK_ABI,
} from "./launchpad/index.js";

// --- indexer model ---------------------------------------------------------
export * as indexer from "./indexer/index.js";

// Chain RPC endpoints and the auto-failover transport.
export * from "./chains/endpoints.js"
export * from "./chains/transport.js"
