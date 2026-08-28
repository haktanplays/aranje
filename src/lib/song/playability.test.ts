import { describe, expect, it } from "vitest";

import {
  COMFORTABLE_SPAN,
  LEVEL_LABELS,
  notesForBar,
  playabilityNotes,
} from "@/lib/song/playability";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import { REPERTOIRE } from "@/lib/repertoire/fixtures";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";

const rest = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => null);

function fixture(slots: MelodicSlot[]): Song {
  return song(
    [guitarTrack()],
    [section([melodicBar(TRACK, slots, { resolution: 16 })])],
  );
}

const kinds = (subject: Song) =>
  playabilityNotes(subject, TRACK).map((note) => note.kind);

describe("what a guitar would have trouble with", () => {
  it("says nothing about music that is simply playable", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "B2", position: { string: 1, fret: 2 } },
      ],
    };
    expect(playabilityNotes(fixture(slots), TRACK)).toEqual([]);
  });

  /* Already refused for new edits; shown here because a file can arrive
     with one and refusing to open the song would be worse than the bug. */
  it("reports a string asked for twice at once as a conflict", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "F2", position: { string: 0, fret: 1 } },
      ],
    };
    const notes = playabilityNotes(fixture(slots), TRACK);
    expect(notes[0]).toMatchObject({ level: "conflict", kind: "string_collision" });
  });

  it("calls a wide fret span hard rather than impossible", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "A2", position: { string: 0, fret: 5 } },
        { pitch: "E4", position: { string: 5, fret: 12 } },
      ],
    };
    const notes = playabilityNotes(fixture(slots), TRACK);
    expect(notes[0]).toMatchObject({ level: "warning", kind: "wide_stretch" });
    expect(notes[0]!.message).toContain("zor olabilir");
    expect(notes[0]!.message).not.toContain("çalınamaz");
  });

  it("leaves a hand-sized span alone", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "A2", position: { string: 0, fret: 5 } },
        { pitch: "C4", position: { string: 3, fret: 5 + COMFORTABLE_SPAN } },
      ],
    };
    expect(kinds(fixture(slots))).toEqual([]);
  });

  /* An open string needs no finger, so it is not part of a stretch. */
  it("does not count open strings into the stretch", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "E4", position: { string: 5, fret: 12 } },
      ],
    };
    expect(kinds(fixture(slots))).toEqual([]);
  });

  it("explains why a written note is heard short, without calling it wrong", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, durationTicks: 768 }],
    };
    slots[4] = { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] };
    const found = playabilityNotes(fixture(slots), TRACK).find(
      (note) => note.kind === "shortened_by_restrike",
    );
    expect(found?.level).toBe("info");
    expect(found?.message).toContain("kısa duyulur");
    expect(found?.message).toContain("yerinde duruyor");
  });

  it("says the dirty arpeggio's overlap is not a mistake", () => {
    const found = playabilityNotes(REPERTOIRE.fixtureC(), "gtr").find(
      (note) => note.kind === "voices_overlap",
    );
    expect(found?.level).toBe("info");
    expect(found?.message).toContain("hata değil");
  });

  it("puts the worst first", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "F2", position: { string: 0, fret: 1 } },
      ],
    };
    slots[4] = {
      notes: [
        { pitch: "A2", position: { string: 0, fret: 5 } },
        { pitch: "E4", position: { string: 5, fret: 12 } },
      ],
    };
    const levels = playabilityNotes(fixture(slots), TRACK).map((note) => note.level);
    expect(levels[0]).toBe("conflict");
    expect(levels).toContain("warning");
  });

  /* Nothing the model says to itself may reach the reader. */
  it("never uses the model's vocabulary", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "F2", position: { string: 0, fret: 1 } },
      ],
    };
    slots[8] = {
      notes: [
        { pitch: "A2", position: { string: 0, fret: 5 } },
        { pitch: "E4", position: { string: 5, fret: 12 } },
      ],
    };
    for (const note of playabilityNotes(fixture(slots), TRACK)) {
      for (const word of ["tick", "slot", "stringIndex", "onset", "schema", "null"]) {
        expect(note.message.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("can be narrowed to the bar a reader is looking at", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "F2", position: { string: 0, fret: 1 } },
      ],
    };
    const all = playabilityNotes(fixture(slots), TRACK);
    expect(notesForBar(all, 0)).toHaveLength(all.length);
    expect(notesForBar(all, 1)).toEqual([]);
  });

  it("names the three tiers in words a reader can tell apart", () => {
    expect(LEVEL_LABELS.conflict).toBe("Çalınamaz");
    expect(LEVEL_LABELS.warning).toBe("Zor olabilir");
    expect(LEVEL_LABELS.info).toBe("Bilgi");
  });

  it("says nothing about a track that is not there", () => {
    expect(playabilityNotes(REPERTOIRE.fixtureA(), "yok")).toEqual([]);
  });
});
