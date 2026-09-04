/**
 * Changing and removing a gesture that is already written (2V-C.2 §12, §13).
 *
 * The audit these answer: C.1 shipped the adding and not the un-adding. A
 * note that bent had no way to say so and no way to stop, because writing a
 * second gesture over the first is refused — correctly — as two answers on
 * one axis. So the pure command has to be able to take one axis off while
 * leaving everything else exactly as it was, and "everything else" is what
 * most of this file is about: the other axis, the note itself, its neighbours,
 * the drums, the bar, the tick and the duration.
 */
import { describe, expect, it } from "vitest";

import { applyGestureWrite } from "@/lib/song/gesture-write";
import { inspectGesture } from "@/lib/song/gesture-inspect";
import {
  approachIsPlayable,
  distanceOf,
  slideDistance,
  SLIDE_DISTANCES,
  DEFAULT_SLIDE_DISTANCE,
} from "@/lib/music/slide-distance";
import { pitchToMidi } from "@/lib/music/pitch";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";

/** Two notes on one string, the second carrying whatever the caller says. */
function fixture(extra: Partial<NoteEvent>): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [{ pitch: "G3", position: { string: 2, fret: 5 } } as NoteEvent] };
  lane[1] = {
    notes: [{ pitch: "A3", position: { string: 2, fret: 7 }, ...extra } as NoteEvent],
  };
  /* A drum hit and a second string, so "touched nothing else" has something
     to be true about. */
  lane[3] = { notes: [{ pitch: "D4", position: { string: 3, fret: 7 } } as NoteEvent] };
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
      },
    ],
  } satisfies Song);
}

const AT = { sectionId: SAMPLE_SONG.sections[0]!.id, trackId: TRACK, timeTicks: 96 };

const noteAt = (song: Song, ticks: number, string = 2) => {
  const bar = song.sections[0]!.bars[0]!;
  const lane = bar.slots[TRACK] as MelodicSlot[];
  const slot = lane[ticks / 96];
  if (slot === null || slot === undefined || slot === "-") return undefined;
  return slot.notes.find((note) => note.position?.string === string);
};

const BEND: NoteEvent["pitchGesture"] = { kind: "bend_release", targetCents: 200 };

/** Which string sounds lowest. Not an index: an alternate tuning may reorder. */
function lowestString(tuning: readonly string[]): number {
  let best = 0;
  let bestMidi = Infinity;
  tuning.forEach((pitch, index) => {
    const midi = pitchToMidi(pitch);
    if (midi !== null && midi < bestMidi) {
      bestMidi = midi;
      best = index;
    }
  });
  return best;
}

describe("109. a written gesture can be read back", () => {
  it("says what the note is currently doing, per axis", () => {
    const song = fixture({ pitchGesture: BEND, connection: { kind: "shift_slide" } });
    const seen = inspectGesture(song, AT)!;
    expect(seen.hasPitchGesture).toBe(true);
    expect(seen.hasConnection).toBe(true);
    expect(seen.pitchSpoken.length).toBeGreaterThan(0);
    expect(seen.connectionSpoken.length).toBeGreaterThan(0);
  });

  it("does not claim a gesture on a note that carries only the legacy enum", () => {
    /* A `bend_full` reads as a bend and is worth showing, but offering to
       remove a `pitchGesture` that is not there would silently rewrite an old
       song's articulation. */
    const seen = inspectGesture(fixture({ articulation: "bend_full" }), AT)!;
    expect(seen.hasPitchGesture).toBe(false);
    expect(seen.pitchSpoken.length).toBeGreaterThan(0);
  });

  it("says nothing at all about a plain note", () => {
    const seen = inspectGesture(fixture({}), AT)!;
    expect(seen.hasPitchGesture).toBe(false);
    expect(seen.hasConnection).toBe(false);
  });
});

