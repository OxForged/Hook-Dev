// SPDX-License-Identifier: MIT
/**
 * Loading and editing `latch.config.ts` from a Node script.
 *
 * The config is TypeScript with comments, which is the right shape for the one
 * file a human edits and the wrong shape for a Node script to `import`. Rather
 * than keeping a second machine-readable copy — which would drift, and which is
 * exactly the failure this project is built to avoid — these scripts load the
 * config through **Vite's own module loader**.
 *
 * That is deliberate and worth the extra second it costs: the script then reads
 * byte-for-byte the same module, resolved the same way, that the running app
 * reads. A verifier that checks a different config from the one that ships is
 * not a verifier.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_PATH = join(PROJECT_ROOT, "latch.config.ts");

/**
 * Loads the tenant config AND the shared-core address book, from the same
 * modules the app imports.
 *
 * Both come back from one Vite server so a script can never check a config
 * against a second, hand-copied address table. Duplicating that table into a
 * script is exactly the drift this project refuses to ship.
 */
export async function loadConfig() {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: PROJECT_ROOT,
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const [configModule, deploymentsModule] = await Promise.all([
      server.ssrLoadModule("/latch.config.ts"),
      server.ssrLoadModule("/src/config/deployments.ts"),
    ]);
    const config = configModule.default;
    if (config === undefined || config === null) {
      throw new Error("latch.config.ts has no default export");
    }
    return { config, deployments: deploymentsModule.LATCH_DEPLOYMENTS };
  } finally {
    await server.close();
  }
}

/**
 * Rewrites one top-level address field inside `chain: { ... }`.
 *
 * A surgical text edit rather than a re-serialisation, because re-serialising
 * would delete every comment in the file — and the comments in
 * `latch.config.ts` are most of what makes it usable. This will refuse rather
 * than guess: if the field is not found exactly once, nothing is written.
 *
 * @param {"registry"|"launchpadKit"} field
 * @param {string|null} value an address, or null to clear it
 */
export async function writeChainField(field, value) {
  const source = await readFile(CONFIG_PATH, "utf8");
  const pattern = new RegExp(`^(\\s*)${field}:\\s*(?:null|'0x[0-9a-fA-F]{40}'|"0x[0-9a-fA-F]{40}")\\s*,`, "gm");

  const matches = source.match(pattern);
  if (matches === null || matches.length !== 1) {
    throw new Error(
      `Could not find exactly one \`${field}:\` line in latch.config.ts ` +
        `(found ${matches === null ? 0 : matches.length}). Refusing to guess — ` +
        `set it by hand to ${value === null ? "null" : `'${value}'`}.`,
    );
  }

  const replacement = value === null ? "null" : `'${value}'`;
  const updated = source.replace(pattern, (_m, indent) => `${indent}${field}: ${replacement},`);
  await writeFile(CONFIG_PATH, updated, "utf8");
}

/* ---------------------------------------------------------------- output --- */

const CSI = `${String.fromCharCode(27)}[`;
const color = process.env["NO_COLOR"] === undefined && process.stdout.isTTY === true;
const paint = (code, text) => (color ? `${CSI}${code}m${text}${CSI}0m` : text);

export const ok = (t) => paint("32", t);
export const bad = (t) => paint("31", t);
export const warnColor = (t) => paint("33", t);
export const dim = (t) => paint("2", t);

export function line(status, label, detail) {
  const mark = status === "ok" ? ok("ok  ") : status === "warn" ? warnColor("warn") : bad("FAIL");
  process.stdout.write(`  ${mark}  ${label.padEnd(26)} ${detail}\n`);
}

export function heading(text) {
  process.stdout.write(`\n${text}\n`);
}
