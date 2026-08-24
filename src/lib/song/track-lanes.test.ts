/**
 * A new track is a working surface, and a first note is one edit (2Q-A §1, §2).
 *
 * The defect these tests close was not a crash: `create_track` succeeded,
 * the track appeared, the grid drew nothing and every cell refused. So what
 * is asserted here is the thing that was silently untrue — that the track a
 * reader just asked for can be written on — and the atomicity that keeps the
 * fix from becoming a second defect.
 */
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/copilot/fingerprint";
import { isDrumInstrument } from "@/lib/instruments/registry";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { slotCount } from "@/lib/music/timing";
import { applyEdit } from "@/lib/song/edit";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Bar, type Song, type Track } from "@/lib/song/schema";
import { applyTrackCommand, type TrackSetup } from "@/lib/song/track-lifecycle";
import {
  barsWrittenIn,
  emptyLane,
  isWrittenInBar,
  withEmptyLaneInBar,
  withEmptyLanes,
} from "@/lib/song/track-lanes";
import { errorsOnly, runValidators } from "@/lib/validators";

const frozen = canonicalJson(SAMPLE_SONG);

const GUITAR: TrackSetup = {
  name: "Solo Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  fretboard: { tuning: TUNING_PRESETS.e_standard!.tuning, capo: 0 },
};
const BASS: TrackSetup = {
  name: "Bas 2",
  instrumentId: "electric_bass",
  presetId: "finger",
  fretboard: { tuning: TUNING_PRESETS.bass_standard!.tuning, capo: 0 },
};
const DRUMS: TrackSetup = {
  name: "Davul 2",
  instrumentId: "drum_kit",
  presetId: "rock",
};
/**
 * A melodic instrument with no fretboard.
 *
 * Not creatable through `create_track`: the piano is `phase_2_5` scope and
 * the command only takes core instruments, which is a product boundary and
 * not a defect. So this track is put into a song directly, the way one
 * arrives from a project file, and the lane helper is asked about it there.
 */
const KEYS_TRACK: Track = {
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
};

function create(song: Song, setup: TrackSetup): { song: Song; track: Track } {
  const result = applyTrackCommand(song, { kind: "create_track", setup });
  expect(result.ok, setup.name).toBe(true);
  if (!result.ok) throw new Error("create refused");
  return { song: result.song, track: result.song.tracks.at(-1)! };
}

/** Every bar of the song, so a claim can be made about all of them. */
function allBars(song: Song): Bar[] {
  return song.sections.flatMap((section) => section.bars);
}

function lanesAreSilent(song: Song, track: Track): boolean {
  return allBars(song).every((bar) => {
    const lane = bar.slots[track.id];
    if (lane === undefined) return false;
    if (lane.length !== slotCount(bar.timeSignature, bar.resolution)) return false;
    return isDrumInstrument(track.instrumentId)
      ? lane.every((slot) => Array.isArray(slot) && slot.length === 0)
      : lane.every((slot) => slot === null);
  });
}

/**
 * The same bar on a different meter and grid, every lane silent.
 *
 * Only the geometry matters for these tests, so the content is dropped rather
 * than re-notated — re-notating is `bar-regrid`'s job and is tested there.
 */
function regrid(bar: Bar, timeSignature: [number, number], resolution: number): Bar {
  const count = slotCount(
    timeSignature as Bar["timeSignature"],
    resolution as Bar["resolution"],
  );
  const slots: Bar["slots"] = {};
  for (const [trackId, lane] of Object.entries(bar.slots)) {
    slots[trackId] = Array.isArray(lane[0])
      ? Array.from({ length: count }, () => [])
      : Array.from({ length: count }, () => null);
  }
  return {
    timeSignature: timeSignature as Bar["timeSignature"],
    resolution: resolution as Bar["resolution"],
    slots,
  };
}

/** A song whose one guitar track is written in no bar at all: the legacy shape. */
function withMissingKeys(trackId: string): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  for (const section of next.sections) {
    for (const bar of section.bars) delete bar.slots[trackId];
  }
  return next;
}