describe("110. one axis comes off, and only that axis", () => {
  it("removes the pitch gesture and leaves the connection", () => {
    const song = fixture({ pitchGesture: BEND, connection: { kind: "shift_slide" } });
    const result = applyGestureWrite(song, { ...AT, pitchGesture: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = noteAt(result.song, 96)!;
    expect(note.pitchGesture).toBeUndefined();
    expect(note.connection).toEqual({ kind: "shift_slide" });
  });

  it("removes the connection and leaves the pitch gesture", () => {
    const song = fixture({ pitchGesture: BEND, connection: { kind: "shift_slide" } });
    const result = applyGestureWrite(song, { ...AT, connection: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = noteAt(result.song, 96)!;
    expect(note.connection).toBeUndefined();
    expect(note.pitchGesture).toEqual(BEND);
  });

  it("leaves an accent alone when the bend comes off", () => {
    /* Different axis. Removing one expression must not tidy away another. */
    const song = fixture({ pitchGesture: BEND, articulation: "accent" });
    const result = applyGestureWrite(song, { ...AT, pitchGesture: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 96)!.articulation).toBe("accent");
  });

  it("does not delete the note, its pitch, its fret or its place", () => {
    const song = fixture({ pitchGesture: BEND });
    const before = noteAt(song, 96)!;
    const result = applyGestureWrite(song, { ...AT, pitchGesture: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = noteAt(result.song, 96)!;
    expect(after.pitch).toBe(before.pitch);
    expect(after.position).toEqual(before.position);
    expect(result.song.sections[0]!.bars[0]!.resolution).toBe(
      song.sections[0]!.bars[0]!.resolution,
    );
  });

  it("touches no other note in the bar", () => {
    const song = fixture({ pitchGesture: BEND });
    const result = applyGestureWrite(song, { ...AT, pitchGesture: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0)).toEqual(noteAt(song, 0));
    expect(noteAt(result.song, 288, 3)).toEqual(noteAt(song, 288, 3));
  });

  it("changes a gesture in place rather than refusing it as a second answer", () => {
    const song = fixture({ pitchGesture: BEND });
    const result = applyGestureWrite(song, {
      ...AT,
      pitchGesture: { kind: "prebend", targetCents: 100 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 96)!.pitchGesture).toEqual({
      kind: "prebend",
      targetCents: 100,
    });
  });

  it("refuses to remove what is not there, byte for byte", () => {
    const song = fixture({});
    const before = JSON.stringify(song);
    const result = applyGestureWrite(song, { ...AT, pitchGesture: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no_change");
    expect(JSON.stringify(song)).toBe(before);
  });

  it("leaves the song untouched on every refusal", () => {
    const song = fixture({});
    const before = JSON.stringify(song);
    /* A slide with nothing to slide from. */
    applyGestureWrite(song, {
      ...AT,
      timeTicks: 0,
      connection: { kind: "shift_slide" },
    });
    applyGestureWrite(song, { ...AT, sectionId: "nope", pitchGesture: BEND });
    expect(JSON.stringify(song)).toBe(before);
  });
});

describe("111. how far an open slide comes from, in three words", () => {
  it("offers exactly three, all of them words", () => {
    expect(SLIDE_DISTANCES).toHaveLength(3);
    expect(SLIDE_DISTANCES.map((entry) => entry.label)).toEqual([
      "Kısa",
      "Belirgin",
      "Uzun",
    ]);
    for (const entry of SLIDE_DISTANCES) {
      expect(entry.label).not.toMatch(/\d/);
    }
  });

  it("defaults to the middle one", () => {
    expect(DEFAULT_SLIDE_DISTANCE).toBe("clear");
    expect(slideDistance(DEFAULT_SLIDE_DISTANCE).label).toBe("Belirgin");
  });

  it("maps each word to a distinct bounded interval", () => {
    const values = SLIDE_DISTANCES.map((entry) => entry.semitones);
    expect(new Set(values).size).toBe(3);
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(5);
    }
    /* And they go up, so the word and the sound agree. */
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("says the real interval plainly, for the disclosure", () => {
    for (const entry of SLIDE_DISTANCES) {
      expect(entry.spoken.length).toBeGreaterThan(0);
      expect(entry.spoken).not.toMatch(/cent|semiton|approx/i);
    }
  });

  it("reads back which word a written gesture is using", () => {
    expect(distanceOf(2)).toBe("clear");
    expect(distanceOf(4)).toBe("long");
    expect(distanceOf(undefined)).toBeNull();
    expect(distanceOf(7)).toBeNull();
  });

  it("changes what is written, and therefore what is heard", () => {
    const song = fixture({});
    const short = applyGestureWrite(song, {
      ...AT,
      pitchGesture: {
        kind: "slide_in",
        from: "below",
        approxSemitones: slideDistance("short").semitones,
      },
    });
    const long = applyGestureWrite(song, {
      ...AT,
      pitchGesture: {
        kind: "slide_in",
        from: "below",
        approxSemitones: slideDistance("long").semitones,
      },
    });
    expect(short.ok && long.ok).toBe(true);
    if (!short.ok || !long.ok) return;
    expect(noteAt(short.song, 96)!.pitchGesture).not.toEqual(
      noteAt(long.song, 96)!.pitchGesture,
    );
  });

  it("refuses an approach that is not on the neck", () => {
    /* The lowest open string, entered from below: there is nothing there.
       Found by pitch rather than by index, because an alternate tuning need
       not put its lowest note on the last string. */
    const board = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
    const low = { string: lowestString(board.tuning), fret: 0 };
    expect(
      approachIsPlayable(board, low, { kind: "slide_in", from: "below" }, 4),
    ).toBe(false);
    /* And the same option higher up is fine, so the refusal is about the
       neck rather than about the option. */
    expect(
      approachIsPlayable(
        board,
        { string: lowestString(board.tuning), fret: 7 },
        { kind: "slide_in", from: "below" },
        4,
      ),
    ).toBe(true);
  });

  it("refuses it through the write command too, with its own sentence", () => {
    const board = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
    const lowString = lowestString(board.tuning);
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[1] = {
      notes: [
        { pitch: board.tuning[lowString]!, position: { string: lowString, fret: 0 } } as NoteEvent,
      ],
    };
    const song = songSchema.parse({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
      sections: [
        {
          ...SAMPLE_SONG.sections[0]!,
          bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);
    const result = applyGestureWrite(song, {
      ...AT,
      pitchGesture: { kind: "slide_in", from: "below", approxSemitones: 4 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("slide_off_the_neck");
    expect(result.message).not.toMatch(/\d|cent|semiton/i);
  });

  it("follows the capo rather than the fret number", () => {
    const board = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
    const low = { string: lowestString(board.tuning), fret: 2 };
    /* Two frets below fret 2 is the open string with no capo... */
    expect(
      approachIsPlayable(board, low, { kind: "slide_in", from: "below" }, 2),
    ).toBe(true);
    /* ...and with a capo at 5 the same *written* fret sounds five higher, so
       the same two semitones below is still on the neck. The question is
       asked of the sounding pitch, which is why this holds. */
    const capoed = { ...board, capo: 5 };
    expect(
      approachIsPlayable(capoed, low, { kind: "slide_in", from: "below" }, 2),
    ).toBe(true);
    /* But four semitones below the capo's own lowest note is not. */
    expect(
      approachIsPlayable(
        capoed,
        { string: lowestString(board.tuning), fret: 0 },
        { kind: "slide_in", from: "below" },
        4,
      ),
    ).toBe(false);
  });
});
