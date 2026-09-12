// SPDX-License-Identifier: MIT
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // A source map ships by default. This app is MIT and its whole pitch is
    // that a user can check what it does; shipping unreadable bundles would
    // make the fee disclosure on the Fees screen unverifiable.
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
