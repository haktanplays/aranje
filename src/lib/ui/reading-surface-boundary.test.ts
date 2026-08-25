/**
 * Where the reading surface may reach (2Q-C §15, §11.46–51).
 *
 * Windowing is the kind of change that quietly acquires dependencies: it sits
 * between the music and the screen, so almost anything can be argued into it.
 * The rules below are the ones that make it safe to say "a bar that is not
 * mounted is still exactly where it was":
 *
 * - the axis, the window and the follow model are pure arithmetic,
 * - none of them can reach storage, history, export or audio, so windowing
 *   cannot change what a song *is*,
 * - the components do no timing maths of their own, and
 * - the anchor fraction and the overscan each exist in exactly one place.
 *
 * Measured on the import graph and the syntax tree. No new grep-based
 * architecture test (§15).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  arithmeticIdentifiersOf,
  identifiersOf,
  numericLiteralsOf,
  valueImportsOf,
} from "@/lib/dev/ast";

const PURE = [
  "src/lib/tab/song-axis.ts",
  "src/lib/ui/horizontal-window.ts",
  "src/lib/ui/continuous-follow.ts",
];

const SURFACE_HOOK = "src/lib/workspace/use-reading-surface.ts";
const CANVASES = [
  "src/components/workspace/TabCanvas.tsx",
  "src/components/workspace/MultiTrackCanvas.tsx",
];

/** What a reading surface must not be able to touch, by import specifier. */
const FORBIDDEN = ["/storage", "/history", "/export/", "/audio/", "tone"];

describe("240. the reading surface is arithmetic, not machinery", () => {
  it("keeps the axis, the window and the follow model pure", () => {
    for (const path of PURE) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.startsWith("react"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.includes("/components/"), `${path} → ${specifier}`).toBe(
          false,
        );
        for (const forbidden of FORBIDDEN) {
          expect(specifier.includes(forbidden), `${path} → ${specifier}`).toBe(false);
        }
      }
    }
  });

  it("lets windowing reach no storage, no history, no export and no audio", () => {
    /*
     * The claim the whole checkpoint rests on: windowing changes what is in
     * the DOM and nothing else. A module that cannot import a store cannot
     * write to one, whatever anybody later believes about it.
     */
    for (const specifier of valueImportsOf(SURFACE_HOOK)) {
      for (const forbidden of FORBIDDEN) {
        expect(specifier.includes(forbidden), `${SURFACE_HOOK} → ${specifier}`).toBe(
          false,
        );
      }
    }
    const names = identifiersOf(SURFACE_HOOK);
    for (const api of ["localStorage", "sessionStorage", "fetch", "AudioContext"]) {
      expect(names.has(api), api).toBe(false);
    }
  });

  it("keeps the surface hook out of the export path entirely", () => {
    // The other direction: nothing that produces a file may read the view.
    for (const path of [
      "src/lib/export/export-plan.ts",
      "src/lib/project/project-file.ts",
      "src/lib/copilot/fingerprint.ts",
    ]) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.includes("reading-surface"), `${path} → ${specifier}`).toBe(
          false,
        );
        expect(specifier.includes("horizontal-window"), `${path} → ${specifier}`).toBe(
          false,
        );
        expect(specifier.includes("continuous-follow"), `${path} → ${specifier}`).toBe(
          false,
        );
      }
    }
  });

  it("does not import a controller from a controller", () => {
    for (const specifier of valueImportsOf(SURFACE_HOOK)) {
      expect(specifier.startsWith("@/lib/workspace/use-"), specifier).toBe(false);
    }
  });

  it("adds no runtime dependency", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    /*
     * A windowing library was the obvious thing to reach for and is exactly
     * what the checkpoint forbids: the window is forty lines of arithmetic
     * over an axis this app already had, and a dependency would have brought
     * its own idea of what a row is.
     */
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "next",
      "react",
      "react-dom",
      "tone",
      "zod",
    ]);
  });
});

describe("241. the components draw, and compute nothing", () => {
  it("does no tick or scroll arithmetic in a canvas", () => {
    for (const path of CANVASES) {
      const arithmetic = arithmeticIdentifiersOf(path);
      /*
       * Anything a canvas would have to add up to place the music itself. It
       * asks the axis and the surface hook instead, which is why a playhead
       * cannot land a slot away from the note it is over.
       */
      for (const name of [
        "ticks",
        "startTicks",
        "durationTicks",
        "barProgress",
        "scrollLeft",
        "slotWidth",
        "slotCount",
      ]) {
        expect(arithmetic.has(name), `${path} → ${name}`).toBe(false);
      }
    }
  });

  it("gives nothing but the follow model an opinion about the anchor", () => {
    /*
     * Read off the syntax tree, so a comment that mentions the fraction is
     * not a copy of it and a copy buried in an expression is. The reading
     * anchor is a product decision with one home: a component that held its
     * own 0.32 would go on agreeing until the day somebody changed one of
     * them.
     */
    expect(numericLiteralsOf("src/lib/ui/continuous-follow.ts").has(0.32)).toBe(true);
    for (const path of [
      ...CANVASES,
      SURFACE_HOOK,
      "src/components/workspace/TabBarSlot.tsx",
      "src/components/workspace/SectionMarkers.tsx",
      "src/lib/ui/horizontal-window.ts",
      "src/lib/tab/song-axis.ts",
    ]) {
      expect(numericLiteralsOf(path).has(0.32), path).toBe(false);
    }
  });

  it("states the overscan once, in the window", () => {
    // Same rule, other number: the amount was chosen by measurement, and a
    // component holding its own copy would not have been measured.
    const owner = numericLiteralsOf("src/lib/ui/horizontal-window.ts");
    expect(owner.has(0.5)).toBe(true);
    for (const path of [...CANVASES, SURFACE_HOOK]) {
      const names = identifiersOf(path);
      expect(names.has("OVERSCAN_VIEWPORTS"), path).toBe(false);
    }
  });
});
