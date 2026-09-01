/**
 * What a pause left in the air, read as numbers (2V-B.1 §6).
 *
 * Every claim here is about the plan the engine plays, not about a node: the
 * point of the pure layer is that "the slide resumed from the pitch it had
 * reached" can be falsified without a speaker.
 */
import { describe, expect, it } from "vitest";

import { activeVoicesAt } from "@/lib/audio/active-voices";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import {
  REST,
  TIE,
  TRACK_ID,
  bar,
  note,
  slots,
  song,
} from "@/test/expression-fixtures";
import type { Song } from "@/lib/song/schema";

/** A source held long enough for the hand to travel off it. */
const held = (source: ReturnType<typeof note>, target: ReturnType<typeof note>): Song =>
  song([bar(slots([source, TIE, TIE, TIE, target]))]);

function planAndTempo(target: Song) {
  return {
    plan: buildExpressionPlan(target),
    tempo: buildTempoMap(target),
  };
}

/** The tick that sits `fraction` of the way through the bar. */
const TICKS_PER_BAR = 768;

describe("activeVoicesAt", () => {
  it("names nothing before anything has been struck", () => {
    const { plan, tempo } = planAndTempo(song([bar(slots([note("A3", 1, 12)]))]));
    expect(activeVoicesAt(plan, tempo, 0).voices).toEqual([]);
  });

  it("excludes a note whose onset is exactly the resume tick", () => {
    /* Two onsets, one at tick 0 and one at the fifth 1/8 slot. Pausing on the
       second one's own tick must leave it to the transport: continuing it
       here would strike the same note twice. */
    const target = song([bar(slots([note("A3", 1, 12), REST, REST, REST, note("B3", 1, 14)]))]);
    const { plan, tempo } = planAndTempo(target);
    const onset = plan.notes.find((entry) => entry.slotIndex === 4);
    expect(onset).toBeDefined();

    const at = activeVoicesAt(plan, tempo, onset!.timeTicks);
    expect(at.voices.map((voice) => voice.id)).not.toContain(onset!.id);

    /* One tick later it is a continuation, which proves the exclusion above
       is the boundary rule and not simply "this note is never restored". */
    const after = activeVoicesAt(plan, tempo, onset!.timeTicks + 1);
    expect(after.voices.map((voice) => voice.id)).toContain(onset!.id);
  });

  it("continues a held note from where it had got to", () => {
    const target = song([bar(slots([note("A3", 1, 12), TIE, TIE, TIE]))]);
    const { plan, tempo } = planAndTempo(target);
    const paused = TICKS_PER_BAR / 4;

    const [voice] = activeVoicesAt(plan, tempo, paused).voices;
    expect(voice).toBeDefined();
    expect(voice!.continuation).toBe(true);
    expect(voice!.kind).toBe("note");
    expect(voice!.elapsedSeconds).toBeCloseTo(
      secondsAtTicks(tempo, paused) - voice!.onsetSeconds,
      10,
    );
    expect(voice!.remainingSeconds).toBeGreaterThan(0);
  });

  it("resumes a slide from the interpolated pitch, not from either end", () => {
    const target = held(note("A3", 1, 12), note("B3", 1, 14, "slide"));
    const { plan, tempo } = planAndTempo(target);
    const chain = plan.chains[0];
    expect(chain).toBeDefined();

    const transition = chain!.transitions[0]!;
    /* Halfway through the hand's travel: after it set off, before it lands. */
    const middle =
      chain!.startSeconds + (transition.atSeconds + transition.arrivesAtSeconds) / 2;
    const ticks = Math.round(
      (middle / tempo.totalSeconds) * tempo.totalTicks,
    );

    const [voice] = activeVoicesAt(plan, tempo, ticks).voices;
    expect(voice).toBeDefined();
    expect(voice!.kind).toBe("chain");
    /* The chain's own source pitch, so the buffer is the one already ringing. */
    expect(voice!.sourcePitch).toBe(chain!.sourcePitch);

    const arrival = transition.cumulativeCents;
    expect(arrival).not.toBe(0);
    /* Strictly between the two: not the source it left, not the target it has
       not reached. Either end would be an audible jump on resume. */
    const low = Math.min(0, arrival);
    const high = Math.max(0, arrival);
    expect(voice!.currentCents).toBeGreaterThan(low);
    expect(voice!.currentCents).toBeLessThan(high);
  });

  it("resumes a vibrato at the phase it was actually at", () => {
    const target = song([bar(slots([note("A3", 1, 12, "vibrato"), TIE, TIE, TIE]))]);
    const { plan, tempo } = planAndTempo(target);
    const written = plan.notes.find((entry) => entry.articulation === "vibrato");
    expect(written).toBeDefined();
    expect(written!.pitchAutomation.length).toBeGreaterThan(4);

    /* Two moments inside the same note. A vibrato is a sine, so two different
       phases must give two different cents — a resume that reset the phase,
       or one that dropped the automation and left a plain sustain, would give
       the same number twice. */
    const first = activeVoicesAt(plan, tempo, TICKS_PER_BAR / 8).voices[0];
    const second = activeVoicesAt(plan, tempo, TICKS_PER_BAR / 4).voices[0];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.currentCents).not.toBeCloseTo(second!.currentCents, 6);

    /* And the vibrato keeps going: future points survive, rebased to zero. */
    expect(second!.pitchAutomation.length).toBeGreaterThan(2);
    expect(second!.pitchAutomation[0]!.timeSeconds).toBe(0);
    expect(second!.pitchAutomation[0]!.cents).toBeCloseTo(second!.currentCents, 10);
    expect(
      second!.pitchAutomation.every((point) => point.timeSeconds >= 0),
    ).toBe(true);
  });

  it("continues a hammer-on as one chain voice with no auxiliary attack", () => {
    const target = song([
      bar(slots([note("A3", 1, 12), TIE, note("B3", 1, 14, "hammer_on"), TIE])),
    ]);
    const { plan, tempo } = planAndTempo(target);
    const chain = plan.chains[0];
    expect(chain).toBeDefined();
    expect(chain!.transitions[0]!.kind).toBe("hammer_on");
    /* The written chain does carry a finger landing, so "no auxiliary in the
       continuation" is a property of the resume rather than of the fixture. */
    expect(chain!.transitions[0]!.auxiliary).toBeDefined();

    const ticks = Math.round(
      ((chain!.startSeconds + chain!.endSeconds) / 2 / tempo.totalSeconds) *
        tempo.totalTicks,
    );
    const at = activeVoicesAt(plan, tempo, ticks);

    /* Exactly one voice: the chain. Its member notes are not continued
       separately, or the string would sound twice. */
    expect(at.voices).toHaveLength(1);
    expect(at.voices[0]!.kind).toBe("chain");
    expect(at.voices[0]!.id).toBe(chain!.chainId);
    expect(at.voices[0]!.continuation).toBe(true);
  });

  it("continues a pull-off the same way", () => {
    const target = song([
      bar(slots([note("B3", 1, 14), TIE, note("A3", 1, 12, "pull_off"), TIE])),
    ]);
    const { plan, tempo } = planAndTempo(target);
    const chain = plan.chains[0];
    expect(chain).toBeDefined();
    expect(chain!.transitions[0]!.kind).toBe("pull_off");

    const ticks = Math.round(
      ((chain!.startSeconds + chain!.endSeconds) / 2 / tempo.totalSeconds) *
        tempo.totalTicks,
    );
    const at = activeVoicesAt(plan, tempo, ticks);
    expect(at.voices).toHaveLength(1);
    expect(at.voices[0]!.kind).toBe("chain");
  });

  it("gives the same answer twice for the same moment", () => {
    const target = held(note("A3", 1, 12), note("B3", 1, 14, "slide"));
    const { plan, tempo } = planAndTempo(target);
    const ticks = TICKS_PER_BAR / 2;
    expect(activeVoicesAt(plan, tempo, ticks)).toEqual(
      activeVoicesAt(plan, tempo, ticks),
    );
  });

  it("refuses to restore a note the selection window never played", () => {
    const target = song([
      bar(slots([note("A3", 1, 12), TIE, TIE, TIE])),
      bar(slots([note("B3", 1, 14), TIE, TIE, TIE])),
    ]);
    const { plan, tempo } = planAndTempo(target);
    /* Paused inside bar 2, with bar 2 selected. The bar 1 note has stopped by
       then anyway; what this pins is that the window is consulted at all. */
    const inside = activeVoicesAt(plan, tempo, TICKS_PER_BAR + 100, {
      startTicks: TICKS_PER_BAR,
      endTicks: TICKS_PER_BAR * 2,
      trackIds: [TRACK_ID],
    });
    expect(inside.voices).toHaveLength(1);

    /* The same moment with bar 1 selected restores nothing: the sounding note
       began outside the window, and putting it back would sound music the
       reader asked not to hear. */
    const outside = activeVoicesAt(plan, tempo, TICKS_PER_BAR + 100, {
      startTicks: 0,
      endTicks: TICKS_PER_BAR,
      trackIds: [TRACK_ID],
    });
    expect(outside.voices).toEqual([]);
  });

  it("refuses to restore another track's voice", () => {
    const target = song([bar(slots([note("A3", 1, 12), TIE, TIE, TIE]))]);
    const { plan, tempo } = planAndTempo(target);
    const ticks = TICKS_PER_BAR / 4;

    expect(
      activeVoicesAt(plan, tempo, ticks, {
        startTicks: 0,
        endTicks: TICKS_PER_BAR,
        trackIds: [TRACK_ID],
      }).voices,
    ).toHaveLength(1);

    expect(
      activeVoicesAt(plan, tempo, ticks, {
        startTicks: 0,
        endTicks: TICKS_PER_BAR,
        trackIds: ["some-other-track"],
      }).voices,
    ).toEqual([]);
  });

  it("carries the paused moment so a caller cannot recompute it differently", () => {
    const target = song([bar(slots([note("A3", 1, 12), TIE, TIE, TIE]))]);
    const { plan, tempo } = planAndTempo(target);
    const at = activeVoicesAt(plan, tempo, 200);
    expect(at.pausedTicks).toBe(200);
    expect(at.pausedSeconds).toBeCloseTo(secondsAtTicks(tempo, 200), 10);
  });
});
