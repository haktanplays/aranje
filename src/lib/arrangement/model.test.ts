/**
 * The eighteen things the arrangement model has to get right (spec 13.10).
 *
 * These are all questions about *structure*, which is what makes them worth
 * pinning: a wrong answer here does not crash anything and does not look wrong
 * on screen. A bar drawn at the wrong width just looks like a bar. A silent
 * stretch labelled "same as bar 4" just looks tidy. The only way to know is to
 * ask.
 */
import { describe, expect, it } from "vitest";

import {
  buildArrangementModel,
  cellKey,
  type ArrangementModel,
} from "@/lib/arrangement/model";
import { arrangementBarWidth, PX_PER_WHOLE } from "@/lib/arrangement/geometry";
import { barDigest, isSilentCell } from "@/lib/arrangement/digest";
import { crossBarLinks } from "@/lib/arrangement/links";
import { PPQ, TICKS_PER_WHOLE } from "@/lib/music/timing";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";

const note = (pitch: string, extra: Record<string, unknown> = {}): MelodicSlot => ({
  notes: [{ pitch, velocity: 100, ...extra }],
});

const cellOf = (model: ArrangementModel, trackId: string, barKey: string) => {
  const cell = model.cells.get(cellKey(trackId, barKey));
  if (!cell) throw new Error(`no cell for ${trackId} ${barKey}`);
  return cell;
};

/** One guitar, bars given as slot arrays on the same track. */
function guitarSong(bars: readonly Bar[], overrides: Partial<Song> = {}): Song {
  return song([guitarTrack()], [section(bars)], overrides);
}

describe("1. section and bar tick geometry", () => {
  it("lays bars end to end in ticks and in pixels", () => {
    const model = buildArrangementModel(
      guitarSong([
        melodicBar("gtr", [note("E2"), ...restSlots(7)]),
        melodicBar("gtr", [note("A2"), ...restSlots(7)]),
      ]),
    );

    expect(model.bars.map((bar) => bar.startTicks)).toEqual([0, TICKS_PER_WHOLE]);
    expect(model.bars.map((bar) => bar.left)).toEqual([0, PX_PER_WHOLE]);
    expect(model.bars[1]?.endTicks).toBe(TICKS_PER_WHOLE * 2);
    expect(model.totalTicks).toBe(TICKS_PER_WHOLE * 2);
    expect(model.totalWidth).toBe(PX_PER_WHOLE * 2);
  });

  it("gives each section its own span and bar count", () => {
    const model = buildArrangementModel(
      song(
        [guitarTrack()],
        [
          section([melodicBar("gtr", restSlots(8))], { id: "a", name: "Giriş" }),
          section(
            [melodicBar("gtr", restSlots(8)), melodicBar("gtr", restSlots(8))],
            { id: "b", name: "Nakarat" },
          ),
        ],
      ),
    );

    expect(model.sections.map((entry) => entry.sectionId)).toEqual(["a", "b"]);
    expect(model.sections[1]?.barCount).toBe(2);
    expect(model.sections[1]?.startTicks).toBe(TICKS_PER_WHOLE);
    expect(model.sections[1]?.left).toBe(PX_PER_WHOLE);
    expect(model.sections[1]?.width).toBe(PX_PER_WHOLE * 2);
  });
});

describe("2. the grid never changes a bar's width", () => {
  it("draws 4/4 the same at every resolution", () => {
    const widths = ([8, 12, 16, 24, 32] as const).map((resolution) =>
      arrangementBarWidth([4, 4], resolution),
    );
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe(PX_PER_WHOLE);
  });

  it("draws the same bar the same width through the whole model", () => {
    const model = buildArrangementModel(
      guitarSong([
        melodicBar("gtr", restSlots(8), { resolution: 8 }),
        melodicBar("gtr", restSlots(32), { resolution: 32 }),
        melodicBar("gtr", restSlots(12), { resolution: 12 }),
      ]),
    );
    expect(model.bars.map((bar) => bar.width)).toEqual([
      PX_PER_WHOLE,
      PX_PER_WHOLE,
      PX_PER_WHOLE,
    ]);
  });
});

