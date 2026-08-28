import { describe, expect, it } from "vitest";

import {
  arpeggioToChord,
  chordToArpeggio,
  setChordStrum,
  type ChordTarget,
} from "@/lib/song/chord-shape";
import { SONG_VERSION, songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { soundingSpans, writtenSpans } from "@/lib/song/sounding";

const TRACK = "t1";
const SECTION = "s1";

const CHORD: MelodicSlot = {
  notes: [
    { pitch: "E2", position: { string: 0, fret: 0 }, velocity: 96 },
    { pitch: "B2", position: { string: 1, fret: 2 }, articulation: "palm_mute" },
    { pitch: "E3", position: { string: 2, fret: 2 } },
  ],
};

function fixture(slots?: MelodicSlot[]): Song {
  const line: MelodicSlot[] = slots ?? [
    CHORD,
    ...Array.from({ length: 15 }, () => null as MelodicSlot),
  ];
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
        bars: [{ timeSignature: [4, 4], resolution: 16, slots: { [TRACK]: line } }],
      },
    ],
  };
}

const at: ChordTarget = {
  sectionId: SECTION,
  barIndex: 0,
  trackId: TRACK,
  slotIndex: 0,
};

const slotsOf = (song: Song) => song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];

const notesOf = (song: Song) =>
  slotsOf(song).flatMap((slot) =>
    slot === null || slot === "-" ? [] : slot.notes.map((n) => n.pitch),
  );

const DETACHED = { direction: "down_to_up", stepTicks: 48, ring: false } as const;

