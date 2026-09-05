/**
 * The Çalım surface is a section, not a sheet in disguise (2V-D.1-C §12).
 *
 * The editor's whole shell work exists so the reader can see the music while
 * they edit it. A new surface that covered the staff would undo that quietly,
 * one feature at a time, so the rule is checked on the real file rather than
 * trusted to review: no `fixed`, no `inset-0`, no sheet z-layer, and every
 * touch target at the size a thumb needs.
 *
 * The jargon rule is checked on the words a reader can actually see, and the
 * table those words come from is walked in `technique-surface.test.ts`. Both
 * are needed: one stops the model leaking into the labels, the other stops it
 * leaking into the markup around them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { valueImportsOf } from "@/lib/dev/ast";

const SECTION = "src/components/workspace/TechniqueSection.tsx";

/** Comments describe the problem; scanning them would flag the description. */
const read = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");

describe("341. the Çalım surface stays beside the music", () => {
  const source = read(SECTION);

  it("covers nothing", () => {
    expect(source).not.toMatch(/className="[^"]*\bfixed\b/u);
    expect(source).not.toMatch(/inset-0/u);
    expect(source).not.toMatch(/\bz-[23]\d\b/u);
    expect(source).not.toContain("85dvh");
  });

  it("gives every choice a thumb-sized target", () => {
    /*
     * The constant *bound to the height*, not merely imported. An earlier
     * version of this test only asked whether the name appeared anywhere in
     * the file, which the import line satisfies on its own — so a hard-coded
     * 20px would have passed it. The probe that puts that number back is what
     * found the hole.
     */
    expect(source).toMatch(/minHeight:\s*MIN_TOUCH_TARGET_PX/u);
  });

  it("decides nothing about the music itself", () => {
    /*
     * It draws and it calls. Every command lives in the pure surface, which
     * is what lets `technique-surface.test.ts` check the behaviour without a
     * component and stops a second opinion growing in the markup.
     */
    for (const specifier of valueImportsOf(SECTION)) {
      expect(specifier, `${SECTION} imports ${specifier}`).not.toMatch(
        /technique-write|song-store|expression-plan/u,
      );
    }
  });

  it("shows the reader what a choice does before it does it", () => {
    expect(source).toContain("data-technique-preview");
    expect(source).toContain("data-technique-apply");
  });

  it("offers a way to take a region mark back off", () => {
    /* A technique you cannot remove is a technique nobody tries. */
    expect(source).toContain("data-technique-remove");
  });

  it("carries the picking disclosure into the markup", () => {
    expect(source).toContain("data-technique-disclosure");
    expect(source).toContain("group.disclosure");
  });

  it("writes no jargon of its own into the page", () => {
    const visible: string[] = [];
    for (const match of source.matchAll(/>\s*([A-Za-zÇĞİÖŞÜçğıöşü][^<>{}\n]{2,})\s*</gu)) {
      visible.push(match[1]!.trim());
    }
    expect(visible.length).toBeGreaterThan(0);
    for (const text of visible) {
      for (const pattern of [/\bslot\b/iu, /\btick/iu, /\bspan\b/iu, /\bvelocity\b/iu]) {
        expect(pattern.test(text), text).toBe(false);
      }
    }
  });
});
