import { describe, expect, it } from "vitest";

import {
  pitchRole,
  retuneHarmony,
  retunePitch,
  type Harmony,
} from "@/lib/song/retune-harmony";
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
   * 2T-B §3.2. This function moves *voices*, and a passing note is not one.
   * Answering "C3" here — the nearest chord tone — is what turned a
   * neighbour cell into three strikes of the same note. It has no context to
   * do better, so it declines instead of guessing.
   */
  it("declines a note the chord does not contain, rather than snapping it", () => {
    expect(retunePitch("F#2", Em, Am)).toBeNull();
    expect(retunePitch("G2", E5, A5)).toBeNull();
  });

  /*
   * Voice by voice, not pitch by pitch. E5's second voice is its fifth; A
   * minor's second voice is its third. A figure built on the top of a power
   * chord comes back built on the middle of the triad, which is what "same
   * voicing, new chord" means. Nearest-pitch would have said E3.
   */
  it("maps a chord tone onto the same voice of the target voicing", () => {
    expect(retunePitch("B2", E5, Am)).toBe("C3");
  });

  /* A voicing that puts its third an octave up gets a third an octave up. */
  it("follows the target voicing's own octave placement", () => {
    expect(retunePitch("G3", Em, { root: "A", intervals: [0, 15, 7] })).toBe("C5");
  });

  /*
   * Am7's fourth voice is its seventh; a power chord has no fourth voice, so
   * that voice has nowhere of its own to go and folds onto the nearest tone
   * the chord does have. The caller is told, because the figure lost a voice.
   */
  it("folds onto the nearest tone when the target has no such voice", () => {
    const Am7: Harmony = { root: "A", intervals: [0, 3, 7, 10] };
    expect(retunePitch("G3", Am7, A5)).toBe("A2");
  });

  it("stays in the octave the note was in", () => {
    expect(retunePitch("E2", Em, Am)).toBe("A2");
    expect(retunePitch("E4", Em, Am)).toBe("A4");
  });

  it("refuses a root it does not know", () => {
    expect(retunePitch("E2", { root: "H", intervals: [0] }, Am)).toBeNull();
  });
});

