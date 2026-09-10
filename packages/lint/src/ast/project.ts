// SPDX-License-Identifier: MIT
/**
 * Locating the compiler output for a target.
 *
 * The linter never parses Solidity text structurally: everything that matters
 * (which functions exist, what a modifier body does, which declaration an
 * identifier resolves to) is read from solc's compact AST. That AST is already
 * on disk in any Foundry project — `forge build` emits it both inside each
 * artifact (`out/Foo.sol/Foo.json` has an `ast` field) and, in full, in
 * `out/build-info/*.json`, which additionally carries every source's text and
 * the source-index table. Reading it costs nothing and cannot drift from what
 * the compiler actually saw.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Where compiler output was found, and how. */
export interface FoundryProject {
  /** Directory containing `foundry.toml`. */
  readonly root: string;
  /** Configured source directory (absolute). */
  readonly srcDir: string;
  /** Configured artifact directory (absolute). */
  readonly outDir: string;
}

const DEFAULT_SRC = "src";
const DEFAULT_OUT = "out";

/** Walks up from `start` looking for a `foundry.toml`. */
export function findProjectRoot(start: string): string | undefined {
  let dir = isAbsolute(start) ? start : resolve(start);
  try {
    if (statSync(dir).isFile()) dir = dirname(dir);
  } catch {
    dir = dirname(dir);
  }
  for (;;) {
    if (existsSync(join(dir, "foundry.toml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Reads `src` and `out` from a `foundry.toml` profile.
 *
 * Deliberately a narrow scanner rather than a TOML dependency: only two string
 * keys of one table are needed, and a malformed or exotic config falls back to
 * Foundry's own defaults instead of failing the run.
 */
export function readFoundryConfig(root: string, profile = "default"): FoundryProject {
  const configPath = join(root, "foundry.toml");
  let src = DEFAULT_SRC;
  let out = DEFAULT_OUT;
  try {
    const text = readFileSync(configPath, "utf8");
    let inProfile = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("[")) {
        inProfile = line === `[profile.${profile}]` || (profile === "default" && line === "[default]");
        continue;
      }
      if (!inProfile) continue;
      const match = /^(src|out)\s*=\s*["']([^"']+)["']/.exec(line);
      if (match === null) continue;
      if (match[1] === "src" && match[2] !== undefined) src = match[2];
      if (match[1] === "out" && match[2] !== undefined) out = match[2];
    }
  } catch {
    // fall through to defaults
  }
  return { root, srcDir: resolve(root, src), outDir: resolve(root, out) };
}

/**
 * Every build-info JSON in `dir`, newest first.
 *
 * All of them, not just the newest: Foundry writes one per compiler input set
 * and a partial rebuild leaves small ones behind that carry no ASTs at all.
 * Picking "the newest" and giving up is how a linter ends up claiming a built
 * project has never been built.
 */
export function findBuildInfos(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return entries
    .map((entry) => {
      const path = join(dir, entry);
      let mtime = 0;
      try {
        mtime = statSync(path).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { path, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map((item) => item.path);
}

/** Build-info files inside a Foundry `out/` directory. */
export function findProjectBuildInfos(outDir: string): string[] {
  return findBuildInfos(join(outDir, "build-info"));
}

/** Every artifact JSON under `outDir` (excluding `build-info`). */
export function findArtifacts(outDir: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "build-info") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".json")) out.push(path);
    }
  };
  visit(outDir, 0);
  return out;
}

/** Every `.sol` file at or under `path` (a file yields itself). */
export function solidityFilesUnder(path: string): string[] {
  const out: string[] = [];
  let isDirectory = false;
  try {
    isDirectory = statSync(path).isDirectory();
  } catch {
    return out;
  }
  if (!isDirectory) return path.endsWith(".sol") ? [path] : out;

  const visit = (current: string, depth: number): void => {
    if (depth > 12) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) visit(child, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".sol")) out.push(child);
    }
  };
  visit(path, 0);
  return out;
}

/** Newest mtime among `.sol` files under `dir`, for staleness reporting. */
export function newestSolidityMtime(dir: string): number | undefined {
  let newest: number | undefined;
  const visit = (current: string, depth: number): void => {
    if (depth > 12) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".sol")) {
        try {
          const mtime = statSync(path).mtimeMs;
          if (newest === undefined || mtime > newest) newest = mtime;
        } catch {
          // skip
        }
      }
    }
  };
  visit(dir, 0);
  return newest;
}

/** Normalises a path for comparison across the `/` and `\` the toolchain mixes. */
export function normalisePath(path: string): string {
  return path.split(sep).join("/").replace(/\/+/g, "/");
}
