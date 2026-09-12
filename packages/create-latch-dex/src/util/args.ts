// SPDX-License-Identifier: MIT
/**
 * A very small flag parser.
 *
 * Deliberately not a dependency: a scaffolder that pulls a CLI framework to read
 * six flags is a scaffolder people stop trusting to be quick.
 */

export interface ParsedArgs {
  /** Positional arguments, in order. */
  readonly positionals: readonly string[];
  /** `--flag value`, `--flag=value` and bare `--flag` (which yields `true`). */
  readonly flags: Readonly<Record<string, string | true>>;
}

export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgError";
  }
}

const KNOWN_VALUE_FLAGS = new Set([
  "chain",
  "fee-wallet",
  "fee-bps",
  "features",
  "name",
  "template",
  "package-manager",
]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    if (body.length === 0) {
      // `--` ends flag parsing; everything after is positional.
      for (let j = i + 1; j < argv.length; j += 1) {
        const rest = argv[j];
        if (rest !== undefined) positionals.push(rest);
      }
      break;
    }

    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    const next = argv[i + 1];
    if (KNOWN_VALUE_FLAGS.has(body)) {
      if (next === undefined || next.startsWith("--")) {
        throw new ArgError(`--${body} needs a value, for example --${body}=<value>`);
      }
      flags[body] = next;
      i += 1;
      continue;
    }
    flags[body] = true;
  }

  return { positionals, flags };
}

/** Reads a flag that must be a string when present. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined) return undefined;
  if (value === true) throw new ArgError(`--${name} needs a value, for example --${name}=<value>`);
  return value;
}

/** Reads a boolean flag. Presence means true; `--flag=false` means false. */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  const value = args.flags[name];
  if (value === undefined) return false;
  if (value === true) return true;
  return value !== "false" && value !== "0";
}
