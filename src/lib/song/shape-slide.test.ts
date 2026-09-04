/**
 * Two strings moving as one hand (2V-C.3 §9, §10, §14).
 *
 * The model's whole claim is that a shape slide is *derivable* — that nothing
 * about the gesture needs storing beyond what the notes already say. So most
 * of this file is that claim being attacked: does it still hold after an
 * edit, does it refuse the things a hand cannot do, and does a refusal leave
 * the song exactly as it was.
 */
import { describe, expect, it } from "vitest";

import {
  shapeSlideAt,
  shapeCandidateStrings,
  shapeSummary,
  MAX_SHAPE_STRINGS,
} from "@/lib/song/shape-slide";
import { applyShapeSlide } from "@/lib/song/shape-slide-write";
import {
  songSchema,
  type MelodicSlot,
  type NoteConnection,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const SECTION = SAMPLE_SONG.sections[0]!.id;
const AT = { sectionId: SECTION, trackId: TRACK, targetTicks: 96 };

const note = (
  string: number,
  fret: number,
  pitch: string,
  extra: Partial<NoteEvent> = {},
): NoteEvent => ({ pitch, position: { string, fret }, ...extra }) as NoteEvent;

/**
 * A double stop that moves. `slide` says what each target string carries;
 * pass `undefined` for a string that carries nothing.
 */
function shape(
  from: readonly (readonly [number, number, string])[],
  to: readonly (readonly [number, number, string])[],
  slide: readonly (NoteConnection | undefined)[],
): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: from.map(([s, f, p]) => note(s, f, p)) };
  lane[1] = {
    notes: to.map(([s, f, p], index) => {
      const connection = slide[index];
      return note(s, f, p, connection === undefined ? {} : { connection });
    }),
  };
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

const SHIFT: NoteConnection = { kind: "shift_slide" };
const LEGATO: NoteConnection = { kind: "legato_slide" };

/** Two strings, a whole tone up, both shifting. The happy case. */
const twoUp = () =>
  shape(
    [
      [2, 5, "G3"],
      [3, 5, "C4"],
    ],
    [
      [2, 7, "A3"],
      [3, 7, "D4"],
    ],
    [SHIFT, SHIFT],
  );

describe("112. a shape slide is derived from the notes, not stored beside them", () => {
  it("reads two strings moving together as one gesture", () => {
    const found = shapeSlideAt(twoUp(), AT);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.plan.voices).toHaveLength(2);
    expect(found.plan.intervalSemitones).toBe(2);
    expect(found.plan.rising).toBe(true);
    expect(found.plan.kind).toBe("shift_slide");
    expect(found.plan.sourceTicks).toBe(0);
    expect(found.plan.targetTicks).toBe(96);
  });

  it("orders its voices, so two derivations of one shape compare equal", () => {
    const a = shapeSlideAt(twoUp(), AT);
    const b = shapeSlideAt(twoUp(), AT);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.plan).toEqual(b.plan);
    expect(a.plan.voices.map((voice) => voice.stringIndex)).toEqual([2, 3]);
  });

  it("still derives the whole shape after one string is edited", () => {
    /* The argument against a stored group id: if the shape survives being
       re-read after a change, nothing needed remembering. */
    const written = applyShapeSlide(twoUp(), { ...AT, connection: LEGATO });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const found = shapeSlideAt(written.song, AT);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.plan.kind).toBe("legato_slide");
    expect(found.plan.voices).toHaveLength(2);
  });

  it("speaks it as a hand movement, with no index or number of ours", () => {
    const found = shapeSlideAt(twoUp(), AT);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const said = shapeSummary(found.plan);
    expect(said).toBe("2 tel birlikte yukarı kayacak");
    expect(said).not.toMatch(/cent|slide|string|index|slot/i);
  });

  it("counts what could move before anything is written", () => {
    const plain = shape(
      [
        [2, 5, "G3"],
        [3, 5, "C4"],
      ],
      [
        [2, 7, "A3"],
        [3, 7, "D4"],
      ],
      [undefined, undefined],
    );
    expect(shapeCandidateStrings(plain, AT)).toBe(2);
    expect(shapeSlideAt(plain, AT).ok).toBe(false);
  });

  it("is not a shape when only one string slides", () => {
    const one = shape(
      [
        [2, 5, "G3"],
        [3, 5, "C4"],
      ],
      [
        [2, 7, "A3"],
        [3, 7, "D4"],
      ],
      [SHIFT, undefined],
    );
    const found = shapeSlideAt(one, AT);
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.reason).toBe("not_a_shape");
  });
});

