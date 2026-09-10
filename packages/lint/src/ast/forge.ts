// SPDX-License-Identifier: MIT
/**
 * Producing an AST when the project's own build output does not carry one.
 *
 * `forge build` only emits ASTs when asked (`--ast`), and a project built
 * without it leaves artifacts that contain an ABI and bytecode but nothing the
 * linter can reason about. Rather than tell the user to rebuild - and rather
 * than silently degrade to regex heuristics - the linter compiles the project
 * itself, into a scratch directory keyed by the project path.
 *
 * Nothing is written inside the project: `--out`, `--build-info-path` and
 * `--cache-path` all point at the scratch directory, so a linter run cannot
 * disturb a build, a test run, or another tool working in the same tree.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where a scratch build for `root` lives. */
export function scratchDirFor(root: string): string {
  const digest = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(tmpdir(), "latch-lint", digest);
}

/** Outcome of a scratch build. */
export interface ForgeBuildResult {
  readonly ok: boolean;
  readonly outDir: string;
  readonly buildInfoDir: string;
  readonly message: string;
}

function invoke(args: readonly string[], useShell: boolean): ReturnType<typeof spawnSync> {
  return spawnSync("forge", args, {
    encoding: "utf8",
    shell: useShell,
    windowsHide: true,
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Compiles `root` with ASTs enabled into a scratch directory.
 *
 * Returns `ok: false` with a printable reason rather than throwing, so the
 * caller can fall back to whatever output already exists.
 */
export function buildAstForProject(root: string): ForgeBuildResult {
  const scratch = scratchDirFor(root);
  const outDir = join(scratch, "out");
  const buildInfoDir = join(scratch, "build-info");
  try {
    mkdirSync(scratch, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      outDir,
      buildInfoDir,
      message: `could not create scratch directory ${scratch}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const args = [
    "build",
    "--root",
    root,
    "--ast",
    "--build-info",
    "--build-info-path",
    buildInfoDir,
    "--out",
    outDir,
    "--cache-path",
    join(scratch, "cache"),
  ];

  let result = invoke(args, false);
  if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    result = invoke(args, true);
  }

  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      outDir,
      buildInfoDir,
      message:
        code === "ENOENT"
          ? "`forge` is not on PATH; install Foundry (https://getfoundry.sh) or build with `--ast` yourself"
          : `running forge failed: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").toString().trim();
    const stdout = (result.stdout ?? "").toString().trim();
    const detail = (stderr.length > 0 ? stderr : stdout).split("\n").slice(0, 12).join("\n");
    return {
      ok: false,
      outDir,
      buildInfoDir,
      message: `forge build failed in ${root}:\n${detail}`,
    };
  }

  return { ok: true, outDir, buildInfoDir, message: "" };
}
