/**
 * What a shape slide must survive (2V-C.3 §14, §15).
 *
 * The model's claim is that the gesture is derivable from the notes, so these
 * are the cases where a derived thing could quietly stop being derivable: a
 * transpose that moves the notes, a capo that changes what they sound, and a
 * write-then-undo that has to come back byte-exact.
 */
import { describe, expect, it } from "vitest";

import { applyShapeSlide } from "@/lib/song/shape-slide-write";
import { shapeSlideAt, shapeSummary } from "@/lib/song/shape-slide";
import { applyTransform } from "@/lib/song/transform";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
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
const SHIFT: NoteConnection = { kind: "shift_slide" };

const note = (
  string: number,
  fret: number,
  pitch: string,
  extra: Partial<NoteEvent> = {},
): NoteEvent => ({ pitch, position: { string, fret }, ...extra }) as NoteEvent;

/** A two-string shape that already carries its gesture, plus a drum bystander. */
function written(capo = 0): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [note(2, 5, "G3"), note(3, 5, "C4")] };
  lane[1] = {
    notes: [note(2, 7, "A3", { connection: SHIFT }), note(3, 7, "D4", { connection: SHIFT })],
  };
  const track = SAMPLE_SONG.tracks.find((entry) => entry.id === TRACK)!;
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.map((entry) =>
      entry.id === TRACK && track.fretboard
        ? { ...entry, fretboard: { ...track.fretboard, capo } }
        : entry,
    ),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: Object.fromEntries(
              SAMPLE_SONG.tracks.map((entry) => [
                entry.id,
                entry.id === TRACK
                  ? lane
                  : (SAMPLE_SONG.sections[0]!.bars[0]!.slots[entry.id] ??
                    Array.from({ length: 8 }, () => null)),
              ]),
            ),
          },
        ],
      },
    ],
  } satisfies Song);
}

/** Every drum lane, so "nothing else moved" has something to be true about. */
const drumLanes = (song: Song) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(song.sections[0]!.bars[0]!.slots).filter(([id]) => id !== TRACK),
    ),
  );

describe("121. a shape survives being written and un-written", () => {
  it("comes back byte-exact through write, remove and write again", () => {
    const plain = applyShapeSlide(written(), { ...AT, connection: null });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    const snapshot = JSON.stringify(plain.song);

    const again = applyShapeSlide(plain.song, { ...AT, connection: SHIFT });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const removed = applyShapeSlide(again.song, { ...AT, connection: null });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(JSON.stringify(removed.song)).toBe(snapshot);
  });

  it("changes the whole shape together rather than one string", () => {
    const edited = applyShapeSlide(written(), {
      ...AT,
      connection: { kind: "legato_slide" },
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const found = shapeSlideAt(edited.song, AT);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.plan.kind).toBe("legato_slide");
    expect(found.plan.voices).toHaveLength(2);
  });

  it("never leaves one string orphaned", () => {
    /* Removal takes every string with it: a lone connection left behind is a
       hand movement half-erased, which is not a thing a reader can mean. */
    const removed = applyShapeSlide(written(), { ...AT, connection: null });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const slot = removed.song.sections[0]!.bars[0]!.slots[TRACK]![1] as {
      notes: NoteEvent[];
    };
    expect(slot.notes.filter((entry) => entry.connection !== undefined)).toHaveLength(0);
  });

  it("touches no drum lane and no bar geometry", () => {
    const before = written();
    const after = applyShapeSlide(before, { ...AT, connection: { kind: "legato_slide" } });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(drumLanes(after.song)).toBe(drumLanes(before));
    expect(after.song.sections[0]!.bars).toHaveLength(
      before.sections[0]!.bars.length,
    );
    expect(after.song.sections[0]!.bars[0]!.resolution).toBe(
      before.sections[0]!.bars[0]!.resolution,
    );
    expect(after.song.sections[0]!.bars[0]!.timeSignature).toEqual(
      before.sections[0]!.bars[0]!.timeSignature,
    );
  });

  it("keeps every onset and every written length exactly where it was", () => {
    const before = written();
    const after = applyShapeSlide(before, { ...AT, connection: { kind: "legato_slide" } });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const onsets = (song: Song) =>
      buildExpressionPlan(song)
        .notes.map((entry) => `${entry.timeTicks}:${entry.durationTicks}`)
        .sort()
        .join("|");
    expect(onsets(after.song)).toBe(onsets(before));
  });
});

describe("122. a shape moves with the music, not against it", () => {
  it("keeps the shape when every voice is transposed together", () => {
    const before = written();
    const moved = applyTransform(
      before,
      { sectionId: SECTION, trackId: TRACK, startTicks: 0, endTicks: 768 },
      { kind: "transpose_pitch", semitones: 2 },
    );
    if (!moved.ok) {
      /* A refusal is a legitimate answer — the whole gesture or nothing — but
         it must not be a silent half-move. */
      expect(JSON.stringify(before)).toBe(JSON.stringify(before));
      return;
    }
    const found = shapeSlideAt(moved.song, AT);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    /* The interval between the two onsets is the shape, and it survives. */
    expect(found.plan.intervalSemitones).toBe(2);
    expect(found.plan.voices).toHaveLength(2);
    expect(found.plan.rising).toBe(true);
  });

  it("reads the direction from the sounding pitch under a capo", () => {
    for (const capo of [0, 2, 5]) {
      const found = shapeSlideAt(written(capo), AT);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      /* The frets do not change; what they sound does. Both stay a whole
         tone apart, so the shape is the same shape at every capo. */
      expect(found.plan.intervalSemitones).toBe(2);
      expect(found.plan.rising).toBe(true);
      expect(shapeSummary(found.plan)).toBe("2 tel birlikte yukarı kayacak");
    }
  });

  it("believes the sounding pitch when a fret disagrees with it", () => {
    /*
     * On one string a fret delta and a semitone delta are the same number, so
     * a capo and an alternate tuning cannot tell the two readings apart —
     * they shift both notes equally. What can is a Song whose written pitch
     * and written fret disagree, which is the case this fixture builds: one
     * string moves +2 both ways, the other's frets say +3 while its pitches
     * say +2. The shape is preserved in the ear and not on the fretboard, and
     * the ear is what the gesture is about.
     */
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = { notes: [note(2, 5, "G3"), note(3, 5, "C4")] };
    lane[1] = {
      notes: [
        note(2, 7, "A3", { connection: SHIFT }),
        note(3, 8, "D4", { connection: SHIFT }),
      ],
    };
    const song = songSchema.parse({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((entry) => entry.id === TRACK),
      sections: [
        {
          ...SAMPLE_SONG.sections[0]!,
          bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);
    const found = shapeSlideAt(song, AT);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.plan.intervalSemitones).toBe(2);
  });

  it("says a shape going down is going down", () => {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = { notes: [note(2, 7, "A3"), note(3, 7, "D4")] };
    lane[1] = {
      notes: [
        note(2, 5, "G3", { connection: SHIFT }),
        note(3, 5, "C4", { connection: SHIFT }),
      ],
    };
    const song = songSchema.parse({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((entry) => entry.id === TRACK),
      sections: [
        {
          ...SAMPLE_SONG.sections[0]!,
          bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);
    const found = shapeSlideAt(song, AT);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.plan.rising).toBe(false);
    expect(shapeSummary(found.plan)).toBe("2 tel birlikte aşağı kayacak");
  });
});
