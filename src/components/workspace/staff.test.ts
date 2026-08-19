import { describe, expect, it } from "vitest";

import {
  frettedRowLabels,
  rowOffset,
  visualRow,
} from "@/components/workspace/staff";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Song } from "@/lib/song/schema";
import {
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { buildTrackTimeline } from "@/lib/tab/timeline";

function fretted(subject: Song, trackId: string) {
  const timeline = buildTrackTimeline(subject, trackId);
  if (timeline.kind !== "fretted") throw new Error("expected a fretted track");
  return timeline;
}

function oneNoteSong(slot: Parameters<typeof melodicBar>[1][number]): Song {
  const slots = restSlots(8);
  slots[0] = slot;
  return song([guitarTrack()], [section([melodicBar("gtr", slots)])]);
}

/** A2 written out on string 1, fret 0. */
const EXPLICIT_SONG = oneNoteSong({
  notes: [{ pitch: "A2", position: { string: 1, fret: 0 } }],
});

/** The same A2 with no position, so the greedy engine places it. */
const COMPUTED_SONG = oneNoteSong({ notes: [{ pitch: "A2" }] });

/** E2 on the thickest string, held over four slots. */
const TIED_SONG: Song = (() => {
  const slots = restSlots(8);
  slots[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
  slots[1] = "-";
  slots[2] = "-";
  slots[3] = "-";
  return song([guitarTrack()], [section([melodicBar("gtr", slots)])]);
})();

const GUITAR = TUNING_PRESETS.e_standard?.tuning ?? [];
const BASS = TUNING_PRESETS.bass_standard?.tuning ?? [];

describe("string order on screen", () => {
  it("puts the thickest string, index 0, on the bottom line", () => {
    expect(visualRow(6, 0)).toBe(5);
    expect(visualRow(4, 0)).toBe(3);
  });

  it("puts the thinnest string, the last index, on the top line", () => {
    expect(visualRow(6, 5)).toBe(0);
    expect(visualRow(4, 3)).toBe(0);
  });

  it("keeps the mapping a bijection over every string", () => {
    const rows = Array.from({ length: 6 }, (_, index) => visualRow(6, index));
    expect([...rows].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("turns the row into a pixel offset", () => {
    expect(rowOffset(6, 0, 56)).toBe(280);
    expect(rowOffset(6, 5, 56)).toBe(0);
  });
});

describe("string labels", () => {
  it("reads e B G D A E down a guitar", () => {
    expect(frettedRowLabels(GUITAR)).toEqual(["e", "B", "G", "D", "A", "E"]);
  });

  it("reads G D A E down a bass", () => {
    expect(frettedRowLabels(BASS)).toEqual(["G", "D", "A", "E"]);
  });

  it("lowercases the duplicate, not a fixed position", () => {
    // Drop D is D2 A2 D3 G3 B3 E4. The two D strings are the ambiguous pair,
    // so the higher one is lowercased; the single E needs no disambiguation.
    expect(frettedRowLabels(TUNING_PRESETS.drop_d?.tuning ?? [])).toEqual([
      "E",
      "B",
      "G",
      "d",
      "A",
      "D",
    ]);
  });

  it("has one label per string", () => {
    expect(frettedRowLabels(GUITAR)).toHaveLength(GUITAR.length);
    expect(frettedRowLabels(BASS)).toHaveLength(BASS.length);
  });
});

describe("the whole staff goes through one transform", () => {
  const stringCount = 6;

  it("maps an explicitly written position and a computed one the same way", () => {
    // Same string index, different provenance: the drawing must not care.
    const explicit = fretted(EXPLICIT_SONG, "gtr").bars[0]?.spans[0];
    const computed = fretted(COMPUTED_SONG, "gtr").bars[0]?.spans[0];

    expect(explicit?.stringIndex).toBe(1);
    expect(computed?.stringIndex).toBe(1);
    expect(rowOffset(stringCount, explicit?.stringIndex ?? -1, 56)).toBe(
      rowOffset(stringCount, computed?.stringIndex ?? -1, 56),
    );
    // String 1 is the second thickest, so it lands on the second row up.
    expect(visualRow(stringCount, 1)).toBe(4);
  });

  it("keeps a sustained note on the string it started on", () => {
    const span = fretted(TIED_SONG, "gtr").bars[0]?.spans[0];
    expect(span?.startSlot).toBe(0);
    expect(span?.endSlot).toBe(3);
    // One span, one string, therefore one row for the head and its line.
    expect(visualRow(stringCount, span?.stringIndex ?? -1)).toBe(
      visualRow(stringCount, span?.stringIndex ?? -1),
    );
    expect(span?.stringIndex).toBe(0);
    expect(visualRow(stringCount, 0)).toBe(5);
  });

  it("leaves drum lanes in their own order", () => {
    const timeline = buildTrackTimeline(SAMPLE_SONG, "drums");
    if (timeline.kind !== "drums") throw new Error("expected drums");
    // Cymbals on top, kick at the bottom, untouched by the string flip.
    expect(timeline.lanes).toEqual(["crash", "closed_hat", "snare", "kick"]);
    const kickLane = timeline.lanes.indexOf("kick");
    expect(kickLane).toBe(timeline.lanes.length - 1);
  });
});
