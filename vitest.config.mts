import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    /*
     * Eval harness tests run in the same suite as the product's.
     *
     * The measuring instruments of 2P-A — a pitch tracker, a transient
     * ratio, a seeded noise source — are code that can be wrong, and code
     * that can be wrong and is never run is how a benchmark ends up
     * confidently reporting nothing.
     */
    include: ["src/**/*.test.ts", "eval/**/*.test.ts"],
  },
});
