import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Dev harness build. Separate from the library build so neither affects the other. */
export default defineConfig({
  root: resolve(__dirname, "demo"),
  plugins: [react()],
  server: { port: 5180, open: false },
  build: {
    outDir: resolve(__dirname, "demo-dist"),
    emptyOutDir: true,
  },
});
