// SPDX-License-Identifier: MIT
/**
 * Writes `dist/styles.css` from the stylesheet in `src/styles/css.ts`.
 *
 * The stylesheet lives in TypeScript because the web component has to inject it
 * into a shadow root as a string. Hosts that would rather link a stylesheet get
 * this file, generated from the same source so the two cannot drift.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "..", "src", "styles", "css.ts");
const target = resolve(here, "..", "dist", "styles.css");

const contents = readFileSync(source, "utf8");
const match = /export const WIDGET_CSS = `([\s\S]*?)`;/.exec(contents);

if (match === null || match[1] === undefined) {
  console.error("emit-css: could not find `export const WIDGET_CSS` in src/styles/css.ts");
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  `/* Generated from src/styles/css.ts by scripts/emit-css.mjs. Do not edit. */\n${match[1].trim()}\n`,
  "utf8",
);

console.log(`emit-css: wrote ${target} (${match[1].trim().length} bytes)`);
