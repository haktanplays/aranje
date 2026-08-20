import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the.shadow-eval-s02 renderer for the browser harness. Eval only. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeShadowEvalS02",
      formats: ["iife"],
      fileName: () => "s02-render.js",
    },
    outDir: fileURLToPath(new URL("../../.shadow-eval-s02", import.meta.url)),
    emptyOutDir: true,
  },
});
