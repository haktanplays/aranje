/**
 * Where the chord builder is allowed to reach (2O-B §29).
 *
 * Measured on the import graph and the syntax tree, not by searching source
 * text: a rule that greps finds its own comment and misses a rename. No new
 * architecture-by-grep test is added here, and no new runtime dependency.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { callCount, identifiersOf, valueImportsOf } from "@/lib/dev/ast";
import { CHORD_FORMULA_LIST } from "@/lib/chords/chord-formula";
import { voicingLimits, keyboardVoicingLimits, chordPreviewLimits } from "@/lib/limits";

const CORES = [
  "src/lib/chords/chord-formula.ts",
  "src/lib/chords/chord-recognition.ts",
  "src/lib/chords/fretted-voicing.ts",
  "src/lib/chords/keyboard-voicing.ts",
  "src/lib/chords/chord-voicing.ts",
  "src/lib/chords/chord-command.ts",
  "src/lib/chords/chord-copy.ts",
  "src/lib/chords/chord-target.ts",
  "src/lib/chords/chord-errors.ts",
  "src/lib/chords/chord-audition.ts",
];

const COMPONENTS = [
  "src/components/workspace/ChordBuilderSheet.tsx",
  "src/components/workspace/FretSheet.tsx",
];

/** The same count the 2L-R budgets are stated in: a trailing newline is not a line. */
const lines = (path: string) => {
  const text = readFileSync(path, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

describe("165. the pure cores stay pure", () => {
  it("imports no React, no Tone, no Next and no storage", () => {
    for (const path of CORES) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.startsWith("react"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.startsWith("tone"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.startsWith("next"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.includes("/components/"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.includes("song/storage"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.includes("/projects/"), `${path} -> ${specifier}`).toBe(false);
        // Production code never reaches into the evaluation harness.
        expect(specifier.startsWith("eval/"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.includes("../../../eval"), `${path} -> ${specifier}`).toBe(false);
      }
    }
  });

  it("touches no browser global", () => {
    for (const path of CORES) {
      const names = identifiersOf(path);
      for (const banned of ["window", "document", "localStorage", "AudioContext", "fetch"]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });

  it("reads no clock and rolls no dice", () => {
    for (const path of CORES) {
      const names = identifiersOf(path);
      for (const banned of ["Date", "random", "randomUUID", "crypto"]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });

  it("derives every pitch through the one pitch helper", () => {
    // No module builds a pitch name or a MIDI number by hand: the fretted
    // search, the keyboard stack and the audition all go through the same
    // two functions the rest of the app uses.
    for (const path of [
      "src/lib/chords/fretted-voicing.ts",
      "src/lib/chords/keyboard-voicing.ts",
    ]) {
      expect(valueImportsOf(path)).toContain("@/lib/music/pitch");
    }
  });
});

describe("166. the screen sees a controller and nothing under it", () => {
  it("keeps the sheets away from the searches, the store and the engine", () => {
    /*
     * `FretSheet` has imported `@/lib/song/edit` since phase 2A, for the
     * read-only pitch label beside the fret field. That is not what this rule
     * is about and it is not retroactively forbidden here; what a sheet may
     * never reach is a way to *change* the song or to run a search itself.
     */
    for (const path of COMPONENTS) {
      for (const specifier of valueImportsOf(path)) {
        for (const banned of [
          "@/lib/song/song-store",
          "@/lib/song/storage",
          "@/lib/chords/fretted-voicing",
          "@/lib/chords/keyboard-voicing",
          "@/lib/chords/chord-voicing",
          "@/lib/audio/playback",
          "@/lib/audio/preview-engine",
        ]) {
          expect(specifier, `${path} -> ${specifier}`).not.toBe(banned);
        }
      }
    }
    // And the sheet built for this checkpoint keeps away from the edit core
    // as well: it has no reason to know it exists.
    expect(valueImportsOf("src/components/workspace/ChordBuilderSheet.tsx")).not.toContain(
      "@/lib/song/edit",
    );
  });

  it("lets a sheet name the five articulations without listing them itself", () => {
    /*
     * `ChordBuilderSheet` does import `chord-command`, and only for
     * `CHORD_ARTICULATIONS`. That is the point: the alternative is the
     * component typing the five names out, which is exactly the second table
     * this checkpoint exists to avoid.
     */
    const imports = valueImportsOf("src/components/workspace/ChordBuilderSheet.tsx");
    expect(imports).toContain("@/lib/chords/chord-command");
    const names = identifiersOf("src/components/workspace/ChordBuilderSheet.tsx");
    expect(names.has("applyChordWrite")).toBe(false);
  });

  it("touches no audio context, no object URL and no storage", () => {
    for (const path of COMPONENTS) {
      const names = identifiersOf(path);
      for (const banned of ["AudioContext", "createObjectURL", "localStorage"]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });

  it("writes no interval table and no tuning arithmetic of its own", () => {
    const sheet = readFileSync("src/components/workspace/ChordBuilderSheet.tsx", "utf8");
    // Every interval the vocabulary uses, and none of them typed here.
    const intervals = new Set(CHORD_FORMULA_LIST.flatMap((formula) => formula.intervals));
    for (const interval of intervals) {
      expect(sheet.includes(`[0, ${interval}`), `interval ${interval}`).toBe(false);
    }
    const names = identifiersOf("src/components/workspace/ChordBuilderSheet.tsx");
    for (const banned of ["pitchToMidi", "midiToPitch", "soundingMidi", "maxCapoRelativeFret"]) {
      expect(names.has(banned), `sheet computes ${banned}`).toBe(false);
    }
  });

  it("keeps the arrangement out of it entirely", () => {
    for (const specifier of valueImportsOf("src/components/workspace/ArrangementCanvas.tsx")) {
      expect(specifier.includes("/chords/"), specifier).toBe(false);
    }
  });
});

describe("167. one table, one set of limits, one budget", () => {
  it("declares every interval exactly once, in the formula table", () => {
    for (const path of CORES) {
      if (path.endsWith("chord-formula.ts")) continue;
      const source = readFileSync(path, "utf8");
      // The distinctive shape of a formula literal: a bracketed run starting
      // at the root. One of these outside the table is a second vocabulary.
      expect(/\[\s*0\s*,\s*[0-9]+\s*,\s*[0-9]+/.test(source), path).toBe(false);
    }
  });

  it("reads every voicing limit from the central module rather than declaring one", () => {
    /*
     * The claim is about *where a limit is decided*, so it is asked of the
     * import graph and of the exported values — not by counting how often the
     * digit 2 appears in a file, which would measure noise.
     */
    for (const path of [
      "src/lib/chords/fretted-voicing.ts",
      "src/lib/chords/keyboard-voicing.ts",
      "src/lib/chords/chord-audition.ts",
    ]) {
      expect(valueImportsOf(path), path).toContain("@/lib/limits");
    }

    // And every one of them is a real number that something reads, so the
    // module cannot quietly become a list of unused constants.
    expect(voicingLimits.maxFretSpan).toBeGreaterThan(0);
    expect(voicingLimits.maxVariations).toBeGreaterThan(0);
    expect(keyboardVoicingLimits.maxVariations).toBeGreaterThan(0);
    expect(chordPreviewLimits.referenceVoices).toBeGreaterThan(0);

    // Nothing outside `limits.ts` declares one of these names.
    for (const path of CORES) {
      const names = identifiersOf(path);
      for (const owned of ["voicingLimits", "keyboardVoicingLimits", "chordPreviewLimits"]) {
        if (!names.has(owned)) continue;
        expect(valueImportsOf(path), `${path} declares ${owned}`).toContain("@/lib/limits");
      }
    }
  });

  it("keeps the composition root and the canvas inside their budgets", () => {
    // 380 is where 2O-A left the root; this checkpoint does not spend it.
    expect(lines("src/components/workspace/Workspace.tsx")).toBeLessThanOrEqual(380);
    expect(lines("src/components/workspace/ArrangementCanvas.tsx")).toBeLessThanOrEqual(470);
  });

  it("adds no new runtime dependency", () => {
    const before = new Set(
      Object.keys(
        (JSON.parse(readFileSync("package.json", "utf8")) as {
          dependencies: Record<string, string>;
        }).dependencies,
      ),
    );
    expect([...before].sort()).toEqual(
      ["next", "react", "react-dom", "tone", "zod"].sort(),
    );
  });

  it("builds no second commit path", () => {
    // The chord command settles and returns; committing is the caller's, and
    // there is exactly one caller.
    expect(callCount("src/lib/chords/chord-command.ts", "commit")).toBe(0);
    const callers = [
      "src/lib/workspace/use-chord-builder.ts",
      "src/lib/workspace/use-audition.ts",
      "src/lib/workspace/use-tab-view.ts",
    ].filter((path) => callCount(path, "commit") > 0);
    expect(callers).toEqual(["src/lib/workspace/use-chord-builder.ts"]);
  });
});
