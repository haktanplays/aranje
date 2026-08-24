/**
 * Chords with no fretboard under them (2O-B §24).
 *
 * The assertions are about sounding pitch and about what is *not* written: a
 * keyboard voicing that carried a `position` would be claiming a string that
 * does not exist, and a voicing quietly moved into another octave would be
 * answering a question the reader did not ask.
 */
import { describe, expect, it } from "vitest";

import {
  keyboardCandidates,
  selectKeyboardVoicings,
} from "@/lib/chords/keyboard-voicing";
import { CHORD_QUALITY_IDS } from "@/lib/chords/chord-formula";
import { keyboardVoicingLimits } from "@/lib/limits";
import { pitchClass, pitchToMidi } from "@/lib/music/pitch";
import { readChord } from "@/lib/chords/chord-recognition";

const pitchesOf = (
  root: number,
  quality: Parameters<typeof keyboardCandidates>[0]["quality"],
  octave: number,
) =>
  keyboardCandidates({ rootPitchClass: root, quality, octave }).map((voicing) =>
    voicing.pitches.join(" "),
  );

describe("155. root position and its inversions", () => {
  it("gives C major its three positions", () => {
    expect(pitchesOf(0, "major", 4)).toEqual([
      "C4 E4 G4",
      "E4 G4 C5",
      "G4 C5 E5",
    ]);
  });

  it("gives A minor 7 its four positions", () => {
    expect(pitchesOf(9, "minor_7", 3)).toEqual([
      "A3 C4 E4 G4",
      "C4 E4 G4 A4",
      "E4 G4 A4 C5",
      "G4 A4 C5 E5",
    ]);
  });

  it("gives C major 7 its four positions", () => {
    expect(pitchesOf(0, "major_7", 4)).toEqual([
      "C4 E4 G4 B4",
      "E4 G4 B4 C5",
      "G4 B4 C5 E5",
      "B4 C5 E5 G5",
    ]);
  });

  it("lifts exactly the lowest note by exactly one octave", () => {
    const all = keyboardCandidates({
      rootPitchClass: 0,
      quality: "major",
      octave: 4,
    });
    for (let index = 1; index < all.length; index += 1) {
      const before = all[index - 1]!.midi;
      const after = all[index]!.midi;
      expect(after.slice(0, -1)).toEqual(before.slice(1));
      expect(after[after.length - 1]).toBe(before[0]! + 12);
    }
  });

  it("keeps every stack ascending, with no note written twice", () => {
    for (const quality of ["major", "minor", "minor_7", "half_diminished_7", "sus2"] as const) {
      for (let root = 0; root < 12; root += 1) {
        for (const voicing of keyboardCandidates({ rootPitchClass: root, quality, octave: 4 })) {
          const midi = [...voicing.midi];
          expect(midi, `${root} ${quality} ${voicing.id}`).toEqual(
            [...midi].sort((a, b) => a - b),
          );
          expect(new Set(midi).size, `${root} ${quality} ${voicing.id}`).toBe(midi.length);
        }
      }
    }
  });

  it("is still the chord it was asked for, read back from the notes", () => {
    for (const voicing of keyboardCandidates({
      rootPitchClass: 9,
      quality: "minor_7",
      octave: 3,
    })) {
      const reading = readChord(voicing.pitches.map((pitch) => ({ pitch })));
      expect(reading.kind, voicing.id).toBe("matched");
      if (reading.kind !== "matched") continue;
      expect(reading.matches.map((match) => match.name), voicing.id).toEqual(["Am7"]);
    }
  });

  it("writes no fretboard position, because there is no fretboard", () => {
    // The shape is pitches. Anything else would be a claim about strings.
    for (const voicing of keyboardCandidates({
      rootPitchClass: 0,
      quality: "major",
      octave: 4,
    })) {
      expect(Object.keys(voicing).sort()).toEqual([
        "bassPitch",
        "id",
        "inversion",
        "midi",
        "pitches",
      ]);
    }
  });

  it("answers the same bytes five runs over", () => {
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(
        keyboardCandidates({ rootPitchClass: 7, quality: "dominant_7", octave: 3 }),
      ),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("156. power chords and the edges of what can be written", () => {
  it("is two notes, root underneath", () => {
    const two = keyboardCandidates({
      rootPitchClass: 2,
      quality: "power",
      octave: 3,
    });
    expect(two.map((voicing) => voicing.pitches.join(" "))).toEqual(["D3 A3"]);
  });

  it("is three notes with the octave, and the top note is the root again", () => {
    const three = keyboardCandidates({
      rootPitchClass: 2,
      quality: "power",
      octave: 3,
      withOctave: true,
    });
    expect(three.map((voicing) => voicing.pitches.join(" "))).toEqual(["D3 A3 D4"]);
    const midi = three[0]!.midi;
    expect(midi[2]! - midi[0]!).toBe(12);
    expect(pitchClass(three[0]!.pitches[2]!)).toBe(2);
  });

  it("offers no inversion of a power chord in either form", () => {
    // Putting the fifth underneath makes a different sound with the same
    // name, and inverting the octave form would write the root twice.
    expect(
      keyboardCandidates({ rootPitchClass: 2, quality: "power", octave: 3 }),
    ).toHaveLength(1);
    expect(
      keyboardCandidates({
        rootPitchClass: 2,
        quality: "power",
        octave: 3,
        withOctave: true,
      }),
    ).toHaveLength(1);
  });

  it("refuses rather than folding a chord back down at the top", () => {
    // C major 7 in octave 9 would need notes past the highest pitch the Song
    // Contract can spell. Nothing is offered, and nothing is transposed.
    expect(
      keyboardCandidates({ rootPitchClass: 0, quality: "major_7", octave: 9 }),
    ).toEqual([]);
  });

  it("writes the lowest octave the contract can spell, and no lower", () => {
    const low = keyboardCandidates({
      rootPitchClass: 0,
      quality: "major_7",
      octave: -1,
    });
    expect(low.length).toBeGreaterThan(0);
    expect(low[0]?.pitches[0]).toBe("C-1");
    for (const voicing of low) {
      for (const midi of voicing.midi) {
        expect(midi).toBeGreaterThanOrEqual(keyboardVoicingLimits.lowestMidi);
        expect(midi).toBeLessThanOrEqual(keyboardVoicingLimits.highestMidi);
      }
    }
  });

  it("keeps every inversion in the register the reader picked, by construction", () => {
    /*
     * Not by a check — by arithmetic. An inversion lifts the lowest note by
     * exactly an octave, so every inversion of a chord whose intervals fit
     * inside one sits within an octave and a seventh of the note that was
     * chosen. Asserted over the whole vocabulary rather than one example,
     * because that is what makes it a property instead of a coincidence.
     */
    for (const quality of CHORD_QUALITY_IDS) {
      for (let root = 0; root < 12; root += 1) {
        const all = keyboardCandidates({ rootPitchClass: root, quality, octave: 4 });
        if (all.length === 0) continue;
        const chosen = all[0]!.midi[0]!;
        for (const voicing of all) {
          for (const midi of voicing.midi) {
            expect(midi - chosen, `${root} ${quality} ${voicing.id}`).toBeLessThan(24);
            expect(midi - chosen, `${root} ${quality} ${voicing.id}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("lifts a note by an octave, never by anything else", () => {
    // The one arithmetic fact the register guarantee rests on.
    for (const quality of ["major", "minor_7", "half_diminished_7"] as const) {
      const all = keyboardCandidates({ rootPitchClass: 3, quality, octave: 3 });
      for (let index = 1; index < all.length; index += 1) {
        const before = all[index - 1]!.midi;
        const after = all[index]!.midi;
        expect(after[after.length - 1]! - before[0]!, `${quality} inv${index}`).toBe(12);
      }
    }
  });

  it("shows at most the central maximum, in order", () => {
    const offered = selectKeyboardVoicings({
      rootPitchClass: 9,
      quality: "minor_7",
      octave: 3,
    });
    expect(offered.length).toBeLessThanOrEqual(keyboardVoicingLimits.maxVariations);
    expect(offered.map((voicing) => voicing.inversion)).toEqual([0, 1, 2, 3]);
  });

  it("puts the note the reader picked at the bottom of root position", () => {
    for (let root = 0; root < 12; root += 1) {
      const first = keyboardCandidates({
        rootPitchClass: root,
        quality: "major",
        octave: 4,
      })[0];
      expect(first, String(root)).toBeDefined();
      if (!first) continue;
      expect(pitchClass(first.bassPitch), String(root)).toBe(root);
      expect(pitchToMidi(first.bassPitch)).toBe(pitchToMidi(`C4`)! + root);
    }
  });
});
