// SPDX-License-Identifier: MIT
/** Shared analysis helpers for the test suite. */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, type AnalysisResult, type Finding } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The self-contained fixture project. */
export const FIXTURES_SRC = join(here, "fixtures", "src");

/** The protocol's real hooks - correct code, so a finding here is a linter bug. */
export const REAL_HOOKS_SRC = resolve(here, "..", "..", "hooks", "src");

let fixtureResult: AnalysisResult | undefined;

/**
 * Analyses the fixture project.
 *
 * `build: false` is deliberate: the fixtures are compiled by `npm run fixtures`,
 * so a test failure means a rule changed, never that a background build did.
 */
export function analyzeFixtures(): AnalysisResult {
  fixtureResult ??= analyze(FIXTURES_SRC, { build: false });
  return fixtureResult;
}

/** Findings reported against one contract. */
export function findingsFor(result: AnalysisResult, contract: string): Finding[] {
  return result.findings.filter((finding) => finding.contract === contract);
}

/** Rule ids reported against one contract, de-duplicated and sorted. */
export function rulesFor(result: AnalysisResult, contract: string): string[] {
  return [...new Set(findingsFor(result, contract).map((finding) => finding.rule))].sort();
}

/** Renders findings compactly, so an assertion failure says what went wrong. */
export function describeFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "(none)";
  return findings
    .map((finding) => `${finding.rule} ${finding.severity} ${finding.file}:${finding.line} ${finding.message.slice(0, 140)}`)
    .join("\n");
}
