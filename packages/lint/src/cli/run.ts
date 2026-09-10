// SPDX-License-Identifier: MIT
/** CLI orchestration, kept separate from the process so it is testable. */

import { analyze, NoCompilerOutputError } from "../analyze.js";
import { meetsThreshold } from "../finding.js";
import { buildJsonReport } from "../report/json.js";
import { renderText } from "../report/text.js";
import { ALL_RULES } from "../rules/index.js";
import { parseArgs, UsageError, USAGE, type CliOptions } from "./args.js";

/** What the CLI would print and exit with. */
export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const VERSION = "0.1.0";

function explain(): string {
  const lines = [
    "latch-lint rules",
    "",
    "Each rule states which analysis input it uses and why. Two are available:",
    "the solc AST (structure, control flow, name resolution) and the compiled",
    "artifacts (the ABI, which records the deployed callback surface).",
    "",
  ];
  for (const rule of ALL_RULES) {
    lines.push(`${rule.id}  ${rule.title}`);
    for (const line of rule.basis.split("\n")) lines.push(`    ${line}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Runs the linter and returns what should be printed. */
export function run(argv: readonly string[]): CliResult {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const message = error instanceof UsageError ? error.message : String(error);
    return { stdout: "", stderr: `latch-lint: ${message}\n\n${USAGE}`, exitCode: 2 };
  }

  if (options.help) return { stdout: USAGE, stderr: "", exitCode: 0 };
  if (options.version) return { stdout: `${VERSION}\n`, stderr: "", exitCode: 0 };
  if (options.explain) return { stdout: explain(), stderr: "", exitCode: 0 };

  const unknownRules = [...options.only, ...options.exclude].filter(
    (id) => !ALL_RULES.some((rule) => rule.id === id),
  );
  if (unknownRules.length > 0) {
    return {
      stdout: "",
      stderr:
        `latch-lint: unknown rule id(s): ${unknownRules.join(", ")}\n` +
        `known rules: ${ALL_RULES.map((rule) => rule.id).join(", ")}\n`,
      exitCode: 2,
    };
  }

  let result;
  try {
    result = analyze(options.target, {
      only: options.only,
      exclude: options.exclude,
      build: options.build,
      rebuild: options.rebuild,
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.buildInfo === undefined ? {} : { buildInfo: options.buildInfo }),
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });
  } catch (error) {
    const message =
      error instanceof NoCompilerOutputError || error instanceof Error
        ? error.message
        : String(error);
    return { stdout: "", stderr: `latch-lint: ${message}\n`, exitCode: 2 };
  }

  const failing = options.neverFail
    ? 0
    : result.findings.filter((finding) => meetsThreshold(finding.severity, options.failOn)).length;
  const exitCode = failing > 0 ? 1 : 0;

  if (options.json) {
    const report = buildJsonReport(result, options.failOn, failing, exitCode);
    return { stdout: `${JSON.stringify(report, null, 2)}\n`, stderr: "", exitCode };
  }

  return {
    stdout: renderText(result, { colour: options.colour, width: options.width }),
    stderr: "",
    exitCode,
  };
}
