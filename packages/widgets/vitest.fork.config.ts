import { defineConfig } from "vitest/config";

/**
 * Fork suites: real calldata, executed against an anvil forked from Sepolia.
 *
 * Kept out of the default `vitest run` because they need `anvil` on PATH, a
 * reachable Sepolia RPC, and Foundry artefacts built in `packages/router` and
 * `packages/periphery`. Run them with `npm run test:fork`.
 *
 * Files run one at a time: each boots its own anvil and forks the same public
 * endpoint, and racing them only earns rate limits.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/fork/**/*.fork.test.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 300_000,
    teardownTimeout: 30_000,
  },
});
