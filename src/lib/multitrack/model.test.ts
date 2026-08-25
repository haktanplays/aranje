/**
 * The shared time axis, and what a lane is allowed to say (2Q-A §5, §15,
 * 2Q-C §4).
 *
 * The invariant these tests exist for is the one the whole view rests on:
 * every lane lands on the same bar lines. It is asserted from the model
 * rather than from the screen, because if the model can drift then no amount
 * of scroll-syncing in a component will save it.
 *
 * Since 2Q-C the model is the **whole song** rather than one section, and the
 * pixels come from `lib/tab/song-axis.ts` — the same axis the tab uses — so
 * these tests assert against one authority instead of a second one that only
 * this surface had.
 */
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/copilot/fingerprint";
import { instrumentLabel } from "@/lib/instruments/registry";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import { laneKindOf } from "@/lib/multitrack/lane-kind";
import { buildMultiTrackModel } from "@/lib/multitrack/model";
import {
  buildSongAxis,
  slotLeftPx,
  xAtTicks,
  type SongAxis,
} from "@/lib/tab/song-axis";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song, type Track } from "@/lib/song/schema";

const SEEDS = ["fourPart", "withKeys", "mixedGrid", "threeFour", "sevenEight"] as const;

/** The generated 2Q-A fixtures, which the schema and validators already accepted. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RAW = require("../../../eval/multitrack/seeds.json") as Record<string, unknown>;

function seed(name: string): Song {
  const parsed = songSchema.safeParse(RAW[name]);
  if (!parsed.success) throw new Error(`fixture ${name} does not parse`);
  return parsed.data;
}

const SLOT = 34;

/** The one axis, built from the song the model was built from. */
const axisOf = (song: Song, slotWidth = SLOT): SongAxis =>
  buildSongAxis(song, slotWidth);

