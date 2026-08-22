/**
 * One way in, and one way out (spec 13.1, K-37).
 *
 * The single-commit promise only holds if there is a single place that
 * commits. A component that called `applyTransform` and wrote the result
 * itself would be a second path: still correct-looking on screen, and quietly
 * capable of two writes, or a write with no undo step behind it.
 *
 * Read from disk on purpose. This is a property of the wiring, not of any one
 * function, and it is the kind of thing that decays the moment someone needs a
 * transform "just here".
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { importsOf, valueImportsOf } from "@/lib/dev/ast";

const COMPONENTS = "src/components/workspace";

const sources = readdirSync(COMPONENTS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, text: readFileSync(`${COMPONENTS}/${name}`, "utf8") }));

describe("the transform core has one caller", () => {
  it("has components to check", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it("no component imports applyTransform", () => {
    for (const source of sources) {
      expect(source.text, source.name).not.toContain("applyTransform");
    }
  });

  it("no component imports commitTransform or copySelection either", () => {
    for (const source of sources) {
      expect(source.text, source.name).not.toContain("commitTransform");
      expect(source.text, source.name).not.toContain("copySelection");
    }
  });

  it("routes everything through the session controller", () => {
    // An import edge, not a substring (2L-R): the selection session is the
    // one module that reaches the transform hook.
    expect(importsOf("src/lib/workspace/use-selection-session.ts")).toContain(
      "@/lib/song/use-transform",
    );
    // A type-only import is not a caller; a runtime edge would be.
    for (const source of sources) {
      expect(
        valueImportsOf(`${COMPONENTS}/${source.name}`),
        source.name,
      ).not.toContain("@/lib/song/use-transform");
    }
  });

  it("keeps the hook as the only module that reaches the core", () => {
    const hook = readFileSync("src/lib/song/use-transform.ts", "utf8");
    expect(hook).toContain("applyTransform");
  });
});
