/**
 * The harmonic vocabulary and reading it back (2O-B §24).
 *
 * The formula table is the sort of thing that looks obviously right and is
 * worth pinning anyway: a single wrong number in it is a wrong chord in every
 * voicing, on every instrument, silently.
 */
import { describe, expect, it } from "vitest";

import {
  CHORD_FORMULAS,
  CHORD_FORMULA_LIST,
  CHORD_QUALITY_IDS,
  chordName,
  chordPitchClasses,
  isChordQualityId,
  normalizePitchClass,
  requiredPitchClasses,
  ROOT_LABELS,
  ROOT_SHORT_LABELS,
  rootLabel,
} from "@/lib/chords/chord-formula";
import {
  describeChord,
  matchPitchClasses,
  readChord,
} from "@/lib/chords/chord-recognition";
import type { NoteEvent } from "@/lib/song/schema";

const notesOf = (...pitches: string[]): NoteEvent[] =>
  pitches.map((pitch) => ({ pitch }));

describe("147. the eleven qualities are exactly what the spec names", () => {
  it("carries the intervals the spec table states, and no others", () => {
    const expected: Record<string, number[]> = {
      major: [0, 4, 7],
      minor: [0, 3, 7],
      power: [0, 7],
      sus2: [0, 2, 7],
      sus4: [0, 5, 7],
      diminished: [0, 3, 6],
      augmented: [0, 4, 8],
      dominant_7: [0, 4, 7, 10],
      major_7: [0, 4, 7, 11],
      minor_7: [0, 3, 7, 10],
      half_diminished_7: [0, 3, 6, 10],
    };
    expect(Object.keys(expected).sort()).toEqual([...CHORD_QUALITY_IDS].sort());
    for (const id of CHORD_QUALITY_IDS) {
      expect([...CHORD_FORMULAS[id].intervals], id).toEqual(expected[id]);
    }
  });

  it("keeps intervals ascending, starting at the root, with no repeats", () => {
    for (const formula of CHORD_FORMULA_LIST) {
      const steps = [...formula.intervals];
      expect(steps[0], formula.id).toBe(0);
      expect(steps, formula.id).toEqual([...steps].sort((a, b) => a - b));
      expect(new Set(steps).size, formula.id).toBe(steps.length);
      expect(Math.max(...steps), formula.id).toBeLessThan(12);
    }
  });

  it("requires only tones the chord actually contains", () => {
    for (const formula of CHORD_FORMULA_LIST) {
      expect(formula.required.length, formula.id).toBeGreaterThan(0);
      for (const step of formula.required) {
        expect(formula.intervals, `${formula.id} requires ${step}`).toContain(step);
      }
      // The root is never optional, whatever else is.
      expect(formula.required, formula.id).toContain(0);
    }
  });

  it("lets only a seventh chord drop a tone, and only its perfect fifth", () => {
    for (const formula of CHORD_FORMULA_LIST) {
      const dropped = formula.intervals.filter(
        (step) => !formula.required.includes(step),
      );
      if (dropped.length === 0) continue;
      expect(dropped, formula.id).toEqual([7]);
      // Only chords that state their quality through a seventh may do this —
      // a minor seventh (10) or a major seventh (11).
      const hasSeventh =
        formula.intervals.includes(10) || formula.intervals.includes(11);
      expect(hasSeventh, formula.id).toBe(true);
    }
    // The half-diminished seventh keeps its diminished fifth: without it the
    // notes are a plain minor seventh.
    expect([...CHORD_FORMULAS.half_diminished_7.required]).toEqual([0, 3, 6, 10]);
  });

  it("gives no two qualities the same pitch-class set", () => {
    const seen = new Map<string, string>();
    for (const formula of CHORD_FORMULA_LIST) {
      const key = [...formula.intervals].sort((a, b) => a - b).join(",");
      expect(seen.has(key), `${formula.id} duplicates ${seen.get(key)}`).toBe(false);
      seen.set(key, formula.id);
    }
  });

  it("names and labels every quality, with no id leaking into the text", () => {
    for (const formula of CHORD_FORMULA_LIST) {
      expect(formula.label.length, formula.id).toBeGreaterThan(0);
      expect(formula.label).not.toContain("_");
      expect(chordName(9, formula.id).startsWith("A")).toBe(true);
    }
    expect(chordName(9, "minor_7")).toBe("Am7");
    expect(chordName(2, "power")).toBe("D5");
    expect(chordName(0, "major_7")).toBe("Cmaj7");
    expect(chordName(4, "sus4")).toBe("Esus4");
  });
});

