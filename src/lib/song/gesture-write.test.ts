/**
 * Writing a gesture, and every way it is refused (2V-C.1 §10, §16).
 *
 * A refusal is the interesting half. The command has to say no *before* it
 * writes anything, in a sentence a guitarist can act on, and it has to leave
 * the song byte-identical when it does — which is what makes the editor's
 * "nothing happened" honest rather than merely invisible.
 */
import { describe, expect, it } from "vitest";

import {
  applyGestureWrite,
  GESTURE_MESSAGE,
  type GestureFailure,
} from "@/lib/song/gesture-write";
import { pitchAt } from "@/lib/song/edit";
import {
  songSchema,
  type Fretboard,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
const SECTION = SAMPLE_SONG.sections[0]!.id;

const at = (
  stringIndex: number,
  fret: number,
  extra: Partial<NoteEvent> = {},
  board: Fretboard = BOARD,
): NoteEvent =>
  ({
    pitch: pitchAt(board, stringIndex, fret)!,
    position: { string: stringIndex, fret },
    ...extra,
  }) as NoteEvent;

function build(
  lane: MelodicSlot[],
  options: { readonly fretboard?: Fretboard } = {},
): Song {
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks
      .filter((track) => track.id === TRACK)
      .map((track) =>
        options.fretboard ? { ...track, fretboard: options.fretboard } : track,
      ),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
      },
    ],
  } satisfies Song);
}

/** Two notes a tone apart on one string, adjacent. */
function pairSong(): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [at(2, 5)] };
  lane[1] = "-";
  lane[2] = { notes: [at(2, 7)] };
  return build(lane);
}

type GestureCommand = Parameters<typeof applyGestureWrite>[1];

const write = (
  song: Song,
  command: Omit<GestureCommand, "sectionId" | "trackId">,
) => applyGestureWrite(song, { sectionId: SECTION, trackId: TRACK, ...command });

const noteAt = (song: Song, slot: number): NoteEvent => {
  const entry = (song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[])[slot];
  if (!entry || entry === "-") throw new Error("no note there");
  return entry.notes[0]!;
};

