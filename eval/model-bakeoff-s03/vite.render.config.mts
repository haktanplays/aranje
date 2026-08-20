import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the.bakeoff-s03 renderer for the browser harness. Eval only. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeBakeoffS03",
      formats: ["iife"],
      fileName: () => "bakeoff-render.js",
    },
    outDir: fileURLToPath(new URL("../../.bakeoff-s03", import.meta.url)),
    emptyOutDir: true,
  },
});