describe("pitchRole — the two kinds of note", () => {
  it("calls a note of the chord a chord tone, and says which voice", () => {
    expect(pitchRole("E2", Em)).toEqual({ kind: "chord_tone", voiceIndex: 0, degree: 0 });
    expect(pitchRole("G3", Em)).toEqual({ kind: "chord_tone", voiceIndex: 1, degree: 3 });
    expect(pitchRole("B2", Em)).toEqual({ kind: "chord_tone", voiceIndex: 2, degree: 7 });
  });

  it("calls everything else an ornament", () => {
    expect(pitchRole("F#2", Em)).toEqual({ kind: "ornament", degree: 2 });
    expect(pitchRole("C4", Em)).toEqual({ kind: "ornament", degree: 8 });
  });

  it("reads a voice an octave up as the same note of the chord", () => {
    expect(pitchRole("G3", { root: "E", intervals: [0, 15, 7] })).toMatchObject({
      kind: "chord_tone",
      voiceIndex: 1,
    });
  });

  it("returns nothing for a root or a pitch it cannot read", () => {
    expect(pitchRole("E2", { root: "H", intervals: [0] })).toBeNull();
    expect(pitchRole("nope", Em)).toBeNull();
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
    expect(result.moves).toContainEqual(
      expect.objectContaining({ from: "E2", to: "A2", role: "chord_tone" }),
    );
    expect(result.moves).toContainEqual(
      expect.objectContaining({ from: "B2", to: "E3", role: "chord_tone" }),
    );
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

/**
 * 2T-B §3.2. The notes that are *not* in the chord are the ones that make a
 * figure a phrase, and the first version of this module destroyed all of
 * them. Every case below is a shape that has to survive the transform.
 */
describe("retuneHarmony — ornaments keep their shape", () => {
  /** A run of single notes on one string, a sixteenth apart. */
  function onOneString(pitches: readonly string[], string = 2): MelodicSlot[] {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    pitches.forEach((pitch, index) => {
      slots[index] = { notes: [{ pitch, position: { string, fret: 0 } }] };
    });
    return slots;
  }

  const played = (song: Song): string[] =>
    slotsOf(song).flatMap((slot) =>
      slot === null || slot === "-" ? [] : slot.notes.map((n) => n.pitch),
    );

  const retuned = (
    slots: MelodicSlot[],
    from: Harmony = Em,
    to: Harmony = Am,
  ) => {
    const result = retuneHarmony(fixture(slots), whole, from, to);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result;
  };

  /* A chord tone is a voice, and it moves to the same voice. */
  it("moves a chord tone to the same voice of the new chord", () => {
    const result = retuned(onOneString(["E3", "G3", "B3"]));
    expect(played(result.song)).toEqual(["A3", "C4", "E4"]);
    expect(result.moves.every((m) => m.role === "chord_tone")).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  /*
   * The founder's cell, and the reason this section exists. 9–10–9 on one
   * string is an upper neighbour: strike, hammer a semitone up, pull back.
   * Whatever chord it is asked for over, it has to come back as x–(x+1)–x.
   */
  it("keeps an upper-neighbour cell as x – (x+1) – x", () => {
    const result = retuned(onOneString(["B3", "C4", "B3"]));
    expect(played(result.song)).toEqual(["E4", "F4", "E4"]);
  });

  it("keeps a lower-neighbour cell as x – (x-1) – x", () => {
    const result = retuned(onOneString(["B3", "A#3", "B3"]));
    expect(played(result.song)).toEqual(["E4", "D#4", "E4"]);
  });

  /*
   * A passing note passes. Snapping it to the nearest chord tone would have
   * produced A3 – C4 – C4: a step that no longer steps.
   */
  it("keeps a passing note between the two tones it passes between", () => {
    const result = retuned(onOneString(["E3", "F#3", "G3"]));
    expect(played(result.song)).toEqual(["A3", "B3", "C4"]);
  });

  /* One semitone below its target before, one semitone below it after. */
  it("keeps a chromatic approach one semitone below what it approaches", () => {
    const result = retuned(onOneString(["A#2", "B2"], 1));
    expect(played(result.song)).toEqual(["D#3", "E3"]);
  });

  it("says which structural note each ornament was measured against", () => {
    const result = retuned(onOneString(["B3", "C4", "B3"]));
    const ornament = result.moves.find((m) => m.role === "ornament");
    expect(ornament).toMatchObject({ from: "C4", to: "F4", anchor: "B3" });
  });

  /*
   * A pedal is a chord tone that happens to be long. It moves as a voice, and
   * everything that made it a pedal comes with it.
   */
  it("carries a ringing pedal tone across as a voice", () => {
    const slots = onOneString(["E2"], 0);
    slots[0] = {
      notes: [
        {
          pitch: "E2",
          position: { string: 0, fret: 0 },
          durationTicks: 768,
          letRing: true,
        },
      ],
    };
    slots[4] = { notes: [{ pitch: "C4", position: { string: 2, fret: 10 } }] };
    slots[8] = { notes: [{ pitch: "B3", position: { string: 2, fret: 9 } }] };
    const result = retuned(slots);
    const pedal = slotsOf(result.song)[0];
    if (pedal === null || pedal === undefined || pedal === "-") throw new Error("lost");
    expect(pedal.notes[0]).toMatchObject({
      pitch: "A2",
      durationTicks: 768,
      letRing: true,
    });
  });

  /*
   * An ornament belongs to the string it is played on. Here the nearest
   * structural note in time is on another string entirely; the one this
   * finger actually left is further away, and is still the right answer.
   */
  it("prefers a structural note on the ornament's own string", () => {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    slots[3] = { notes: [{ pitch: "E4", position: { string: 5, fret: 0 } }] };
    slots[4] = { notes: [{ pitch: "C4", position: { string: 2, fret: 10 } }] };
    slots[6] = { notes: [{ pitch: "B3", position: { string: 2, fret: 9 } }] };
    const result = retuned(slots);
    const ornament = result.moves.find((m) => m.role === "ornament");
    /* Anchored to the B3 on its own string, not the nearer E4 on string 5. */
    expect(ornament).toMatchObject({ from: "C4", anchor: "B3", to: "F4" });
  });

  /* A hammer-on still climbs and a pull-off still falls. */
  it("keeps the direction of a hammer-on and a pull-off ornament", () => {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    slots[0] = { notes: [{ pitch: "B3", position: { string: 2, fret: 9 } }] };
    slots[1] = {
      notes: [
        { pitch: "C4", position: { string: 2, fret: 10 }, articulation: "hammer_on" },
      ],
    };
    slots[2] = {
      notes: [
        { pitch: "B3", position: { string: 2, fret: 9 }, articulation: "pull_off" },
      ],
    };
    const result = retuned(slots);
    expect(played(result.song)).toEqual(["E4", "F4", "E4"]);
    expect(result.warnings).toEqual([]);
  });

  /*
   * A target voicing that puts its third an octave up turns an ascending
   * hammer-on into a descent. The transform is still complete — nothing is
   * half-done — but the reader is told before they apply it.
   */
  it("warns rather than silently inverting a slur", () => {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    slots[0] = { notes: [{ pitch: "G3", position: { string: 2, fret: 5 } }] };
    slots[2] = {
      notes: [
        { pitch: "B3", position: { string: 2, fret: 9 }, articulation: "hammer_on" },
      ],
    };
    const result = retuned(slots, Em, { root: "A", intervals: [0, 15, 7] });
    expect(result.warnings).toEqual([
      expect.objectContaining({ kind: "articulation_inverted", pitch: "B3" }),
    ]);
    expect(played(result.song)).toEqual(["C5", "E4"]);
  });

  /*
   * Nothing structural in the run at all. The ornaments still move — by the
   * interval between the roots, which keeps every distance between them — and
   * the reader is told that a weaker rule was used. What must not happen is a
   * silent snap onto a chord tone.
   */
  it("warns instead of snapping when an ornament has nothing to attach to", () => {
    const result = retuned(onOneString(["F#3", "C4"]));
    expect(played(result.song)).toEqual(["B3", "F4"]);
    expect(result.warnings.map((w) => w.kind)).toEqual([
      "unanchored_ornament",
      "unanchored_ornament",
    ]);
    /* The distance between them is exactly what it was. */
    expect(result.moves.every((m) => m.role === "ornament")).toBe(true);
  });

  it("warns when the target voicing has no room for a voice", () => {
    const result = retuned(onOneString(["E3", "G3", "B3"]), Em, A5);
    expect(result.warnings).toEqual([
      expect.objectContaining({ kind: "voice_folded", pitch: "B3" }),
    ]);
  });

  it("refuses outright when a note would fall off the instrument", () => {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    slots[0] = { notes: [{ pitch: "C8", position: { string: 5, fret: 20 } }] };
    const result = retuneHarmony(fixture(slots), whole, { root: "C", intervals: [0] }, {
      root: "B",
      intervals: [120],
    });
    expect(result).toMatchObject({ ok: false, reason: "unreachable_pitch" });
  });

  it("is deterministic, and leaves the song it was given alone", () => {
    const slots = onOneString(["E3", "F#3", "G3", "C4", "B3"]);
    const song = fixture(slots);
    const snapshot = JSON.stringify(song);
    const a = retuneHarmony(song, whole, Em, Am);
    const b = retuneHarmony(song, whole, Em, Am);
    expect(JSON.stringify(song)).toBe(snapshot);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.song)).toBe(JSON.stringify(b.song));
  });
});
