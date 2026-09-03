/**
 * The loop boundary contract (2V-B.3 §5, §6).
 *
 * The founder's report was about a chord, not a number: the tail of an
 * extended power chord was audible on the first pass through a looped
 * selection and gone from the second wrap onwards. `loop-continuation.test.ts`
 * pins the controller side of that — a wrap asks for a continuation at all.
 * This file pins the *musical* side: what one pass consists of, measured on
 * the real expression plan through the real `activeVoicesAt`, so that "the
 * chord came back" cannot be satisfied by one of its two strings.
 *
 * Nothing here is a second scheduler. Every claim is made against
 * `planSelectionIteration` — the same value the production controller reads
 * on first play, on a resume and on a wrap.
 */
import { describe, expect, it } from "vitest";

import { activeVoicesAt } from "@/lib/audio/active-voices";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap } from "@/lib/audio/tempo";
import {
  planSelectionIteration,
  sameIteration,
  type IterablePlan,
} from "@/lib/playback/selection-iteration";
import {
  REST,
  TIE,
  TRACK_ID,
  bar,
  chord,
  event,
  note,
  slots,
  song,
} from "@/test/expression-fixtures";
import type { Song } from "@/lib/song/schema";

/** 4/4 at resolution 8: eight slots of 96 ticks. */
const SLOT = 96;

/**
 * The founder's fixture, in the smallest form that can carry the claim.
 *
 * Slot 0 is a power chord held over four slots — the "uzayan akor". Slot 4 is
 * the next note, the one that still arrives on every pass. A selection that
 * opens at slot 1 therefore opens *inside* the chord, which is the only
 * situation in which any of this is observable.
 */
function extendedChordSong(): Song {
  return song([
    bar(
      slots([
        chord(event("E2", 6, 0), event("B2", 5, 2)),
        TIE,
        TIE,
        TIE,
        note("G2", 6, 3),
        REST,
        REST,
        REST,
      ]),
    ),
  ]);
}

function planFor(target: Song) {
  return { plan: buildExpressionPlan(target), tempo: buildTempoMap(target) };
}

/** A selection opening inside the held chord and reaching past the next note. */
const MID_CHORD: IterablePlan = {
  startTicks: SLOT + SLOT / 2,
  endTicks: SLOT * 5,
  trackIds: [TRACK_ID],
  sustainCount: 2,
};

/** What one pass would actually restore, as pitches. */
function restoredPitches(target: Song, selection: IterablePlan): string[] {
  const { plan, tempo } = planFor(target);
  const iteration = planSelectionIteration(selection);
  if (!iteration.continues) return [];
  return activeVoicesAt(plan, tempo, iteration.resumeTicks, iteration.window)
    .voices.map((voice) => voice.sourcePitch)
    .sort();
}

