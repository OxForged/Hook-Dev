// SPDX-License-Identifier: MIT
/** Copies the template out and substitutes the tenant's values into it. */

import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScaffoldOptions } from "./options.js";
import { isEmptyEnough, copyTree, listFiles, readText, writeText } from "./util/fsx.js";
import { applyTokens, findUnresolvedTokens, SUBSTITUTED_FILES, tokensFor } from "./template.js";

/**
 * Files renamed on the way out.
 *
 * npm strips `.gitignore` from a published tarball, so the template carries it
 * under a name npm will keep. This is a packaging quirk, not a preference.
 */
const RENAMES: ReadonlyMap<string, string> = new Map([["_gitignore", ".gitignore"]]);

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

/**
 * Locates `template/`, whether running from source (`src/`) or from a build (`dist/`).
 *
 * `npm run build` copies the template into `dist/template`, so an installed
 * package is self-contained; running from a checkout finds the original.
 */
export function templateRoot(fromDir = dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    join(fromDir, "template"),
    join(fromDir, "..", "template"),
    join(fromDir, "..", "..", "template"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "latch.config.ts"))) return candidate;
  }
  throw new ScaffoldError(
    `Could not find the project template. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "If you are running from a checkout, run `npm run build` first.",
  );
}

export interface ScaffoldResult {
  readonly directory: string;
  readonly filesWritten: number;
}

export async function scaffold(
  options: ScaffoldOptions,
  templateDir = templateRoot(),
): Promise<ScaffoldResult> {
  const target = resolve(process.cwd(), options.directory);

  if (!(await isEmptyEnough(target))) {
    throw new ScaffoldError(
      `${target} already exists and is not empty. Refusing to write into it — ` +
        "choose a new directory, or empty this one yourself.",
    );
  }

  await copyTree(templateDir, target);

  const tokens = tokensFor(options);
  const files = await listFiles(target);

  /* A scaffolder that reports success over an empty directory is worse than one
     that crashes: the tenant runs `npm install` in nothing and has to work out
     why. This caught a real bug — the copy filter was matching against absolute
     paths, and the published template lives under `dist/`, which the filter
     excludes by name. */
  if (files.length === 0) {
    throw new ScaffoldError(
      `Copied 0 files out of ${templateDir}. The template is missing or was filtered out; ` +
        "this is a bug in create-latch-dex, not in your input.",
    );
  }

  for (const relativePath of files) {
    const absolute = join(target, relativePath);

    const renamed = RENAMES.get(relativePath);
    if (renamed !== undefined) {
      const contents = await readText(absolute);
      await writeText(join(target, renamed), contents);
      await rm(absolute);
      continue;
    }

    if (!SUBSTITUTED_FILES.includes(relativePath)) continue;

    const contents = await readText(absolute);
    const substituted = applyTokens(relativePath, contents, tokens);
    const leftover = findUnresolvedTokens(substituted);
    if (leftover.length > 0) {
      throw new ScaffoldError(
        `${relativePath} still contains unresolved placeholders after substitution: ` +
          `${leftover.join(", ")}. This is a bug in create-latch-dex, not in your input.`,
      );
    }
    await writeText(absolute, substituted);
  }

  return { directory: target, filesWritten: files.length };
}
