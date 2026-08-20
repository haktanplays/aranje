/**
 * Slurred notes are placed together (spec 8.5, 9.2, K-27).
 *
 * A slide, a hammer-on and a pull-off are one finger moving along one string.
 * The model may not write positions, so before phase 2G it could write a
 * pull-off and the search — knowing nothing about it — could put the two
 * notes on different strings and make it unplayable. Nobody could fix that:
 * not the model, which has no lever, and not a correction round, which can
 * only change pitches.
 */
import { describe, expect, it } from "vitest";

import { placeTrack, type PlacementOnset, type SlurEdge } from "@/lib/music/placement";
import { trackPlacementInput } from "@/lib/tab/placement-input";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { runValidators } from "@/lib/validators";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { songSchema, type Articulation, type Bar, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const GUITAR = SAMPLE_SONG.tracks.find((t) => t.id === "gtr");
if (!GUITAR) throw new Error("no guitar");

const DROP_D = TUNING_PRESETS.drop_d?.tuning ?? [];

type Slot = null | "-" | { notes: { pitch: string; articulation?: Articulation }[] };

const n = (pitch: string, articulation?: Articulation): Slot => ({
  notes: [{ pitch, ...(articulation ? { articulation } : {}) }],
});

function bar(prefix: readonly Slot[]): Bar {
  const slots = [...prefix, ...Array.from({ length: 16 - prefix.length }, () => null)];
  return { timeSignature: [4, 4], resolution: 16, slots: { gtr: slots as never } };
}

function song(bars: readonly Bar[], tuning: readonly string[] = DROP_D): Song {
  const parsed = songSchema.safeParse({
    version: 2,
    title: "slur fixture",
    bpm: 96,
    key: "D minor",
    tracks: [{ ...GUITAR, fretboard: { tuning: [...tuning], capo: 0 } }],
    sections: [{ id: "s1", name: "S1", status: "fixed", bars: [...bars] }],
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

/** Where each struck note ended up, in playing order. */
function placed(target: Song) {
  const timeline = buildTrackTimeline(target, "gtr");
  if (timeline.kind !== "fretted") throw new Error("not fretted");
  return timeline.bars.flatMap((b) =>
    b.spans
      .filter((s) => !s.openStart)
      .map((s) => ({
        pitch: s.pitch,
        stringIndex: s.stringIndex,
        fret: s.fret,
        articulation: s.articulation,
        bar: b.barNumber,
        slot: s.startSlot,
      })),
  );
}

describe("a slurred pair lands on one string", () => {
  it("keeps a pull-off on the string its source is on", () => {
    // Both pitches are playable on several strings; the search has to choose.
    const fixture = song([bar([n("A4"), "-", "-", n("G4", "pull_off")])]);
    const notes = placed(fixture);

    expect(notes).toHaveLength(2);
    expect(notes[0]?.stringIndex).toBe(notes[1]?.stringIndex);
    expect(runValidators(fixture).filter((i) => i.code === "articulationContext")).toEqual([]);
    expect(buildExpressionPlan(fixture).fallbacks).toBe(0);
  });

  it("keeps a hammer-on on one string", () => {
    const fixture = song([bar([n("D4"), "-", "-", n("F4", "hammer_on")])]);
    const notes = placed(fixture);
    expect(notes[0]?.stringIndex).toBe(notes[1]?.stringIndex);
  });

  it("keeps a slide on one string", () => {
    const fixture = song([bar([n("G4"), "-", "-", "-", n("C5", "slide")])]);
    const notes = placed(fixture);
    expect(notes[0]?.stringIndex).toBe(notes[1]?.stringIndex);
  });

  it("keeps a whole chain of them on one string", () => {
    const fixture = song([
      bar([
        n("G4"), "-", "-",
        n("A4", "slide"), "-", "-",
        n("G4", "pull_off"), "-", "-",
        n("A4", "hammer_on"),
      ]),
    ]);
    const strings = new Set(placed(fixture).map((entry) => entry.stringIndex));
    expect(strings.size).toBe(1);
    expect(buildExpressionPlan(fixture).fallbacks).toBe(0);
  });
});

describe("what does not join", () => {
  it("declares no edge across a real rest", () => {
    const fixture = song([bar([n("A4"), null, n("G4", "pull_off")])]);
    expect(trackPlacementInput(fixture, "gtr").slurs).toEqual([]);
  });

  it("declares no edge across a bar the track is not written in", () => {
    const empty: Bar = { timeSignature: [4, 4], resolution: 16, slots: {} };
    const fixture = song([
      bar([null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, n("A4")]),
      empty,
      bar([n("G4", "pull_off")]),
    ]);
    expect(trackPlacementInput(fixture, "gtr").slurs).toEqual([]);
  });

  it("does not treat a tie as a new onset", () => {
    const fixture = song([bar([n("A4"), "-", "-", "-", n("G4", "pull_off")])]);
    const edges = trackPlacementInput(fixture, "gtr").slurs;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ sourceOnset: 0, targetOnset: 1 });
  });

  it("carries on across a section line", () => {
    const parsed = songSchema.safeParse({
      version: 2,
      title: "across",
      bpm: 96,
      key: "D minor",
      tracks: [{ ...GUITAR, fretboard: { tuning: [...DROP_D], capo: 0 } }],
      sections: [
        {
          id: "a",
          name: "A",
          status: "fixed",
          bars: [bar([null, null, null, null, null, null, null, null, null, null, null, null, n("A4"), "-", "-", "-"])],
        },
        { id: "b", name: "B", status: "fixed", bars: [bar([n("G4", "pull_off")])] },
      ],
    });
    if (!parsed.success) throw new Error(parsed.error.message);
    const fixture = parsed.data;
    expect(trackPlacementInput(fixture, "gtr").slurs).toHaveLength(1);
    const notes = placed(fixture);
    expect(notes[0]?.stringIndex).toBe(notes[1]?.stringIndex);
  });
});

describe("an explicit position is never surrendered (spec 9.2)", () => {
  it("stands even when it breaks the slur", () => {
    const parsed = songSchema.safeParse({
      version: 2,
      title: "explicit",
      bpm: 96,
      key: "D minor",
      tracks: [{ ...GUITAR, fretboard: { tuning: [...DROP_D], capo: 0 } }],
      sections: [
        {
          id: "s1",
          name: "S1",
          status: "fixed",
          bars: [
            {
              timeSignature: [4, 4],
              resolution: 16,
              slots: {
                gtr: [
                  { notes: [{ pitch: "A4", position: { string: 3, fret: 14 } }] },
                  "-", "-",
                  { notes: [{ pitch: "G4", articulation: "pull_off", position: { string: 4, fret: 8 } }] },
                  ...Array.from({ length: 12 }, () => null),
                ] as never,
              },
            },
          ],
        },
      ],
    });
    if (!parsed.success) throw new Error(parsed.error.message);
    const notes = placed(parsed.data);

    // Exactly where they were written, whatever the slur wanted.
    expect(notes[0]).toMatchObject({ stringIndex: 3, fret: 14 });
    expect(notes[1]).toMatchObject({ stringIndex: 4, fret: 8 });
    // And the consequence is reported rather than hidden.
    expect(
      runValidators(parsed.data).filter((i) => i.code === "articulationContext"),
    ).not.toEqual([]);
  });
});

describe("when one string genuinely cannot hold both", () => {
  /**
   * A two-string instrument where the two pitches have exactly one home each,
   * and they are different strings. On a six-string guitar this is very hard
   * to construct, which is itself worth knowing: the engine almost always has
   * a way, and the interesting case is what it does when it does not.
   */
  const fretboard = { tuning: ["E2", "C4"], capo: 0 };
  const onsets: PlacementOnset[] = [
    {
      key: "a",
      sectionIndex: 0,
      barIndex: 0,
      slotIndex: 0,
      barNumber: 1,
      // G#3 = 56: string 0 fret 16. String 1 (C4 = 60) would need fret -4.
      notes: [{ pitch: "G#3" }],
    },
    {
      key: "b",
      sectionIndex: 0,
      barIndex: 0,
      slotIndex: 1,
      barNumber: 1,
      // F4 = 65: string 1 fret 5. String 0 would need fret 25, past the neck.
      notes: [{ pitch: "F4", articulation: "slide" }],
    },
  ];
  const slurs: SlurEdge[] = [
    { targetOnset: 1, sourceOnset: 0, targetNoteIndex: 0, sourceNoteIndex: 0 },
  ];

  it("still places both notes, rather than inventing a position", () => {
    const result = placeTrack({
      fretboard,
      onsets,
      bars: [{ barNumber: 1, silent: false }],
      maxShift: 7,
      slurs,
    });
    const a = result.byOnset.get("a");
    const b = result.byOnset.get("b");
    expect(a?.kind).toBe("placed");
    expect(b?.kind).toBe("placed");
    if (a?.kind !== "placed" || b?.kind !== "placed") return;
    expect(a.voicing.notes[0]?.stringIndex).toBe(0);
    expect(b.voicing.notes[0]?.stringIndex).toBe(1);
  });

  it("says so, deterministically, instead of losing it", () => {
    const result = placeTrack({
      fretboard,
      onsets,
      bars: [{ barNumber: 1, silent: false }],
      maxShift: 7,
      slurs,
    });
    expect(result.diagnostics.slurEdges).toBe(1);
    expect(result.diagnostics.brokenSlurs).toBe(1);
  });

  it("reports none broken when the caller declares none", () => {
    const result = placeTrack({
      fretboard,
      onsets,
      bars: [{ barNumber: 1, silent: false }],
      maxShift: 7,
    });
    expect(result.diagnostics.slurEdges).toBe(0);
    expect(result.diagnostics.brokenSlurs).toBe(0);
  });
});

describe("the S-01 rehearsal's bar 10 (regression fixture)", () => {
  /**
   * The exact shape that failed: a G/A figure whose second G was pulled onto
   * another string by the notes that came *after* it, breaking a pull-off the
   * model had no way to protect.
   */
  const barTen = () =>
    song([
      bar([
        n("G4", "accent"), "-", "-",
        n("A4", "slide"), "-", "-",
        n("G4", "pull_off"), "-", "-", "-",
        n("A4", "hammer_on"), "-", "-",
      ]),
      // The bars that pulled the hand away last time.
      bar([n("A4", "accent"), "-", "-", "-", n("C5", "bend_full")]),
      bar([n("A4", "accent"), "-", "-", "-", n("G4", "pull_off"), "-", "-", n("F4", "accent")]),
    ]);

  it("places the whole figure on one string", () => {
    const strings = new Set(
      placed(barTen())
        .filter((entry) => entry.bar === 1)
        .map((entry) => entry.stringIndex),
    );
    expect(strings.size).toBe(1);
  });

  it("leaves no articulation warning and no playback fallback", () => {
    const fixture = barTen();
    expect(
      runValidators(fixture).filter((i) => i.code === "articulationContext"),
    ).toEqual([]);
    expect(buildExpressionPlan(fixture).fallbacks).toBe(0);
  });
});
