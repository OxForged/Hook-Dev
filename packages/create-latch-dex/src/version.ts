// SPDX-License-Identifier: MIT
/**
 * The published version, printed by `--version`.
 *
 * A constant rather than a read of package.json: that file sits outside the
 * compiled `rootDir`, and resolving it at runtime breaks differently under npx,
 * a global install and a bundler. `test/version.test.ts` fails the build if this
 * drifts from package.json.
 */
export const CLI_VERSION = "0.1.0";