describe("3. meter does change a bar's width", () => {
  it("draws 3/4 three quarters as wide as 4/4", () => {
    expect(arrangementBarWidth([3, 4], 8) * 4).toBe(arrangementBarWidth([4, 4], 8) * 3);
  });

  it("draws 6/8 and 3/4 alike, because they last the same", () => {
    expect(arrangementBarWidth([6, 8], 8)).toBe(arrangementBarWidth([3, 4], 8));
  });

  it("draws 7/8 as seven eighths", () => {
    expect(arrangementBarWidth([7, 8], 8)).toBe(Math.round((7 / 8) * PX_PER_WHOLE));
  });
});

describe("4. tempo never changes a bar's width", () => {
  it("draws the same widths at 69 and at 200 BPM", () => {
    const bars = [melodicBar("gtr", restSlots(8))];
    const slow = buildArrangementModel(guitarSong(bars, { bpm: 69 }));
    const fast = buildArrangementModel(guitarSong(bars, { bpm: 200 }));
    expect(slow.bars.map((bar) => bar.width)).toEqual(fast.bars.map((bar) => bar.width));
    expect(slow.totalWidth).toBe(fast.totalWidth);
  });

  it("draws a section override the same width as no override", () => {
    const plain = buildArrangementModel(
      song([guitarTrack()], [section([melodicBar("gtr", restSlots(8))])]),
    );
    const fast = buildArrangementModel(
      song(
        [guitarTrack()],
        [section([melodicBar("gtr", restSlots(8))], { bpmOverride: 200 })],
      ),
    );
    expect(fast.totalWidth).toBe(plain.totalWidth);
    // The tempo step is still reported — it just is not geometry.
    expect(fast.sections[0]?.bpm).toBe(200);
  });
});

describe("5. melodic onset summary", () => {
  it("places marks at the fraction of the bar each onset falls on", () => {
    const model = buildArrangementModel(
      guitarSong([
        melodicBar("gtr", [note("E2"), null, note("G3"), null, null, null, null, null]),
      ]),
    );
    const cell = cellOf(model, "gtr", "s1:0");
    expect(cell.kind).toBe("sounding");
    expect(cell.marks.map((mark) => mark.at)).toEqual([0, 0.25]);
    expect(cell.density).toBeCloseTo(2 / 8);
  });

  it("reads the contour from the track's own range, low to high", () => {
    const model = buildArrangementModel(
      guitarSong([
        melodicBar("gtr", [note("E2"), note("E4"), note("A2"), ...restSlots(5)]),
      ]),
    );
    const heights = cellOf(model, "gtr", "s1:0").marks.map((mark) => mark.height);
    expect(heights[0]).toBe(0);
    expect(heights[1]).toBe(1);
    expect(heights[2]).toBeGreaterThan(0);
    expect(heights[2]).toBeLessThan(1);
  });

  it("marks held sound as a sustain rather than as another onset", () => {
    const model = buildArrangementModel(
      guitarSong([melodicBar("gtr", [note("E2"), "-", "-", null, null, null, null, null])]),
    );
    const cell = cellOf(model, "gtr", "s1:0");
    expect(cell.marks).toHaveLength(1);
    expect(cell.sustains).toEqual([{ from: 0, to: 0.375 }]);
  });
});

describe("6. drum summary", () => {
  it("reports the pieces actually struck, and no contour", () => {
    const bar: Bar = {
      timeSignature: [4, 4],
      resolution: 8,
      slots: {
        drums: [
          [{ piece: "kick" }],
          [],
          [{ piece: "snare" }, { piece: "closed_hat" }],
          [],
          [],
          [],
          [],
          [],
        ],
      },
    };
    const model = buildArrangementModel(song([drumTrack()], [section([bar])]));
    const cell = cellOf(model, "drums", "s1:0");
    expect(cell.marks.map((mark) => mark.at)).toEqual([0, 0.25]);
    expect(cell.marks.every((mark) => mark.height === null)).toBe(true);
    expect([...cell.pieces].sort()).toEqual(["closed_hat", "kick", "snare"]);
  });
});

