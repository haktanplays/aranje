/**
 * The shared time axis, and what a lane is allowed to say (2Q-A §5, §15).
 *
 * The invariant these tests exist for is the one the whole view rests on:
 * every lane lands on the same bar lines. It is asserted from the model
 * rather than from the screen, because if the model can drift then no amount
 * of scroll-syncing in a component will save it.
 */
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/copilot/fingerprint";
import { instrumentLabel } from "@/lib/instruments/registry";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import { laneKindOf } from "@/lib/multitrack/lane-kind";
import { buildMultiTrackModel } from "@/lib/multitrack/model";
import { playheadX, slotX, timeAxis } from "@/lib/multitrack/geometry";
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

describe("200. the model puts every instrument on one axis", () => {
  it.each(SEEDS)("gives every lane the same bar lines: %s", (name) => {
    const song = seed(name);
    const model = buildMultiTrackModel(song, song.sections[0]!.id, song.tracks[0]!.id);
    const axis = timeAxis(model.bars, SLOT);

    for (const lane of model.lanes) {
      // Every lane has one entry per bar of the section, in the same order.
      expect(lane.bars.map((bar) => bar.barIndex), lane.trackId).toEqual(
        model.bars.map((bar) => bar.barIndex),
      );
    }
    // And the axis is one list, so an x is one number per bar.
    expect(axis.bars).toHaveLength(model.bars.length);
    expect(new Set(axis.bars.map((bar) => bar.key)).size).toBe(model.bars.length);
  });

  it("keeps the tracks in the song's own order, silent ones included", () => {
    const song = seed("silentLead");
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
    expect(model.lanes.map((lane) => lane.trackId)).toEqual(
      song.tracks.map((track) => track.id),
    );
    const lead = model.lanes.find((lane) => lane.trackId === "lead")!;
    // Written in no bar of this section: still a lane, and it says so.
    expect(lead.silentThroughout).toBe(true);
  });

  it("marks exactly the active track active", () => {
    const song = seed("fourPart");
    for (const track of song.tracks) {
      const model = buildMultiTrackModel(song, song.sections[0]!.id, track.id);
      expect(model.lanes.filter((lane) => lane.active).map((lane) => lane.trackId)).toEqual([
        track.id,
      ]);
    }
  });

  it("separates fretted, drum and pitched by asking the registry", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
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
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
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

  it("keeps a pitched axis still across the whole section", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "keys");
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
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "keys");
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
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
    const lead = model.lanes.find((lane) => lane.trackId === "lead")!;
    // The lane still has one entry per bar: the axis does not shorten.
    expect(lead.bars).toHaveLength(model.bars.length);
  });

  it("takes bar geometry from the central timing module", () => {
    const song = seed("mixedGrid");
    const section = song.sections[0]!;
    const model = buildMultiTrackModel(song, section.id, "gtr");
    model.bars.forEach((bar, index) => {
      const source = section.bars[index]!;
      expect(bar.slotCount).toBe(slotCount(source.timeSignature, source.resolution));
      expect(bar.durationTicks).toBe(bar.slotCount * ticksPerSlot(source.resolution));
      expect(bar.timeSignature).toEqual(source.timeSignature);
      expect(bar.resolution).toBe(source.resolution);
    });
  });

  it("starts the section's axis at zero, whichever section it is", () => {
    const song = seed("fourPartTwoSections");
    for (const section of song.sections) {
      const model = buildMultiTrackModel(song, section.id, "gtr");
      expect(model.bars[0]?.startTicks).toBe(0);
      expect(model.sectionEndTicks - model.sectionStartTicks).toBe(
        model.bars.reduce((total, bar) => total + bar.durationTicks, 0),
      );
    }
    // The second section does not begin at zero in the *song*.
    const second = buildMultiTrackModel(song, song.sections[1]!.id, "gtr");
    expect(second.sectionStartTicks).toBeGreaterThan(0);
  });

  it("does not change the song it was given, and repeats itself", () => {
    const song = seed("fourPart");
    const before = canonicalJson(song);
    const runs = Array.from({ length: 5 }, () =>
      canonicalJson(
        buildMultiTrackModel(song, song.sections[0]!.id, "gtr") as unknown as Record<
          string,
          unknown
        >,
      ),
    );
    expect(new Set(runs).size).toBe(1);
    expect(canonicalJson(song)).toBe(before);
  });

  it("falls back to the first section rather than drawing nothing", () => {
    const song = seed("fourPart");
    const model = buildMultiTrackModel(song, "no-such-section", "gtr");
    expect(model.sectionId).toBe(song.sections[0]!.id);
    expect(model.bars.length).toBeGreaterThan(0);
  });

  it("names the instrument in the reader's language, never an id", () => {
    const song = seed("withKeys");
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
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
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
    const axis = timeAxis(model.bars, SLOT);
    let expected = 0;
    axis.bars.forEach((bar, index) => {
      expect(bar.width).toBe(model.bars[index]!.slotCount * SLOT);
      expect(bar.x).toBe(expected);
      expected += bar.width;
    });
    expect(axis.width).toBe(expected);
  });

  it("draws the same widths at any tempo", () => {
    const song = seed("fourPart");
    const fast: Song = { ...song, bpm: 240 };
    const slow: Song = { ...song, bpm: 40 };
    const widths = (input: Song) =>
      timeAxis(
        buildMultiTrackModel(input, input.sections[0]!.id, "gtr").bars,
        SLOT,
      ).bars.map((bar) => bar.width);
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
      const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
      expect(model.bars[0]!.slotCount, name).toBe(expected);
      const axis = timeAxis(model.bars, SLOT);
      expect(axis.bars[0]!.width, name).toBe(expected * SLOT);
    }
  });

  it("puts the playhead where the tick is, and nowhere when it is elsewhere", () => {
    const song = seed("fourPartTwoSections");
    const second = song.sections[1]!;
    const model = buildMultiTrackModel(song, second.id, "gtr");
    const axis = timeAxis(model.bars, SLOT);
    const start = model.sectionStartTicks;

    expect(playheadX(axis, start, start)).toBe(0);
    expect(playheadX(axis, start, start + model.bars[0]!.durationTicks)).toBe(
      axis.bars[1]!.x,
    );
    // A tick in the section before this one is not drawn at the left margin;
    // it is not drawn at all.
    expect(playheadX(axis, start, start - 1)).toBeNull();
    expect(playheadX(axis, start, start + axis.totalTicks + 1)).toBeNull();
  });

  it("places a slot inside its own bar", () => {
    const song = seed("fourPart");
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
    const axis = timeAxis(model.bars, SLOT);
    const bar = axis.bars[1]!;
    expect(slotX(bar, 0)).toBe(bar.x);
    expect(slotX(bar, bar.slotCount - 1)).toBe(bar.x + (bar.slotCount - 1) * SLOT);
  });

  it("takes a slot's width from its own bar, not from a shared constant", () => {
    /*
     * The same bars laid out at a width that is deliberately not `SLOT`. A
     * `slotX` that reached for the component's constant instead of dividing
     * the bar it was handed would agree with the test above and disagree
     * here — which is the whole failure mode.
     */
    const song = seed("mixedGrid");
    const model = buildMultiTrackModel(song, song.sections[0]!.id, "gtr");
    const wide = timeAxis(model.bars, SLOT + 7);
    for (const bar of wide.bars) {
      expect(slotX(bar, 0)).toBe(bar.x);
      expect(slotX(bar, 1) - slotX(bar, 0)).toBe(SLOT + 7);
      expect(slotX(bar, bar.slotCount - 1)).toBe(
        bar.x + (bar.slotCount - 1) * (SLOT + 7),
      );
    }
  });

  it("handles a section with no bars without dividing by nothing", () => {
    const song = seed("fourPart");
    const empty: Song = {
      ...song,
      sections: [{ ...song.sections[0]!, bars: [] }],
    };
    const model = buildMultiTrackModel(empty, empty.sections[0]!.id, "gtr");
    const axis = timeAxis(model.bars, SLOT);
    expect(axis.width).toBe(0);
    expect(axis.totalTicks).toBe(0);
    expect(playheadX(axis, 0, 0)).toBe(0);
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
