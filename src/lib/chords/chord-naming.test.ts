/**
 * One chord, one name (2V-B.4 §13).
 *
 * The failure this exists to prevent is not a typo. It is the app showing the
 * same chord three ways at once — "C minor" in one place, "C minör" in
 * another and `minor` from the enum in a third — and a reader concluding
 * there are three things. So identity and spelling are separated on purpose:
 * the identity is a pitch class and a quality, and the *name* is derived from
 * it for the key the song is in.
 */
import { describe, expect, it } from "vitest";

import {
  ADVANCED_QUALITIES,
  SIMPLE_QUALITIES,
  chordDisplayName,
  isSimpleQuality,
  keyPrefersFlats,
  measureLabel,
  parseChordInput,
  qualityLabel,
  sameChord,
  spellPitchClass,
  transposeChord,
} from "@/lib/chords/chord-naming";

describe("51. every way of writing a chord reaches the same chord", () => {
  it("reads the minor aliases a reader actually types", () => {
    const canonical = { rootPitchClass: 0, quality: "minor" as const };
    for (const input of ["Cm", "C min", "C minör", "Cminor", "C-", "Cmoll", "C m"]) {
      const parsed = parseChordInput(input);
      expect(parsed, input).not.toBeNull();
      expect(sameChord(parsed!, canonical), input).toBe(true);
    }
  });

  it("keeps M and m apart, because they are different chords", () => {
    expect(parseChordInput("CM")?.quality).toBe("major");
    expect(parseChordInput("Cm")?.quality).toBe("minor");
  });

  it("reads the rest of the simple vocabulary", () => {
    expect(parseChordInput("C")?.quality).toBe("major");
    expect(parseChordInput("C5")?.quality).toBe("power");
    expect(parseChordInput("Cpower")?.quality).toBe("power");
    expect(parseChordInput("Csus2")?.quality).toBe("sus2");
    expect(parseChordInput("Csus4")?.quality).toBe("sus4");
    expect(parseChordInput("Csus")?.quality).toBe("sus4");
    expect(parseChordInput("C7")?.quality).toBe("dominant_7");
    expect(parseChordInput("Cmaj7")?.quality).toBe("major_7");
    expect(parseChordInput("Cm7")?.quality).toBe("minor_7");
  });

  it("reads accidentals in either notation and lands on one pitch class", () => {
    expect(parseChordInput("F#m")?.rootPitchClass).toBe(6);
    expect(parseChordInput("F♯m")?.rootPitchClass).toBe(6);
    expect(parseChordInput("Gbm")?.rootPitchClass).toBe(6);
    expect(parseChordInput("G♭m")?.rootPitchClass).toBe(6);
    expect(sameChord(parseChordInput("F#m")!, parseChordInput("Gbm")!)).toBe(true);
  });

  it("returns nothing rather than guessing", () => {
    for (const input of ["", "   ", "H", "Cwobble", "7", "minor"]) {
      expect(parseChordInput(input), input).toBeNull();
    }
  });
});

describe("52. the name is spelled for the key it is written in", () => {
  it("uses flats in flat keys and sharps in sharp ones", () => {
    expect(keyPrefersFlats("F major")).toBe(true);
    expect(keyPrefersFlats("D minor")).toBe(true);
    expect(keyPrefersFlats("E minor")).toBe(false);
    expect(keyPrefersFlats("A major")).toBe(false);
    expect(spellPitchClass(6, "F major")).toBe("Gb");
    expect(spellPitchClass(6, "A major")).toBe("F#");
    expect(spellPitchClass(0, "F major")).toBe("C");
  });

  it("names one chord one way on one surface", () => {
    const chord = { rootPitchClass: 6, quality: "minor" as const };
    /* One symbol, spelled for the key. Not the symbol *and* the word, and
       never the enum: "F#m", not "F#m (minor) / minor". */
    expect(chordDisplayName(chord, "A major")).toBe("F#m");
    expect(chordDisplayName(chord, "F major")).toBe("Gbm");
    expect(chordDisplayName(chord, "A major")).not.toContain("minor");
    expect(chordDisplayName({ rootPitchClass: 0, quality: "power" }, "C major")).toBe("C5");
    expect(chordDisplayName({ rootPitchClass: 0, quality: "major_7" }, "C major")).toBe(
      "Cmaj7",
    );
    /* And a display name reads back as the chord it names (§13: one authority). */
    expect(sameChord(parseChordInput(chordDisplayName(chord, "F major"))!, chord)).toBe(true);
  });

  it("follows a transposition without being renamed by hand", () => {
    const chord = { rootPitchClass: 4, quality: "minor" as const };
    const moved = transposeChord(chord, 2);
    expect(moved.rootPitchClass).toBe(6);
    expect(moved.quality).toBe("minor");
    expect(chordDisplayName(moved, "A major")).toBe(chordDisplayName(
      { rootPitchClass: 6, quality: "minor" },
      "A major",
    ));
    /* And wraps rather than running off the end of the octave. */
    expect(transposeChord({ rootPitchClass: 11, quality: "major" }, 3).rootPitchClass).toBe(2);
  });
});

describe("53. the simple surface stays simple", () => {
  it("offers eight qualities and no more", () => {
    expect([...SIMPLE_QUALITIES]).toEqual([
      "major",
      "minor",
      "power",
      "sus2",
      "sus4",
      "dominant_7",
      "major_7",
      "minor_7",
    ]);
    for (const quality of SIMPLE_QUALITIES) expect(isSimpleQuality(quality)).toBe(true);
    for (const quality of ADVANCED_QUALITIES) expect(isSimpleQuality(quality)).toBe(false);
    expect(ADVANCED_QUALITIES.length).toBeGreaterThan(0);
  });

  it("labels a quality in words rather than in identifiers", () => {
    for (const quality of [...SIMPLE_QUALITIES, ...ADVANCED_QUALITIES]) {
      const label = qualityLabel(quality);
      expect(label, quality).not.toContain("_");
      expect(label.length, quality).toBeGreaterThan(0);
    }
  });
});

describe("54. a measure is named the way a musician says it", () => {
  it("says '4. ölçü', never 'Bar 4' and never a slot", () => {
    expect(measureLabel(4)).toBe("4. ölçü");
    expect(measureLabel(1)).toBe("1. ölçü");
    expect(measureLabel(4).toLowerCase()).not.toContain("bar");
    expect(measureLabel(4).toLowerCase()).not.toContain("slot");
  });
});
