// SPDX-License-Identifier: MIT
/**
 * Compiles the test fixtures with ASTs enabled.
 *
 * The fixture project is self-contained (no core, no remappings), so this is
 * fast and Foundry's cache makes repeat runs close to free. Tests then read the
 * emitted ASTs with `build: false`, which keeps them from silently depending on
 * the linter's own auto-build path.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(dirname(fileURLToPath(import.meta.url))), "test", "fixtures");
if (!existsSync(join(fixtures, "foundry.toml"))) {
  console.error(`fixture project not found at ${fixtures}`);
  process.exit(1);
}

const args = ["build", "--root", fixtures, "--ast", "--build-info"];
let result = spawnSync("forge", args, { encoding: "utf8", stdio: "inherit" });
if (result.error?.code === "ENOENT") {
  result = spawnSync("forge", args, { encoding: "utf8", stdio: "inherit", shell: true });
}

if (result.error !== undefined) {
  console.error(
    result.error.code === "ENOENT"
      ? "`forge` is not on PATH. Install Foundry (https://getfoundry.sh) to build the lint fixtures."
      : `running forge failed: ${result.error.message}`,
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
