import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the 2V-C.4 seam renders for the browser harness. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./seam-entry.ts", import.meta.url)),
      name: "AranjeSeam",
      formats: ["iife"],
      fileName: () => "seam-render.js",
    },
    outDir: fileURLToPath(new URL("./.render", import.meta.url)),
    emptyOutDir: true,
  },
});
