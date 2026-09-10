import { describe, expect, it } from "vitest";
import { getBoolean, getString, parseArgs, renderFlags, type FlagSpecs } from "../src/util/args.js";
import { remappingPath } from "../src/util/fsx.js";
import { UserError } from "../src/util/log.js";

const SPECS: FlagSpecs = {
  template: { kind: "string", short: "t", describe: "template" },
  yes: { kind: "boolean", short: "y", describe: "assume yes" },
  build: { kind: "boolean", describe: "build afterwards" },
};

describe("parseArgs", () => {
  it("separates positionals from flags", () => {
    const args = parseArgs(["my-hook", "--template", "noop", "--yes"], SPECS);
    expect(args.positionals).toEqual(["my-hook"]);
    expect(getString(args, "template")).toBe("noop");
    expect(getBoolean(args, "yes")).toBe(true);
  });

  it("accepts --flag=value and short aliases", () => {
    const args = parseArgs(["-t", "dynamic-fee", "--build=false", "-y"], SPECS);
    expect(getString(args, "template")).toBe("dynamic-fee");
    expect(getBoolean(args, "build")).toBe(false);
    expect(getBoolean(args, "yes")).toBe(true);
  });

  it("supports --no-<flag> for booleans", () => {
    expect(getBoolean(parseArgs(["--no-build"], SPECS), "build")).toBe(false);
    expect(getBoolean(parseArgs(["--build"], SPECS), "build")).toBe(true);
  });

  it("passes everything after -- through untouched", () => {
    const args = parseArgs(["--yes", "--", "--block-time", "2"], SPECS);
    expect(args.passthrough).toEqual(["--block-time", "2"]);
    expect(getBoolean(args, "yes")).toBe(true);
  });

  it("suggests a near miss instead of failing silently", () => {
    let caught: unknown;
    try {
      parseArgs(["--templte", "noop"], SPECS);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UserError);
    expect((caught as UserError).message).toContain('unknown flag "--templte"');
    expect((caught as UserError).hint).toContain("did you mean --template");
  });

  it("rejects an unknown short flag", () => {
    expect(() => parseArgs(["-z"], SPECS)).toThrowError(/unknown flag "-z"/);
  });

  it("refuses a value flag with nothing after it", () => {
    expect(() => parseArgs(["--template"], SPECS)).toThrowError(/needs a value/);
  });

  it("treats a lone dash as a positional", () => {
    expect(parseArgs(["-"], SPECS).positionals).toEqual(["-"]);
  });
});

describe("renderFlags", () => {
  it("lists every flag with its alias", () => {
    const rendered = renderFlags(SPECS);
    expect(rendered).toContain("-t, --template");
    expect(rendered).toContain("--build");
  });
});

describe("remappingPath", () => {
  it("prefers a relative path when the two are close together", () => {
    const from = process.platform === "win32" ? "C:\\dev\\my-hook" : "/dev/my-hook";
    const to = process.platform === "win32" ? "C:\\dev\\latch\\packages\\core" : "/dev/latch/packages/core";
    expect(remappingPath(from, to)).toBe("../latch/packages/core");
  });

  it("uses forward slashes on every platform", () => {
    const from = process.platform === "win32" ? "C:\\dev\\a" : "/dev/a";
    const to = process.platform === "win32" ? "C:\\dev\\b\\c" : "/dev/b/c";
    expect(remappingPath(from, to)).not.toContain("\\");
  });
});
