import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    testTimeout: 20_000,
    // Unit tests need no database, Redis or chain. These placeholders satisfy
    // src/config/env.ts at import time and connect to nothing (Redis clients are
    // created lazily and no unit test calls them). Integration tests opt in with
    // TEST_DATABASE_URL and are skipped without it.
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      // No response cache in unit tests, so no Redis connection is ever attempted.
      CACHE_TTL_SECONDS: "0",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:1",
    },
  },
});
