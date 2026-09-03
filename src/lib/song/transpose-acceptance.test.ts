/**
 * The transposition cases the brief names, on real songs (2V-B.4 §15, §16).
 *
 * `transpose.test.ts` checks the mechanism. This checks the *outcomes* a
 * musician would name: E minor plus two is F# minor, the Em in it becomes an
 * F#m, the E5 becomes an F#5, the drummer plays exactly what they played
 * before, and a "9h10p9" stays a hammer-on and a pull-off a whole tone up
 * rather than three unrelated notes. And the second half: that the guitar
 * doing the playing is a real one — a capo, a dropped string, an open shape,
 * a barre — so a transposition that would need a seventh string is refused in
 * a sentence instead of being clamped onto the twenty-fourth fret.
 */
import { describe, expect, it } from "vitest";

import { chordDisplayName, transposeChord } from "@/lib/chords/chord-naming";
import { readChord } from "@/lib/chords/chord-recognition";
import { pitchToMidi } from "@/lib/music/pitch";
import { pitchAt } from "@/lib/song/edit";
import { namePhrase } from "@/lib/song/phrase-write";
import { transposeSong } from "@/lib/song/transpose";
import {
  songSchema,
  type Bar,
  type DrumSlot,
  type Fretboard,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const DRUMS = "drums";
const STANDARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;

const soundOf = (fretboard: Fretboard, stringIndex: number, fret: number) =>
  pitchAt(fretboard, stringIndex, fret)!;

const at = (
  fretboard: Fretboard,
  stringIndex: number,
  fret: number,
  extra: Partial<NoteEvent> = {},
): NoteEvent =>
  ({
    pitch: soundOf(fretboard, stringIndex, fret),
    position: { string: stringIndex, fret },
    ...extra,
  }) as NoteEvent;

/**
 * A bar with everything §15 promises to preserve in it: a two-voice Em, a
 * power chord, a 9h10p9 run, a slide, a velocity, a kit and a phrase.
 */
function song(options: { readonly fretboard?: Fretboard } = {}): Song {
  const board = options.fretboard ?? STANDARD;
  const lane: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  /* Em: the open low E, the B above it, and the G that makes it minor. */
  lane[0] = { notes: [at(board, 0, 0), at(board, 1, 2), at(board, 3, 0)] };
  /* E5: root and fifth. */
  lane[2] = { notes: [at(board, 0, 0), at(board, 1, 2, { velocity: 104 })] };
  /* 9h10p9, one sixteenth each, on the third string. */
  lane[4] = { notes: [at(board, 2, 9, { velocity: 91 })] };
  lane[5] = { notes: [at(board, 2, 10, { articulation: "hammer_on" })] };
  lane[6] = { notes: [at(board, 2, 9, { articulation: "pull_off" })] };
  /* A slide up a whole tone, landing on the next onset. */
  lane[8] = { notes: [at(board, 3, 5)] };
  lane[9] = { notes: [at(board, 3, 7, { articulation: "slide" })] };
  lane[10] = "-";

  const kit: DrumSlot[] = Array.from({ length: 16 }, () => []);
  kit[0] = [{ piece: "kick" }];
  kit[4] = [{ piece: "snare" }];
  kit[8] = [{ piece: "kick" }];
  kit[12] = [{ piece: "snare" }];

  const parsed = songSchema.parse({
    ...SAMPLE_SONG,
    key: "E minor",
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 16,
            slots: { [TRACK]: lane, [DRUMS]: kit },
          },
        ],
      },
      ...SAMPLE_SONG.sections.slice(1, 2).map((section) => ({
        ...section,
        bars: [emptyBar()],
      })),
    ],
    tracks: options.fretboard
      ? SAMPLE_SONG.tracks.map((track) =>
          track.id === TRACK ? { ...track, fretboard: options.fretboard } : track,
        )
      : SAMPLE_SONG.tracks,
  } satisfies Song);
  const named = namePhrase(parsed, {
    sectionId: parsed.sections[0]!.id,
    fromTicks: 0,
    toTicks: 768,
    name: "Ana fikir",
  });
  if (!named.ok) throw new Error(named.reason);
  return named.song;
}

/** A silent 4/4 bar for the section that must not move. */
const emptyBar = (): Bar => ({
  timeSignature: [4, 4],
  resolution: 16,
  slots: { [TRACK]: Array.from({ length: 16 }, () => null) },
});

