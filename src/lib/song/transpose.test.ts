/**
 * Two intentions, and what neither of them is allowed to break (2V-B.4 §15, §16).
 *
 * "Sesi taşı" moves what is held by an interval. "Tonu değiştir" puts a scope
 * into another key. Splitting them is the point: they answer different
 * questions, and only the second one — and only over the whole song — may
 * rewrite what key the song says it is in.
 *
 * The harder half is §16. A transposition on a guitar is not arithmetic on
 * MIDI numbers: the result has to be somewhere a hand can reach on *this*
 * instrument, with its tuning, its capo and its frets. A note that cannot be
 * reached refuses the whole operation rather than being written somewhere it
 * cannot be played.
 */
import { describe, expect, it } from "vitest";

import { pitchToMidi } from "@/lib/music/pitch";
import { pitchAt } from "@/lib/song/edit";
import { semanticSnapshot } from "@/lib/song/preserve";
import {
  KEY_CHOICES,
  PITCH_MOVES,
  TRANSPOSE_SCOPES,
  semitonesBetween,
  transposeSong,
} from "@/lib/song/transpose";
import { songSchema, type DrumSlot, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const FRETBOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
const soundOf = (stringIndex: number, fret: number) =>
  pitchAt(FRETBOARD, stringIndex, fret)!;

const note = (stringIndex: number, fret: number, extra: object = {}) => ({
  notes: [
    { pitch: soundOf(stringIndex, fret), position: { string: stringIndex, fret }, ...extra },
  ],
});

/** One guitar bar with a note on beat one and a held chord after it. */
function fixture(options: { readonly withDrums?: boolean } = {}): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = note(1, 5, { velocity: 88 });
  lane[2] = {
    notes: [
      { pitch: soundOf(0, 3), position: { string: 0, fret: 3 } },
      { pitch: soundOf(1, 5), position: { string: 1, fret: 5 } },
    ],
  };
  lane[3] = "-";
  const slots: Record<string, MelodicSlot[] | DrumSlot[]> = { [TRACK]: lane };
  if (options.withDrums) {
    const kit: DrumSlot[] = Array.from({ length: 8 }, () => []);
    kit[0] = [{ piece: "kick" }];
    kit[4] = [{ piece: "snare" }];
    slots["drums"] = kit;
  }
  return songSchema.parse({
    ...SAMPLE_SONG,
    key: "E minor",
    tracks: options.withDrums
      ? SAMPLE_SONG.tracks
      : SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots }],
      },
    ],
  } satisfies Song);
}

const laneOf = (song: Song) => song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
const midiOf = (song: Song, slot: number, voice = 0) => {
  const entry = laneOf(song)[slot];
  if (!entry || entry === "-") return null;
  return pitchToMidi(entry.notes[voice]!.pitch);
};

