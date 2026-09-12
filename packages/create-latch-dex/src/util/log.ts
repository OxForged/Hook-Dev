// SPDX-License-Identifier: MIT
/** Console output for the scaffolder. Nothing here is a dependency. */

const useColor =
  process.env["NO_COLOR"] === undefined &&
  process.env["FORCE_COLOR"] !== "0" &&
  process.stdout.isTTY === true;

/** ESC + "[" — built from a code point so no control byte lands in this source file. */
const CSI = `${String.fromCharCode(27)}[`;

function paint(code: string, text: string): string {
  return useColor ? `${CSI}${code}m${text}${CSI}0m` : text;
}

export const dim = (t: string): string => paint("2", t);
export const bold = (t: string): string => paint("1", t);
export const green = (t: string): string => paint("32", t);
export const yellow = (t: string): string => paint("33", t);
export const red = (t: string): string => paint("31", t);
export const cyan = (t: string): string => paint("36", t);

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function step(message: string): void {
  process.stdout.write(`${green("·")} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${yellow("!")} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${red("x")} ${message}\n`);
}

/**
 * Turns a thrown value into an exit code, printing something a human can act on.
 *
 * A stack trace is printed only when `LATCH_DEBUG` is set: for a scaffolder the
 * useful output is the message, and a wall of frames buries it.
 */
export function reportFatal(err: unknown): number {
  if (err instanceof Error) {
    error(err.message);
    if (process.env["LATCH_DEBUG"] !== undefined && err.stack !== undefined) {
      process.stderr.write(`${dim(err.stack)}\n`);
    }
  } else {
    error(String(err));
  }
  return 1;
}