describe("7. a silent track or bar", () => {
  it("calls a bar of rests silent, and gives it nothing to draw", () => {
    const model = buildArrangementModel(guitarSong([melodicBar("gtr", restSlots(8))]));
    const cell = cellOf(model, "gtr", "s1:0");
    expect(cell.kind).toBe("silent");
    expect(cell.marks).toHaveLength(0);
    expect(cell.sustains).toHaveLength(0);
    expect(cell.density).toBe(0);
  });

  it("does not call a bar of pure tie silent", () => {
    const model = buildArrangementModel(
      guitarSong([
        melodicBar("gtr", [note("E2"), "-", "-", "-", "-", "-", "-", "-"]),
        melodicBar("gtr", ["-", "-", "-", "-", "-", "-", "-", "-"]),
      ]),
    );
    // The second bar strikes nothing, but a note is sounding through it.
    const cell = cellOf(model, "gtr", "s1:1");
    expect(cell.kind).toBe("sounding");
    expect(cell.marks).toHaveLength(0);
    expect(cell.sustains).toEqual([{ from: 0, to: 1 }]);
  });

  it("reports a track that is silent everywhere", () => {
    const model = buildArrangementModel(
      song(
        [guitarTrack(), guitarTrack({ id: "second", name: "İkinci" })],
        [section([melodicBar("gtr", [note("E2"), ...restSlots(7)])])],
      ),
    );
    expect(model.tracks.find((t) => t.trackId === "second")?.silentThroughout).toBe(true);
    expect(model.tracks.find((t) => t.trackId === "gtr")?.silentThroughout).toBe(false);
  });
});

describe("8. a missing track key", () => {
  it("is silence, not an empty bar someone forgot", () => {
    const bar: Bar = { timeSignature: [4, 4], resolution: 8, slots: {} };
    const model = buildArrangementModel(song([guitarTrack()], [section([bar])]));
    expect(cellOf(model, "gtr", "s1:0").kind).toBe("silent");
    expect(isSilentCell(bar, "gtr")).toBe(true);
  });
});

describe("9. exact repeat", () => {
  it("points a repeated bar back at the first one", () => {
    const bar = () => melodicBar("gtr", [note("E2"), ...restSlots(7)]);
    const model = buildArrangementModel(
      guitarSong([bar(), melodicBar("gtr", [note("A2"), ...restSlots(7)]), bar()]),
    );
    expect(cellOf(model, "gtr", "s1:0").repeatOf).toBeNull();
    expect(cellOf(model, "gtr", "s1:1").repeatOf).toBeNull();
    expect(cellOf(model, "gtr", "s1:2").repeatOf).toEqual({
      barKey: "s1:0",
      barNumber: 1,
    });
  });

  it("does not care which section a bar is in or what it is called", () => {
    const bar = () => melodicBar("gtr", [note("E2"), ...restSlots(7)]);
    const model = buildArrangementModel(
      song(
        [guitarTrack()],
        [
          section([bar()], { id: "a", name: "Giriş" }),
          section([bar()], { id: "b", name: "Nakarat" }),
        ],
      ),
    );
    expect(cellOf(model, "gtr", "b:0").repeatOf?.barKey).toBe("a:0");
  });

  it("treats a chord written in another note order as the same bar", () => {
    const chord = (order: readonly string[]): MelodicSlot => ({
      notes: order.map((pitch) => ({ pitch, velocity: 100 })),
    });
    const a = melodicBar("gtr", [chord(["E2", "B2"]), ...restSlots(7)]);
    const b = melodicBar("gtr", [chord(["B2", "E2"]), ...restSlots(7)]);
    expect(barDigest(a, "gtr")).toBe(barDigest(b, "gtr"));
  });
});

