/**
 * The `9–10–9` acceptance fixture, and the rules it stands for (2V-B.3).
 *
 * The founder's reference is three notes played faster than what surrounds
 * them, joined by a hammer-on and a pull-off. Every claim below is about what
 * that must *not* disturb — because the whole risk of "make this bit faster"
 * is that it quietly lengthens the measure, pushes the next note, or rewrites
 * the grid under music the reader never touched.
 *
 * `9–10–9` is the fixture, not the feature: the same command is asked for two
 * and four notes, on other strings, with and without a connection.
 */
import { describe, expect, it } from "vitest";

import {
  connectionBetween,
  densityExplanation,
  planNoteSequence,
  spanTicksFor,
  type SequenceStep,
} from "@/lib/music/note-sequence";
import {
  LOCAL_OVERRIDE_ACTION,
  LOCAL_OVERRIDE_DETAIL,
  rhythmAvailability,
} from "@/lib/music/rhythm-availability";
import { pitchAt } from "@/lib/song/edit";
import { applySequenceWrite } from "@/lib/song/sequence-write";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
/** 4/4 at 1/8: eight slots of 96 ticks. The grid a beginner's bar is on. */
const SLOT_8 = 96;

const FRETBOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
/**
 * The pitch a position really sounds, asked of the same helper the command
 * asks. A fixture that wrote the pitch by hand would be testing whether two
 * people can spell the same note, not whether the run holds.
 */
const soundOf = (stringIndex: number, fret: number) =>
  pitchAt(FRETBOARD, stringIndex, fret)!;

/*
 * The run sits on the A string, where frets 9 and 10 are F#3 and G3 — both in
 * the fixture song's own key. The founder's `9–10–9` is about the shape of the
 * move, and putting it somewhere the song's tonality validator would refuse
 * would be testing the validator instead of the sequence.
 */
const RUN_STRING = 1;

/**
 * A bar with an anchor note after the space the run goes into.
 *
 * Slot 0 is the run's home; slot 1 is the note that must not move. That
 * neighbour is the whole test: a sequence that lengthened its measure or
 * pushed time forward would move it, and nothing else in the bar would say so.
 */
function fixture(): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[1] = {
    notes: [{ pitch: soundOf(RUN_STRING, 9), position: { string: RUN_STRING, fret: 9 } }],
  };
  const song: Song = {
    ...SAMPLE_SONG,
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { [TRACK]: lane },
          },
        ],
      },
    ],
  };
  return songSchema.parse(song);
}

/** The founder's own run: 9 → 10 → 9 on one string. */
const NINE_TEN_NINE: readonly SequenceStep[] = [
  { stringIndex: RUN_STRING, fret: 9 },
  { stringIndex: RUN_STRING, fret: 10 },
  { stringIndex: RUN_STRING, fret: 9 },
];

function plan(steps: readonly SequenceStep[] = NINE_TEN_NINE, spanTicks = SLOT_8) {
  const result = planNoteSequence({
    startTicks: 0,
    spanTicks,
    steps,
    performance: "connected",
  });
  if (!result.ok) throw new Error(`plan refused: ${result.reason}`);
  return result.plan;
}

const laneOf = (song: Song) => song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
const onsetOf = (slot: MelodicSlot | undefined) =>
  slot && slot !== "-" ? slot.notes[0] : undefined;

