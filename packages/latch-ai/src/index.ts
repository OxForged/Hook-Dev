// SPDX-License-Identifier: MIT
/**
 * LatchAI - the plugin that lets an AI agent understand and use Latch Protocol.
 *
 * Independently authored, MIT-licensed, and dependent on no LLM SDK and no
 * agent framework. It is usable from any of them precisely because it depends
 * on none of them: what it exports is a set of typed, documented capabilities
 * plus thin adapters that reshape them for whatever runtime you already have.
 *
 * ```ts
 * import { createLatchTools } from "@latchprotocol/latch-ai";
 * import { toAnthropicTools } from "@latchprotocol/latch-ai/adapters/anthropic";
 *
 * const latch = createLatchTools();          // Sepolia, read-only, no key
 * const tools = toAnthropicTools(latch);     // hand to your model
 * const result = await latch.call("latch_lookup", { address });
 * ```
 *
 * The defaults are the security posture: read-only, no key read, nothing that
 * can send a transaction. See `src/tools/maintenance.ts` for what it takes to
 * change that and why the boundary sits where it does.
 *
 * @packageDocumentation
 */

// --- the toolset ------------------------------------------------------------
export { LatchToolset, createLatchTools } from "./toolset.js";
export {
  createContext,
  UnsupportedChainError,
  type LatchContext,
  type LatchToolsOptions,
  type MaintenanceMode,
  type MaintenanceOptions,
} from "./context.js";

// --- the tool contract ------------------------------------------------------
export {
  err,
  ok,
  sanitizeUntrusted,
  UNTRUSTED_TEXT_CAVEAT,
  type AnyLatchTool,
  type JsonSchema,
  type JsonSchemaProperty,
  type JsonValue,
  type LatchTool,
  type ToolAccess,
  type ToolErr,
  type ToolOk,
  type ToolResult,
} from "./types.js";
export { toJson, NotJsonSerialisable } from "./json.js";

// --- individual tool factories, for hand-assembled toolsets ------------------
export { protocolStatusTool } from "./tools/status.js";
export { lookupTool } from "./tools/lookup.js";
export { listTool } from "./tools/list.js";
export { explainPermissionsTool } from "./tools/permissions.js";
export { assessRiskTool } from "./tools/risk.js";
export { maintenanceTool } from "./tools/maintenance.js";

// --- pure logic, reusable without a chain connection ------------------------
// Both are side-effect free and network free, which is what makes them
// testable and what makes them safe to run on untrusted input.
export {
  explainPermissions,
  type PermissionExplanation,
  type PermissionFinding,
} from "./explain/permissions.js";
export {
  assessRisk,
  type AssessedWarning,
  type RegisteredInput,
  type RegistryStanding,
  type RiskAssessment,
  type RiskAssessmentInput,
  type UnregisteredInput,
  type WarningSeverity,
} from "./explain/risk.js";

// --- chain reads, for callers who want the data without the tool envelope ---
export {
  listLatchRecords,
  lookupLatch,
  readProtocolStatus,
  requireAddress,
  tryCountPools,
  tryReadHookBitmap,
  type LatchLookup,
  type LatchPage,
  type PoolCensus,
  type ProtocolStatusRead,
} from "./reads.js";

// --- deployments ------------------------------------------------------------
export {
  DEFAULT_CHAIN_ID,
  DEPLOYMENTS,
  SEPOLIA_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  deploymentFor,
  explorerAddressUrl,
  type LatchDeployment,
} from "./deployments.js";

// --- ABIs this package can reach ---------------------------------------------
// Exported so an integrator can audit the complete call surface without
// reading the source. If a function is not in here, this package cannot call it.
export {
  DISTRIBUTOR_ABI,
  FEE_CONTROLLER_ABI,
  HOOK_BITMAP_ABI,
  REV_SHARE_HOOK_ABI,
  TIMELOCK_ABI,
  VAULT_ABI,
} from "./abi.js";