describe("10. velocity and articulation break a repeat", () => {
  it("separates two bars that differ only in velocity", () => {
    const a = melodicBar("gtr", [note("E2", { velocity: 100 }), ...restSlots(7)]);
    const b = melodicBar("gtr", [note("E2", { velocity: 101 }), ...restSlots(7)]);
    expect(barDigest(a, "gtr")).not.toBe(barDigest(b, "gtr"));
  });

  it("separates two bars that differ only in articulation", () => {
    const a = melodicBar("gtr", [note("E2"), ...restSlots(7)]);
    const b = melodicBar("gtr", [note("E2", { articulation: "palm_mute" }), ...restSlots(7)]);
    expect(barDigest(a, "gtr")).not.toBe(barDigest(b, "gtr"));
  });

  it("does not read an absent velocity as the default one", () => {
    const absent = melodicBar("gtr", [{ notes: [{ pitch: "E2" }] }, ...restSlots(7)]);
    const written = melodicBar("gtr", [note("E2", { velocity: 100 }), ...restSlots(7)]);
    expect(barDigest(absent, "gtr")).not.toBe(barDigest(written, "gtr"));
  });
});

describe("11. an explicit position breaks a repeat", () => {
  it("separates the same pitch played on another string", () => {
    const low = melodicBar("gtr", [
      note("E3", { position: { string: 0, fret: 12 } }),
      ...restSlots(7),
    ]);
    const high = melodicBar("gtr", [
      note("E3", { position: { string: 2, fret: 2 } }),
      ...restSlots(7),
    ]);
    expect(barDigest(low, "gtr")).not.toBe(barDigest(high, "gtr"));
  });
});

describe("12. silence is never a repeat of silence", () => {
  it("leaves every silent bar unlabelled", () => {
    const model = buildArrangementModel(
      guitarSong([
        melodicBar("gtr", restSlots(8)),
        melodicBar("gtr", restSlots(8)),
        melodicBar("gtr", restSlots(8)),
      ]),
    );
    for (const key of ["s1:0", "s1:1", "s1:2"]) {
      expect(cellOf(model, "gtr", key).repeatOf).toBeNull();
    }
  });
});

describe("13. a tie across a bar line", () => {
  it("is one link, pointing at the next bar", () => {
    const links = crossBarLinks(
      guitarSong([
        melodicBar("gtr", [note("E2"), "-", "-", "-", "-", "-", "-", "-"]),
        melodicBar("gtr", ["-", "-", "-", "-", null, null, null, null]),
      ]),
      "gtr",
    );
    expect(links).toEqual([
      { trackId: "gtr", fromBarKey: "s1:0", toBarKey: "s1:1", kind: "tie" },
    ]);
  });
});

describe("14. a tie across a section boundary", () => {
  it("is not cut by the seam", () => {
    const links = crossBarLinks(
      song(
        [guitarTrack()],
        [
          section([melodicBar("gtr", [note("E2"), "-", "-", "-", "-", "-", "-", "-"])], {
            id: "a",
          }),
          section([melodicBar("gtr", ["-", "-", null, null, null, null, null, null])], {
            id: "b",
          }),
        ],
      ),
      "gtr",
    );
    expect(links).toEqual([
      { trackId: "gtr", fromBarKey: "a:0", toBarKey: "b:0", kind: "tie" },
    ]);
  });
});

