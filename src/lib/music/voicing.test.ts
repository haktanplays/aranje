import { describe, expect, it } from "vitest";

import { MAX_PHYSICAL_FRET, maxCapoRelativeFret } from "@/lib/music/fretboard";
import {
  CORE_LITE_MAX_STRINGS,
  candidatePositions,
  candidateVoicings,
  compareVoicings,
  isBeyondCoreLite,
} from "@/lib/music/voicing";
import type { Fretboard, NoteEvent } from "@/lib/song/schema";

const GUITAR: Fretboard = {
  tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
  capo: 0,
};
const DROP_D: Fretboard = { ...GUITAR, tuning: ["D2", "A2", "D3", "G3", "B3", "E4"] };
const BASS: Fretboard = { tuning: ["E1", "A1", "D2", "G2"], capo: 0 };
const CAPO_3: Fretboard = { ...GUITAR, capo: 3 };

function voicingsOf(fretboard: Fretboard, notes: readonly NoteEvent[]) {
  const result = candidateVoicings(fretboard, notes);
  return result.kind === "placed" || result.kind === "partial"
    ? result.voicings
    : [];
}

describe("every way one note can be played", () => {
  it("finds each string that can reach the pitch, lowest string first", () => {
    expect(candidatePositions(GUITAR, "E4")).toEqual([
      { string: 0, fret: 24 },
      { string: 1, fret: 19 },
      { string: 2, fret: 14 },
      { string: 3, fret: 9 },
      { string: 4, fret: 5 },
      { string: 5, fret: 0 },
    ]);
    expect(voicingsOf(GUITAR, [{ pitch: "E4" }])).toHaveLength(6);
  });

  it("reads fret 0 as the sound behind the capo", () => {
    const capo2: Fretboard = { ...GUITAR, capo: 2 };
    expect(candidatePositions(capo2, "F#2")).toEqual([{ string: 0, fret: 0 }]);
    // The pitch below the capo has nowhere to go.
    expect(candidatePositions(capo2, "E2")).toEqual([]);
  });

  it("follows an alternate tuning through the same code path", () => {
    expect(candidatePositions(DROP_D, "D2")).toEqual([{ string: 0, fret: 0 }]);
    expect(candidatePositions(BASS, "E1")).toEqual([{ string: 0, fret: 0 }]);
  });

  it("stops at the physical fret limit, and the capo takes some of it", () => {
    const top = voicingsOf(GUITAR, [{ pitch: "E4" }]);
    expect(top.some((voicing) => voicing.maxPhysicalFret === MAX_PHYSICAL_FRET)).toBe(
      true,
    );

    const capo5: Fretboard = { ...GUITAR, capo: 5 };
    for (const position of candidatePositions(capo5, "E4")) {
      expect(position.fret).toBeLessThanOrEqual(maxCapoRelativeFret(5));
    }
  });

  it("has nothing for a pitch off the fretboard or a broken pitch", () => {
    expect(candidatePositions(GUITAR, "C1")).toEqual([]);
    expect(candidatePositions(GUITAR, "not a pitch")).toEqual([]);
    expect(candidateVoicings(GUITAR, [{ pitch: "C1" }]).kind).toBe("unplaceable");
  });
});

