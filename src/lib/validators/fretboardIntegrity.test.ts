import { describe, expect, it } from "vitest";

import type { MelodicSlot } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  silentDrumSlots,
  song,
} from "@/lib/song/fixtures";
import { validateFretboardIntegrity } from "@/lib/validators/fretboardIntegrity";

function withNote(slot: MelodicSlot) {
  const slots = restSlots(8);
  slots[0] = slot;
  return slots;
}

describe("fretboardIntegrity validator (spec 10.1, semantics 9.1)", () => {
  it("accepts a position that sounds the written pitch", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }],
            }),
          ),
        ]),
      ],
    );
    expect(validateFretboardIntegrity(subject)).toEqual([]);
  });

  it("accepts a note with no position at all", () => {
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", withNote({ notes: [{ pitch: "G2" }] }))])],
    );
    expect(validateFretboardIntegrity(subject)).toEqual([]);
  });

  it("reads fret 0 as the sound behind the capo", () => {
    const capoTrack = guitarTrack({
      fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 2 },
    });
    const ok = song(
      [capoTrack],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [{ pitch: "F#2", position: { string: 0, fret: 0 } }],
            }),
          ),
        ]),
      ],
    );
    expect(validateFretboardIntegrity(ok)).toEqual([]);

    const wrong = song(
      [capoTrack],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }],
            }),
          ),
        ]),
      ],
    );
    const issues = validateFretboardIntegrity(wrong);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("F#2");
  });

  it("rejects a pitch that the position does not sound", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [{ pitch: "A2", position: { string: 0, fret: 3 } }],
            }),
          ),
        ]),
      ],
    );
    const issues = validateFretboardIntegrity(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("fretboardIntegrity");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("G2");
  });

  it("rejects a string that does not exist on the fretboard", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [{ pitch: "E2", position: { string: 9, fret: 0 } }],
            }),
          ),
        ]),
      ],
    );
    expect(validateFretboardIntegrity(subject)).toHaveLength(1);
  });

  it("rejects a fret beyond the capo-relative range", () => {
    const subject = song(
      [
        guitarTrack({
          fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 12 },
        }),
      ],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [{ pitch: "E4", position: { string: 0, fret: 13 } }],
            }),
          ),
        ]),
      ],
    );
    const issues = validateFretboardIntegrity(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("0..12");
  });

  it("rejects a position on a track that has no fretboard", () => {
    const subject = song(
      [guitarTrack({ fretboard: undefined })],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }],
            }),
          ),
        ]),
      ],
    );
    expect(validateFretboardIntegrity(subject)).toHaveLength(1);
  });

  it("checks every note of a chord", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          melodicBar(
            "gtr",
            withNote({
              notes: [
                { pitch: "E2", position: { string: 0, fret: 0 } },
                { pitch: "B2", position: { string: 1, fret: 9 } },
              ],
            }),
          ),
        ]),
      ],
    );
    expect(validateFretboardIntegrity(subject)).toHaveLength(1);
  });

  it("ignores drum tracks", () => {
    const subject = song(
      [drumTrack()],
      [
        section([
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { drums: silentDrumSlots(8) },
          },
        ]),
      ],
    );
    expect(validateFretboardIntegrity(subject)).toEqual([]);
  });
});
