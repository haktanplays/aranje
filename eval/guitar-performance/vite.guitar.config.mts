import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the 2T-C §10 guitar-performance renders for the browser harness. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeGuitarPerformance",
      formats: ["iife"],
      fileName: () => "guitar-render.js",
    },
    outDir: fileURLToPath(new URL("./.render", import.meta.url)),
    emptyOutDir: true,
  },
});
