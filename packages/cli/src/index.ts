/**
 * Library surface of the Latch CLI.
 *
 * Exported so the permission maths and the code generator can be reused by other
 * tooling (the web app's "generate a hook" flow, tests, CI checks) without
 * shelling out to the binary.
 */

export * from "./permissions.js";
export * from "./codegen/callbacks.js";
export * from "./codegen/project.js";
export * from "./templates/index.js";
export { CLI_VERSION } from "./version.js";
