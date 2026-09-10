import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
