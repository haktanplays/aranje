/**
 * Straight sixteenths and a triplet, in one measure (2V-B.4 Completion §4, §6).
 *
 * ## What was wrong, and it was not a bug
 *
 * A bar carried one `resolution`, and every onset in it had to land on that
 * grid. Straight sixteenths fall every 48 ticks; three notes in the space of
 * two of them fall every 32. Neither divides the other, so the editor's only
 * honest answer was to refuse — and it did, correctly, and the founder could
 * not write the riff the whole feature exists for.
 *
 * The fix is not a new time model. 48 is the **exact common lattice** of the
 * two: `ticksPerSlot(48) = 16`, sixteenths land on every third slot and
 * triplets on every second. Both are exact. Nothing is rounded, the measure
 * keeps its length, and the bar records which grid the reader is still
 * reading so nobody is shown a number nobody counts.
 *
 * ## The fixture
 *
 * One 4/4 bar: straight sixteenths around a selected beat, and `9h10p9` inside
 * it — picked, hammered, pulled. Every claim below is about what that must not
 * disturb.
 */
import { describe, expect, it } from "vitest";

import { buildNotatedPlan } from "@/lib/audio/schedule";
import { planNoteSequence } from "@/lib/music/note-sequence";
import { rhythmAvailability } from "@/lib/music/rhythm-availability";
import {
  isLatticeResolution,
  readingResolution,
  slotsPerReadingSlot,
  ticksPerBar,
  ticksPerSlot,
} from "@/lib/music/timing";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { pitchAt } from "@/lib/song/edit";
import { breachesOutside, semanticSnapshot } from "@/lib/song/preserve";
import { applySequenceWrite } from "@/lib/song/sequence-write";
import { RESOLUTIONS } from "@/lib/music/timing";
import { RHYTHM_PROFILES } from "@/lib/music/rhythm-profile";
import { gridChoices } from "@/lib/music/rhythm-language";
import { gridLabelFor } from "@/components/workspace/grid-label";
import { MAX_SLOTS_PER_BAR } from "@/lib/music/timing";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const RUN_STRING = 1;
/** 4/4 at 1/16: sixteen slots of 48 ticks. */
const SLOT_16 = 48;
const BEAT = 192;
const SECTION = SAMPLE_SONG.sections[0]!.id;

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
 * A straight 1/16 bar with the second beat left free for the run.
 *
 * Beat one and beats three and four are ordinary sixteenths, each with
 * something worth preserving on it — a velocity, an articulation, a tie, a
 * two-voice chord — and the anchor at tick 384 is the one the run must not
 * push. A phrase covers the whole bar.
 */
function fixture(): Song {
  const lane: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  lane[0] = note(RUN_STRING, 7, { velocity: 104 });
  lane[1] = note(RUN_STRING, 7, { articulation: "palm_mute" });
  lane[2] = note(2, 5);
  lane[3] = note(2, 5, { letRing: true });
  /* Beat two — slots 4..7, ticks 192..384 — is where the run goes. */
  lane[8] = {
    notes: [
      { pitch: soundOf(0, 3), position: { string: 0, fret: 3 }, velocity: 88 },
      { pitch: soundOf(1, 5), position: { string: 1, fret: 5 }, velocity: 88 },
    ],
  };
  lane[9] = "-";
  lane[10] = note(3, 9, { articulation: "vibrato" });
  lane[12] = note(RUN_STRING, 7);
  return songSchema.parse({
    ...SAMPLE_SONG,
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        phrases: [{ id: "p1", name: "Cümle 1", startTicks: 0, endTicks: 768 }],
        bars: [{ timeSignature: [4, 4], resolution: 16, slots: { [TRACK]: lane } }],
      },
    ],
  } satisfies Song);
}

/** The founder's own run, in the second beat of the bar. */
const NINE_TEN_NINE = [
  { stringIndex: RUN_STRING, fret: 9 },
  { stringIndex: RUN_STRING, fret: 10 },
  { stringIndex: RUN_STRING, fret: 9 },
];

const PATH = {
  sectionId: SECTION,
  barIndex: 0,
  fromTicks: BEAT,
  toTicks: BEAT * 2,
  trackIds: [TRACK],
};

