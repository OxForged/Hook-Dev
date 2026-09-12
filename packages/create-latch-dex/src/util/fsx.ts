// SPDX-License-Identifier: MIT
/** Filesystem helpers for copying the template out. */

import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** Directories never copied out of the template, whatever a local build left behind. */
export const NEVER_COPY = new Set([
  "node_modules",
  "dist",
  ".git",
  "cache",
  "foundry-out",
  "foundry-out-legacy",
  "broadcast",
  ".vite",
]);

/** Files never copied out of the template. `.env` in particular must never ship. */
export const NEVER_COPY_FILES = new Set([".env", ".env.local", ".DS_Store", "tsconfig.tsbuildinfo"]);

/**
 * Whether a path inside the template should be copied out.
 *
 * `path` must be RELATIVE to the tree being copied. Testing an absolute path
 * would ask whether any ancestor directory happens to be named `dist` or
 * `node_modules` — and the published template lives at
 * `create-latch-dex/dist/template`, so an absolute check silently rejects every
 * file in it and scaffolds an empty project.
 */
export function isCopyable(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/).filter((s) => s.length > 0);
  if (segments.some((segment) => NEVER_COPY.has(segment))) return false;
  const base = segments[segments.length - 1];
  return base === undefined || !NEVER_COPY_FILES.has(base);
}

/**
 * True when `dir` does not exist, or exists and contains nothing we would clobber.
 *
 * A scaffolder that overwrites a populated directory is a scaffolder that
 * eventually eats somebody's work, so this is checked before anything is written.
 */
export async function isEmptyEnough(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return true;
  const info = await stat(dir);
  if (!info.isDirectory()) return false;
  const entries = await readdir(dir);
  return entries.filter((e) => e !== ".git" && e !== ".DS_Store").length === 0;
}

export async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  await cp(from, to, {
    recursive: true,
    // `relative(from, src)` is "" for the root itself, which must be copied.
    filter: (src) => isCopyable(relative(from, src)),
  });
}

/** Every file under `root`, as paths relative to `root`, with `/` separators. */
export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (!isCopyable(rel)) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.push(rel);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeText(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}
