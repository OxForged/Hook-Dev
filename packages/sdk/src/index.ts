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

// --- indexer model ---------------------------------------------------------
export * as indexer from "./indexer/index.js";

// Chain RPC endpoints and the auto-failover transport.
export * from "./chains/endpoints.js"
export * from "./chains/transport.js"