describe("chords", () => {
  it("never gives one string to two notes", () => {
    for (const voicing of voicingsOf(GUITAR, [{ pitch: "E3" }, { pitch: "G3" }])) {
      const strings = voicing.notes.map((note) => note.stringIndex);
      expect(new Set(strings).size).toBe(strings.length);
    }
  });

  it("keeps a deliberate doubling as two notes on two strings", () => {
    const voicings = voicingsOf(GUITAR, [{ pitch: "A2" }, { pitch: "A2" }]);
    expect(voicings.length).toBeGreaterThan(0);
    for (const voicing of voicings) {
      expect(voicing.notes).toHaveLength(2);
      expect(voicing.notes[0]?.stringIndex).not.toBe(voicing.notes[1]?.stringIndex);
    }
  });

  it("counts two orderings of the same shape as one voicing", () => {
    // A2 on strings 0 and 1 is one way to hold it, whichever note is which.
    const voicings = voicingsOf(GUITAR, [{ pitch: "A2" }, { pitch: "A2" }]);
    const signatures = voicings.map((voicing) => voicing.signature);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("says so when no complete voicing exists", () => {
    // E2 and F2 both live only on the thickest string.
    expect(candidateVoicings(GUITAR, [{ pitch: "E2" }, { pitch: "F2" }]).kind).toBe(
      "unplaceable",
    );
  });
});

describe("written positions", () => {
  const explicit: NoteEvent = { pitch: "G2", position: { string: 0, fret: 3 } };

  it("keeps the position exactly and reserves the string", () => {
    const voicings = voicingsOf(GUITAR, [explicit, { pitch: "D3" }]);
    expect(voicings.length).toBeGreaterThan(0);
    for (const voicing of voicings) {
      const written = voicing.notes.find((note) => note.noteIndex === 0);
      expect(written).toMatchObject({
        stringIndex: 0,
        fret: 3,
        source: "explicit",
      });
      expect(voicing.notes[1]?.stringIndex).not.toBe(0);
      expect(voicing.notes[1]?.source).toBe("computed");
    }
  });

  it("does not correct a wrong written position", () => {
    // The pitch and the position disagree; fretboardIntegrity owns that.
    const wrong: NoteEvent = { pitch: "C4", position: { string: 0, fret: 3 } };
    const voicings = voicingsOf(GUITAR, [wrong]);
    expect(voicings[0]?.notes[0]).toMatchObject({ stringIndex: 0, fret: 3 });
  });

  it("leaves two written positions on the same string where they are", () => {
    const both: NoteEvent[] = [
      { pitch: "G2", position: { string: 0, fret: 3 } },
      { pitch: "A2", position: { string: 0, fret: 5 } },
    ];
    const voicings = voicingsOf(GUITAR, both);
    expect(voicings).toHaveLength(1);
    expect(voicings[0]?.notes.map((note) => note.stringIndex)).toEqual([0, 0]);
  });

  it("keeps a written position even when a sibling cannot be placed", () => {
    // G2 is nailed to string 0; the second G2 has nowhere left to go.
    const result = candidateVoicings(GUITAR, [
      { pitch: "G2", position: { string: 0, fret: 3 } },
      { pitch: "G2" },
    ]);
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.unresolved).toEqual([1]);
    expect(result.voicings[0]?.notes).toHaveLength(1);
    expect(result.voicings[0]?.notes[0]).toMatchObject({ stringIndex: 0, fret: 3 });
  });
});

describe("measurements and order", () => {
  it("measures each voicing the way the hand helper does", () => {
    const voicings = voicingsOf(GUITAR, [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "B2", position: { string: 1, fret: 2 } },
      { pitch: "E3", position: { string: 2, fret: 2 } },
    ]);
    expect(voicings[0]).toMatchObject({
      anchor: 2,
      span: 0,
      center: 1,
      maxPhysicalFret: 2,
      totalPhysicalFret: 4,
    });
  });

  it("measures a note behind the capo as fretted, at the capo's own fret", () => {
    // With a capo at 3 the top string sounds G4 with nothing held. The hand
    // is not at the nut there: the capo is the fret (spec 9.1), so this is
    // where the whole measurement of the neck starts from.
    const behind = voicingsOf(CAPO_3, [{ pitch: "G4" }]).find(
      (voicing) => voicing.signature === "5:0",
    );

    expect(behind).toMatchObject({ anchor: 3, maxPhysicalFret: 3, totalPhysicalFret: 3 });
  });

  it("returns candidates in a canonical order, every time", () => {
    const first = voicingsOf(GUITAR, [{ pitch: "E4" }]).map((v) => v.signature);
    const second = voicingsOf(GUITAR, [{ pitch: "E4" }]).map((v) => v.signature);
    expect(first).toEqual(second);
    // Nearest the nut first.
    expect(first[0]).toBe("5:0");
  });

  it("orders by position, then stretch, then width, then strings", () => {
    const near = { anchor: 0, span: 0, center: 0, maxPhysicalFret: 3, totalPhysicalFret: 3, notes: [], signature: "a" };
    const far = { ...near, maxPhysicalFret: 9, signature: "b" };
    expect(compareVoicings(near, far)).toBeLessThan(0);

    const wide = { ...near, span: 4, signature: "c" };
    expect(compareVoicings(near, wide)).toBeLessThan(0);
  });

  it("does not touch the notes it was given", () => {
    const notes: NoteEvent[] = [{ pitch: "G2" }, { pitch: "D3" }];
    const before = JSON.stringify(notes);
    candidateVoicings(GUITAR, notes);
    expect(JSON.stringify(notes)).toBe(before);
  });
});

describe("beyond the pilot catalogue", () => {
  it("knows a Core Lite fretboard from a wider one", () => {
    expect(CORE_LITE_MAX_STRINGS).toBe(6);
    expect(isBeyondCoreLite(GUITAR)).toBe(false);
    expect(isBeyondCoreLite(BASS)).toBe(false);
    expect(
      isBeyondCoreLite({ ...GUITAR, tuning: [...GUITAR.tuning, "B1"] }),
    ).toBe(true);
  });

  it("never hits the enumeration cap within Core Lite", () => {
    // Six notes across six strings is the widest chord the pilot allows.
    const chord: NoteEvent[] = ["E2", "A2", "D3", "G3", "B3", "E4"].map((pitch) => ({
      pitch,
    }));
    const result = candidateVoicings(GUITAR, chord);
    expect(result.kind).toBe("placed");
    if (result.kind !== "placed") return;
    expect(result.truncated).toBe(false);
  });
});
