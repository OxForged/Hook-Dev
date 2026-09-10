// SPDX-License-Identifier: MIT
/** Findings, severities and thresholds. */

/** How bad it is if the finding is real. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** How sure the analysis is that the finding is real. */
export type Confidence = "high" | "medium" | "low";

/** Ordered worst-first. */
export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

const RANK: Readonly<Record<Severity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Numeric rank; higher is worse. */
export function severityRank(severity: Severity): number {
  return RANK[severity];
}

/** True when `severity` is at least as bad as `threshold`. */
export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return RANK[severity] >= RANK[threshold];
}

/** Parses a severity name, case-insensitively. */
export function parseSeverity(value: string): Severity | undefined {
  const lower = value.toLowerCase();
  return SEVERITIES.find((s) => s === lower);
}

/** One reported problem. */
export interface Finding {
  /** Stable rule id, e.g. `LATCH-001`. */
  readonly rule: string;
  /** Short rule title. */
  readonly title: string;
  readonly severity: Severity;
  readonly confidence: Confidence;
  /** Contract the finding belongs to. */
  readonly contract: string;
  /** Source path, as solc recorded it. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** What is wrong, in this contract's terms. */
  readonly message: string;
  /** What to change. Concrete, not "consider reviewing". */
  readonly fix: string;
  /** The offending source line, when available. */
  readonly snippet: string | undefined;
}

/** Worst-first, then by file and line, so output is stable. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      RANK[b.severity] - RANK[a.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule) ||
      a.message.localeCompare(b.message),
  );
}
