// SPDX-License-Identifier: MIT
/** Human-readable output. */

import { formatHookPermissions } from "@latchprotocol/sdk";
import type { AnalysisResult } from "../analyze.js";
import type { Finding, Severity } from "../finding.js";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;

const SEVERITY_COLOUR: Readonly<Record<Severity, string>> = {
  critical: `${ESC}[41m${ESC}[97m`,
  high: `${ESC}[31m`,
  medium: `${ESC}[33m`,
  low: `${ESC}[36m`,
  info: `${ESC}[2m`,
};

/** Formatting knobs. */
export interface TextReportOptions {
  readonly colour: boolean;
  /** Terminal width for wrapping prose. */
  readonly width: number;
}

function paint(text: string, colour: string, enabled: boolean): string {
  return enabled ? `${colour}${text}${RESET}` : text;
}

function wrap(text: string, width: number, indent: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim().length === 0) {
      lines.push("");
      continue;
    }
    // A pre-indented block is a code suggestion: keep it verbatim.
    if (/^\s{2,}/.test(paragraph)) {
      lines.push(indent + paragraph);
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (current.length === 0) current = word;
      else if (current.length + 1 + word.length <= width) current += ` ${word}`;
      else {
        lines.push(indent + current);
        current = word;
      }
    }
    if (current.length > 0) lines.push(indent + current);
  }
  return lines;
}

function renderFinding(finding: Finding, options: TextReportOptions): string {
  const { colour, width } = options;
  const body = Math.max(40, width - 4);
  const badge = paint(` ${finding.severity.toUpperCase()} `, SEVERITY_COLOUR[finding.severity], colour);
  const head =
    `${badge} ${paint(finding.rule, BOLD, colour)} ${finding.title} ` +
    paint(`[confidence: ${finding.confidence}]`, DIM, colour);
  const location = paint(
    `  ${finding.file}:${finding.line}:${finding.column}  (${finding.contract})`,
    DIM,
    colour,
  );

  const lines = [head, location];
  if (finding.snippet !== undefined && finding.snippet.trim().length > 0) {
    lines.push(paint(`  ${String(finding.line).padStart(5)} | `, DIM, colour) + finding.snippet.trim());
  }
  lines.push("");
  lines.push(...wrap(finding.message, body, "  "));
  lines.push("");
  lines.push(`  ${paint("Fix:", BOLD, colour)}`);
  lines.push(...wrap(finding.fix, body, "    "));
  return lines.join("\n");
}

/** Renders the full report. */
export function renderText(result: AnalysisResult, options: TextReportOptions): string {
  const { colour, width } = options;
  const out: string[] = [];

  out.push(paint("latch-lint", BOLD, colour) + paint(`  -  AST: ${result.astOrigin}`, DIM, colour));

  if (result.hooks.length > 0) {
    out.push("");
    out.push(paint("Analysed", BOLD, colour));
    for (const hook of result.hooks) {
      const permissions =
        hook.declaredBitmap === undefined
          ? hook.isAbstract
            ? "abstract; no concrete bitmap"
            : "bitmap not statically determinable"
          : formatHookPermissions(hook.poolType === "BIN" ? "BIN" : "CL", hook.declaredBitmap);
      out.push(`  ${hook.name}  ${paint(hook.file, DIM, colour)}`);
      out.push(paint(`    ${hook.dialect} / ${hook.poolType} - declares ${permissions}`, DIM, colour));
      out.push(
        paint(
          `    implements: ${hook.implementedCallbacks.length === 0 ? "(none)" : hook.implementedCallbacks.join(", ")}`,
          DIM,
          colour,
        ),
      );
    }
  }

  for (const warning of result.warnings) {
    out.push("");
    out.push(paint(`! ${warning}`, SEVERITY_COLOUR.medium, colour));
  }

  out.push("");
  if (result.findings.length === 0) {
    out.push(paint("No findings.", BOLD, colour));
    out.push(
      paint(
        `${result.rulesRun.length} rules ran clean over ${result.hooks.length} contract(s).`,
        DIM,
        colour,
      ),
    );
    return `${out.join("\n")}\n`;
  }

  for (const finding of result.findings) {
    out.push(renderFinding(finding, { colour, width }));
    out.push("");
  }

  const counts = new Map<Severity, number>();
  for (const finding of result.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([severity, count]) => paint(`${count} ${severity}`, SEVERITY_COLOUR[severity], colour))
    .join(paint(" - ", DIM, colour));
  out.push(`${paint(`${result.findings.length} finding(s):`, BOLD, colour)} ${summary}`);

  return `${out.join("\n")}\n`;
}
