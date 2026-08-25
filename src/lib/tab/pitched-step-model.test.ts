/**
 * A fretless track as a strip you can tap (2Q-B §7.1, §14).
 *
 * The distinction the model exists to keep is "written silence" versus "not
 * written here". Both are tappable; only one of them is a fact about the
 * music. A model that collapsed them would hide K-55's defect rather than
 * carry its fix forward.
 */
import { describe, expect, it } from "vitest";

import { buildPitchedStepModel, suggestedOctave } from "@/lib/tab/pitched-step-model";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import { songSchema, type Bar, type Song } from "@/lib/song/schema";

const SECTION = SAMPLE_SONG.sections[0]!.id;

const KEYS = {
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
} as const;

/** The sample song with a fretless track whose lanes are all written rests. */
function withKeys(): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  next.tracks = [...next.tracks, { ...KEYS }];
  for (const section of next.sections) {
    for (const bar of section.bars) {
      bar.slots[KEYS.id] = bar.slots["gtr"]!.map(() => null) as Bar["slots"][string];
    }
  }
  return songSchema.parse(next);
}

/** The same, but the track was never written in this song at all. */
function withUnwrittenKeys(): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  next.tracks = [...next.tracks, { ...KEYS }];
  return songSchema.parse(next);
}

describe("221. the pitched step strip", () => {
  it("carries the tick of every moment, not a slot index", () => {
    const model = buildPitchedStepModel(withKeys(), SECTION, KEYS.id);
    const bar0 = model.bars[0]!;
    const per = ticksPerSlot(bar0.resolution);
    expect(model.cells[0]?.ticks).toBe(0);
    expect(model.cells[1]?.ticks).toBe(per);
  });

  it("gives one cell per slot of every bar in the section", () => {
    const song = withKeys();
    const model = buildPitchedStepModel(song, SECTION, KEYS.id);
    const expected = song.sections[0]!.bars.reduce(
      (total, bar) => total + slotCount(bar.timeSignature, bar.resolution),
      0,
    );
    expect(model.cells).toHaveLength(expected);
  });

  it("counts bar numbers from the start of the song, not the section", () => {
    const song = withKeys();
    const second = song.sections[1]!.id;
    const model = buildPitchedStepModel(song, second, KEYS.id);
    expect(model.bars[0]?.barNumber).toBe(song.sections[0]!.bars.length + 1);
  });

  it("separates written silence from a track that is not written here", () => {
    expect(buildPitchedStepModel(withKeys(), SECTION, KEYS.id).cells[0]?.state).toBe("rest");
    expect(
      buildPitchedStepModel(withUnwrittenKeys(), SECTION, KEYS.id).cells[0]?.state,
    ).toBe("blank");
  });

  it("says a track is silent throughout only when no bar carries its key", () => {
    expect(buildPitchedStepModel(withKeys(), SECTION, KEYS.id).silentThroughout).toBe(false);
    expect(
      buildPitchedStepModel(withUnwrittenKeys(), SECTION, KEYS.id).silentThroughout,
    ).toBe(true);
  });

  it("reads an onset and the tie that holds it as two different moments", () => {
    const song = withKeys();
    const lane = song.sections[0]!.bars[0]!.slots[KEYS.id] as unknown[];
    lane[0] = { notes: [{ pitch: "A3" }] };
    lane[1] = "-";
    const model = buildPitchedStepModel(songSchema.parse(song), SECTION, KEYS.id);
    expect(model.cells[0]?.state).toBe("note");
    expect(model.cells[0]?.pitches).toEqual(["A3"]);
    expect(model.cells[1]?.state).toBe("tie");
    expect(model.cells[1]?.pitches).toEqual([]);
  });

  it("reports every pitch of a chord onset, in the order the song stores them", () => {
    const song = withKeys();
    const lane = song.sections[0]!.bars[0]!.slots[KEYS.id] as unknown[];
    lane[0] = { notes: [{ pitch: "C4" }, { pitch: "E4" }, { pitch: "G4" }] };
    const model = buildPitchedStepModel(songSchema.parse(song), SECTION, KEYS.id);
    expect(model.cells[0]?.pitches).toEqual(["C4", "E4", "G4"]);
  });

  it("falls back to the first section when the id names no section", () => {
    const model = buildPitchedStepModel(withKeys(), "no-such-section", KEYS.id);
    expect(model.sectionId).toBe(SECTION);
  });
});

describe("222. where the note sheet opens", () => {
  it("opens on the octave this track last used", () => {
    const song = withKeys();
    const lane = song.sections[0]!.bars[0]!.slots[KEYS.id] as unknown[];
    lane[0] = { notes: [{ pitch: "A2" }] };
    expect(suggestedOctave(songSchema.parse(song), KEYS.id)).toBe(2);
  });

  it("borrows an octave from the song when this track has none", () => {
    // The sample song's guitar is written; the empty keys track is not.
    const song = withKeys();
    expect(suggestedOctave(song, KEYS.id)).toBeGreaterThan(0);
  });

  it("falls back to the contract's middle octave when nothing is written", () => {
    const song = structuredClone(SAMPLE_SONG) as Song;
    for (const section of song.sections) {
      for (const bar of section.bars) bar.slots = {} as Bar["slots"];
    }
    expect(suggestedOctave(songSchema.parse(song), "keys")).toBe(4);
  });
});
