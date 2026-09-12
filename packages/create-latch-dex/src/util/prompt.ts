// SPDX-License-Identifier: MIT
/**
 * Interactive prompts, used only when stdin is a TTY.
 *
 * A scaffolder must be scriptable, so every prompt has a flag equivalent and a
 * non-interactive run never blocks waiting for an answer that will not come.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { dim } from "./log.js";

export function isInteractive(): boolean {
  return stdin.isTTY === true && stdout.isTTY === true;
}

/** Asks a question. `fallback` is returned on an empty answer. */
export async function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = fallback === undefined ? "" : ` ${dim(`(${fallback})`)}`;
    const answer = await rl.question(`${question}${suffix} `);
    const trimmed = answer.trim();
    return trimmed.length === 0 ? (fallback ?? "") : trimmed;
  } finally {
    rl.close();
  }
}

/** Asks a question with a fixed set of answers, re-asking until one matches. */
export async function askChoice(
  question: string,
  choices: readonly string[],
  fallback: string,
): Promise<string> {
  const rendered = choices.join(" / ");
  for (;;) {
    const answer = await ask(`${question} ${dim(`[${rendered}]`)}`, fallback);
    const normalized = answer.trim().toLowerCase();
    const hit = choices.find((c) => c.toLowerCase() === normalized);
    if (hit !== undefined) return hit;
    stdout.write(`  not one of ${rendered}\n`);
  }
}
