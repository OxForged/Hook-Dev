// SPDX-License-Identifier: MIT
/**
 * Foundry artifact loading for the fork harness.
 *
 * The whole Latch stack - core, periphery and router - is deployed on Sepolia,
 * so the harness deploys none of it. The one thing it does put on the fork is a
 * third `MockERC20`, because a multi-hop route needs a third token and Sepolia
 * carries exactly one pool over exactly two.
 *
 * That bytecode is read out of the sibling package's `foundry-out` at run time
 * rather than vendored here: it keeps GPL-2.0 artefacts out of an MIT tree, and
 * the harness tests whatever the repo currently compiles rather than a snapshot
 * that can silently rot.
 *
 * If the artefact is missing (a fresh clone that has not run `forge build`),
 * {@link loadArtifact} throws with the exact command to run.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi, Hex } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/` - this file lives at `packages/widgets/test/fork/`. */
const PACKAGES_DIR = resolve(HERE, "..", "..", "..");

/** A compiled contract: ABI plus creation bytecode. */
export interface ForgeArtifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

/** Which sibling package's `foundry-out` an artefact comes from. */
export type ArtifactPackage = "router" | "periphery" | "core";

const BUILD_COMMAND: Record<ArtifactPackage, string> = {
  router: "cd packages/router && forge build",
  periphery: "cd packages/periphery && forge build",
  core: "cd packages/core && forge build",
};

function artifactPath(pkg: ArtifactPackage, file: string, contract: string): string {
  return join(PACKAGES_DIR, pkg, "foundry-out", file, `${contract}.json`);
}

/**
 * Loads one Foundry artefact.
 *
 * @throws when the artefact is absent or carries no deployable bytecode.
 */
export function loadArtifact(
  pkg: ArtifactPackage,
  file: string,
  contract: string,
): ForgeArtifact {
  const path = artifactPath(pkg, file, contract);
  if (!existsSync(path)) {
    throw new Error(
      `[fork] missing Foundry artefact ${pkg}/foundry-out/${file}/${contract}.json.\n` +
        `Build it first: ${BUILD_COMMAND[pkg]}`,
    );
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = raw as { abi?: Abi; bytecode?: { object?: string } };
  const object = parsed.bytecode?.object;
  if (parsed.abi === undefined || object === undefined || object.length <= 2) {
    throw new Error(`[fork] artefact ${path} has no creation bytecode`);
  }
  return { abi: parsed.abi, bytecode: object as Hex };
}

/**
 * `true` when the one artefact the fork harness deploys is present.
 *
 * Only the multi-hop suite needs it; the swap, liquidity and bin suites run
 * entirely against deployed contracts.
 */
export function forkArtifactsAvailable(): boolean {
  return existsSync(artifactPath("core", "mocks/MockERC20.sol", "MockERC20"));
}