describe("200. the model puts every instrument on one axis", () => {
  it.each(SEEDS)("gives every lane the same bar lines: %s", (name) => {
    const song = seed(name);
    const model = buildMultiTrackModel(song, song.tracks[0]!.id);
    const axis = axisOf(song);

    for (const lane of model.lanes) {
      // Every lane has one entry per bar of the song, in the same order.
      expect(lane.bars.map((bar) => bar.key), lane.trackId).toEqual(
        model.bars.map((bar) => bar.key),
      );
    }
    // And the axis is one list, so an x is one number per bar.
    expect(axis.bars).toHaveLength(model.bars.length);
    expect(axis.bars.map((bar) => bar.key)).toEqual(model.bars.map((bar) => bar.key));
  });

  it("keeps the tracks in the song's own order, silent ones included", () => {
    const song = seed("silentLead");
    const model = buildMultiTrackModel(song, "gtr");
    expect(model.lanes.map((lane) => lane.trackId)).toEqual(
      song.tracks.map((track) => track.id),
    );
    const lead = model.lanes.find((lane) => lane.trackId === "lead")!;
    // Written in no bar of the song: still a lane, and it says so.
    expect(lead.silentThroughout).toBe(true);
  });

  it("marks exactly the active track active", () => {
    const song = seed("fourPart");
    for (const track of song.tracks) {
      const model = buildMultiTrackModel(song, track.id);
      expect(model.lanes.filter((lane) => lane.active).map((lane) => lane.trackId)).toEqual([
        track.id,
      ]);
    }
  });

  it("separates fretted, drum and pitched by asking the registry", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, "gtr");
    const kinds = Object.fromEntries(model.lanes.map((lane) => [lane.trackId, lane.kind]));
    expect(kinds).toEqual({
      gtr: "fretted",
      bass: "fretted",
      drums: "drums",
      keys: "pitched",
    });
    for (const track of song.tracks) {
      expect(laneKindOf(track), track.id).toBe(kinds[track.id]);
    }
  });

  it("invents no string and no fret for a pitched lane", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, "gtr");
    const keys = model.lanes.find((lane) => lane.trackId === "keys")!;
    expect(keys.kind).toBe("pitched");
    if (keys.kind !== "pitched") return;
    const serialised = canonicalJson(keys as unknown as Record<string, unknown>);
    // Nothing in a pitched lane may look like a fretboard.
    expect(serialised).not.toContain("stringIndex");
    expect(serialised).not.toContain('"fret"');
    for (const bar of keys.bars) {
      for (const note of bar.notes) {
        expect(Object.keys(note).sort()).not.toContain("fret");
      }
    }
  });

  it("keeps a pitched axis still across the whole song", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, "keys");
    const keys = model.lanes.find((lane) => lane.trackId === "keys")!;
    if (keys.kind !== "pitched") throw new Error("expected a pitched lane");
    // One axis for the lane, not one per bar: the same melody in two bars
    // must not be drawn at two different heights.
    expect(keys.axis.span).toBeGreaterThanOrEqual(12);
    expect(keys.axis.highMidi - keys.axis.lowMidi).toBe(keys.axis.span);
    for (const bar of keys.bars) {
      for (const note of bar.notes) {
        if (note.midi === null) continue;
        expect(note.midi).toBeGreaterThanOrEqual(keys.axis.lowMidi);
        expect(note.midi).toBeLessThanOrEqual(keys.axis.highMidi);
      }
    }
  });

  it("reads a tie as continuation and a chord as one onset", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, "keys");
    const keys = model.lanes.find((lane) => lane.trackId === "keys")!;
    if (keys.kind !== "pitched") throw new Error("expected a pitched lane");
    const first = keys.bars[0]!;
    // The fixture opens with a three-note chord on slot 0: three notes, one
    // onset slot, not three onsets.
    const onsets = new Set(first.notes.filter((note) => !note.openStart).map((n) => n.startSlot));
    expect(first.notes.filter((note) => note.startSlot === 0)).toHaveLength(3);
    expect(onsets.has(0)).toBe(true);
  });

  it("counts a bar the track is not written in as silence, not as a gap in time", () => {
    const song = seed("silentLead");
    const model = buildMultiTrackModel(song, "gtr");
    const lead = model.lanes.find((lane) => lane.trackId === "lead")!;
    // The lane still has one entry per bar: the axis does not shorten.
    expect(lead.bars).toHaveLength(model.bars.length);
  });

  it("takes bar geometry from the central timing module", () => {
    const song = seed("mixedGrid");
    const section = song.sections[0]!;
    const model = buildMultiTrackModel(song, "gtr");
    model.bars.forEach((bar, index) => {
      const source = section.bars[index]!;
      expect(bar.slotCount).toBe(slotCount(source.timeSignature, source.resolution));
      expect(bar.durationTicks).toBe(bar.slotCount * ticksPerSlot(source.resolution));
      expect(bar.timeSignature).toEqual(source.timeSignature);
      expect(bar.resolution).toBe(source.resolution);
    });
  });

  it("counts ticks from the song's start, sections one after another", () => {
    const song = seed("fourPartTwoSections");
    const model = buildMultiTrackModel(song, "gtr");
    expect(model.bars[0]!.startTicks).toBe(0);

    // Contiguous: no gap and no overlap anywhere, boundary included.
    let ticks = 0;
    for (const bar of model.bars) {
      expect(bar.startTicks, bar.key).toBe(ticks);
      ticks += bar.durationTicks;
    }
    expect(model.totalTicks).toBe(ticks);

    // The second section is on the same axis rather than restarting it —
    // which is what stopped the surface being rebuilt at the boundary.
    const second = model.bars.find((bar) => bar.sectionId === song.sections[1]!.id)!;
    expect(second.startTicks).toBeGreaterThan(0);
    expect(second.isSectionStart).toBe(true);
    expect(second.barIndex).toBe(0);
  });

  it("carries every section of the song, in order", () => {
    const song = seed("fourPartTwoSections");
    const model = buildMultiTrackModel(song, "gtr");
    expect(model.bars.map((bar) => bar.sectionId)).toEqual(
      song.sections.flatMap((section) => section.bars.map(() => section.id)),
    );
    expect(model.bars.map((bar) => bar.barNumber)).toEqual(
      model.bars.map((_bar, index) => index + 1),
    );
    // A section start is marked exactly once per section.
    expect(model.bars.filter((bar) => bar.isSectionStart)).toHaveLength(
      song.sections.length,
    );
  });

  it("does not change the song it was given, and repeats itself", () => {
    const song = seed("fourPart");
    const before = canonicalJson(song);
    const runs = Array.from({ length: 5 }, () =>
      canonicalJson(
        buildMultiTrackModel(song, "gtr") as unknown as Record<string, unknown>,
      ),
    );
    expect(new Set(runs).size).toBe(1);
    expect(canonicalJson(song)).toBe(before);
  });

  it("has no section to be wrong about", () => {
    // There is no section argument any more, so there is no stale id, no
    // fallback and no render in which the surface is showing the wrong part
    // of the song. Every bar is here, always.
    const song = seed("fourPartTwoSections");
    const model = buildMultiTrackModel(song, "gtr");
    expect(model.bars).toHaveLength(
      song.sections.reduce((total, section) => total + section.bars.length, 0),
    );
  });

  it("names the instrument in the reader's language, never an id", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, "gtr");
    for (const lane of model.lanes) {
      const track = song.tracks.find((entry) => entry.id === lane.trackId)!;
      expect(lane.label).toBe(track.name);
      expect(lane.instrumentFamily).toBe(instrumentLabel(track.instrumentId));
      expect(lane.instrumentFamily).not.toBe(track.instrumentId);
      // And the lane kind is not a word the reader ever sees.
      expect(lane.label).not.toContain(lane.kind);
    }
  });
});

