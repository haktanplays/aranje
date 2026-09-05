import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the 2V-D.1-C §10/§15 technique-span renders for the browser harness. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeTechniqueSpans",
      formats: ["iife"],
      fileName: () => "spans-render.js",
    },
    outDir: fileURLToPath(new URL("./.render", import.meta.url)),
    emptyOutDir: true,
  },
});