describe("48. moving a sound is one intention, changing a key is another", () => {
  it("offers the four intervals a beginner asks for, in their own words", () => {
    expect(PITCH_MOVES.map((move) => move.label)).toEqual([
      "Yarım ses aşağı",
      "Yarım ses yukarı",
      "Tam ses aşağı",
      "Tam ses yukarı",
    ]);
    expect(PITCH_MOVES.map((move) => move.semitones)).toEqual([-1, 1, -2, 2]);
    expect([...TRANSPOSE_SCOPES]).toEqual(["selection", "section", "song"]);
  });

  it("moves every voice of a chord by the same interval", () => {
    const before = fixture();
    const after = transposeSong(before, { semitones: 2, target: { scope: "song" } });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(midiOf(after.song, 0)).toBe(midiOf(before, 0)! + 2);
    expect(midiOf(after.song, 2, 0)).toBe(midiOf(before, 2, 0)! + 2);
    expect(midiOf(after.song, 2, 1)).toBe(midiOf(before, 2, 1)! + 2);
  });

  it("keeps the rhythm, the tie and the velocity exactly as they were", () => {
    const before = fixture();
    const after = transposeSong(before, { semitones: 2, target: { scope: "song" } });
    if (!after.ok) throw new Error(after.error.message);
    const onsets = (song: Song) =>
      semanticSnapshot(song).map((event) => [event.atTicks, event.lengthTicks]);
    expect(onsets(after.song)).toEqual(onsets(before));
    expect(laneOf(after.song)[3]).toBe("-");
    const moved = laneOf(after.song)[0];
    expect(moved && moved !== "-" ? moved.notes[0]?.velocity : null).toBe(88);
  });

  it("leaves a drum kit exactly where it is", () => {
    const before = fixture({ withDrums: true });
    const after = transposeSong(before, {
      semitones: 2,
      target: { scope: "song" },
      nextKey: "F# minor",
    });
    if (!after.ok) throw new Error(after.error.message);
    expect(after.song.sections[0]!.bars[0]!.slots["drums"]).toEqual(
      before.sections[0]!.bars[0]!.slots["drums"],
    );
  });

  it("changes the song's key only when the whole song was the scope", () => {
    const before = fixture();
    const whole = transposeSong(before, {
      semitones: 2,
      target: { scope: "song" },
      nextKey: "F# minor",
    });
    if (!whole.ok) throw new Error(whole.error.message);
    expect(whole.song.key).toBe("F# minor");

    const part = transposeSong(before, {
      semitones: 2,
      target: {
        scope: "selection",
        sectionId: before.sections[0]!.id,
        trackId: TRACK,
        fromTicks: 0,
        toTicks: 96,
      },
      /* Even asked for, a selection may not rename the song's key (§15). */
      nextKey: "F# minor",
    });
    if (!part.ok) throw new Error(part.error.message);
    expect(part.song.key).toBe("E minor");
  });

  it("touches only the held range", () => {
    const before = fixture();
    const after = transposeSong(before, {
      semitones: 2,
      target: {
        scope: "selection",
        sectionId: before.sections[0]!.id,
        trackId: TRACK,
        fromTicks: 0,
        toTicks: 96,
      },
    });
    if (!after.ok) throw new Error(after.error.message);
    expect(midiOf(after.song, 0)).toBe(midiOf(before, 0)! + 2);
    /* The chord at tick 192 was outside the range and did not move. */
    expect(midiOf(after.song, 2, 0)).toBe(midiOf(before, 2, 0));
  });

  it("says so rather than moving nothing quietly", () => {
    const before = fixture();
    const empty = transposeSong(before, {
      semitones: 2,
      target: {
        scope: "selection",
        sectionId: before.sections[0]!.id,
        trackId: TRACK,
        fromTicks: 480,
        toTicks: 576,
      },
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe("no_target");
  });

  it("is a no-op at zero semitones, byte for byte", () => {
    const before = fixture();
    const after = transposeSong(before, { semitones: 0, target: { scope: "song" } });
    if (!after.ok) throw new Error(after.error.message);
    expect(after.song).toBe(before);
  });
});

describe("49. a transposition has to stay playable on this guitar", () => {
  it("refuses rather than writing a note the instrument cannot reach", () => {
    const before = fixture();
    /* Four octaves up puts every voice past the last fret of every string;
       the whole operation is refused, not half-applied. */
    const after = transposeSong(before, { semitones: 48, target: { scope: "song" } });
    expect(after.ok).toBe(false);
    if (after.ok) return;
    /* Either refusal is honest — the pitch left the audible range, or it
       left the fretboard — and both refuse the whole operation. */
    expect(["out_of_range", "not_playable"]).toContain(after.error.code);
    expect(after.error.message).toMatch(/\S/u);
  });

  it("leaves the song untouched when it refuses", () => {
    const before = fixture();
    const snapshot = semanticSnapshot(before);
    transposeSong(before, { semitones: 48, target: { scope: "song" } });
    expect(semanticSnapshot(before)).toEqual(snapshot);
  });

  it("writes a real string and fret for every note it moves", () => {
    const before = fixture();
    const after = transposeSong(before, { semitones: -2, target: { scope: "song" } });
    if (!after.ok) throw new Error(after.error.message);
    for (const slot of laneOf(after.song)) {
      if (slot === null || slot === "-") continue;
      for (const voice of slot.notes) {
        expect(voice.position).toBeDefined();
        expect(voice.position!.fret).toBeGreaterThanOrEqual(0);
        /* The written pitch and the written position have to agree, or the
           tab would show one note and the speakers play another. */
        expect(pitchAt(FRETBOARD, voice.position!.string, voice.position!.fret)).toBe(
          voice.pitch,
        );
      }
    }
  });
});

describe("50. the key picker means what it says", () => {
  it("takes the shorter way round between two keys", () => {
    expect(semitonesBetween("E minor", "F minor")).toBe(1);
    expect(semitonesBetween("E minor", "D minor")).toBe(-2);
    expect(semitonesBetween("C major", "C major")).toBe(0);
    expect(semitonesBetween("C major", "F# major")).toBe(6);
    expect(semitonesBetween("nonsense", "C major")).toBeNull();
  });

  it("offers keys a reader would recognise, and nothing internal", () => {
    expect(KEY_CHOICES.length).toBeGreaterThanOrEqual(12);
    for (const key of KEY_CHOICES) {
      expect(key).toMatch(/^[A-G][#b]? (major|minor)$/u);
      expect(semitonesBetween("C major", key)).not.toBeNull();
    }
  });
});