describe("148. a chord transposes to all twelve roots and stays itself", () => {
  it("keeps the interval structure at every root", () => {
    for (const formula of CHORD_FORMULA_LIST) {
      for (let root = 0; root < 12; root += 1) {
        const classes = chordPitchClasses(root, formula.id);
        expect(classes.length, formula.id).toBe(formula.intervals.length);
        expect(classes[0], formula.id).toBe(root);
        const steps = classes.map((entry) =>
          normalizePitchClass(entry - root),
        );
        expect(steps, `${formula.id}@${root}`).toEqual([...formula.intervals]);
      }
    }
  });

  it("wraps past B rather than running off the end", () => {
    // B major is B, D#, F# — the third and fifth wrap through zero.
    expect(chordPitchClasses(11, "major")).toEqual([11, 3, 6]);
    expect(normalizePitchClass(-1)).toBe(11);
    expect(normalizePitchClass(25)).toBe(1);
  });

  it("treats an enharmonic spelling as one pitch class, not two", () => {
    // The reader may read "D♯ / E♭"; the app only ever has the number 3.
    expect(rootLabel(3)).toBe("D♯ / E♭");
    expect(ROOT_SHORT_LABELS[3]).toBe("D#");
    expect(ROOT_LABELS).toHaveLength(12);
    expect(chordPitchClasses(3, "major")).toEqual(chordPitchClasses(15, "major"));
  });

  it("answers the same bytes five runs over", () => {
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(
        CHORD_QUALITY_IDS.map((id) =>
          Array.from({ length: 12 }, (_, root) => chordPitchClasses(root, id)),
        ),
      ),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("recognises its own ids and refuses anything else", () => {
    expect(isChordQualityId("minor_7")).toBe(true);
    expect(isChordQualityId("minor7")).toBe(false);
    expect(isChordQualityId("add9")).toBe(false);
  });

  it("requires the characteristic tones of each seventh", () => {
    // A minor 7 on A: A, C, G required; E may go if the neck cannot reach it.
    expect(requiredPitchClasses(9, "minor_7").sort((a, b) => a - b)).toEqual([
      0, 7, 9,
    ]);
  });
});

describe("149. reading notes back into a chord name", () => {
  it("names the plain triads", () => {
    const c = readChord(notesOf("C4", "E4", "G4"));
    expect(c.kind).toBe("matched");
    if (c.kind !== "matched") return;
    expect(c.matches.map((match) => match.name)).toEqual(["C"]);
  });

  it("names A minor and A minor 7", () => {
    const am = readChord(notesOf("A3", "C4", "E4"));
    expect(am.kind === "matched" && am.matches.map((m) => m.name)).toEqual(["Am"]);

    const am7 = readChord(notesOf("A2", "E3", "G3", "C4", "E4"));
    expect(am7.kind).toBe("matched");
    if (am7.kind !== "matched") return;
    // A, C, E, G is exactly Am7 in the V1 vocabulary. C6 is not in it, and is
    // therefore not offered — the reader is never shown a name the app does
    // not otherwise support.
    expect(am7.matches.map((m) => m.name)).toEqual(["Am7"]);
  });

  it("reads an inversion by its notes, not by its bass", () => {
    // E in the bass, C major above it: still C major, and the bass is reported
    // separately rather than becoming the root.
    const reading = readChord(notesOf("E3", "G3", "C4"));
    expect(reading.kind).toBe("matched");
    if (reading.kind !== "matched") return;
    expect(reading.matches.map((m) => m.name)).toEqual(["C"]);
    expect(reading.lowestPitch).toBe("E3");
    expect(reading.matches[0]?.rootPitchClass).toBe(0);
  });

  it("reads Cmaj7 in first inversion", () => {
    const reading = readChord(notesOf("E3", "G3", "B3", "C4"));
    expect(reading.kind === "matched" && reading.matches.map((m) => m.name)).toEqual([
      "Cmaj7",
    ]);
  });

  it("normalises an octave doubling to the same two pitch classes", () => {
    const two = readChord(notesOf("D3", "A3"));
    const three = readChord(notesOf("D3", "A3", "D4"));
    expect(two.kind === "matched" && two.matches.map((m) => m.name)).toEqual(["D5"]);
    expect(three.kind === "matched" && three.matches.map((m) => m.name)).toEqual([
      "D5",
    ]);
  });

  it("carries every exact reading when the notes are genuinely ambiguous", () => {
    // A diminished seventh is symmetrical, but V1 has no dim7; the augmented
    // triad is: C, E, G# is equally C+, E+ and G#+ and all three are returned.
    const reading = readChord(notesOf("C4", "E4", "G#4"));
    expect(reading.kind).toBe("matched");
    if (reading.kind !== "matched") return;
    expect(reading.matches.map((m) => m.name)).toEqual(["Caug", "Eaug", "G#aug"]);
    expect(describeChord(reading)).toBe("Olası yapılar: Caug · Eaug · G#aug");
  });

  it("calls music it cannot name special, never wrong", () => {
    const reading = readChord(notesOf("C4", "C#4", "D4", "F#4"));
    expect(reading.kind).toBe("unknown");
    expect(describeChord(reading)).toBe("Özel nota grubu.");
  });

  it("does not name a chord from one note or one pitch class", () => {
    expect(readChord(notesOf("C4")).kind).toBe("single");
    expect(readChord(notesOf("C3", "C4", "C5")).kind).toBe("single");
    expect(readChord([]).kind).toBe("empty");
  });

  it("ignores velocity, articulation and position entirely", () => {
    const plain = readChord(notesOf("A3", "C4", "E4"));
    const dressed = readChord([
      { pitch: "A3", velocity: 20, articulation: "palm_mute", position: { string: 0, fret: 5 } },
      { pitch: "C4", velocity: 127, articulation: "accent" },
      { pitch: "E4", articulation: "staccato", position: { string: 3, fret: 2 } },
    ]);
    expect(JSON.stringify(dressed)).toBe(JSON.stringify(plain));
  });

  it("matches only an exact set, never a subset or a superset", () => {
    // C, E, G, B is Cmaj7; C, E, B alone is not "Cmaj7 with a missing fifth".
    expect(matchPitchClasses([0, 4, 7, 11]).map((m) => m.name)).toEqual(["Cmaj7"]);
    expect(matchPitchClasses([0, 4, 11])).toEqual([]);
    expect(matchPitchClasses([0, 4, 7, 11, 2])).toEqual([]);
  });

  it("is deterministic in root then quality order", () => {
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(matchPitchClasses([0, 4, 8])),
    );
    expect(new Set(runs).size).toBe(1);
    expect(matchPitchClasses([0, 4, 8]).map((m) => m.rootPitchClass)).toEqual([
      0, 4, 8,
    ]);
  });
});
