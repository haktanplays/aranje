/**
 * Where the multi-track view may reach (2Q-A §14).
 *
 * A third surface is a third chance to grow the god module that 2L-R took
 * apart, so the rules are the ones that were settled then, applied to the
 * new files: the pure model stays pure, components go through controllers,
 * lanes do not import each other, and nothing in production reaches into
 * `eval/`.
 *
 * Measured on the import graph and the syntax tree. No new grep-based
 * architecture test.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { identifiersOf, valueImportsOf } from "@/lib/dev/ast";

const PURE = [
  "src/lib/multitrack/model.ts",
  "src/lib/multitrack/lane-kind.ts",
];

const LANES = [
  "src/components/workspace/FrettedMultiLane.tsx",
  "src/components/workspace/DrumMultiLane.tsx",
  "src/components/workspace/PitchedMultiLane.tsx",
];

const CANVAS = "src/components/workspace/MultiTrackCanvas.tsx";
const CONTROLLER = "src/lib/workspace/use-multitrack-session.ts";

describe("206. the multi-track model is a pure model", () => {
  it("imports no React, no audio, no storage and no component", () => {
    for (const path of PURE) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.startsWith("react"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.startsWith("tone"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.includes("/components/"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.includes("/audio/"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.includes("song/storage"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.includes("/projects/"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.startsWith("eval/"), `${path} → ${specifier}`).toBe(false);
      }
    }
  });

  it("touches no browser global, no clock and no dice", () => {
    for (const path of PURE) {
      const names = identifiersOf(path);
      for (const banned of [
        "window",
        "document",
        "localStorage",
        "AudioContext",
        "fetch",
        "Date",
        "random",
        "requestAnimationFrame",
      ]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });

  it("carries no pixel constant of its own", () => {
    // Geometry takes the slot width as an argument; a `lib/` module that
    // imported a component's constants would have the dependency backwards.
    for (const path of PURE) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.includes("workspace/geometry"), `${path} → ${specifier}`).toBe(
          false,
        );
      }
    }
  });
});

describe("207. the surface goes through the controllers it is given", () => {
  it("keeps the canvas away from the store, history and the engine", () => {
    for (const path of [CANVAS, ...LANES]) {
      for (const specifier of valueImportsOf(path)) {
        for (const banned of [
          "@/lib/song/song-store",
          "@/lib/song/storage",
          "@/lib/song/edit-history",
          "@/lib/song/edit",
          "@/lib/copilot/fingerprint",
          "@/lib/audio/engine",
          "@/lib/audio/playback",
        ]) {
          expect(specifier, `${path} → ${specifier}`).not.toBe(banned);
        }
        expect(specifier.includes("/projects/"), `${path} → ${specifier}`).toBe(false);
        expect(specifier.startsWith("eval/"), `${path} → ${specifier}`).toBe(false);
      }
    }
  });

  it("builds no engine and reaches for no storage global", () => {
    for (const path of [CANVAS, ...LANES]) {
      const names = identifiersOf(path);
      for (const banned of ["localStorage", "sessionStorage", "AudioContext", "fetch"]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });

  it("keeps the lane components from importing each other", () => {
    /*
     * Three renderers that share a typed model and nothing else. An edge
     * between two of them is how "the drum lane needs a little of what the
     * fretted one does" becomes one component that draws both.
     */
    for (const path of LANES) {
      for (const specifier of valueImportsOf(path)) {
        for (const other of ["FrettedMultiLane", "DrumMultiLane", "PitchedMultiLane"]) {
          if (path.endsWith(`${other}.tsx`)) continue;
          expect(specifier.includes(other), `${path} → ${specifier}`).toBe(false);
        }
      }
    }
  });

  it("keeps the arrangement out of this feature entirely", () => {
    for (const specifier of valueImportsOf(
      "src/components/workspace/ArrangementCanvas.tsx",
    )) {
      expect(specifier).not.toContain("multitrack");
      expect(specifier).not.toContain("MultiTrack");
    }
  });
});

describe("208. one animation frame, one scroller, one view owner", () => {
  it("runs the playhead through the shared loop rather than its own frames", () => {
    const names = identifiersOf(CANVAS);
    // No direct `requestAnimationFrame`: the loop that counts as one is the
    // one the whole app is measured through (2N-A.1).
    expect(names.has("requestAnimationFrame")).toBe(false);
    expect(names.has("cancelAnimationFrame")).toBe(false);
    expect(names.has("runPlayheadLoop")).toBe(true);
  });

  it("declares one horizontal scroller in the canvas and none in a lane", () => {
    const canvas = readFileSync(CANVAS, "utf8");
    /*
     * A genuinely textual question about a class attribute, so a textual
     * check is the right instrument — and it is the *count* that matters,
     * because the failure mode is a second scroller, not a missing one.
     */
    expect(canvas.match(/overflow-x-auto/g) ?? []).toHaveLength(1);
    for (const path of LANES) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("overflow-x-auto");
      expect(source, path).not.toContain("overflow-x-scroll");
      expect(source, path).not.toContain("scrollLeft");
    }
  });

  it("keeps the view state in the one owner", () => {
    // The controller holds the folds; it does not hold a second idea of
    // which surface is on screen.
    const names = identifiersOf(CONTROLLER);
    expect(names.has("WorkspaceView")).toBe(false);
    for (const specifier of valueImportsOf(CONTROLLER)) {
      expect(specifier).not.toContain("ViewSwitch");
    }
  });

  it("writes nothing to a song, a store or a fingerprint from the session", () => {
    for (const specifier of valueImportsOf(CONTROLLER)) {
      for (const banned of [
        "@/lib/song/song-store",
        "@/lib/song/storage",
        "@/lib/song/edit-history",
        "@/lib/copilot/fingerprint",
        "@/lib/project/project-file",
      ]) {
        expect(specifier).not.toBe(banned);
      }
      expect(specifier.includes("/projects/")).toBe(false);
    }
    const names = identifiersOf(CONTROLLER);
    expect(names.has("localStorage")).toBe(false);
  });
});
