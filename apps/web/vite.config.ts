import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The origin the site is served from. Social scrapers and the canonical link need
// ABSOLUTE URLs — a relative og:image is fetched off-host and 404s, which silently
// kills the link preview — so index.html writes %SITE_URL% and this substitutes it.
//
// The default is the canonical production origin, which is also the domain printed
// on the brand OG artwork itself. Override with VITE_SITE_URL on a preview deploy so
// its cards point at that deploy rather than at production.
const SITE_URL = (process.env.VITE_SITE_URL ?? 'https://latch.guru').replace(/\/+$/, '')

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'latch-site-url',
      // `order: 'pre'` so the token is gone before any other HTML transform sees it.
      transformIndexHtml: {
        order: 'pre',
        handler: (html: string) => html.replaceAll('%SITE_URL%', SITE_URL),
      },
    },
  ],
  resolve: {
    // SINGLETON DEDUPE — keep in step with `paths` in tsconfig.app.json.
    // `@latchprotocol/connect` is linked from ../../packages/connect and carries
    // its own node_modules with a second copy of each of these. Two copies of
    // react break hooks outright; two copies of wagmi are worse because nothing
    // throws — the provider writes to one store and `useAccount` reads the
    // other, so the wallet connects and the UI never notices.
    dedupe: [
      'react',
      'react-dom',
      'viem',
      'wagmi',
      '@tanstack/react-query',
      '@rainbow-me/rainbowkit',
    ],
  },
  server: {
    watch: {
      // public/brand is DERIVED by scripts/sync-brand.mjs from the design handoff
      // and is never hand-edited, so watching it buys nothing. It also breaks dev
      // on Windows: the predev copy writes 36 binaries, then chokidar tries to
      // watch them while the OS still holds handles open, and the watcher dies
      // with EBUSY, taking the whole dev server with it.
      ignored: ['**/public/brand/**'],
    },
  },
})