describe("91. a gesture is written onto a note that exists", () => {
  it("puts a bend on the note the reader pointed at", () => {
    const result = write(pairSong(), {
      timeTicks: 0,
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    if (!result.ok) throw new Error(result.message);
    expect(noteAt(result.song, 0).pitchGesture).toEqual({
      kind: "bend",
      targetCents: 200,
    });
    /* And nowhere else. */
    expect(noteAt(result.song, 2).pitchGesture).toBeUndefined();
  });

  it("joins the second note to the first with either slide", () => {
    for (const kind of ["legato_slide", "shift_slide"] as const) {
      const result = write(pairSong(), { timeTicks: 192, connection: { kind } });
      if (!result.ok) throw new Error(result.message);
      expect(noteAt(result.song, 2).connection).toEqual({ kind });
    }
  });

  it("removes a gesture when handed null", () => {
    const first = write(pairSong(), {
      timeTicks: 0,
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    if (!first.ok) throw new Error(first.message);
    const second = write(first.song, { timeTicks: 0, pitchGesture: null });
    if (!second.ok) throw new Error(second.message);
    expect(noteAt(second.song, 0).pitchGesture).toBeUndefined();
    expect(JSON.stringify(second.song)).toBe(JSON.stringify(pairSong()));
  });

  it("changes nothing else in the song", () => {
    const before = pairSong();
    const result = write(before, {
      timeTicks: 0,
      pitchGesture: { kind: "prebend", targetCents: 100 },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.song.tracks).toEqual(before.tracks);
    expect(result.song.sections[0]!.bars[0]!.resolution).toBe(
      before.sections[0]!.bars[0]!.resolution,
    );
    expect(noteAt(result.song, 2)).toEqual(noteAt(before, 2));
  });

  it("is idempotent: the same command twice writes the same song", () => {
    const once = write(pairSong(), {
      timeTicks: 0,
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    if (!once.ok) throw new Error(once.message);
    const twice = write(once.song, {
      timeTicks: 0,
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.error).toBe("no_change");
  });
});

describe("92. every refusal is a sentence, and nothing is written", () => {
  const refusals: readonly {
    readonly name: GestureFailure;
    readonly song: () => Song;
    readonly command: GestureCommand;
  }[] = [
    {
      name: "no_note_here",
      song: pairSong,
      command: {
        sectionId: SECTION,
        trackId: TRACK,
        /* Slot 3 is a written rest: nothing to put a gesture on. */
        timeTicks: 288,
        pitchGesture: { kind: "bend", targetCents: 100 },
      },
    },
    {
      name: "no_previous_note",
      song: pairSong,
      command: {
        sectionId: SECTION,
        trackId: TRACK,
        timeTicks: 0,
        connection: { kind: "legato_slide" },
      },
    },
    {
      name: "previous_note_other_string",
      song: () => {
        /* Something *was* sounding right before, on the wrong string. That is
           a different problem from silence and gets a different sentence. */
        const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
        lane[1] = { notes: [at(1, 5)] };
        lane[2] = { notes: [at(2, 7)] };
        return build(lane);
      },
      command: {
        sectionId: SECTION,
        trackId: TRACK,
        timeTicks: 192,
        connection: { kind: "legato_slide" },
      },
    },
    {
      name: "no_direction",
      song: () => {
        const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
        lane[0] = { notes: [at(2, 7)] };
        lane[1] = "-";
        lane[2] = { notes: [at(2, 7)] };
        return build(lane);
      },
      command: {
        sectionId: SECTION,
        trackId: TRACK,
        timeTicks: 192,
        connection: { kind: "shift_slide" },
      },
    },
    {
      name: "interval_too_wide",
      song: () => {
        const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
        lane[0] = { notes: [at(2, 0)] };
        lane[1] = "-";
        lane[2] = { notes: [at(2, 14)] };
        return build(lane);
      },
      command: {
        sectionId: SECTION,
        trackId: TRACK,
        timeTicks: 192,
        connection: { kind: "legato_slide" },
      },
    },
    {
      name: "target_is_tie_continuation",
      song: pairSong,
      command: {
        sectionId: SECTION,
        trackId: TRACK,
        timeTicks: 96,
        connection: { kind: "legato_slide" },
      },
    },
    {
      name: "conflicting_gesture",
      song: () => {
        const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
        lane[0] = { notes: [at(2, 5, { articulation: "bend_full" })] };
        return build(lane);
      },
      command: {
        sectionId: SECTION,
        trackId: TRACK,
        timeTicks: 0,
        pitchGesture: { kind: "prebend", targetCents: 100 },
      },
    },
  ];

  for (const entry of refusals) {
    it(`refuses "${entry.name}" and leaves the song byte-identical`, () => {
      const before = entry.song();
      const bytes = JSON.stringify(before);
      const result = applyGestureWrite(before, entry.command);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(entry.name);
      expect(result.message).toBe(GESTURE_MESSAGE[entry.name]);
      expect(JSON.stringify(before)).toBe(bytes);
    });
  }

  it("refuses a slide across real silence rather than bridging it", () => {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = { notes: [at(2, 5)] };
    /* Slot 1 is a written rest, not a tie: the string stopped. */
    lane[2] = { notes: [at(2, 7)] };
    const result = write(build(lane), {
      timeTicks: 192,
      connection: { kind: "legato_slide" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("silence_between");
  });

  it("says all of it in words a musician can act on", () => {
    for (const message of Object.values(GESTURE_MESSAGE)) {
      expect(message).toMatch(/\S/u);
      expect(message).not.toMatch(
        /slot|tick|cent|null|undefined|pitchGesture|articulation|_/u,
      );
    }
  });
});

describe("93. the slide's direction comes from the sound, not the fret", () => {
  it("accepts a drop-tuned pair whose fret numbers point the other way", () => {
    /*
     * Drop D: the lowest string sounds a whole tone lower than standard, so
     * fret 7 on it is below fret 5 on the neighbour. A command that read the
     * fret numbers would call this the same direction as standard tuning; one
     * that reads the pitch knows better.
     */
    const dropped: Fretboard = { tuning: [...BOARD.tuning], capo: 0 };
    (dropped.tuning as string[])[0] = "D2";
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = { notes: [at(0, 5, {}, dropped)] };
    lane[1] = "-";
    lane[2] = { notes: [at(0, 7, {}, dropped)] };
    const result = applyGestureWrite(build(lane, { fretboard: dropped }), {
      sectionId: SECTION,
      trackId: TRACK,
      timeTicks: 192,
      connection: { kind: "shift_slide" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(noteAt(result.song, 2).connection).toEqual({ kind: "shift_slide" });
  });

  it("refuses two frets that sound the same note behind a capo", () => {
    const capoed: Fretboard = { tuning: [...BOARD.tuning], capo: 3 };
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = { notes: [at(2, 5, {}, capoed)] };
    lane[1] = "-";
    lane[2] = { notes: [at(2, 5, {}, capoed)] };
    const result = applyGestureWrite(build(lane, { fretboard: capoed }), {
      sectionId: SECTION,
      trackId: TRACK,
      timeTicks: 192,
      connection: { kind: "legato_slide" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no_direction");
  });
});