describe("what one pass of a looped selection restores (§5)", () => {
  it("restores a single held note on all four passes, identically", () => {
    const target = song([bar(slots([note("A3", 1, 12), TIE, TIE, TIE]))]);
    const selection: IterablePlan = {
      startTicks: SLOT,
      endTicks: SLOT * 4,
      trackIds: [TRACK_ID],
      sustainCount: 1,
    };
    const { plan, tempo } = planFor(target);
    const iteration = planSelectionIteration(selection);

    const passes = [0, 1, 2, 3].map(() =>
      activeVoicesAt(plan, tempo, iteration.resumeTicks, iteration.window),
    );

    for (const pass of passes) {
      expect(pass.voices).toHaveLength(1);
      expect(pass.voices[0]?.continuation).toBe(true);
    }
    /*
     * Down to the value, not merely the count: a pass that restored the same
     * note from a different point in its envelope would be a different sound
     * with the same length, and the reader would hear the loop sag.
     */
    expect(passes[1]).toEqual(passes[0]);
    expect(passes[2]).toEqual(passes[0]);
    expect(passes[3]).toEqual(passes[0]);
  });

  it("restores every voice of a power chord, not just one of them", () => {
    const restored = restoredPitches(extendedChordSong(), MID_CHORD);
    /*
     * The specific failure this forbids: a chord half-restored sounds like a
     * thinner chord rather than like a fault, so a total "something was
     * audible" measurement would have passed it.
     */
    expect(restored).toEqual(["B2", "E2"]);
  });

  it("restores the same chord voices on the fourth pass as on the first", () => {
    const target = extendedChordSong();
    const first = restoredPitches(target, MID_CHORD);
    const fourth = [1, 2, 3].map(() => restoredPitches(target, MID_CHORD)).at(-1);
    expect(fourth).toEqual(first);
  });

  it("schedules a boundary onset once: as the transport's, never as a resume", () => {
    /* Selection opening exactly on the chord's own onset. The transport
       fires it, so a continuation for it would be a second attack on the
       same two strings in the same instant. */
    const opening: IterablePlan = { ...MID_CHORD, startTicks: 0 };
    expect(restoredPitches(extendedChordSong(), opening)).toEqual([]);
  });

  it("does not leak in a note that starts at the selection's end", () => {
    /* The next note is at slot 4; a selection ending there excludes it. */
    const upTo: IterablePlan = { ...MID_CHORD, endTicks: SLOT * 4 };
    const { plan, tempo } = planFor(extendedChordSong());
    const iteration = planSelectionIteration(upTo);
    const voices = activeVoicesAt(plan, tempo, iteration.resumeTicks, iteration.window);
    expect(voices.voices.map((voice) => voice.sourcePitch)).not.toContain("G2");
  });

  it("cuts a voice that would ring past the selection's end", () => {
    const target = extendedChordSong();
    const { plan, tempo } = planFor(target);
    /* A window that ends inside the held chord rather than after it. */
    const short = planSelectionIteration({ ...MID_CHORD, endTicks: SLOT * 2 });
    const long = planSelectionIteration(MID_CHORD);

    const cut = activeVoicesAt(plan, tempo, short.resumeTicks, short.window).voices;
    const whole = activeVoicesAt(plan, tempo, long.resumeTicks, long.window).voices;

    expect(cut).toHaveLength(2);
    for (const [index, voice] of cut.entries()) {
      expect(voice.remainingSeconds).toBeLessThan(whole[index]!.remainingSeconds);
      /* Still sounding, though: cut is not the same as never restored. */
      expect(voice.remainingSeconds).toBeGreaterThan(0);
    }
  });

  it("restores nothing when there is no room left inside the window", () => {
    const empty = planSelectionIteration({
      ...MID_CHORD,
      endTicks: MID_CHORD.startTicks,
    });
    const { plan, tempo } = planFor(extendedChordSong());
    expect(
      activeVoicesAt(plan, tempo, empty.resumeTicks, empty.window).voices,
    ).toEqual([]);
  });

  it("ignores a held note on a track the selection did not choose", () => {
    const other: IterablePlan = { ...MID_CHORD, trackIds: ["drums"] };
    expect(restoredPitches(extendedChordSong(), other)).toEqual([]);
  });
});

describe("first pass and later passes are the same plan (§4)", () => {
  it("plans the wrap exactly as it planned the opening", () => {
    const first = planSelectionIteration(MID_CHORD);
    const wrap = planSelectionIteration(MID_CHORD);
    expect(sameIteration(first, wrap)).toBe(true);
  });

  it("keeps the track filter and the end, and drops only the lower bound", () => {
    const iteration = planSelectionIteration(MID_CHORD);
    expect(iteration.window).toEqual({
      startTicks: 0,
      endTicks: MID_CHORD.endTicks,
      trackIds: [TRACK_ID],
    });
    expect(iteration.resumeTicks).toBe(MID_CHORD.startTicks);
  });

  it("says a selection opening on silence continues nothing", () => {
    const iteration = planSelectionIteration({ ...MID_CHORD, sustainCount: 0 });
    expect(iteration.continues).toBe(false);
    /* And it is still the same window, so turning the loop off or on cannot
       change which notes the selection is about. */
    expect(iteration.window).toEqual(planSelectionIteration(MID_CHORD).window);
  });

  it("calls two selections with different ends different passes", () => {
    expect(
      sameIteration(
        planSelectionIteration(MID_CHORD),
        planSelectionIteration({ ...MID_CHORD, endTicks: SLOT * 6 }),
      ),
    ).toBe(false);
  });

  it("calls two selections with different tracks different passes", () => {
    expect(
      sameIteration(
        planSelectionIteration(MID_CHORD),
        planSelectionIteration({ ...MID_CHORD, trackIds: [TRACK_ID, "drums"] }),
      ),
    ).toBe(false);
  });
});
