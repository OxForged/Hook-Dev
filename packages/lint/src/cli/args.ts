// SPDX-License-Identifier: MIT
/** Argument parsing for `latch-lint`. */

import { parseSeverity, type Severity } from "../finding.js";

/** Parsed command line. */
export interface CliOptions {
  readonly target: string;
  readonly json: boolean;
  readonly failOn: Severity;
  /** `--fail-on none` disables the non-zero exit entirely. */
  readonly neverFail: boolean;
  readonly colour: boolean;
  readonly width: number;
  readonly only: readonly string[];
  readonly exclude: readonly string[];
  readonly root: string | undefined;
  readonly buildInfo: string | undefined;
  readonly profile: string | undefined;
  /** Allow latch-lint to compile the project when its output has no AST. */
  readonly build: boolean;
  /** Compile even when usable output already exists. */
  readonly rebuild: boolean;
  readonly help: boolean;
  readonly explain: boolean;
  readonly version: boolean;
}

/** Raised for a malformed command line. */
export class UsageError extends Error {}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Parses `argv` (without `node` and the script path). */
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let target = ".";
  let targetSeen = false;
  let json = false;
  let failOn: Severity = "medium";
  let neverFail = false;
  let colour = env["NO_COLOR"] === undefined && env["FORCE_COLOR"] !== "0";
  let width = Number(env["COLUMNS"] ?? 0) || 100;
  const only: string[] = [];
  const exclude: string[] = [];
  let root: string | undefined;
  let buildInfo: string | undefined;
  let profile: string | undefined;
  let build = true;
  let rebuild = false;
  let help = false;
  let explain = false;
  let version = false;

  const requireValue = (flag: string, value: string | undefined): string => {
    if (value === undefined) throw new UsageError(`${flag} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === undefined) continue;

    switch (argument) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "--version":
        version = true;
        break;
      case "--explain":
        explain = true;
        break;
      case "--json":
        json = true;
        break;
      case "--no-build":
        build = false;
        break;
      case "--rebuild":
        rebuild = true;
        break;
      case "--no-color":
      case "--no-colour":
        colour = false;
        break;
      case "--fail-on": {
        const value = requireValue("--fail-on", argv[++i]);
        if (value.toLowerCase() === "none") {
          neverFail = true;
          break;
        }
        const parsed = parseSeverity(value);
        if (parsed === undefined) {
          throw new UsageError(
            `--fail-on expects one of: critical, high, medium, low, info, none (received "${value}")`,
          );
        }
        failOn = parsed;
        break;
      }
      case "--only":
        only.push(...splitList(requireValue("--only", argv[++i])));
        break;
      case "--exclude":
        exclude.push(...splitList(requireValue("--exclude", argv[++i])));
        break;
      case "--root":
        root = requireValue("--root", argv[++i]);
        break;
      case "--build-info":
        buildInfo = requireValue("--build-info", argv[++i]);
        break;
      case "--profile":
        profile = requireValue("--profile", argv[++i]);
        break;
      case "--width":
        width = Number(requireValue("--width", argv[++i])) || width;
        break;
      default:
        if (argument.startsWith("-")) throw new UsageError(`unknown option: ${argument}`);
        if (targetSeen) throw new UsageError(`unexpected extra path: ${argument}`);
        target = argument;
        targetSeen = true;
    }
  }

  return {
    target,
    json,
    failOn,
    neverFail,
    colour: colour && !json,
    width,
    only,
    exclude,
    root,
    buildInfo,
    profile,
    build,
    rebuild,
    help,
    explain,
    version,
  };
}

/** `--help` text. */
export const USAGE = `latch-lint - static analysis for AMM hooks

  Catches the mistakes that are specific to writing a hook: a callback anyone
  can call, a permission bitmap that does not match the code, a fee override a
  static-fee pool silently discards, per-user accounting keyed on a value that
  is the router rather than the user.

USAGE
  npx latch-lint <path> [options]

  <path>  a .sol file, a directory, or a Foundry project root (default: .)

  latch-lint works from the solc AST. If the project was built with
  \`forge build --ast\` it reads what is already on disk; otherwise it compiles
  the project itself into a scratch directory outside the project, so a lint
  run never writes to your \`out/\`, your cache, or anything else in the tree.

OPTIONS
  --json                 machine-readable output for CI
  --fail-on <severity>   exit non-zero at this severity or worse
                         critical|high|medium|low|info|none  (default: medium)
  --only <ids>           run only these rules, comma-separated (e.g. LATCH-001)
  --exclude <ids>        skip these rules
  --root <dir>           Foundry project root (default: nearest foundry.toml)
  --profile <name>       foundry.toml profile whose src/out to read
  --build-info <file>    use a specific build-info JSON
  --no-build             never invoke forge; fail if no AST is already present
  --rebuild              compile even when usable output already exists
  --width <n>            wrap prose at n columns
  --no-color             disable ANSI colour
  --explain              print the rule set and what each rule analyses
  -h, --help             this text
  --version              print the version

EXIT CODES
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  the run itself failed (no AST, bad path, bad arguments)
`;