const laneOf = (value: Song) => value.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
const kitOf = (value: Song) => value.sections[0]!.bars[0]!.slots[DRUMS] as DrumSlot[];
const onsetAt = (value: Song, slot: number) => {
  const entry = laneOf(value)[slot];
  return entry === null || entry === undefined || entry === "-" ? null : entry;
};
const midisAt = (value: Song, slot: number) =>
  (onsetAt(value, slot)?.notes ?? []).map((voice) => pitchToMidi(voice.pitch)!);

const up2 = (value: Song, nextKey?: string) => {
  const result = transposeSong(value, {
    semitones: 2,
    target: { scope: "song" },
    ...(nextKey === undefined ? {} : { nextKey }),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.song;
};

describe("71. E minor plus two whole steps of a tone is F sharp minor", () => {
  it("moves the song's own key when the whole song moved", () => {
    expect(up2(song(), "F# minor").key).toBe("F# minor");
  });

  it("turns the Em into an F#m, by name and not only by pitch", () => {
    const before = readChord(onsetAt(song(), 0)!.notes);
    expect(before.kind).toBe("matched");
    if (before.kind !== "matched") return;
    const em = before.matches[0]!;
    expect(chordDisplayName(em, "E minor")).toBe("Em");
    expect(chordDisplayName(transposeChord(em, 2), "F# minor")).toBe("F#m");
    /* And the moved song reads back as that chord, not merely as those
       pitches: the symbol on the surface follows the notes (§15). */
    const after = readChord(onsetAt(up2(song(), "F# minor"), 0)!.notes);
    expect(after.kind).toBe("matched");
    if (after.kind !== "matched") return;
    expect(chordDisplayName(after.matches[0]!, "F# minor")).toBe("F#m");
    /* And the moved song really carries those pitch classes. */
    expect(midisAt(up2(song(), "F# minor"), 0).map((midi) => midi % 12)).toEqual(
      midisAt(song(), 0).map((midi) => (midi + 2) % 12),
    );
  });

  it("turns the E5 into an F#5 and keeps it a fifth", () => {
    const moved = midisAt(up2(song(), "F# minor"), 2);
    const original = midisAt(song(), 2);
    expect(moved).toEqual(original.map((midi) => midi + 2));
    expect(moved[1]! - moved[0]!).toBe(original[1]! - original[0]!);
  });

  it("leaves every drum hit exactly where and what it was", () => {
    expect(kitOf(up2(song(), "F# minor"))).toEqual(kitOf(song()));
  });

  it("keeps the 9h10p9 a hammer-on and a pull-off, at the same interval", () => {
    const moved = up2(song(), "F# minor");
    expect(midisAt(moved, 4)[0]! + 1).toBe(midisAt(moved, 5)[0]!);
    expect(midisAt(moved, 6)[0]!).toBe(midisAt(moved, 4)[0]!);
    expect(onsetAt(moved, 5)!.notes[0]!.articulation).toBe("hammer_on");
    expect(onsetAt(moved, 6)!.notes[0]!.articulation).toBe("pull_off");
  });

  it("keeps the slide going the same way, over the same distance", () => {
    const moved = up2(song(), "F# minor");
    expect(onsetAt(moved, 9)!.notes[0]!.articulation).toBe("slide");
    expect(midisAt(moved, 9)[0]! - midisAt(moved, 8)[0]!).toBe(
      midisAt(song(), 9)[0]! - midisAt(song(), 8)[0]!,
    );
  });

  it("changes no rhythm, no length, no loudness and no phrase", () => {
    const before = song();
    const after = up2(before, "F# minor");
    const shape = (value: Song) =>
      laneOf(value).map((slot) =>
        slot === null || slot === undefined
          ? "empty"
          : slot === "-"
            ? "tie"
            : slot.notes.map((voice) => ({
                durationTicks: voice.durationTicks ?? null,
                velocity: voice.velocity ?? null,
                articulation: voice.articulation ?? null,
              })),
      );
    expect(shape(after)).toEqual(shape(before));
    expect(after.sections[0]!.phrases).toEqual(before.sections[0]!.phrases);
    expect(after.sections[0]!.bars[0]!.resolution).toBe(
      before.sections[0]!.bars[0]!.resolution,
    );
  });
});

describe("72. a smaller scope does not get to rename the whole song", () => {
  it("leaves the key alone when only a section moved", () => {
    const before = song();
    const moved = transposeSong(before, {
      semitones: 2,
      target: { scope: "section", sectionId: before.sections[0]!.id },
    });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(moved.song.key).toBe(before.key);
    /* And the section that was not named is untouched, note for note. */
    expect(moved.song.sections[1]).toEqual(before.sections[1]);
  });

  it("leaves the key alone when only a held range moved", () => {
    const before = song();
    const moved = transposeSong(before, {
      semitones: 2,
      target: {
        scope: "selection",
        sectionId: before.sections[0]!.id,
        trackId: TRACK,
        fromTicks: 0,
        toTicks: 768,
      },
    });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(moved.song.key).toBe(before.key);
  });

  it("moves nothing at all for zero semitones", () => {
    const before = song();
    const moved = transposeSong(before, { semitones: 0, target: { scope: "song" } });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(moved.song).toBe(before);
  });
});

describe("73. the guitar doing the playing is a real one", () => {
  const board = (tuning: readonly string[], capo = 0): Fretboard => ({
    tuning: [...tuning],
    capo,
  });
  const STANDARD_TUNING = STANDARD.tuning;
  /* The lowest string is index 0, so dropping D is done there. */
  const DROP_D = [...STANDARD_TUNING];
  DROP_D[0] = "D2";

  it("writes a fret that really sounds the pitch, in standard tuning", () => {
    const moved = up2(song());
    for (const slot of laneOf(moved)) {
      if (slot === null || slot === undefined || slot === "-") continue;
      for (const voice of slot.notes) {
        expect(pitchAt(STANDARD, voice.position!.string, voice.position!.fret)).toBe(
          voice.pitch,
        );
      }
    }
  });

  it("respells against the dropped string, not against the standard one", () => {
    const dropped = board(DROP_D);
    const moved = up2(song({ fretboard: dropped }));
    for (const slot of laneOf(moved)) {
      if (slot === null || slot === undefined || slot === "-") continue;
      for (const voice of slot.notes) {
        expect(pitchAt(dropped, voice.position!.string, voice.position!.fret)).toBe(
          voice.pitch,
        );
      }
    }
  });

  it("stays behind the capo: no fret below it, and none past the last one", () => {
    const capoed = board(STANDARD_TUNING, 3);
    const moved = up2(song({ fretboard: capoed }));
    for (const slot of laneOf(moved)) {
      if (slot === null || slot === undefined || slot === "-") continue;
      for (const voice of slot.notes) {
        expect(voice.position!.fret).toBeGreaterThanOrEqual(0);
        expect(pitchAt(capoed, voice.position!.string, voice.position!.fret)).toBe(
          voice.pitch,
        );
      }
    }
  });

  it("moves an open shape to a fretted one rather than refusing it", () => {
    /* The Em's open low E has no fret below it to move down to, so it has to
       come up. What must not happen is a negative fret or a dropped voice. */
    const moved = up2(song());
    expect(midisAt(moved, 0)).toEqual(midisAt(song(), 0).map((midi) => midi + 2));
    expect(onsetAt(moved, 0)!.notes).toHaveLength(3);
  });

  it("never puts two voices of one chord on the same string", () => {
    const moved = up2(song());
    for (const slot of laneOf(moved)) {
      if (slot === null || slot === undefined || slot === "-") continue;
      const strings = slot.notes.map((voice) => voice.position!.string);
      expect(new Set(strings).size).toBe(strings.length);
    }
  });

  it("refuses in a sentence rather than clamping to the last fret", () => {
    const refused = transposeSong(song(), {
      semitones: 40,
      target: { scope: "song" },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(["out_of_range", "not_playable"]).toContain(refused.error.code);
    /* A sentence a musician can act on, with no code and no fret number in
       it that they never asked for. */
    expect(refused.error.message).toMatch(/[a-zçğıöşü]/u);
    expect(refused.error.message).not.toMatch(/undefined|null|Error/u);
  });

  it("refuses the whole thing, so no bar is left half-moved", () => {
    const before = song();
    const refused = transposeSong(before, { semitones: 40, target: { scope: "song" } });
    expect(refused.ok).toBe(false);
    expect(laneOf(before)).toEqual(laneOf(song()));
  });
});
