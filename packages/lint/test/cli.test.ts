// SPDX-License-Identifier: MIT
/** CLI contract: arguments, exit codes and the `--json` shape CI depends on. */

import { describe, expect, it } from "vitest";
import { ALL_RULES, parseArgs, run, UsageError, type JsonReport } from "../src/index.js";
import { FIXTURES_SRC } from "./helpers.js";

const BASE = [FIXTURES_SRC, "--no-build", "--no-color"];

describe("argument parsing", () => {
  it("defaults sensibly", () => {
    const options = parseArgs([], {});
    expect(options.target).toBe(".");
    expect(options.failOn).toBe("medium");
    expect(options.json).toBe(false);
    expect(options.build).toBe(true);
  });

  it("accepts a severity threshold, including `none`", () => {
    expect(parseArgs(["--fail-on", "critical"], {}).failOn).toBe("critical");
    expect(parseArgs(["--fail-on", "none"], {}).neverFail).toBe(true);
  });

  it("rejects an unknown severity", () => {
    expect(() => parseArgs(["--fail-on", "catastrophic"], {})).toThrow(UsageError);
  });

  it("rejects an unknown option and a second path", () => {
    expect(() => parseArgs(["--wat"], {})).toThrow(UsageError);
    expect(() => parseArgs(["a.sol", "b.sol"], {})).toThrow(UsageError);
  });

  it("splits comma-separated rule lists", () => {
    expect(parseArgs(["--only", "LATCH-001,LATCH-004"], {}).only).toEqual(["LATCH-001", "LATCH-004"]);
  });
});

describe("exit codes", () => {
  it("exits 1 when findings meet the threshold", () => {
    const result = run([...BASE, "--fail-on", "medium"]);
    expect(result.exitCode).toBe(1);
  });

  it("exits 0 when the threshold is above every finding", () => {
    const result = run([...BASE, "--fail-on", "none"]);
    expect(result.exitCode).toBe(0);
  });

  it("exits 0 for a clean target", () => {
    const result = run([`${FIXTURES_SRC}/good/CleanCLHook.sol`, "--no-build", "--no-color"]);
    expect(result.stdout).toContain("No findings.");
    expect(result.exitCode).toBe(0);
  });

  it("exits 2 on a usage error, and prints usage", () => {
    const result = run(["--fail-on", "nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("USAGE");
  });

  it("exits 2 on an unknown rule id", () => {
    const result = run([...BASE, "--only", "LATCH-999"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("LATCH-999");
  });

  it("exits 2 when the path does not exist", () => {
    const result = run(["./definitely-not-here", "--no-build"]);
    expect(result.exitCode).toBe(2);
  });
});

describe("--json", () => {
  const parsed = (): JsonReport => {
    const result = run([...BASE, "--json", "--fail-on", "high"]);
    return JSON.parse(result.stdout) as JsonReport;
  };

  it("emits a stable, machine-readable document", () => {
    const report = parsed();
    expect(report.version).toBe(1);
    expect(report.tool).toBe("latch-lint");
    expect(report.rulesRun).toEqual(ALL_RULES.map((rule) => rule.id));
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.failOn).toBe("high");
    expect(report.summary.exitCode).toBe(1);
  });

  it("counts findings by severity consistently", () => {
    const report = parsed();
    const total = Object.values(report.summary.bySeverity).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(report.summary.total);
    expect(report.summary.failing).toBe(
      report.findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length,
    );
  });

  it("gives every finding a location and a concrete fix", () => {
    for (const finding of parsed().findings) {
      expect(finding.file).toMatch(/\.sol$/);
      expect(finding.line).toBeGreaterThan(0);
      expect(finding.fix.length, `${finding.rule} has no fix text`).toBeGreaterThan(30);
      expect(finding.message.length).toBeGreaterThan(60);
      expect(finding.contract.length).toBeGreaterThan(0);
    }
  });
});

describe("rule selection", () => {
  it("--only narrows the run", () => {
    const report = JSON.parse(
      run([...BASE, "--json", "--only", "LATCH-001", "--fail-on", "none"]).stdout,
    ) as JsonReport;
    expect(report.rulesRun).toEqual(["LATCH-001"]);
    expect(new Set(report.findings.map((finding) => finding.rule))).toEqual(new Set(["LATCH-001"]));
  });

  it("--exclude removes a rule", () => {
    const report = JSON.parse(
      run([...BASE, "--json", "--exclude", "LATCH-001", "--fail-on", "none"]).stdout,
    ) as JsonReport;
    expect(report.findings.some((finding) => finding.rule === "LATCH-001")).toBe(false);
  });
});

describe("informational output", () => {
  it("--help and --version exit 0", () => {
    expect(run(["--help"]).exitCode).toBe(0);
    expect(run(["--version"]).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--explain documents every rule's analysis input", () => {
    const result = run(["--explain"]);
    expect(result.exitCode).toBe(0);
    for (const rule of ALL_RULES) expect(result.stdout).toContain(rule.id);
  });

  it("the text report names the file, line and severity", () => {
    const stdout = run([...BASE, "--fail-on", "none"]).stdout;
    expect(stdout).toContain("CRITICAL");
    expect(stdout).toContain("LATCH-001");
    expect(stdout).toMatch(/\.sol:\d+:\d+/);
    expect(stdout).toContain("Fix:");
  });
});
