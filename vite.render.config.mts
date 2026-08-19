import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the offline demo renderer for the browser harness. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./scripts/render-demo/entry.ts", import.meta.url)),
      name: "AranjeRenderDemo",
      formats: ["iife"],
      fileName: () => "render-demo.js",
    },
    outDir: fileURLToPath(
      new URL("./.render-demo", import.meta.url),
    ),
    emptyOutDir: true,
  },
});
