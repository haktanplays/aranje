import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the expressive/plain gain-parity bench (2V-D.2 gain parity §4, §5). */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeParityRender",
      formats: ["iife"],
      fileName: () => "parity-render.js",
    },
    outDir: fileURLToPath(new URL("./.render", import.meta.url)),
    emptyOutDir: true,
  },
});
