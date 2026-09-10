import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // These are pure unit tests over the decoding, permission and pagination
    // layers. They deliberately do NOT touch Postgres or Redis, so `npm test`
    // runs with nothing else started.
    globals: false,
    testTimeout: 20_000,
  },
});