describe("what the run is, before anything is written (§ fast sequence)", () => {
  it("divides the span it was given and not one tick more", () => {
    const made = plan();
    expect(made.spanTicks).toBe(SLOT_8);
    expect(made.stepTicks).toBe(32);
    expect(made.notes.map((note) => note.timeTicks)).toEqual([0, 32, 64]);
    /* The run ends exactly where the space ended. */
    const last = made.notes[2]!;
    expect(last.timeTicks + last.durationTicks).toBe(SLOT_8);
  });

  it("reads the connection off the fretboard rather than guessing", () => {
    expect(connectionBetween({ stringIndex: 4, fret: 9 }, { stringIndex: 4, fret: 10 })).toBe(
      "hammer_on",
    );
    expect(connectionBetween({ stringIndex: 4, fret: 10 }, { stringIndex: 4, fret: 9 })).toBe(
      "pull_off",
    );
    expect(connectionBetween({ stringIndex: 4, fret: 9 }, { stringIndex: 3, fret: 9 })).toBe(
      "ambiguous",
    );
    expect(connectionBetween({ stringIndex: 4, fret: 9 }, { stringIndex: 4, fret: 9 })).toBe(
      "ambiguous",
    );
  });

  it("strikes the first note and slurs the rest", () => {
    const made = plan();
    expect(made.notes[0]?.connection).toBeUndefined();
    expect(made.notes[1]?.connection).toBe("hammer_on");
    expect(made.notes[2]?.connection).toBe("pull_off");
    expect(made.ambiguousAt).toEqual([]);
  });

  it("says so instead of choosing, when the fretboard has no answer", () => {
    const across = plan([
      { stringIndex: RUN_STRING, fret: 9 },
      { stringIndex: RUN_STRING + 1, fret: 9 },
    ]);
    expect(across.ambiguousAt).toEqual([1]);
    expect(across.notes[1]?.connection).toBeUndefined();
    /* And the run is still made: the reader hears it and is told why the
       connection is theirs to pick. */
    expect(across.notes).toHaveLength(2);
  });

  it("leaves the notes unslurred when they are to be played one by one", () => {
    const separate = planNoteSequence({
      startTicks: 0,
      spanTicks: SLOT_8,
      steps: NINE_TEN_NINE,
      performance: "separate",
    });
    expect(separate.ok).toBe(true);
    if (!separate.ok) return;
    expect(separate.plan.notes.every((note) => note.connection === undefined)).toBe(true);
    /* Same rhythm, though: a connection is not what makes a run fast. */
    expect(separate.plan.notes.map((note) => note.timeTicks)).toEqual([0, 32, 64]);
  });

  it("refuses a division it cannot write, rather than rounding it", () => {
    expect(planNoteSequence({
      startTicks: 0,
      spanTicks: 100,
      steps: NINE_TEN_NINE,
      performance: "separate",
    })).toEqual({ ok: false, reason: "uneven_span" });
    expect(planNoteSequence({
      startTicks: 0,
      spanTicks: 48,
      steps: [...NINE_TEN_NINE, { stringIndex: 4, fret: 11 }],
      performance: "separate",
    })).toEqual({ ok: false, reason: "span_too_short" });
  });

  it("works out how long each span option is", () => {
    expect(spanTicksFor({ span: "beat", beatTicks: 192, toNextNoteTicks: null })).toBe(192);
    expect(spanTicksFor({ span: "half_beat", beatTicks: 192, toNextNoteTicks: null })).toBe(96);
    expect(spanTicksFor({ span: "next_note", beatTicks: 192, toNextNoteTicks: 96 })).toBe(96);
    expect(spanTicksFor({ span: "next_note", beatTicks: 192, toNextNoteTicks: null })).toBeNull();
  });

  it("explains the rule in one sentence, in musician's words", () => {
    expect(densityExplanation(3)).toBe(
      "Aynı süreye 3 nota sığar; ölçünün uzunluğu değişmez.",
    );
    expect(densityExplanation(3)).not.toMatch(/1\/(8|16|32)|tick|slot/i);
  });
});

describe("whether the bar can hold it (§17)", () => {
  it("asks for the reader's permission rather than changing the grid", () => {
    const answer = rhythmAvailability({
      resolution: 8,
      startTicks: 0,
      stepTicks: 32,
      stepCount: 3,
      existingTicks: [SLOT_8],
    });
    expect(answer.state).toBe("requires_local_override");
    expect(answer.neededResolution).toBe(24);
    expect(answer.action).toBe(LOCAL_OVERRIDE_ACTION);
    expect(answer.actionDetail).toBe(LOCAL_OVERRIDE_DETAIL);
    /* The words the reader sees are about their music, not about notation. */
    expect(`${answer.action} ${answer.actionDetail}`).not.toMatch(/1\/32|tick|slot/i);
  });

  it("says yes without asking when the bar is already fine enough", () => {
    expect(
      rhythmAvailability({
        resolution: 24,
        startTicks: 0,
        stepTicks: 32,
        stepCount: 3,
        existingTicks: [96],
      }).state,
    ).toBe("available");
  });

  it("refuses when no grid holds both the run and what is already there", () => {
    /* Existing music on a straight 1/16 grid, a run that needs a triplet one:
       nothing in the format can write both, and saying so is the only honest
       answer — quantising either would be silently rewriting music. */
    const answer = rhythmAvailability({
      resolution: 16,
      startTicks: 0,
      stepTicks: 64,
      stepCount: 3,
      existingTicks: [48, 240],
    });
    expect(answer.state).toBe("unavailable");
    expect(answer.neededResolution).toBeNull();
    expect(answer.reason).toBeTruthy();
  });
});