describe("201. the axis is arithmetic, and tempo is not in it", () => {
  it("gives every bar the width its slot count asks for", () => {
    const song = seed("mixedGrid");
    const model = buildMultiTrackModel(song, "gtr");
    const axis = axisOf(song);
    let expected = 0;
    axis.bars.forEach((bar, index) => {
      expect(bar.widthPx).toBe(model.bars[index]!.slotCount * SLOT);
      expect(bar.leftPx).toBe(expected);
      expected += bar.widthPx;
    });
    expect(axis.totalWidthPx).toBe(expected);
  });

  it("draws the same widths at any tempo", () => {
    const song = seed("fourPart");
    const fast: Song = { ...song, bpm: 240 };
    const slow: Song = { ...song, bpm: 40 };
    const widths = (input: Song) =>
      axisOf(input).bars.map((bar) => bar.widthPx);
    expect(widths(fast)).toEqual(widths(slow));
  });

  it("gives 3/4, 4/4, 6/8 and 7/8 the widths their slot counts imply", () => {
    for (const [name, expected] of [
      ["fourPart", 8],
      ["threeFour", 9],
      ["sixEight", 6],
      ["sevenEight", 7],
    ] as const) {
      const song = seed(name);
      const model = buildMultiTrackModel(song, "gtr");
      expect(model.bars[0]!.slotCount, name).toBe(expected);
      const axis = axisOf(song);
      expect(axis.bars[0]!.widthPx, name).toBe(expected * SLOT);
    }
  });

  it("puts the playhead where the tick is, across the boundary", () => {
    const song = seed("fourPartTwoSections");
    const model = buildMultiTrackModel(song, "gtr");
    const axis = axisOf(song);
    const second = model.bars.find(
      (bar) => bar.sectionId === song.sections[1]!.id,
    )!;

    expect(xAtTicks(axis, 0)).toBe(0);
    /*
     * The first tick of the second section. It is a position on the same
     * axis, not zero on a new one — which is why the surface no longer has
     * anything to reset when the music crosses a boundary.
     */
    const there = xAtTicks(axis, second.startTicks);
    expect(there).toBe(axis.bars.find((bar) => bar.key === second.key)!.leftPx);
    expect(there).toBeGreaterThan(0);

    // Outside the song is nowhere, not an edge.
    expect(xAtTicks(axis, -1)).toBeNull();
    expect(xAtTicks(axis, model.totalTicks + 1)).toBeNull();
  });

  it("places a slot inside its own bar", () => {
    const axis = axisOf(seed("fourPart"));
    const bar = axis.bars[1]!;
    expect(slotLeftPx(bar, 0)).toBe(bar.leftPx);
    expect(slotLeftPx(bar, bar.slotCount - 1)).toBe(
      bar.leftPx + (bar.slotCount - 1) * SLOT,
    );
  });

  it("takes a slot's width from its own bar, not from a shared constant", () => {
    /*
     * The same bars laid out at a width that is deliberately not `SLOT`. A
     * `slotX` that reached for the component's constant instead of dividing
     * the bar it was handed would agree with the test above and disagree
     * here — which is the whole failure mode.
     */
    const wide = axisOf(seed("mixedGrid"), SLOT + 7);
    for (const bar of wide.bars) {
      expect(slotLeftPx(bar, 0)).toBe(bar.leftPx);
      expect(slotLeftPx(bar, 1) - slotLeftPx(bar, 0)).toBe(SLOT + 7);
      expect(slotLeftPx(bar, bar.slotCount - 1)).toBe(
        bar.leftPx + (bar.slotCount - 1) * (SLOT + 7),
      );
    }
  });

  it("handles a song with no bars without dividing by nothing", () => {
    const song = seed("fourPart");
    const empty: Song = {
      ...song,
      sections: [{ ...song.sections[0]!, bars: [] }],
    };
    const model = buildMultiTrackModel(empty, "gtr");
    const axis = axisOf(empty);
    expect(model.bars).toEqual([]);
    expect(model.totalTicks).toBe(0);
    expect(axis.totalWidthPx).toBe(0);
    expect(xAtTicks(axis, 0)).toBeNull();
  });
});

describe("202. lane kind is a fact about the instrument", () => {
  it("calls a kit drums whatever it is named", () => {
    const kit: Track = {
      id: "d",
      name: "Ritim",
      instrumentId: "drum_kit",
      presetId: "rock",
      volumeDb: -6,
    };
    expect(laneKindOf(kit)).toBe("drums");
  });

  it("calls a melodic instrument with a fretboard fretted and one without pitched", () => {
    const guitar = SAMPLE_SONG.tracks.find((track) => track.fretboard)!;
    expect(laneKindOf(guitar)).toBe("fretted");
    expect(laneKindOf({ ...guitar, fretboard: undefined })).toBe("pitched");
  });
});
