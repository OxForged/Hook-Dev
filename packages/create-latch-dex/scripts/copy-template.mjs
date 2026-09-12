// SPDX-License-Identifier: MIT
//
// Copies `template/` into `dist/template` so an installed package is
// self-contained. Anything a local `npm install`/`npm run build` left inside the
// template is skipped — a scaffold that ships somebody else's node_modules is a
// scaffold that takes four minutes to download and leaks a lockfile.

import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const from = join(pkgRoot, "template");
const to = join(pkgRoot, "dist", "template");

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "cache",
  ".vite",
  ".git",
  "foundry-out",
  "broadcast",
]);
const IGNORED_FILES = new Set([
  ".env",
  ".env.local",
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.tsbuildinfo",
]);

if (!existsSync(from)) {
  console.error(`copy-template: nothing at ${from}`);
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await cp(from, to, {
  recursive: true,
  filter: (src) => {
    const segments = src.split(sep);
    if (segments.some((s) => IGNORED_DIRS.has(s))) return false;
    const base = segments[segments.length - 1];
    return !IGNORED_FILES.has(base);
  },
});

if (!existsSync(join(to, "latch.config.ts"))) {
  console.error("copy-template: latch.config.ts missing from the copy — refusing to ship it");
  process.exit(1);
}

console.log(`copy-template: template -> dist${sep}template`);
