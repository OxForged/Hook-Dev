import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Fork suites need anvil, a Sepolia RPC and sibling Foundry artefacts, so
    // they run from vitest.fork.config.ts via `npm run test:fork` instead of
    // failing the unit run on a machine that has none of those.
    exclude: ["**/node_modules/**", "**/dist/**", "test/fork/**"],
  },
});
