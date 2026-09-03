/**
 * What an edit is allowed to touch, inside the bar it touches (2V-B.4 §9).
 *
 * `c11a758` proved a fast sequence leaves the *next* note and the *other*
 * measures alone. That is the easy half. The hard half is the measure the run
 * is written into, where an edit that quietly rewrote a neighbour would look
 * exactly like an edit that did not — the bar is still one bar long, the next
 * anchor is still where it was, and nothing downstream would complain.
 *
 * So the contract is stated as a *path*: the edit declares the ticks and the
 * tracks it is about, and every sounding event outside that path — onset,
 * length, pitch, string, fret, velocity, tie, articulation, let-ring, chord
 * membership — has to come out byte-identical. `breachesOutside` names the
 * ones that did not.
 */
import { describe, expect, it } from "vitest";

import {
  breachesOutside,
  semanticSnapshot,
  structureDigest,
  trackDigest,
} from "@/lib/song/preserve";
import { applySequenceWrite } from "@/lib/song/sequence-write";
import { planNoteSequence } from "@/lib/music/note-sequence";
import { pitchAt } from "@/lib/song/edit";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const RUN_STRING = 1;
const SLOT_8 = 96;
const FRETBOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
const soundOf = (stringIndex: number, fret: number) =>
  pitchAt(FRETBOARD, stringIndex, fret)!;

const note = (stringIndex: number, fret: number, extra: object = {}) => ({
  notes: [
    {
      pitch: soundOf(stringIndex, fret),
      position: { string: stringIndex, fret },
      ...extra,
    },
  ],
});

/**
 * One bar, crowded on purpose.
 *
 * Slot 0 is where the run goes. Everything after it is a different kind of
 * thing the edit must not disturb: a plain note, a held note with its tie, a
 * two-voice chord, an articulated note and a note with a velocity of its own.
 */
function crowdedBar(): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[1] = note(RUN_STRING, 7);
  lane[2] = note(2, 5, { velocity: 40 });
  lane[3] = "-";
  lane[4] = {
    notes: [
      { pitch: soundOf(0, 3), position: { string: 0, fret: 3 } },
      { pitch: soundOf(1, 5), position: { string: 1, fret: 5 } },
    ],
  };
  lane[5] = note(2, 7, { articulation: "hammer_on" });
  lane[6] = note(3, 9, { letRing: true });
  return songSchema.parse({
    ...SAMPLE_SONG,
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } },
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: Array.from({ length: 8 }, () => null) } },
        ],
      },
    ],
  } satisfies Song);
}

const PATH = {
  sectionId: SAMPLE_SONG.sections[0]!.id,
  barIndex: 0,
  fromTicks: 0,
  toTicks: SLOT_8,
  trackIds: [TRACK],
};

function writeRun(song: Song): Song {
  const planned = planNoteSequence({
    startTicks: 0,
    spanTicks: SLOT_8,
    steps: [
      { stringIndex: RUN_STRING, fret: 9 },
      { stringIndex: RUN_STRING, fret: 10 },
      { stringIndex: RUN_STRING, fret: 9 },
    ],
    performance: "connected",
  });
  if (!planned.ok) throw new Error(planned.reason);
  const written = applySequenceWrite(song, {
    sectionId: PATH.sectionId,
    trackId: TRACK,
    barIndex: 0,
    plan: planned.plan,
    /* Three notes in an eighth need a finer local grid, which is the whole
       point: the regrid is what could disturb the neighbours (§8, §9). */
    allowLocalOverride: true,
  });
  if (!written.ok) throw new Error(written.error);
  return written.song;
}

describe("47. the same bar's other events survive a fast sequence", () => {
  it("changes nothing outside the ticks it declared", () => {
    const before = crowdedBar();
    const after = writeRun(before);
    expect(breachesOutside(before, after, PATH)).toEqual([]);
  });

  it("really did write something inside them", () => {
    /* The vacuity check. A preservation proof over an edit that did nothing
       proves nothing, so the claim above is only worth having beside this. */
    const before = crowdedBar();
    const after = writeRun(before);
    const inside = (song: Song) =>
      semanticSnapshot(song, { sectionId: PATH.sectionId, barIndex: 0 }).filter(
        (event) => event.atTicks < SLOT_8,
      );
    expect(inside(before)).toHaveLength(0);
    expect(inside(after)).toHaveLength(3);
  });

  it("keeps the crowded neighbours event for event", () => {
    const before = crowdedBar();
    const after = writeRun(before);
    const outside = (song: Song) =>
      semanticSnapshot(song, { sectionId: PATH.sectionId, barIndex: 0 }).filter(
        (event) => event.atTicks >= SLOT_8,
      );
    expect(outside(after)).toEqual(outside(before));
    /* Five written things: the plain note, the velocity note, the tied run,
       the two-voice chord, the articulated note and the let-ring note. */
    expect(outside(before).length).toBeGreaterThanOrEqual(5);
  });

  it("leaves the bar and track metadata alone but for the grid it declared", () => {
    const before = crowdedBar();
    const after = writeRun(before);
    const allowed = { sectionId: PATH.sectionId, barIndex: 0 };
    expect(structureDigest(after, allowed)).toBe(structureDigest(before, allowed));
    expect(trackDigest(after)).toBe(trackDigest(before));
    /* And the local override really did happen, so the line above is not
       forgiving something that never occurred. */
    expect(after.sections[0]!.bars[0]!.resolution).not.toBe(
      before.sections[0]!.bars[0]!.resolution,
    );
    expect(after.sections[0]!.bars[1]!.resolution).toBe(
      before.sections[0]!.bars[1]!.resolution,
    );
  });

  it("names the event when something outside the path does move", () => {
    /*
     * The negative control. Without it, `breachesOutside` returning `[]`
     * could mean "nothing moved" or "this function always says that".
     */
    const before = crowdedBar();
    const tampered = structuredClone(before) as Song;
    const lane = tampered.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
    lane[2] = note(2, 6, { velocity: 40 });
    const breaches = breachesOutside(before, tampered, PATH);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.reason).toBe("changed");
    expect(breaches[0]?.event.atTicks).toBe(2 * SLOT_8);
  });

  it("notices a removal and an addition too", () => {
    const before = crowdedBar();
    const removed = structuredClone(before) as Song;
    (removed.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[])[5] = null;
    expect(breachesOutside(before, removed, PATH).map((entry) => entry.reason)).toEqual([
      "removed",
    ]);

    const added = structuredClone(before) as Song;
    (added.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[])[7] = note(0, 2);
    expect(breachesOutside(before, added, PATH).map((entry) => entry.reason)).toEqual([
      "added",
    ]);
  });

  it("sees a change of resolution as the structural change it is", () => {
    const before = crowdedBar();
    const denser = structuredClone(before) as Song;
    denser.sections[0]!.bars[0] = { ...denser.sections[0]!.bars[0]!, resolution: 16 };
    expect(structureDigest(denser)).not.toBe(structureDigest(before));
    /* And is forgiven exactly where the caller said a local override happened. */
    expect(
      structureDigest(denser, { sectionId: PATH.sectionId, barIndex: 0 }),
    ).toBe(structureDigest(before, { sectionId: PATH.sectionId, barIndex: 0 }));
  });
});