describe("196. a new track is somewhere you can write", () => {
  it.each([
    ["fretted guitar", GUITAR],
    ["bass", BASS],
    ["drum kit", DRUMS],
  ])("gives %s a writable, silent lane in every bar", (_label, setup) => {
    const { song, track } = create(SAMPLE_SONG, setup);
    expect(barsWrittenIn(song, track.id)).toBe(allBars(song).length);
    expect(lanesAreSilent(song, track)).toBe(true);
  });

  it("refuses a track the reader cannot have, and lays no lane for it", () => {
    // The piano is out of core scope today. The refusal is the product
    // decision; what matters here is that the refusal is total.
    const refused = applyTrackCommand(SAMPLE_SONG, {
      kind: "create_track",
      setup: { name: "Piyano", instrumentId: "piano", presetId: "grand" },
    });
    expect(refused.ok).toBe(false);
    expect(canonicalJson(SAMPLE_SONG)).toBe(frozen);
  });

  it("lays a melodic lane for a non-fretted track that arrived in a file", () => {
    const imported: Song = { ...SAMPLE_SONG, tracks: [...SAMPLE_SONG.tracks, KEYS_TRACK] };
    const song = withEmptyLanes(imported, KEYS_TRACK);
    expect(barsWrittenIn(song, KEYS_TRACK.id)).toBe(allBars(song).length);
    // No fretboard does not mean drum shape: the slot is a note or a rest.
    expect(lanesAreSilent(song, KEYS_TRACK)).toBe(true);
  });

  it("keeps each bar's own meter, resolution and slot count", () => {
    /*
     * A section whose bars deliberately do *not* share a grid, so a lane
     * length taken from the first bar — or from a constant — is caught here
     * rather than in a browser. The sample song is uniform 4/4 at 1/8, which
     * would have made this test agree with a wrong implementation.
     */
    const mixed = structuredClone(SAMPLE_SONG) as Song;
    const bars = mixed.sections[0]!.bars;
    bars[1] = regrid(bars[1]!, [4, 4], 16);
    bars[2] = regrid(bars[2]!, [3, 4], 12);
    bars[3] = regrid(bars[3]!, [7, 8], 8);
    const original = bars.map((bar) => ({
      timeSignature: [...bar.timeSignature],
      resolution: bar.resolution,
      keys: Object.keys(bar.slots).sort(),
    }));
    const { song, track } = create(mixed, GUITAR);
    song.sections[0]!.bars.forEach((bar, index) => {
      expect(bar.timeSignature).toEqual(original[index]!.timeSignature);
      expect(bar.resolution).toBe(original[index]!.resolution);
      expect(bar.slots[track.id]).toHaveLength(
        slotCount(bar.timeSignature, bar.resolution),
      );
      // Nothing but the new key appeared.
      expect(Object.keys(bar.slots).sort()).toEqual(
        [...original[index]!.keys, track.id].sort(),
      );
    });
  });

  it("invents no note, no rest run and no tie", () => {
    const { song, track } = create(SAMPLE_SONG, GUITAR);
    for (const bar of allBars(song)) {
      for (const slot of bar.slots[track.id]!) {
        expect(slot).toBeNull();
      }
    }
  });

  it("changes no tempo, no section, no other track and no metadata", () => {
    const { song, track } = create(SAMPLE_SONG, GUITAR);
    expect(song.bpm).toBe(SAMPLE_SONG.bpm);
    expect(song.key).toBe(SAMPLE_SONG.key);
    expect(song.title).toBe(SAMPLE_SONG.title);
    expect(song.sections.map((section) => section.id)).toEqual(
      SAMPLE_SONG.sections.map((section) => section.id),
    );
    for (const other of SAMPLE_SONG.tracks) {
      const before = SAMPLE_SONG.sections.flatMap((section) =>
        section.bars.map((bar) => bar.slots[other.id]),
      );
      const after = allBars(song).map((bar) => bar.slots[other.id]);
      expect(canonicalJson(after), other.id).toBe(canonicalJson(before));
    }
    expect(song.tracks.slice(0, -1)).toEqual(SAMPLE_SONG.tracks);
    expect(track.id).not.toBe("");
    expect(canonicalJson(SAMPLE_SONG)).toBe(frozen);
  });

  it("still passes the strict schema and the whole validator chain", () => {
    for (const setup of [GUITAR, BASS, DRUMS]) {
      const { song } = create(SAMPLE_SONG, setup);
      const parsed = songSchema.safeParse(song);
      expect(parsed.success, setup.name).toBe(true);
      if (parsed.success) {
        expect(errorsOnly(runValidators(parsed.data)), setup.name).toEqual([]);
      }
    }
  });

  it("is deterministic over five runs", () => {
    const runs = Array.from({ length: 5 }, () =>
      canonicalJson(create(SAMPLE_SONG, GUITAR).song),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("197. duplicate and delete keep the silence they were given", () => {
  it("copies a source's missing keys as missing, not as empty lanes", () => {
    const legacy = withMissingKeys("gtr");
    const result = applyTrackCommand(legacy, {
      kind: "duplicate_track",
      trackId: "gtr",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.song.tracks.find((track) => track.id !== "gtr" && track.name.includes("Gitar"));
    expect(copy).toBeDefined();
    /*
     * A copy of a track that says nothing in a bar says nothing there too.
     * Turning that into an empty lane would change the copy's meaning from
     * "not written here" to "written here and silent" — a different
     * statement about somebody's music, made on their behalf.
     */
    expect(barsWrittenIn(result.song, copy!.id)).toBe(0);
  });

  it("restores the exact set of missing keys when a delete is undone", () => {
    const legacy = withMissingKeys("gtr");
    const before = canonicalJson(legacy);
    const deleted = applyTrackCommand(legacy, { kind: "delete_track", trackId: "bass" });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    // Undo in this app is a stored previous song, so the assertion is that
    // the command left the original untouched to go back to.
    expect(canonicalJson(legacy)).toBe(before);
    expect(barsWrittenIn(deleted.song, "gtr")).toBe(0);
  });
});

describe("198. the first note on a bar the track is not written in", () => {
  const target = { sectionId: SAMPLE_SONG.sections[0]!.id, trackId: "gtr", barIndex: 0, slotIndex: 0 };

  it("writes the lane and the note as one edit", () => {
    const legacy = withMissingKeys("gtr");
    expect(barsWrittenIn(legacy, "gtr")).toBe(0);

    const result = applyEdit(legacy, { kind: "set_note", target, stringIndex: 0, fret: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exactly one bar gained a key: the one written into.
    expect(barsWrittenIn(result.song, "gtr")).toBe(1);
    expect(isWrittenInBar(result.song.sections[0]!.bars[0]!, "gtr")).toBe(true);
    const lane = result.song.sections[0]!.bars[0]!.slots.gtr!;
    expect(lane[0]).not.toBeNull();
    expect(lane.slice(1).every((slot) => slot === null)).toBe(true);
  });

  it("writes no key into any other bar", () => {
    const legacy = withMissingKeys("gtr");
    const result = applyEdit(legacy, { kind: "set_note", target, stringIndex: 0, fret: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const [sectionIndex, section] of result.song.sections.entries()) {
      for (const [barIndex, bar] of section.bars.entries()) {
        const expected = sectionIndex === 0 && barIndex === 0;
        expect(isWrittenInBar(bar, "gtr"), `${sectionIndex}:${barIndex}`).toBe(expected);
      }
    }
  });

  it.each([
    ["a fret past the ceiling", { stringIndex: 0, fret: 99 }, "fret_out_of_range"],
    ["a string that does not exist", { stringIndex: 12, fret: 0 }, "string_out_of_range"],
  ])("leaves no lane behind when the note is refused: %s", (_label, note, code) => {
    const legacy = withMissingKeys("gtr");
    const before = canonicalJson(legacy);
    const result = applyEdit(legacy, { kind: "set_note", target, ...note });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    // The song is byte-identical: no half-written lane, no silent first step.
    expect(canonicalJson(legacy)).toBe(before);
    expect(barsWrittenIn(legacy, "gtr")).toBe(0);
  });

  it("refuses an out-of-range slot without laying a lane", () => {
    const legacy = withMissingKeys("gtr");
    const before = canonicalJson(legacy);
    const result = applyEdit(legacy, {
      kind: "set_note",
      target: { ...target, slotIndex: 9999 },
      stringIndex: 0,
      fret: 3,
    });
    expect(result.ok).toBe(false);
    expect(canonicalJson(legacy)).toBe(before);
  });

  it("lays no lane for a track the reader has no note editor for", () => {
    /*
     * Drums are edited through the kit's own surface, not through a fret
     * cell (`isEditableTrack`). A `set_note` aimed at a kit is refused — and
     * the refusal has to be total: materialising a drum lane on the way to
     * saying no would write silence the reader never asked for, into a bar
     * that until then said "this track is not written here".
     */
    const legacy = withMissingKeys("drums");
    const before = canonicalJson(legacy);
    const result = applyEdit(legacy, {
      kind: "set_note",
      target: { ...target, trackId: "drums" },
      stringIndex: 0,
      fret: 3,
    });
    expect(result.ok).toBe(false);
    expect(barsWrittenIn(legacy, "drums")).toBe(0);
    expect(canonicalJson(legacy)).toBe(before);
  });

  it("does not materialise a lane for a rest, a tie or a clear", () => {
    const legacy = withMissingKeys("gtr");
    for (const command of [
      { kind: "set_rest", target } as const,
      { kind: "set_tie", target } as const,
      { kind: "clear_string", target, stringIndex: 0 } as const,
    ]) {
      const result = applyEdit(legacy, command);
      // Nothing to rest, tie or clear in a bar the track was never written
      // in. The refusal is the honest answer; a lane would be an edit the
      // reader did not ask for.
      expect(result.ok, command.kind).toBe(false);
      expect(barsWrittenIn(legacy, "gtr"), command.kind).toBe(0);
    }
  });

  it("does not mutate the song it was handed", () => {
    const legacy = withMissingKeys("gtr");
    const before = canonicalJson(legacy);
    applyEdit(legacy, { kind: "set_note", target, stringIndex: 0, fret: 3 });
    expect(canonicalJson(legacy)).toBe(before);
  });

  it("produces the same song five times over", () => {
    const legacy = withMissingKeys("gtr");
    const runs = Array.from({ length: 5 }, () => {
      const result = applyEdit(legacy, {
        kind: "set_note",
        target,
        stringIndex: 0,
        fret: 3,
      });
      return result.ok ? canonicalJson(result.song) : "refused";
    });
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).not.toBe("refused");
  });
});

describe("199. the lane helpers say what they mean", () => {
  it("treats a present-but-empty lane as written and a missing one as not", () => {
    const bar = SAMPLE_SONG.sections[0]!.bars[0]!;
    expect(isWrittenInBar(bar, "gtr")).toBe(true);
    expect(isWrittenInBar(bar, "nope")).toBe(false);
    const empty: Bar = { ...bar, slots: { ...bar.slots, empty: [] } };
    // An empty array is a real answer, and `[]` is falsy in ways that matter.
    expect(isWrittenInBar(empty, "empty")).toBe(true);
  });

  it("returns the same bar object when there is nothing to lay", () => {
    const { song, track } = create(SAMPLE_SONG, GUITAR);
    // Idempotent: running it again is not a new song that merely looks equal.
    expect(withEmptyLanes(song, track)).toBe(song);
    expect(withEmptyLaneInBar(song, track, SAMPLE_SONG.sections[0]!.id, 0)).toBe(song);
  });

  it("asks the registry for the slot shape rather than assuming one", () => {
    const bar = SAMPLE_SONG.sections[0]!.bars[0]!;
    const guitar = create(SAMPLE_SONG, GUITAR).track;
    const drums = create(SAMPLE_SONG, DRUMS).track;
    expect(emptyLane(bar, guitar).every((slot) => slot === null)).toBe(true);
    expect(
      emptyLane(bar, drums).every((slot) => Array.isArray(slot) && slot.length === 0),
    ).toBe(true);
  });

  it("returns the song unchanged for a bar or section that is not there", () => {
    const { song, track } = create(SAMPLE_SONG, GUITAR);
    expect(withEmptyLaneInBar(song, track, "no-such-section", 0)).toBe(song);
    expect(withEmptyLaneInBar(song, track, SAMPLE_SONG.sections[0]!.id, 9999)).toBe(song);
  });
});
