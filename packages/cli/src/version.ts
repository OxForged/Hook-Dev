/**
 * The published version, stamped into generated projects.
 *
 * Kept as a constant rather than read from package.json: the file sits outside
 * the compiled `rootDir`, and resolving it at runtime breaks differently under
 * npx, a global install and a bundler. `test/version.test.ts` fails the build if
 * this drifts from package.json.
 */
export const CLI_VERSION = "0.1.0";
