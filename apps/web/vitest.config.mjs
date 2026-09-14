/* Unit tests for the web app's PURE modules only (no DOM, no wallet, no RPC).

   apps/web carries no test runner of its own and adding one would mean a new
   dependency tree. The SDK already ships vitest, so this config is run with
   that binary:

     node ../../packages/sdk/node_modules/vitest/vitest.mjs run --config vitest.config.mjs

   A plain object rather than `defineConfig` so this file resolves nothing from
   apps/web/node_modules. `globals` lets the test files avoid importing
   `vitest`, which is not installed here. */
export default {
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
}
