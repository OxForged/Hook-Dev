/**
 * Interactive prompts built on `node:readline/promises`.
 *
 * Every prompt has a non-interactive equivalent flag, and every prompt refuses
 * to run when stdin is not a TTY (CI) - a CLI that blocks forever waiting for
 * input nobody can give is the classic way to hang a pipeline.
 */

import { createInterface } from "node:readline/promises";
import { style, UserError } from "./log.js";

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function assertInteractive(what: string, flag: string): void {
  if (!isInteractive()) {
    throw new UserError(
      `cannot prompt for ${what}: stdin is not a terminal`,
      `pass ${flag} (or --yes to accept every default) when running non-interactively`,
    );
  }
}

async function withReadline<T>(fn: (rl: ReturnType<typeof createInterface>) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await fn(rl);
  } finally {
    rl.close();
  }
}

/** Free-text question with a default shown in brackets. */
export async function askText(question: string, fallback: string): Promise<string> {
  return withReadline(async (rl) => {
    const answer = (await rl.question(`${question} ${style.dim(`(${fallback})`)} `)).trim();
    return answer.length === 0 ? fallback : answer;
  });
}

/** Yes/no question. */
export async function askConfirm(question: string, fallback: boolean): Promise<boolean> {
  const hint = fallback ? "Y/n" : "y/N";
  return withReadline(async (rl) => {
    const answer = (await rl.question(`${question} ${style.dim(`(${hint})`)} `)).trim().toLowerCase();
    if (answer.length === 0) return fallback;
    return answer === "y" || answer === "yes";
  });
}

export interface Choice<T> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
}

/** Numbered single-select. */
export async function askChoice<T>(
  question: string,
  choices: ReadonlyArray<Choice<T>>,
  defaultIndex = 0,
): Promise<T> {
  const first = choices[0];
  if (first === undefined) throw new UserError("internal: askChoice called with no choices");

  process.stdout.write(`${question}\n`);
  choices.forEach((choice, index) => {
    const marker = index === defaultIndex ? style.cyan(">") : " ";
    const description = choice.description === undefined ? "" : `  ${style.dim(choice.description)}`;
    process.stdout.write(`  ${marker} ${style.bold(String(index + 1))}. ${choice.label}${description}\n`);
  });

  return withReadline(async (rl) => {
    for (;;) {
      const raw = (await rl.question(`${style.dim(`select 1-${choices.length}`)} `)).trim();
      if (raw.length === 0) return (choices[defaultIndex] ?? first).value;
      const index = Number.parseInt(raw, 10) - 1;
      const picked = Number.isInteger(index) ? choices[index] : undefined;
      if (picked !== undefined) return picked.value;
      process.stdout.write(`${style.yellow("!")} enter a number between 1 and ${choices.length}\n`);
    }
  });
}

/**
 * Numbered multi-select. Accepts `1,3,5`, ranges (`1-4`), `all`, `none`, or an
 * empty line to keep the pre-selected set.
 */
export async function askMultiSelect<T>(
  question: string,
  choices: ReadonlyArray<Choice<T>>,
  preselected: ReadonlySet<number>,
): Promise<T[]> {
  process.stdout.write(`${question}\n`);
  choices.forEach((choice, index) => {
    const mark = preselected.has(index) ? style.green("[x]") : "[ ]";
    const description = choice.description === undefined ? "" : `  ${style.dim(choice.description)}`;
    process.stdout.write(`  ${mark} ${style.bold(String(index + 1).padStart(2))}. ${choice.label}${description}\n`);
  });
  process.stdout.write(
    `${style.dim("  enter numbers (1,3 or 1-4), 'all', 'none', or blank to keep the pre-selected set")}\n`,
  );

  return withReadline(async (rl) => {
    for (;;) {
      const raw = (await rl.question(`${style.dim("select")} `)).trim().toLowerCase();

      if (raw.length === 0) {
        return choices.filter((_, index) => preselected.has(index)).map((choice) => choice.value);
      }
      if (raw === "none") return [];
      if (raw === "all") return choices.map((choice) => choice.value);

      const picked = new Set<number>();
      let valid = true;
      for (const part of raw.split(",").map((piece) => piece.trim()).filter((piece) => piece.length > 0)) {
        const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
        if (range !== null) {
          const from = Number.parseInt(range[1] as string, 10);
          const to = Number.parseInt(range[2] as string, 10);
          if (from < 1 || to > choices.length || from > to) {
            valid = false;
            break;
          }
          for (let i = from; i <= to; i++) picked.add(i - 1);
          continue;
        }
        const index = Number.parseInt(part, 10);
        if (!Number.isInteger(index) || index < 1 || index > choices.length) {
          valid = false;
          break;
        }
        picked.add(index - 1);
      }

      if (valid) {
        return choices.filter((_, index) => picked.has(index)).map((choice) => choice.value);
      }
      process.stdout.write(`${style.yellow("!")} could not read that; use numbers 1-${choices.length}\n`);
    }
  });
}
