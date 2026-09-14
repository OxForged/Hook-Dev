import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The operator console. Served by the API process at /admin (same origin as
// /v1/admin), so `base` is /admin/ in every build. NOT a GitHub Pages site:
// .github/workflows/pages.yml builds and uploads apps/web/dist only.
//
// Dev: `npm run dev` proxies /v1 to ADMIN_API_TARGET (default a local API on
// :4000). UI testing without an API: run `npm run dev:mock` (test/mock-server,
// fixture data, never bundled) and start vite with
// ADMIN_API_TARGET=http://127.0.0.1:5189.
const API_TARGET = process.env.ADMIN_API_TARGET ?? 'http://127.0.0.1:4000'

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/v1': { target: API_TARGET, changeOrigin: false } },
  },
  build: {
    // The production CSP is `script-src 'self'` with no 'unsafe-inline': the
    // modulepreload polyfill is an inline script, so it is off. Evergreen
    // browsers support modulepreload natively.
    modulePreload: { polyfill: false },
    sourcemap: false,
    // Everything under /admin/assets is served immutable by the API.
    assetsDir: 'assets',
  },
})
