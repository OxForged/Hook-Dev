import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Library build.
 *
 * ESM only, three entry points, and everything a host already has marked
 * external. React, react-dom and viem are peers - bundling a second copy of
 * React into a host's page is the fastest way to make a widget unembeddable.
 *
 * Declarations come from `tsc --emitDeclarationOnly` rather than a Vite plugin,
 * so the published types are produced by the same compiler that typechecks the
 * source.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        headless: resolve(__dirname, "src/headless.ts"),
        embed: resolve(__dirname, "src/embed.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react-dom/client",
        "viem",
        "wagmi",
        /^viem\//,
        /^@latchprotocol\/sdk/,
      ],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