describe("113. a hand cannot do these, so the gesture refuses them", () => {
  const cases: readonly {
    readonly name: string;
    readonly reason: string;
    readonly song: () => Song;
  }[] = [
    {
      name: "the two sides are different strings",
      reason: "string_set_differs",
      song: () =>
        shape(
          [
            [2, 5, "G3"],
            [3, 5, "C4"],
          ],
          [
            [2, 7, "A3"],
            [4, 7, "G4"],
          ],
          [SHIFT, SHIFT],
        ),
    },
    {
      name: "a moving string is open",
      reason: "open_string_moving",
      song: () =>
        shape(
          [
            [2, 0, "D3"],
            [3, 5, "C4"],
          ],
          [
            [2, 2, "E3"],
            [3, 7, "D4"],
          ],
          [SHIFT, SHIFT],
        ),
    },
    {
      name: "the strings travel different distances",
      reason: "shape_not_preserved",
      song: () =>
        shape(
          [
            [2, 5, "G3"],
            [3, 5, "C4"],
          ],
          [
            [2, 7, "A3"],
            [3, 8, "D#4"],
          ],
          [SHIFT, SHIFT],
        ),
    },
    {
      name: "the strings travel in different directions",
      reason: "shape_not_preserved",
      song: () =>
        shape(
          [
            [2, 5, "G3"],
            [3, 5, "C4"],
          ],
          [
            [2, 7, "A3"],
            [3, 3, "A#3"],
          ],
          [SHIFT, SHIFT],
        ),
    },
    {
      name: "one string legato and the other struck",
      reason: "mixed_connection_kinds",
      song: () =>
        shape(
          [
            [2, 5, "G3"],
            [3, 5, "C4"],
          ],
          [
            [2, 7, "A3"],
            [3, 7, "D4"],
          ],
          [LEGATO, SHIFT],
        ),
    },
    {
      name: "a string appears only on the target side",
      reason: "string_set_differs",
      song: () =>
        shape(
          [[2, 5, "G3"]],
          [
            [2, 7, "A3"],
            [3, 7, "D4"],
          ],
          [SHIFT, SHIFT],
        ),
    },
    {
      name: "a string is missing from the target side",
      reason: "string_set_differs",
      song: () =>
        shape(
          [
            [2, 5, "G3"],
            [3, 5, "C4"],
            [4, 5, "F4"],
          ],
          [
            [2, 7, "A3"],
            [3, 7, "D4"],
          ],
          [SHIFT, SHIFT],
        ),
    },
  ];

  for (const entry of cases) {
    it(`refuses when ${entry.name}`, () => {
      const found = shapeSlideAt(entry.song(), AT);
      expect(found.ok).toBe(false);
      if (found.ok) return;
      expect(found.reason).toBe(entry.reason);
      /* Musician language, and no internal word. */
      expect(found.message.length).toBeGreaterThan(0);
      expect(found.message).not.toMatch(/slide|string|cent|index|null/i);
    });
  }

  it("holds a hand to six strings", () => {
    expect(MAX_SHAPE_STRINGS).toBe(6);
  });
});