describe("15. slurs across a bar line", () => {
  it("links a hammer-on to the note in the bar before it", () => {
    const links = crossBarLinks(
      guitarSong([
        melodicBar("gtr", [...restSlots(7), note("G3", { position: { string: 3, fret: 0 } })]),
        melodicBar("gtr", [
          note("A3", { articulation: "hammer_on", position: { string: 3, fret: 2 } }),
          ...restSlots(7),
        ]),
      ]),
      "gtr",
    );
    expect(links).toEqual([
      { trackId: "gtr", fromBarKey: "s1:0", toBarKey: "s1:1", kind: "hammer_on" },
    ]);
  });

  it("links a pull-off downwards, and refuses one written upwards", () => {
    const down = crossBarLinks(
      guitarSong([
        melodicBar("gtr", [...restSlots(7), note("A3", { position: { string: 3, fret: 2 } })]),
        melodicBar("gtr", [
          note("G3", { articulation: "pull_off", position: { string: 3, fret: 0 } }),
          ...restSlots(7),
        ]),
      ]),
      "gtr",
    );
    expect(down.map((link) => link.kind)).toEqual(["pull_off"]);

    const wrongWay = crossBarLinks(
      guitarSong([
        melodicBar("gtr", [...restSlots(7), note("G3", { position: { string: 3, fret: 0 } })]),
        melodicBar("gtr", [
          note("A3", { articulation: "pull_off", position: { string: 3, fret: 2 } }),
          ...restSlots(7),
        ]),
      ]),
      "gtr",
    );
    expect(wrongWay).toEqual([]);
  });
});

describe("16. a real rest cuts the carry", () => {
  it("draws no link when the sound has already stopped", () => {
    const links = crossBarLinks(
      guitarSong([
        melodicBar("gtr", [note("E2"), "-", null, null, null, null, null, null]),
        melodicBar("gtr", [note("A2"), ...restSlots(7)]),
      ]),
      "gtr",
    );
    expect(links).toEqual([]);
  });

  it("draws no link when the next bar does not write the track at all", () => {
    const held = melodicBar("gtr", [note("E2"), "-", "-", "-", "-", "-", "-", "-"]);
    const absent: Bar = { timeSignature: [4, 4], resolution: 8, slots: {} };
    expect(crossBarLinks(guitarSong([held, absent]), "gtr")).toEqual([]);
  });
});

describe("17. the model is deterministic", () => {
  it("builds byte-equivalent output twice for the same song", () => {
    const source = guitarSong([
      melodicBar("gtr", [note("E2"), "-", note("G3"), ...restSlots(5)]),
      melodicBar("gtr", restSlots(8), { resolution: 8 }),
    ]);
    const serialise = (model: ArrangementModel) =>
      JSON.stringify({
        ...model,
        cells: [...model.cells.entries()],
      });
    expect(serialise(buildArrangementModel(source))).toBe(
      serialise(buildArrangementModel(source)),
    );
  });

  it("keeps tracks and bars in the song's own order", () => {
    const model = buildArrangementModel(
      song(
        [guitarTrack({ id: "b", name: "B" }), guitarTrack({ id: "a", name: "A" })],
        [section([melodicBar("b", restSlots(8))])],
      ),
    );
    expect(model.tracks.map((track) => track.trackId)).toEqual(["b", "a"]);
  });
});

describe("18. the model never touches the song", () => {
  it("leaves the input byte-identical", () => {
    const source = guitarSong([
      melodicBar("gtr", [note("E2"), "-", ...restSlots(6)]),
      melodicBar("gtr", restSlots(8)),
    ]);
    const before = JSON.stringify(source);
    buildArrangementModel(source);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("uses registry labels rather than the technical ids", () => {
    const model = buildArrangementModel(guitarSong([melodicBar("gtr", restSlots(8))]));
    const track = model.tracks[0];
    expect(track?.instrument).not.toBe("electric_guitar");
    expect(track?.instrument.length).toBeGreaterThan(0);
    expect(track?.preset).not.toBe("clean");
  });
});

describe("the tick contract the widths rest on", () => {
  it("has a whole note of four quarters, so a 4/4 bar is one whole", () => {
    expect(TICKS_PER_WHOLE).toBe(PPQ * 4);
  });
});