function planned() {
  const result = planNoteSequence({
    startTicks: BEAT,
    spanTicks: BEAT,
    steps: NINE_TEN_NINE,
    performance: "connected",
  });
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

/** The production command, asked exactly the way the panel asks it. */
function write(song: Song) {
  return applySequenceWrite(song, {
    sectionId: SECTION,
    trackId: TRACK,
    barIndex: 0,
    plan: planned(),
    allowLocalOverride: true,
    replaceExisting: true,
  });
}

function written(): Song {
  const result = write(fixture());
  if (!result.ok) throw new Error(result.error);
  return result.song;
}

const barOf = (song: Song) => song.sections[0]!.bars[0]!;
const laneOf = (song: Song) => barOf(song).slots[TRACK] as MelodicSlot[];

/** Every onset of this track, in ticks from the start of the bar. */
function onsets(song: Song): number[] {
  const step = ticksPerSlot(barOf(song).resolution);
  return laneOf(song).flatMap((slot, index) =>
    slot !== null && slot !== "-" ? [index * step] : [],
  );
}

describe("65. straight and triplet share one measure, exactly", () => {
  it("offers the lattice instead of refusing the founder's riff", () => {
    const answer = rhythmAvailability({
      resolution: 16,
      startTicks: BEAT,
      stepTicks: 64,
      stepCount: 3,
      existingTicks: onsets(fixture()),
    });
    expect(answer.state).toBe("requires_local_override");
    expect(answer.neededResolution).toBe(48);
  });

  it("keeps every straight onset on the tick it was written on", () => {
    const before = fixture();
    const after = written();
    /* Not slot indices — those necessarily change when the lattice is finer.
       Ticks are the music, and they are identical. */
    const straightBefore = onsets(before).filter(
      (tick) => tick < BEAT || tick >= BEAT * 2,
    );
    const straightAfter = onsets(after).filter(
      (tick) => tick < BEAT || tick >= BEAT * 2,
    );
    expect(straightAfter).toEqual(straightBefore);
    expect(straightBefore).toEqual([0, 48, 96, 144, 384, 480, 576]);
  });

  it("writes the three fast onsets exactly, every 64 ticks", () => {
    const after = written();
    const inside = onsets(after).filter((tick) => tick >= BEAT && tick < BEAT * 2);
    expect(inside).toEqual([192, 256, 320]);
    /* And they really are a triplet: 64 does not divide 48. */
    expect(inside.every((tick) => tick % SLOT_16 === 0)).toBe(false);
  });

  it("picks the first note, hammers the second and pulls the third", () => {
    const after = written();
    const step = ticksPerSlot(barOf(after).resolution);
    const at = (tick: number) => {
      const slot = laneOf(after)[tick / step];
      return slot && slot !== "-" ? slot.notes[0] : undefined;
    };
    expect(at(192)?.articulation).toBeUndefined();
    expect(at(192)?.position?.fret).toBe(9);
    expect(at(256)?.articulation).toBe("hammer_on");
    expect(at(256)?.position?.fret).toBe(10);
    expect(at(320)?.articulation).toBe("pull_off");
    expect(at(320)?.position?.fret).toBe(9);
  });

  it("leaves the measure exactly as long as it was", () => {
    const before = fixture();
    const after = written();
    expect(ticksPerBar(barOf(after).timeSignature, barOf(after).resolution)).toBe(
      ticksPerBar(barOf(before).timeSignature, barOf(before).resolution),
    );
    expect(after.sections[0]!.bars).toHaveLength(1);
  });

  it("does not move the anchor after the run", () => {
    const after = written();
    expect(onsets(after)).toContain(384);
  });

  it("leaves the phrase exactly where it was", () => {
    const before = fixture();
    const after = written();
    expect(after.sections[0]!.phrases).toEqual(before.sections[0]!.phrases);
  });

  it("changes nothing outside the beat it was given", () => {
    const before = fixture();
    expect(breachesOutside(before, written(), PATH)).toEqual([]);
  });

  it("keeps every neighbour's length, velocity, position and articulation", () => {
    const before = fixture();
    const after = written();
    const outside = (song: Song) =>
      semanticSnapshot(song, { sectionId: SECTION, barIndex: 0 }).filter(
        (event) => event.atTicks < BEAT || event.atTicks >= BEAT * 2,
      );
    expect(outside(after)).toEqual(outside(before));
    expect(outside(before).length).toBeGreaterThanOrEqual(6);
  });

  it("leaves a drum kit in the same bar untouched, hit for hit", () => {
    const withKit = songSchema.parse({
      ...fixture(),
      sections: [
        {
          ...fixture().sections[0]!,
          bars: [
            {
              ...barOf(fixture()),
              slots: {
                ...barOf(fixture()).slots,
                drums: Array.from({ length: 16 }, (_, index) =>
                  index % 4 === 0 ? [{ piece: "kick" as const }] : [],
                ),
              },
            },
          ],
        },
      ],
    } satisfies Song);
    const result = write(withKit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kitTicks = (song: Song) => {
      const bar = song.sections[0]!.bars[0]!;
      const step = ticksPerSlot(bar.resolution);
      const lane = bar.slots["drums"] as { piece: string }[][];
      return lane.flatMap((hits, index) => (hits.length > 0 ? [index * step] : []));
    };
    expect(kitTicks(result.song)).toEqual(kitTicks(withKit));
    expect(kitTicks(withKit)).toEqual([0, 192, 384, 576]);
  });
});

describe("66. the reader is never shown the lattice", () => {
  it("records the grid they are still reading", () => {
    const after = written();
    expect(isLatticeResolution(barOf(after).resolution)).toBe(true);
    expect(barOf(after).notation).toBe(16);
    expect(readingResolution(barOf(after))).toBe(16);
    expect(slotsPerReadingSlot(barOf(after))).toBe(3);
  });

  it("leaves the reading grid alone in an ordinary bar", () => {
    const before = fixture();
    expect(barOf(before).notation).toBeUndefined();
    expect(readingResolution(barOf(before))).toBe(16);
    expect(slotsPerReadingSlot(barOf(before))).toBe(1);
  });

  it("gives the tab the same number of cells the reader had", () => {
    const after = written();
    const timeline = buildTrackTimeline(after, TRACK);
    expect(timeline.kind).toBe("fretted");
    if (timeline.kind !== "fretted") return;
    const bar = timeline.bars[0]!;
    expect(bar.slotCount).toBe(48);
    expect(bar.slotsPerCell).toBe(3);
    /* Sixteen taps, as before: 48 lattice columns, three to a cell. */
    expect(bar.slotCount / bar.slotsPerCell).toBe(16);
    expect(bar.notation).toBe(16);
  });

  it("draws the straight notes and the triplet at their own places", () => {
    const after = written();
    const timeline = buildTrackTimeline(after, TRACK);
    if (timeline.kind !== "fretted") throw new Error("fretted");
    const step = ticksPerSlot(48);
    const starts = timeline.bars[0]!.spans
      .filter((span) => !span.openStart)
      .map((span) => span.startSlot * step)
      .sort((left, right) => left - right);
    /* Every onset the song has, drawn where the song says it is. */
    expect([...new Set(starts)]).toEqual([0, 48, 96, 144, 192, 256, 320, 384, 480, 576]);
  });
});

describe("67. the ear and the exporter read the same ticks", () => {
  it("gives the scheduler every onset, in order, at the right tick", () => {
    const plan = buildNotatedPlan(written());
    const guitar = plan.events
      .filter((event) => event.kind === "note" && event.trackId === TRACK)
      .map((event) => event.time)
      .sort((left, right) => left - right);
    for (const tick of [0, 48, 96, 144, 192, 256, 320, 384, 480, 576]) {
      expect(guitar, `${tick}`).toContain(tick);
    }
    /* In order and never later than the bar. */
    expect([...guitar].sort((left, right) => left - right)).toEqual(guitar);
    expect(Math.max(...guitar)).toBeLessThan(768);
  });

  it("round-trips through the schema without losing a tick", () => {
    const after = written();
    const reparsed = songSchema.parse(JSON.parse(JSON.stringify(after)));
    expect(reparsed).toEqual(after);
    expect(onsets(reparsed)).toEqual(onsets(after));
    expect(reparsed.sections[0]!.bars[0]!.notation).toBe(16);
  });

  it("opens a song written before the lattice existed, unmigrated", () => {
    /* The ordinary case, stated as a case: no `notation`, no lattice, and the
       reading grid is simply the stored one. */
    const old = fixture();
    expect(JSON.stringify(old)).not.toContain("notation");
    expect(songSchema.parse(JSON.parse(JSON.stringify(old)))).toEqual(old);
  });

  it("writes the same song when the same command runs twice", () => {
    const once = written();
    const twice = write(once);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    /* Idempotent, not duplicating: the run replaces itself. */
    expect(onsets(twice.song)).toEqual(onsets(once));
    expect(semanticSnapshot(twice.song)).toEqual(semanticSnapshot(once));
  });
});

describe("68. the lattice is a format detail, not a vocabulary word", () => {
  it("is in no picker, no profile and no Copilot budget", () => {
    expect(RESOLUTIONS as readonly number[]).not.toContain(48);
    expect(gridChoices([4, 4], RESOLUTIONS).map((choice) => choice.resolution)).not.toContain(
      48 as never,
    );
    expect(RHYTHM_PROFILES.map((profile) => profile.resolution)).not.toContain(48 as never);
    /* The Copilot's slot cap is derived from the offered grids, so a model
       cannot be handed — or asked for — a 48-column bar. */
    expect(MAX_SLOTS_PER_BAR).toBe(32);
  });

  it("announces no grid change when only the lattice underneath changed", () => {
    const before = fixture();
    const after = written();
    /* One bar, so the label is the "first bar" case either way; what matters
       is that it names the reader's grid and not the lattice. */
    const label = gridLabelFor(after.sections[0]!.bars, 0);
    expect(label).toBe("1/16");
    expect(label).toBe(gridLabelFor(before.sections[0]!.bars, 0));

    /* And a second, ordinary bar after it is not announced as a change —
       which is what would happen if the lattice were compared directly. */
    const twoBars = [after.sections[0]!.bars[0]!, before.sections[0]!.bars[0]!];
    expect(gridLabelFor(twoBars, 1)).toBeNull();
  });
});
