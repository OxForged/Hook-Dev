/**
 * A tiny argv parser.
 *
 * Deliberately not `node:util.parseArgs`: this one reports unknown flags with a
 * suggestion instead of either throwing a cryptic message or silently swallowing
 * them, which is the difference between "typo" and "half an hour lost".
 */

import { UserError } from "./log.js";

export type FlagKind = "boolean" | "string";

export interface FlagSpec {
  readonly kind: FlagKind;
  /** Single-letter alias, without the dash. */
  readonly short?: string;
  /** Shown by `--help`. */
  readonly describe: string;
  /** Placeholder shown after a string flag in `--help`, e.g. `<path>`. */
  readonly placeholder?: string;
  /** Rendered in `--help` as the effective default. */
  readonly defaultLabel?: string;
}

export type FlagSpecs = Readonly<Record<string, FlagSpec>>;

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  /** Everything after a bare `--`, passed through untouched. */
  readonly passthrough: readonly string[];
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = new Array<number>(rows * cols).fill(0);
  for (let i = 0; i < rows; i++) dist[i * cols] = i;
  for (let j = 0; j < cols; j++) dist[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i * cols + j] = Math.min(
        (dist[(i - 1) * cols + j] ?? 0) + 1,
        (dist[i * cols + j - 1] ?? 0) + 1,
        (dist[(i - 1) * cols + j - 1] ?? 0) + cost,
      );
    }
  }
  return dist[rows * cols - 1] ?? 0;
}

function suggest(unknown: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const distance = levenshtein(unknown, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= 3 ? best : undefined;
}

export function parseArgs(argv: readonly string[], specs: FlagSpecs): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const passthrough: string[] = [];

  const longNames = Object.keys(specs);
  const byShort = new Map<string, string>();
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short !== undefined) byShort.set(spec.short, name);
  }

  let i = 0;
  for (; i < argv.length; i++) {
    const token = argv[i] as string;

    if (token === "--") {
      passthrough.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    let name: string;
    let inlineValue: string | undefined;
    let negated = false;

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      const rawName = eq === -1 ? body : body.slice(0, eq);
      if (eq !== -1) inlineValue = body.slice(eq + 1);

      if (rawName.startsWith("no-") && specs[rawName.slice(3)]?.kind === "boolean") {
        name = rawName.slice(3);
        negated = true;
      } else {
        name = rawName;
      }
    } else {
      const short = token.slice(1);
      const mapped = byShort.get(short);
      if (mapped === undefined) {
        throw new UserError(`unknown flag "-${short}"`, "run with --help to list the flags this command accepts");
      }
      name = mapped;
    }

    const spec = specs[name];
    if (spec === undefined) {
      const hint = suggest(name, longNames);
      throw new UserError(
        `unknown flag "--${name}"`,
        hint === undefined ? "run with --help to list the flags this command accepts" : `did you mean --${hint}?`,
      );
    }

    if (spec.kind === "boolean") {
      if (inlineValue !== undefined) {
        flags[name] = inlineValue !== "false" && inlineValue !== "0";
      } else {
        flags[name] = !negated;
      }
      continue;
    }

    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next === "--") {
      throw new UserError(`flag "--${name}" needs a value`);
    }
    flags[name] = next;
    i++;
  }

  return { positionals, flags, passthrough };
}

export function getString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function getBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

/** Renders the flag table for a `--help` screen. */
export function renderFlags(specs: FlagSpecs): string {
  const rows = Object.entries(specs).map(([name, spec]) => {
    const short = spec.short === undefined ? "    " : `-${spec.short}, `;
    const value = spec.kind === "string" ? ` ${spec.placeholder ?? "<value>"}` : "";
    const left = `  ${short}--${name}${value}`;
    const right =
      spec.defaultLabel === undefined ? spec.describe : `${spec.describe} (default: ${spec.defaultLabel})`;
    return [left, right] as const;
  });
  const width = rows.reduce((max, [left]) => Math.max(max, left.length), 0);
  return rows.map(([left, right]) => `${left.padEnd(width)}  ${right}`).join("\n");
}
