import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the 2O-B chord render cases for the browser harness. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeChordRender",
      formats: ["iife"],
      fileName: () => "chord-render.js",
    },
    outDir: fileURLToPath(new URL("./.render", import.meta.url)),
    emptyOutDir: true,
  },
});