describe("chordToArpeggio", () => {
  it("spreads the voices onto separate onsets, low string first", () => {
    const result = chordToArpeggio(fixture(), at, DETACHED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.onsets.map((o) => [o.slotIndex, o.pitch])).toEqual([
      [0, "E2"],
      [1, "B2"],
      [2, "E3"],
    ]);
  });

  it("crosses the strings the other way when asked", () => {
    const result = chordToArpeggio(fixture(), at, { ...DETACHED, direction: "up_to_down" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.onsets.map((o) => o.pitch)).toEqual(["E3", "B2", "E2"]);
  });

  /* Nothing may be lost, and nothing may be quietly changed. */
  it("keeps every note, every pitch and every articulation", () => {
    const before = fixture();
    const result = chordToArpeggio(before, at, DETACHED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(notesOf(result.song))).toEqual(new Set(notesOf(before)));

    const slots = slotsOf(result.song);
    const palm = slots.find(
      (slot) => slot !== null && slot !== "-" && slot.notes[0]!.pitch === "B2",
    );
    if (palm === null || palm === undefined || palm === "-") throw new Error("lost");
    expect(palm.notes[0]!.articulation).toBe("palm_mute");
    expect(palm.notes[0]!.position).toEqual({ string: 1, fret: 2 });

    const first = slots[0];
    if (first === null || first === undefined || first === "-") throw new Error("lost");
    expect(first.notes[0]!.velocity).toBe(96);
  });

  it("gives a detached arpeggio a voice that stops when the next starts", () => {
    const result = chordToArpeggio(fixture(), at, DETACHED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spans = writtenSpans(result.song.sections[0]!.bars, TRACK);
    expect(spans.map((s) => s.writtenTicks)).toEqual([48, 48, 48]);
    expect(spans.every((s) => s.note.letRing === undefined)).toBe(true);
  });

  /*
   * The dirty arpeggio §3.3 asked for: every string keeps ringing to the end
   * of the figure, so the voices overlap instead of taking turns.
   */
  it("gives a ringing arpeggio overlapping lives, one per string", () => {
    const result = chordToArpeggio(fixture(), at, { ...DETACHED, ring: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = writtenSpans(result.song.sections[0]!.bars, TRACK);
    expect(written.map((s) => s.writtenTicks)).toEqual([144, 96, 48]);

    const heard = soundingSpans(written, (span) => span.slotIndex);
    expect(heard.map((s) => s.soundingTicks)).toEqual([144, 96, 48]);
    expect(heard.every((s) => !s.cutByRestrike)).toBe(true);
  });

  it("uses the step the reader chose, on the grid the bar is on", () => {
    const eighths = chordToArpeggio(fixture(), at, { ...DETACHED, stepTicks: 96 });
    expect(eighths.ok).toBe(true);
    if (!eighths.ok) return;
    expect(eighths.onsets.map((o) => o.slotIndex)).toEqual([0, 2, 4]);
  });

  it("refuses a step the grid cannot write, rather than rounding it", () => {
    const song = fixture();
    song.sections[0]!.bars[0]!.resolution = 8;
    song.sections[0]!.bars[0]!.slots[TRACK] = [
      CHORD,
      ...Array.from({ length: 7 }, () => null as MelodicSlot),
    ];
    expect(chordToArpeggio(song, at, { ...DETACHED, stepTicks: 24 })).toMatchObject({
      ok: false,
      reason: "would_not_fit",
    });
  });

  /* A transform is not a bulldozer: it refuses rather than overwriting. */
  it("refuses when the arpeggio would land on notes that are already there", () => {
    const line: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    line[0] = CHORD;
    line[1] = { notes: [{ pitch: "G2" }] };
    const result = chordToArpeggio(fixture(line), at, DETACHED);
    expect(result).toMatchObject({ ok: false, reason: "would_not_fit" });
    if (result.ok) return;
    expect(result.detail).toMatch(/başka notalar/);
  });

  it("refuses when the figure would run past the end of the bar", () => {
    const line: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    line[15] = CHORD;
    const result = chordToArpeggio(fixture(line), { ...at, slotIndex: 15 }, DETACHED);
    expect(result).toMatchObject({ ok: false, reason: "would_not_fit" });
    if (result.ok) return;
    expect(result.detail).toMatch(/dışına taşar/);
  });

  it("refuses a single note and a rest", () => {
    const line: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    line[0] = { notes: [{ pitch: "E2" }] };
    expect(chordToArpeggio(fixture(line), at, DETACHED)).toMatchObject({
      ok: false,
      reason: "not_a_chord",
    });
    expect(
      chordToArpeggio(fixture(), { ...at, slotIndex: 5 }, DETACHED),
    ).toMatchObject({ ok: false, reason: "not_a_chord" });
  });

  it("does not touch the input song", () => {
    const song = fixture();
    const snapshot = JSON.stringify(song);
    chordToArpeggio(song, at, DETACHED);
    expect(JSON.stringify(song)).toBe(snapshot);
  });
});

describe("arpeggioToChord", () => {
  it("gathers the voices back onto one onset", () => {
    const spread = chordToArpeggio(fixture(), at, DETACHED);
    expect(spread.ok).toBe(true);
    if (!spread.ok) return;

    const gathered = arpeggioToChord(spread.song, at, 3);
    expect(gathered.ok).toBe(true);
    if (!gathered.ok) return;

    const slots = slotsOf(gathered.song);
    const first = slots[0];
    if (first === null || first === undefined || first === "-") throw new Error("lost");
    expect(first.notes.map((n) => n.pitch)).toEqual(["E2", "B2", "E3"]);
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBeNull();
  });

  it("brings back everything except the durations the arpeggio gave", () => {
    const spread = chordToArpeggio(fixture(), at, { ...DETACHED, ring: true });
    expect(spread.ok).toBe(true);
    if (!spread.ok) return;
    const gathered = arpeggioToChord(spread.song, at, 3);
    expect(gathered.ok).toBe(true);
    if (!gathered.ok) return;
    const first = slotsOf(gathered.song)[0];
    if (first === null || first === undefined || first === "-") throw new Error("lost");
    expect(first.notes).toEqual(CHORD.notes);
  });

  it("refuses when there is only one voice in the span", () => {
    const line: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    line[0] = { notes: [{ pitch: "E2" }] };
    expect(arpeggioToChord(fixture(line), at, 3)).toMatchObject({
      ok: false,
      reason: "not_a_chord",
    });
  });
});

describe("setChordStrum", () => {
  /*
   * The distinction §3.4 exists to protect: a strum is one written onset,
   * performed across the strings. An arpeggio moves notes; this does not.
   */
  it("marks the chord without moving a single note", () => {
    const before = fixture();
    const result = setChordStrum(before, at, "down");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slots = slotsOf(result.song);
    expect(slots[1]).toBeNull();
    const chord = slots[0];
    if (chord === null || chord === undefined || chord === "-") throw new Error("lost");
    expect(chord.notes.map((n) => n.pitch)).toEqual(["E2", "B2", "E3"]);
    expect(chord.notes.every((n) => n.strum === "down")).toBe(true);

    const spans = writtenSpans(result.song.sections[0]!.bars, TRACK);
    expect(spans.map((s) => s.startTicks)).toEqual([0, 0, 0]);
  });

  it("carries the direction the reader asked for", () => {
    const up = setChordStrum(fixture(), at, "up");
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const chord = slotsOf(up.song)[0];
    if (chord === null || chord === undefined || chord === "-") throw new Error("lost");
    expect(chord.notes.every((n) => n.strum === "up")).toBe(true);
  });

  it("takes the mark off again, field and all", () => {
    const marked = setChordStrum(fixture(), at, "down");
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    const cleared = setChordStrum(marked.song, at, null);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    /*
     * Compared through the schema on both sides: a parse normalises key
     * order, so a raw fixture and a parsed song differ in spelling without
     * differing in music, and it is the music that has to come back.
     */
    expect(cleared.song).toEqual(songSchema.parse(fixture()));
  });

  it("keeps articulation and position while marking", () => {
    const result = setChordStrum(fixture(), at, "down");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chord = slotsOf(result.song)[0];
    if (chord === null || chord === undefined || chord === "-") throw new Error("lost");
    expect(chord.notes[1]!.articulation).toBe("palm_mute");
    expect(chord.notes[1]!.position).toEqual({ string: 1, fret: 2 });
  });

  it("refuses a single note", () => {
    const line: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    line[0] = { notes: [{ pitch: "E2" }] };
    expect(setChordStrum(fixture(line), at, "down")).toMatchObject({
      ok: false,
      reason: "not_a_chord",
    });
  });
});
