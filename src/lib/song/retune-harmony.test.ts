import { describe, expect, it } from "vitest";

import { retuneHarmony, retunePitch, type Harmony } from "@/lib/song/retune-harmony";
import { SONG_VERSION, type MelodicSlot, type Song } from "@/lib/song/schema";
import { writtenSpans } from "@/lib/song/sounding";

const TRACK = "t1";
const SECTION = "s1";

const Em: Harmony = { root: "E", intervals: [0, 3, 7] };
const Am: Harmony = { root: "A", intervals: [0, 3, 7] };
const E5: Harmony = { root: "E", intervals: [0, 7] };
const A5: Harmony = { root: "A", intervals: [0, 7] };

/**
 * A figure with a shape worth keeping: a ringing pedal root, a palm-muted
 * chug, a hammer-on, and a strummed chord — one of every kind of thing the
 * transform promises to leave alone.
 */
function figure(): MelodicSlot[] {
  const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  slots[0] = {
    notes: [
      {
        pitch: "E2",
        position: { string: 0, fret: 0 },
        durationTicks: 384,
        letRing: true,
        velocity: 100,
      },
    ],
  };
  slots[2] = {
    notes: [{ pitch: "B2", position: { string: 1, fret: 2 }, articulation: "palm_mute" }],
  };
  slots[4] = {
    notes: [{ pitch: "G3", position: { string: 2, fret: 5 }, articulation: "hammer_on" }],
  };
  slots[8] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 }, strum: "down" },
      { pitch: "B2", position: { string: 1, fret: 2 }, strum: "down" },
    ],
  };
  return slots;
}

function fixture(slots: MelodicSlot[] = figure()): Song {
  return {
    version: SONG_VERSION,
    title: "t",
    bpm: 100,
    key: "E minor",
    tracks: [
      {
        id: TRACK,
        name: "Gitar",
        instrumentId: "electric_guitar",
        presetId: "high_gain",
        volumeDb: -6,
        fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
      },
    ],
    sections: [
      {
        id: SECTION,
        name: "A",
        status: "fixed",
        bars: [{ timeSignature: [4, 4], resolution: 16, slots: { [TRACK]: slots } }],
      },
    ],
  };
}

const whole = { sectionId: SECTION, barIndex: 0, trackId: TRACK, fromSlot: 0, toSlot: 16 };

const slotsOf = (song: Song) => song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];

describe("retunePitch", () => {
  it("moves a root to the new root", () => {
    expect(retunePitch("E2", Em, Am)).toBe("A2");
    expect(retunePitch("E3", E5, A5)).toBe("A3");
  });

  it("keeps a fifth a fifth and a third a third", () => {
    expect(retunePitch("B2", Em, Am)).toBe("E3");
    expect(retunePitch("G2", Em, Am)).toBe("C3");
  });

  /*
   * A note the chord does not contain lands on its nearest chord tone. F# is
   * a major second above E; in A minor the nearest tone to a major second is
   * the minor third, not the root — one semitone away rather than two.
   */
  it("snaps a passing note onto the nearest note of the new chord", () => {
    expect(retunePitch("F#2", Em, Am)).toBe("C3");
    expect(retunePitch("G2", E5, A5)).toBe("A2");
  });

  it("stays in the octave the note was in", () => {
    expect(retunePitch("E2", Em, Am)).toBe("A2");
    expect(retunePitch("E4", Em, Am)).toBe("A4");
  });

  it("refuses a root it does not know", () => {
    expect(retunePitch("E2", { root: "H", intervals: [0] }, Am)).toBeNull();
  });
});

