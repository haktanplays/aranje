import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the.grid-check renderer for the browser harness. Eval only. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeGridCheck",
      formats: ["iife"],
      fileName: () => "grid-render.js",
    },
    outDir: fileURLToPath(new URL("../../.grid-check", import.meta.url)),
    emptyOutDir: true,
  },
});
