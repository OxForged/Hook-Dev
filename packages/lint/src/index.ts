// SPDX-License-Identifier: MIT
/**
 * `@latchprotocol/lint` - static analysis for AMM hooks.
 *
 * A hook is a small contract that runs inside somebody else's swap, and the
 * ways it goes wrong are not the ways ordinary contracts go wrong. This package
 * encodes the ones that have actually been found: a callback with no
 * pool-manager guard, a permission bitmap that disagrees with the code, a fee
 * override the pool silently discards, per-user accounting keyed on a value
 * that is the router rather than the user.
 *
 * The rules work on any hook that compiles with Foundry, including Uniswap v4
 * hooks, because they read the solc AST rather than anything Latch-specific.
 *
 * @packageDocumentation
 */

export { analyze, NoCompilerOutputError } from "./analyze.js";
export type { AnalyzeOptions, AnalysisResult, HookSummary } from "./analyze.js";

export {
  SEVERITIES,
  meetsThreshold,
  parseSeverity,
  severityRank,
  sortFindings,
} from "./finding.js";
export type { Confidence, Finding, Severity } from "./finding.js";

export { ALL_RULES } from "./rules/index.js";
export type { Rule, RuleContext, FindingDraft } from "./rules/index.js";

export { renderText } from "./report/text.js";
export type { TextReportOptions } from "./report/text.js";
export { buildJsonReport } from "./report/json.js";
export type { JsonReport } from "./report/json.js";

export { run } from "./cli/run.js";
export type { CliResult } from "./cli/run.js";
export { parseArgs, USAGE, UsageError } from "./cli/args.js";
export type { CliOptions } from "./cli/args.js";

export { findHookContracts, asHookContract } from "./model/hook.js";
export type { HookContract, CallbackBinding, CallbackStatus, HookDialect } from "./model/hook.js";

export { loadCompilation } from "./ast/compilation.js";
export type { Compilation, LoadedSource } from "./ast/compilation.js";
export { findProjectRoot, readFoundryConfig } from "./ast/project.js";
export type { FoundryProject } from "./ast/project.js";