describe("writing it into the song, atomically", () => {
  it("refuses until the reader has said yes", () => {
    const before = fixture();
    expect(
      applySequenceWrite(before, {
        sectionId: before.sections[0]!.id,
        trackId: TRACK,
        barIndex: 0,
        plan: plan(),
      }),
    ).toEqual({ ok: false, error: "needs_local_override" });
  });

  it("writes the three notes with their own onsets and lengths", () => {
    const before = fixture();
    const result = applySequenceWrite(before, {
      sectionId: before.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(),
      allowLocalOverride: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.usedLocalOverride).toBe(true);
    expect(result.resolution).toBe(24);
    const lane = laneOf(result.song);
    /* At 1/24 a slot is 32 ticks, so the run is slots 0, 1, 2. */
    expect(onsetOf(lane[0])?.position).toEqual({ string: RUN_STRING, fret: 9 });
    expect(onsetOf(lane[1])?.position).toEqual({ string: RUN_STRING, fret: 10 });
    expect(onsetOf(lane[2])?.position).toEqual({ string: RUN_STRING, fret: 9 });
    expect(onsetOf(lane[0])?.durationTicks).toBe(32);
    expect(onsetOf(lane[0])?.articulation).toBeUndefined();
    expect(onsetOf(lane[1])?.articulation).toBe("hammer_on");
    expect(onsetOf(lane[2])?.articulation).toBe("pull_off");
  });

  it("leaves the note after the run on exactly the tick it was on", () => {
    const before = fixture();
    const result = applySequenceWrite(before, {
      sectionId: before.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(),
      allowLocalOverride: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lane = laneOf(result.song);
    /* 96 ticks in, whatever the grid: slot 1 at 1/8 is slot 3 at 1/24. */
    expect(onsetOf(lane[3])?.position).toEqual({ string: RUN_STRING, fret: 9 });
    expect(onsetOf(lane[3])?.pitch).toBe(onsetOf(laneOf(before)[1])?.pitch);
  });

  it("does not lengthen the measure or change what it is in", () => {
    const before = fixture();
    const result = applySequenceWrite(before, {
      sectionId: before.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(),
      allowLocalOverride: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bar = result.song.sections[0]!.bars[0]!;
    expect(bar.timeSignature).toEqual([4, 4]);
    /* Twenty-four slots of 32 ticks is the same 768: a finer ruler, not a
       longer bar. */
    expect(laneOf(result.song)).toHaveLength(24);
    expect(result.song.sections[0]!.bars).toHaveLength(1);
  });

  it("changes one bar's grid and no other bar's", () => {
    const before = songSchema.parse({
      ...fixture(),
      sections: [
        {
          ...fixture().sections[0]!,
          bars: [
            fixture().sections[0]!.bars[0]!,
            fixture().sections[0]!.bars[0]!,
          ],
        },
      ],
    });
    const result = applySequenceWrite(before, {
      sectionId: before.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(),
      allowLocalOverride: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections[0]!.bars[0]?.resolution).toBe(24);
    expect(result.song.sections[0]!.bars[1]?.resolution).toBe(8);
    expect(result.song.sections[0]!.bars[1]).toEqual(before.sections[0]!.bars[1]);
  });

  it("is one value, so undo removes all of it and redo restores it exactly", () => {
    const before = fixture();
    const command = {
      sectionId: before.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(),
      allowLocalOverride: true,
    };
    const first = applySequenceWrite(before, command);
    const second = applySequenceWrite(before, command);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    /*
     * Undo is "the song before", and there is exactly one of those because
     * the command produced exactly one song. Redo is byte-exact for the same
     * reason: applying it again to the same input is the same bytes, so
     * nothing about the grid change depends on how many times it has run.
     */
    expect(JSON.stringify(second.song)).toBe(JSON.stringify(first.song));
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(first.song));
  });

  it("refuses whole when the space is already occupied", () => {
    const before = fixture();
    const occupied = songSchema.parse({
      ...before,
      sections: [
        {
          ...before.sections[0]!,
          bars: [
            {
              ...before.sections[0]!.bars[0]!,
              slots: {
                [TRACK]: (laneOf(before) as MelodicSlot[]).map((slot, index) =>
                  index === 0
                    ? {
                        notes: [
                          { pitch: soundOf(0, 0), position: { string: 0, fret: 0 } },
                        ],
                      }
                    : slot,
                ),
              },
            },
          ],
        },
      ],
    });
    const result = applySequenceWrite(occupied, {
      sectionId: occupied.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(),
      allowLocalOverride: true,
    });
    expect(result).toEqual({ ok: false, error: "target_occupied" });
  });

  it("refuses a run that would reach past the end of the bar", () => {
    const before = fixture();
    const result = applySequenceWrite(before, {
      sectionId: before.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(NINE_TEN_NINE, 96 * 9),
      allowLocalOverride: true,
    });
    expect(result).toEqual({ ok: false, error: "outside_bar" });
  });

  it("needs no override at all when the bar is already fine enough", () => {
    const before = songSchema.parse({
      ...fixture(),
      sections: [
        {
          ...fixture().sections[0]!,
          bars: [
            {
              timeSignature: [4, 4] as const,
              resolution: 24,
              slots: {
                [TRACK]: Array.from({ length: 24 }, (_, index) =>
                  index === 3
                    ? {
                        notes: [
                          {
                            pitch: soundOf(RUN_STRING, 9),
                            position: { string: RUN_STRING, fret: 9 },
                          },
                        ],
                      }
                    : null,
                ),
              },
            },
          ],
        },
      ],
    });
    const result = applySequenceWrite(before, {
      sectionId: before.sections[0]!.id,
      trackId: TRACK,
      barIndex: 0,
      plan: plan(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usedLocalOverride).toBe(false);
    expect(result.resolution).toBe(24);
  });
});
