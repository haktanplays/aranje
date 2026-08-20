import { describe, expect, it } from "vitest";

import { TUNING_PRESETS, type Fretboard } from "@/lib/music/fretboard";
import { pitchToMidi } from "@/lib/music/pitch";
import {
  candidatePositions,
  resolveNotePosition,
  resolveSlotPositions,
  resolvedSoundsAs,
} from "@/test/legacy-greedy";

const GUITAR: Fretboard = {
  tuning: TUNING_PRESETS.e_standard?.tuning ?? [],
  capo: 0,
};
const BASS: Fretboard = {
  tuning: TUNING_PRESETS.bass_standard?.tuning ?? [],
  capo: 0,
};

function place(fretboard: Fretboard, ...pitches: string[]) {
  return resolveSlotPositions(
    fretboard,
    pitches.map((pitch) => ({ pitch })),
  ).map((entry) => entry.position);
}

describe("candidate positions (spec 9.2 rule 1)", () => {
  it("lists every string that can reach the pitch", () => {
    expect(candidatePositions(GUITAR, "E4")).toEqual([
      { string: 0, fret: 24 },
      { string: 1, fret: 19 },
      { string: 2, fret: 14 },
      { string: 3, fret: 9 },
      { string: 4, fret: 5 },
      { string: 5, fret: 0 },
    ]);
  });

  it("drops positions outside the capo-relative range", () => {
    const capo12: Fretboard = { tuning: GUITAR.tuning, capo: 12 };
    for (const position of candidatePositions(capo12, "E4")) {
      expect(position.fret).toBeLessThanOrEqual(12);
    }
    expect(candidatePositions(capo12, "E2")).toEqual([]);
  });

  it("returns nothing for a pitch the instrument cannot reach", () => {
    expect(candidatePositions(GUITAR, "C1")).toEqual([]);
    expect(candidatePositions(GUITAR, "not-a-pitch")).toEqual([]);
  });
});

describe("single note placement (spec 9.2 rules 3-5)", () => {
  it("takes the lowest reachable fret", () => {
    expect(place(GUITAR, "E4")).toEqual([{ string: 5, fret: 0 }]);
    expect(place(GUITAR, "G2")).toEqual([{ string: 0, fret: 3 }]);
    expect(place(GUITAR, "C3")).toEqual([{ string: 1, fret: 3 }]);
  });

  it("places bass notes on the bass fretboard", () => {
    expect(place(BASS, "E1")).toEqual([{ string: 0, fret: 0 }]);
    expect(place(BASS, "C2")).toEqual([{ string: 1, fret: 3 }]);
  });

  it("reports no placement when the note is out of reach", () => {
    const resolved = resolveNotePosition(GUITAR, { pitch: "C1" });
    expect(resolved.position).toBeNull();
    expect(resolved.source).toBe("none");
  });

  it("always sounds the pitch it was asked for", () => {
    for (const pitch of ["E2", "G2", "A2", "B2", "C3", "D3", "E3", "F#3", "G3", "B3", "E4", "F#4", "G4"]) {
      const resolved = resolveNotePosition(GUITAR, { pitch });
      expect(resolvedSoundsAs(GUITAR, resolved)).toBe(pitchToMidi(pitch));
    }
  });

  it("respects the capo when placing", () => {
    const capo3: Fretboard = { tuning: GUITAR.tuning, capo: 3 };
    const resolved = resolveNotePosition(capo3, { pitch: "G2" });
    expect(resolved.position).toEqual({ string: 0, fret: 0 });
    expect(resolvedSoundsAs(capo3, resolved)).toBe(pitchToMidi("G2"));
  });
});

describe("chord placement (spec 9.2 rule 2)", () => {
  it("gives each note its own string", () => {
    const positions = place(GUITAR, "E2", "B2");
    const strings = positions.map((position) => position?.string);
    expect(new Set(strings).size).toBe(strings.length);
  });

  it("voices the demo power chords in open position", () => {
    expect(place(GUITAR, "E2", "B2")).toEqual([
      { string: 0, fret: 0 },
      { string: 1, fret: 2 },
    ]);
    expect(place(GUITAR, "A2", "E3")).toEqual([
      { string: 1, fret: 0 },
      { string: 2, fret: 2 },
    ]);
  });

  it("picks the lowest frets, not the shape a guitarist would use (K-4)", () => {
    // G5 is normally fretted as string 0 fret 3 plus string 1 fret 5. The
    // greedy rule minimises the highest physical fret instead, so it puts the
    // fifth on the open D string. Both sound G2 and D3; only the hand shape
    // differs. This is the documented limit of spec 9.2, and it is why the
    // demo song writes those positions out explicitly.
    expect(place(GUITAR, "G2", "D3")).toEqual([
      { string: 0, fret: 3 },
      { string: 2, fret: 0 },
    ]);
  });

  it("keeps the same pitch twice on two different strings", () => {
    const positions = place(GUITAR, "E4", "E4");
    expect(positions[0]).not.toEqual(positions[1]);
    expect(positions.every((position) => position !== null)).toBe(true);
  });

  it("prefers the lowest maximum fret over the lowest total", () => {
    // B3 sits on string 4 fret 0 or string 3 fret 4; E4 on string 5 fret 0,
    // string 4 fret 5 or string 3 fret 9. Taking both open beats any mix.
    expect(place(GUITAR, "B3", "E4")).toEqual([
      { string: 4, fret: 0 },
      { string: 5, fret: 0 },
    ]);
  });

  it("returns no placement when the strings run out", () => {
    // Five notes of the same pitch, but only four strings can reach E4 below
    // the fret limit shared with the others.
    const positions = place(BASS, "G2", "G2", "G2", "G2", "G2");
    expect(positions.every((position) => position === null)).toBe(true);
  });

  it("is deterministic across repeated runs", () => {
    const first = place(GUITAR, "E2", "B2", "E3");
    for (let run = 0; run < 5; run += 1) {
      expect(place(GUITAR, "E2", "B2", "E3")).toEqual(first);
    }
  });
});

describe("explicit positions win (spec 5.4)", () => {
  it("keeps a position the note already carries", () => {
    const resolved = resolveSlotPositions(GUITAR, [
      { pitch: "E4", position: { string: 3, fret: 9 } },
    ]);
    expect(resolved[0]?.position).toEqual({ string: 3, fret: 9 });
    expect(resolved[0]?.source).toBe("explicit");
  });

  it("places the remaining notes around a reserved string", () => {
    const resolved = resolveSlotPositions(GUITAR, [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "B2" },
    ]);
    expect(resolved[0]?.source).toBe("explicit");
    expect(resolved[1]?.source).toBe("computed");
    expect(resolved[1]?.position?.string).not.toBe(0);
    expect(resolvedSoundsAs(GUITAR, resolved[1]!)).toBe(pitchToMidi("B2"));
  });

  it("does not move a computed note onto a reserved string", () => {
    const resolved = resolveSlotPositions(GUITAR, [
      { pitch: "B3", position: { string: 4, fret: 0 } },
      { pitch: "E4" },
    ]);
    expect(resolved[1]?.position?.string).toBe(5);
  });

  it("leaves the order of the returned entries alone", () => {
    const resolved = resolveSlotPositions(GUITAR, [
      { pitch: "G3" },
      { pitch: "E2" },
      { pitch: "B2" },
    ]);
    expect(resolved.map((entry) => entry.note.pitch)).toEqual([
      "G3",
      "E2",
      "B2",
    ]);
  });
});
