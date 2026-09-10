// SPDX-License-Identifier: MIT
/** Machine-readable output for CI. */

import type { AnalysisResult } from "../analyze.js";
import type { Severity } from "../finding.js";

/** The `--json` document. Stable shape; new fields may be added. */
export interface JsonReport {
  readonly version: 1;
  readonly tool: "latch-lint";
  readonly projectRoot: string;
  readonly astOrigin: string;
  readonly rulesRun: readonly string[];
  readonly warnings: readonly string[];
  readonly hooks: AnalysisResult["hooks"];
  readonly summary: {
    readonly total: number;
    readonly bySeverity: Readonly<Record<Severity, number>>;
    readonly failOn: Severity;
    readonly failing: number;
    readonly exitCode: number;
  };
  readonly findings: AnalysisResult["findings"];
}

/** Builds the JSON document. */
export function buildJsonReport(
  result: AnalysisResult,
  failOn: Severity,
  failing: number,
  exitCode: number,
): JsonReport {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of result.findings) bySeverity[finding.severity] += 1;

  return {
    version: 1,
    tool: "latch-lint",
    projectRoot: result.projectRoot,
    astOrigin: result.astOrigin,
    rulesRun: result.rulesRun,
    warnings: result.warnings,
    hooks: result.hooks,
    summary: {
      total: result.findings.length,
      bySeverity,
      failOn,
      failing,
      exitCode,
    },
    findings: result.findings,
  };
}