describe("114. all strings or none", () => {
  it("writes every string in one go", () => {
    const before = twoUp();
    const result = applyShapeSlide(before, { ...AT, connection: LEGATO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strings).toBe(2);
    const slot = result.song.sections[0]!.bars[0]!.slots[TRACK]![1] as {
      notes: NoteEvent[];
    };
    expect(slot.notes.every((entry) => entry.connection?.kind === "legato_slide")).toBe(
      true,
    );
  });

  it("removes every string in one go", () => {
    const written = applyShapeSlide(twoUp(), { ...AT, connection: null });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const slot = written.song.sections[0]!.bars[0]!.slots[TRACK]![1] as {
      notes: NoteEvent[];
    };
    expect(slot.notes.every((entry) => entry.connection === undefined)).toBe(true);
    expect(shapeSlideAt(written.song, AT).ok).toBe(false);
  });

  it("leaves the song byte-identical when one string cannot take it", () => {
    /* The open string is the second voice, so the first would succeed if the
       command wrote as it went. It must not. */
    const before = shape(
      [
        [2, 5, "G3"],
        [3, 0, "G3"],
      ],
      [
        [2, 7, "A3"],
        [3, 2, "A3"],
      ],
      [undefined, undefined],
    );
    const snapshot = JSON.stringify(before);
    const result = applyShapeSlide(before, { ...AT, connection: SHIFT });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("open_string_moving");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("refuses the whole gesture when the shape would not be preserved", () => {
    const before = shape(
      [
        [2, 5, "G3"],
        [3, 5, "C4"],
      ],
      [
        [2, 7, "A3"],
        [3, 9, "E4"],
      ],
      [undefined, undefined],
    );
    const snapshot = JSON.stringify(before);
    const result = applyShapeSlide(before, { ...AT, connection: SHIFT });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("shape_not_preserved");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("touches nothing but the connection of the moving notes", () => {
    const before = twoUp();
    const result = applyShapeSlide(before, { ...AT, connection: LEGATO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const strip = (song: Song) =>
      JSON.stringify(song, (key, value) => (key === "connection" ? undefined : value));
    expect(strip(result.song)).toBe(strip(before));
  });

  it("comes back byte-exact after being written and removed", () => {
    const before = shape(
      [
        [2, 5, "G3"],
        [3, 5, "C4"],
      ],
      [
        [2, 7, "A3"],
        [3, 7, "D4"],
      ],
      [undefined, undefined],
    );
    const snapshot = JSON.stringify(before);
    const written = applyShapeSlide(before, { ...AT, connection: SHIFT });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const removed = applyShapeSlide(written.song, { ...AT, connection: null });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(JSON.stringify(removed.song)).toBe(snapshot);
  });

  it("keeps accents, bends and velocities on the moving notes", () => {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = {
      notes: [note(2, 5, "G3"), note(3, 5, "C4")],
    };
    lane[1] = {
      notes: [
        note(2, 7, "A3", { articulation: "accent", velocity: 110 }),
        note(3, 7, "D4", { pitchGesture: { kind: "bend", targetCents: 100 } }),
      ],
    };
    const before = songSchema.parse({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
      sections: [
        {
          ...SAMPLE_SONG.sections[0]!,
          bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);
    const result = applyShapeSlide(before, { ...AT, connection: SHIFT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.song.sections[0]!.bars[0]!.slots[TRACK]![1] as {
      notes: NoteEvent[];
    };
    expect(slot.notes[0]?.articulation).toBe("accent");
    expect(slot.notes[0]?.velocity).toBe(110);
    expect(slot.notes[1]?.pitchGesture).toEqual({ kind: "bend", targetCents: 100 });
  });

  it("says nothing changed rather than writing the same thing twice", () => {
    const plain = shape(
      [
        [2, 5, "G3"],
        [3, 5, "C4"],
      ],
      [
        [2, 7, "A3"],
        [3, 7, "D4"],
      ],
      [undefined, undefined],
    );
    const once = applyShapeSlide(plain, { ...AT, connection: SHIFT });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyShapeSlide(once.song, { ...AT, connection: SHIFT });
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.reason).toBe("no_change");
  });
});
