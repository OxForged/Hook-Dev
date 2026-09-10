/**
 * Minimal, dependency-free terminal output.
 *
 * Colour is disabled when stdout is not a TTY, when `NO_COLOR` is set, or when
 * `TERM=dumb` - which covers CI logs and the Windows console hosts that do not
 * understand ANSI.
 */

const ESC = "\u001B";

const colorEnabled =
  process.env["NO_COLOR"] === undefined &&
  process.env["TERM"] !== "dumb" &&
  process.stdout.isTTY === true;

function wrap(open: string, close: string) {
  return (text: string): string => (colorEnabled ? `${ESC}[${open}m${text}${ESC}[${close}m` : text);
}

export const style = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  blue: wrap("34", "39"),
  cyan: wrap("36", "39"),
} as const;

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function step(message: string): void {
  process.stdout.write(`${style.cyan("*")} ${message}\n`);
}

export function ok(message: string): void {
  process.stdout.write(`${style.green("+")} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${style.yellow("!")} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${style.red("x")} ${message}\n`);
}

/** Renders `label: value` rows with the values aligned into one column. */
export function table(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${style.bold(value)}`).join("\n");
}

/**
 * An error whose message is already meant for a user: printed without a stack
 * trace. Anything else that escapes to the top level is a bug and keeps its
 * stack so it can be reported.
 */
export class UserError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "UserError";
    this.hint = hint;
  }
}

/** Prints an error the way the top-level handler should and returns an exit code. */
export function reportFatal(err: unknown): number {
  if (err instanceof UserError) {
    error(err.message);
    if (err.hint !== undefined) info(style.dim(`  ${err.hint}`));
    return 1;
  }
  error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  return 1;
}
