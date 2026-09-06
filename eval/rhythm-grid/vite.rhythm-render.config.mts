import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the D.2 completion renders (L31 accents, WAV bar boundaries). */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./render-entry.ts", import.meta.url)),
      name: "AranjeRhythmRender",
      formats: ["iife"],
      fileName: () => "rhythm-render.js",
    },
    outDir: fileURLToPath(new URL("./.render", import.meta.url)),
    emptyOutDir: true,
  },
});
