import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The live Sepolia test talks to a public RPC.
    testTimeout: 120_000,
  },
});
