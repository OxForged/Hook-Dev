// SPDX-License-Identifier: MIT
// Marks the CLI entry executable on POSIX. A no-op on Windows, where npm
// generates its own shim.
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bin = join(dirname(dirname(fileURLToPath(import.meta.url))), "dist", "bin", "latch-lint.js");
if (existsSync(bin) && process.platform !== "win32") {
  chmodSync(bin, 0o755);
}
