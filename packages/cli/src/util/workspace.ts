/**
 * Locates the Latch Protocol Solidity packages a generated project (or the
 * devnet) has to compile against.
 *
 * Latch is not published to a package registry yet, so a generated project
 * resolves `infinity-core/`, `latch-hooks/` and `latch-fees/` through Foundry
 * remappings pointing at a checkout on disk. Everything written into generated
 * files is a *relative* path, so a project can be moved with its checkout and
 * committed to a repository without leaking anybody's home directory.
 *
 * Resolution order, most explicit first:
 *   1. `--core <path>` on the command line
 *   2. `LATCH_CORE_PATH` in the environment
 *   3. a walk up from the target directory, then from this CLI's own location,
 *      looking for `packages/core/foundry.toml`
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "./log.js";

export interface LatchWorkspace {
  /** Absolute path to `packages/core`. */
  readonly core: string;
  /** Absolute path to `packages/hooks`, when present. */
  readonly hooks: string | undefined;
  /** Absolute path to `packages/fees`, when present. */
  readonly fees: string | undefined;
  /** Absolute path to the monorepo root, when the layout was recognised. */
  readonly root: string | undefined;
  /** How the core path was found; surfaced in `--help` style diagnostics. */
  readonly source: "flag" | "env" | "discovered";
}

/** True when `path` looks like a checkout of `packages/core`. */
export function looksLikeCore(path: string): boolean {
  return (
    existsSync(join(path, "foundry.toml")) &&
    existsSync(join(path, "src", "Vault.sol")) &&
    existsSync(join(path, "src", "pool-cl", "CLPoolManager.sol"))
  );
}

function ancestors(from: string): string[] {
  const out: string[] = [];
  let current = resolve(from);
  const { root } = parse(current);
  for (;;) {
    out.push(current);
    if (current === root) break;
    const next = dirname(current);
    if (next === current) break;
    current = next;
  }
  return out;
}

function findCoreNear(start: string): string | undefined {
  for (const dir of ancestors(start)) {
    const candidate = join(dir, "packages", "core");
    if (looksLikeCore(candidate)) return candidate;
    // also handle being *inside* packages/core already
    if (looksLikeCore(dir)) return dir;
  }
  return undefined;
}

function siblingPackage(core: string, name: string): string | undefined {
  const candidate = resolve(core, "..", name);
  return existsSync(join(candidate, "foundry.toml")) ? candidate : undefined;
}

function monorepoRoot(core: string): string | undefined {
  const packagesDir = resolve(core, "..");
  const root = resolve(packagesDir, "..");
  return packagesDir.endsWith(`packages`) ? root : undefined;
}

export interface ResolveWorkspaceOptions {
  /** Value of `--core`, if the user passed one. */
  readonly explicit?: string | undefined;
  /** Directory the command is acting on; searched first. */
  readonly near: string;
}

export function resolveWorkspace(options: ResolveWorkspaceOptions): LatchWorkspace {
  const fromEnv = process.env["LATCH_CORE_PATH"];
  const cliDir = dirname(fileURLToPath(import.meta.url));

  let core: string | undefined;
  let source: LatchWorkspace["source"] = "discovered";

  if (options.explicit !== undefined && options.explicit.length > 0) {
    core = isAbsolute(options.explicit) ? options.explicit : resolve(process.cwd(), options.explicit);
    source = "flag";
    if (!looksLikeCore(core)) {
      throw new UserError(
        `--core ${options.explicit} does not look like a Latch core checkout`,
        "expected a directory containing foundry.toml, src/Vault.sol and src/pool-cl/CLPoolManager.sol",
      );
    }
  } else if (fromEnv !== undefined && fromEnv.length > 0) {
    core = isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
    source = "env";
    if (!looksLikeCore(core)) {
      throw new UserError(
        `LATCH_CORE_PATH=${fromEnv} does not look like a Latch core checkout`,
        "unset it, or point it at the packages/core directory of a Latch checkout",
      );
    }
  } else {
    core = findCoreNear(options.near) ?? findCoreNear(process.cwd()) ?? findCoreNear(cliDir);
  }

  if (core === undefined) {
    throw new UserError(
      "could not find the Latch core contracts",
      "run this from inside a Latch checkout, pass --core <path-to-packages/core>, or set LATCH_CORE_PATH",
    );
  }

  const resolvedCore = resolve(core);
  return {
    core: resolvedCore,
    hooks: siblingPackage(resolvedCore, "hooks"),
    fees: siblingPackage(resolvedCore, "fees"),
    root: monorepoRoot(resolvedCore),
    source,
  };
}

/** Asserts the pieces a given command needs are present, with an actionable message. */
export function requireHooks(workspace: LatchWorkspace): string {
  if (workspace.hooks === undefined) {
    throw new UserError(
      `packages/hooks was not found next to ${workspace.core}`,
      "the generated hook extends BaseCLHook from that package; check out the full monorepo",
    );
  }
  if (!existsSync(join(workspace.hooks, "src", "base", "BaseCLHook.sol"))) {
    throw new UserError(
      `${workspace.hooks} does not contain src/base/BaseCLHook.sol`,
      "the generated hook extends BaseCLHook; is this an up-to-date checkout?",
    );
  }
  return workspace.hooks;
}

export function requireFees(workspace: LatchWorkspace): string {
  if (workspace.fees === undefined) {
    throw new UserError(
      `packages/fees was not found next to ${workspace.core}`,
      "the devnet deploys LatchProtocolFeeController from that package",
    );
  }
  return workspace.fees;
}
