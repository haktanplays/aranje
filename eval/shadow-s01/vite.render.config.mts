import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the shadow-eval renderer for the browser harness. Eval only. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeShadowEval",
      formats: ["iife"],
      fileName: () => "shadow-render.js",
    },
    outDir: fileURLToPath(new URL("../../.shadow-eval", import.meta.url)),
    emptyOutDir: true,
  },
});
