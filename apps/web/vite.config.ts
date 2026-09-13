import { copyFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// The path the site is MOUNTED at, which is not the same question as the origin above.
//
// At a custom domain this is `/` and nothing here matters. On a GitHub Pages PROJECT
// site the app lives under `/<repo>/`, and every root-absolute reference — the bundle,
// the brand favicons, the webmanifest, and every client-side route — has to carry that
// prefix or 404. Vite rewrites what it can find in index.html and in the bundle; the
// router needs the same value separately, which it reads from `import.meta.env.BASE_URL`.
//
// Normalised to always start and end with `/`, because Vite silently misbehaves
// otherwise: a base without a trailing slash concatenates straight onto asset names.
const RAW_BASE = process.env.VITE_BASE_PATH ?? '/'
const BASE_PATH = `/${RAW_BASE.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/{2,}/, '/')

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
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
    {
      // Two files a DUMB static host needs and a dev server never does.
      //
      // 404.html — this is a single-page app with real client-side routes
      // (/docs, /app/*, /brand, /verify/:addr). A static host has no rewrite
      // rule, so a visitor who types one of those, or follows a shared link,
      // or simply reloads, gets the host's own 404 instead of the app. GitHub
      // Pages serves 404.html for any unmatched path, so an identical copy of
      // index.html turns that into the app booting and the router resolving
      // the URL. The address bar keeps the real path, so this is not a
      // redirect and nothing is lost.
      //
      // .nojekyll — Pages runs Jekyll by default, which silently DROPS files
      // and directories whose names begin with an underscore. Vite does not
      // emit any today, but a future dependency's chunk name can, and the
      // failure is a 404 on one asset with nothing in the build log.
      name: 'latch-static-host-fallbacks',
      apply: 'build',
      closeBundle() {
        const out = resolve(__dirname, 'dist')
        copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'))
        writeFileSync(resolve(out, '.nojekyll'), '')
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
  build: {
    rolldownOptions: {
      output: {
        // VENDOR CHUNKS — for caching, not for first-load size.
        //
        // Without these, every deploy re-downloads nearly everything: react-dom
        // sits in the entry, the entry's preload map names every route chunk,
        // and a hash change anywhere cascades through each importer. Measured
        // on this app with a one-line change to a dapp screen, a returning
        // landing visitor re-downloaded ~200 kB gzip of ~219 kB; with the groups
        // below, ~3 kB. A change to lib/chain.ts: ~200 kB -> ~49 kB. First-load
        // cost of the extra requests: under 1 kB gzip on the landing route.
        //
        // `entriesAware` on viem and the wallet stack is load-bearing. Without
        // it a group is ONE chunk that every route touching any of its modules
        // must download whole — the landing reads chain data through viem, so a
        // plain viem group would hand it the wallet-only parts of viem too, and
        // a wallet group shared with anything public would undo route splitting.
        // Grouped by importer set instead, the landing only ever loads the viem
        // modules it uses, and wagmi/RainbowKit stay behind /app/*.
        //
        // An `entriesAware` subgroup is named after every chunk that imports it
        // (`viem~index~Terms~Privacy~…~ccip`), which runs past 100 characters.
        // The group name alone is enough; the content hash keeps files distinct.
        chunkFileNames: (chunk) => `assets/${chunk.name.split('~')[0]}-[hash].js`,
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
              priority: 30,
            },
            {
              name: 'viem',
              test: /[\\/]node_modules[\\/](viem|ox|abitype|@noble|@scure|@adraffy)[\\/]/,
              priority: 20,
              entriesAware: true,
            },
            {
              name: 'wallet',
              test: /[\\/]node_modules[\\/](wagmi|@wagmi|@rainbow-me|@tanstack|@vanilla-extract|zustand|use-sync-external-store|eventemitter3|mipd|ua-parser-js|qr|cuer|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|tslib|get-nonce|detect-node-es)[\\/]/,
              priority: 10,
              entriesAware: true,
            },
          ],
        },
      },
    },
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