describe("retuneHarmony", () => {
  /*
   * The claim in one test: same rhythm, same picking hand, new chord. Every
   * onset falls on the same tick and every length is the same length.
   */
  it("keeps every onset and every duration exactly", () => {
    const before = writtenSpans(fixture().sections[0]!.bars, TRACK);
    const result = retuneHarmony(fixture(), whole, Em, Am);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = writtenSpans(result.song.sections[0]!.bars, TRACK);

    expect(after.map((s) => s.startTicks)).toEqual(before.map((s) => s.startTicks));
    expect(after.map((s) => s.writtenTicks)).toEqual(before.map((s) => s.writtenTicks));
    expect(after).toHaveLength(before.length);
  });

  it("keeps every articulation, velocity, let-ring and strum", () => {
    const result = retuneHarmony(fixture(), whole, Em, Am);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slots = slotsOf(result.song);

    const pedal = slots[0];
    if (pedal === null || pedal === undefined || pedal === "-") throw new Error("lost");
    expect(pedal.notes[0]).toMatchObject({ letRing: true, durationTicks: 384, velocity: 100 });

    const chug = slots[2];
    if (chug === null || chug === undefined || chug === "-") throw new Error("lost");
    expect(chug.notes[0]!.articulation).toBe("palm_mute");

    const hammer = slots[4];
    if (hammer === null || hammer === undefined || hammer === "-") throw new Error("lost");
    expect(hammer.notes[0]!.articulation).toBe("hammer_on");

    const strummed = slots[8];
    if (strummed === null || strummed === undefined || strummed === "-") throw new Error("lost");
    expect(strummed.notes.every((n) => n.strum === "down")).toBe(true);
  });

  it("moves the pitches, and only the pitches", () => {
    const result = retuneHarmony(fixture(), whole, Em, Am);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slots = slotsOf(result.song);
    const pitchesAt = (index: number) => {
      const slot = slots[index];
      return slot === null || slot === undefined || slot === "-"
        ? []
        : slot.notes.map((n) => n.pitch);
    };
    expect(pitchesAt(0)).toEqual(["A2"]);
    expect(pitchesAt(2)).toEqual(["E3"]);
    expect(pitchesAt(8)).toEqual(["A2", "E3"]);
  });

  /*
   * A fret is a claim about where a pitch sits on this instrument. Keeping a
   * stale one beside a moved pitch would print a number that does not produce
   * the note next to it, so the placement engine is left to say it again.
   */
  it("drops the old fret rather than leaving one that lies", () => {
    const result = retuneHarmony(fixture(), whole, Em, Am);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const slot of slotsOf(result.song)) {
      if (slot === null || slot === "-") continue;
      for (const note of slot.notes) expect(note.position).toBeUndefined();
    }
  });

  it("leaves rests and the slots outside the selection alone", () => {
    const result = retuneHarmony(
      fixture(),
      { ...whole, fromSlot: 0, toSlot: 3 },
      Em,
      Am,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slots = slotsOf(result.song);
    expect(slots[1]).toBeNull();
    /* Slot 4 was outside the run: untouched, fret and all. */
    expect(slots[4]).toEqual(figure()[4]);
  });

  it("is deterministic — the same figure and target, the same answer", () => {
    const a = retuneHarmony(fixture(), whole, Em, Am);
    const b = retuneHarmony(fixture(), whole, Em, Am);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.song)).toBe(JSON.stringify(b.song));
  });

  it("does not touch the input song", () => {
    const song = fixture();
    const snapshot = JSON.stringify(song);
    retuneHarmony(song, whole, Em, Am);
    expect(JSON.stringify(song)).toBe(snapshot);
  });

  it("reports what moved, so a preview can show it before anything is applied", () => {
    const result = retuneHarmony(fixture(), whole, Em, Am);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moves).toContainEqual({ from: "E2", to: "A2" });
    expect(result.moves).toContainEqual({ from: "B2", to: "E3" });
  });

  /* Half a transposed riff is worse than none: the reader has to find it. */
  it("refuses the whole transform rather than moving part of it", () => {
    const slots = figure();
    slots[0] = { notes: [{ pitch: "E2" }] };
    const result = retuneHarmony(fixture(slots), whole, Em, {
      root: "A",
      intervals: [],
    });
    expect(result).toMatchObject({ ok: false, reason: "unreachable_pitch" });
  });

  it("refuses an unknown root without touching anything", () => {
    expect(retuneHarmony(fixture(), whole, { root: "H", intervals: [0] }, Am)).toEqual({
      ok: false,
      reason: "unknown_root",
    });
  });

  it("refuses a selection with nothing in it", () => {
    expect(
      retuneHarmony(fixture(), { ...whole, fromSlot: 10, toSlot: 12 }, Em, Am),
    ).toMatchObject({ ok: false, reason: "empty_selection" });
  });

  it("refuses a track or section that is not there", () => {
    expect(retuneHarmony(fixture(), { ...whole, trackId: "x" }, Em, Am).ok).toBe(false);
    expect(retuneHarmony(fixture(), { ...whole, sectionId: "x" }, Em, Am).ok).toBe(false);
  });

  it("works on power chords as well as triads", () => {
    const result = retuneHarmony(fixture(), whole, E5, A5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = slotsOf(result.song)[0];
    if (first === null || first === undefined || first === "-") throw new Error("lost");
    expect(first.notes[0]!.pitch).toBe("A2");
  });
});
