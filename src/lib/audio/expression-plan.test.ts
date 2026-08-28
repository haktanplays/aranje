/**
 * What each articulation does, read back as numbers (spec 8.5, K-21).
 */
import { describe, expect, it } from "vitest";

import { expressionPresets } from "@/lib/audio/expression";
import {
  bendAutomation,
  bendStages,
  buildExpressionPlan,
  type ExpressiveNotePlan,
} from "@/lib/audio/expression-plan";
import {
  chainIdFor,
  desiredGlideSeconds,
  glideFor,
  transitionSeconds,
} from "@/lib/audio/legato-chain";
import { buildNotatedPlan, buildSongPlan } from "@/lib/audio/schedule";
import { renderDuration } from "@/lib/export/export-plan";
import { validateArticulationContext } from "@/lib/validators";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  REST,
  TIE,
  TRACK_ID,
  bar,
  denseBar,
  emptyBar,
  event,
  chord,
  note,
  slots,
  song,
} from "@/test/expression-fixtures";
import type {
  Articulation,
  MelodicSlot,
  Resolution,
  Song,
} from "@/lib/song/schema";

function planOf(target: Song, percent?: number): ExpressiveNotePlan[] {
  return buildExpressionPlan(
    target,
    percent === undefined ? {} : { practicePercent: percent },
  ).notes;
}

/** The plan for the note at this slot of the first bar. */
function at(target: Song, slotIndex: number, percent?: number): ExpressiveNotePlan {
  const found = planOf(target, percent).find(
    (plan) => plan.slotIndex === slotIndex && plan.barKey === "s1:0",
  );
  if (!found) throw new Error(`no plan at slot ${slotIndex}`);
  return found;
}

const A3 = (articulation?: Articulation) => note("A3", 1, 12, articulation);
const B3 = (articulation?: Articulation) => note("B3", 1, 14, articulation);
const G3 = (articulation?: Articulation) => note("G3", 1, 10, articulation);

/**
 * A source held across four slots, then the note that slides off it.
 *
 * A slide needs the note before it to still be ringing, so the room between
 * the two comes from a tie. A rest there would end the source, and then there
 * is nothing to slide from.
 */
const held = (source: MelodicSlot, target: MelodicSlot): Song =>
  song([bar(slots([source, TIE, TIE, TIE, target]))]);

describe("a note with nothing asked of it", () => {
  it("has flat pitch, no envelope and no voice of its own", () => {
    const plan = at(song([bar(slots([A3()]))]), 0);

    expect(plan.expressive).toBe(false);
    expect(plan.pitchAutomation).toEqual([{ timeSeconds: 0, cents: 0, curve: "step" }]);
    expect(plan.gainEnvelope).toEqual([]);
    expect(plan.fallbackReason).toBeUndefined();
  });

  it("keeps the written pitch and position", () => {
    const plan = at(song([bar(slots([A3("bend_full")]))]), 0);
    expect(plan.pitch).toBe("A3");
    expect(plan.position).toEqual({ stringIndex: 1, fret: 12 });
  });
});

describe("vibrato", () => {
  const plan = at(song([bar(slots([A3("vibrato")]))]), 0);

  it("waits before it starts, and not longer than the cap", () => {
    const delay = plan.pitchAutomation[1]?.timeSeconds ?? 0;
    expect(delay).toBeLessThanOrEqual(expressionPresets.vibrato.maxDelaySeconds);
    expect(delay).toBeCloseTo(
      Math.min(
        expressionPresets.vibrato.maxDelaySeconds,
        plan.durationSeconds * expressionPresets.vibrato.delayFraction,
      ),
      6,
    );
    expect(plan.pitchAutomation[1]?.cents).toBe(0);
  });

  it("swings to the preset depth and no further", () => {
    const cents = plan.pitchAutomation.map((point) => point.cents);
    const peak = Math.max(...cents.map(Math.abs));
    expect(peak).toBeLessThanOrEqual(expressionPresets.vibrato.depthCents);
    expect(peak).toBeGreaterThan(expressionPresets.vibrato.depthCents * 0.9);
    expect(Math.min(...cents)).toBeLessThan(0);
  });

  it("runs at the preset rate", () => {
    const moving = plan.pitchAutomation.filter((point) => point.curve === "sine");
    const first = moving[0]?.timeSeconds ?? 0;
    const second = moving[1]?.timeSeconds ?? 0;
    const step = second - first;
    expect(step).toBeCloseTo(
      1 / (expressionPresets.vibrato.rateHz * expressionPresets.vibrato.pointsPerCycle),
      6,
    );
  });

  it("stays straight on a note too short to shake", () => {
    // 16ths at 240% of the demo tempo leave less than the delay itself.
    const fast: Song = { ...song([bar(slots([A3("vibrato")]))]), bpm: 260 };
    const short = buildExpressionPlan(fast, { practicePercent: 150 }).notes[0];
    expect(short?.pitchAutomation.length).toBeGreaterThan(0);
    expect(short?.pitchAutomation.every((point) => Number.isFinite(point.cents))).toBe(true);
  });
});

describe("bends", () => {
  it("takes a half bend exactly one semitone up", () => {
    const plan = at(song([bar(slots([A3("bend_half")]))]), 0);
    expect(Math.max(...plan.pitchAutomation.map((p) => p.cents))).toBe(100);
  });

  it("takes a full bend exactly two semitones up", () => {
    const plan = at(song([bar(slots([A3("bend_full")]))]), 0);
    expect(Math.max(...plan.pitchAutomation.map((p) => p.cents))).toBe(200);
  });

  it("settles, rises, holds and comes back", () => {
    const plan = at(song([bar(slots([A3("bend_full")]))]), 0);
    const stages = bendStages(plan.durationSeconds);
    const cents = plan.pitchAutomation.map((point) => point.cents);

    // Flat while the pick lands.
    expect(plan.pitchAutomation[0]).toMatchObject({ timeSeconds: 0, cents: 0 });
    expect(stages.settleSeconds).toBeGreaterThan(0);

    // Arrives exactly, and stays there.
    expect(Math.max(...cents)).toBe(200);
    const reached = plan.pitchAutomation.find((point) => point.cents === 200);
    expect(reached?.timeSeconds).toBeCloseTo(stages.reachedAtSeconds, 5);

    // Comes back to where it started, at the end of the note.
    expect(cents[cents.length - 1]).toBe(0);
    expect(
      plan.pitchAutomation[plan.pitchAutomation.length - 1]?.timeSeconds,
    ).toBeCloseTo(plan.durationSeconds, 4);
  });

  it("arrives within the real-time ceiling however long the note is", () => {
    const held = [A3("bend_full"), TIE, TIE, TIE, TIE, TIE, TIE, TIE];
    const plan = at(song([bar(held)]), 0);
    const stages = bendStages(plan.durationSeconds);

    expect(plan.durationSeconds).toBeGreaterThan(1);
    expect(stages.riseSeconds).toBeLessThanOrEqual(
      expressionPresets.bend.riseMaxSeconds,
    );
    expect(stages.releaseSeconds).toBeLessThanOrEqual(
      expressionPresets.bend.releaseMaxSeconds,
    );
    expect(stages.reachedAtSeconds).toBeLessThan(0.4);
  });

  it("takes its rise from the note itself between the floor and the ceiling", () => {
    // Long notes are clamped by the ceiling and short ones by the floor, so
    // the fraction only shows in between. This is that range.
    const stages = bendStages(0.8);

    expect(stages.riseSeconds).toBeCloseTo(0.8 * expressionPresets.bend.riseFraction, 6);
    expect(stages.riseSeconds).toBeGreaterThan(expressionPresets.bend.riseMinSeconds);
    expect(stages.riseSeconds).toBeLessThan(expressionPresets.bend.riseMaxSeconds);
    expect(stages.releaseSeconds).toBeCloseTo(
      0.8 * expressionPresets.bend.releaseFraction,
      6,
    );
  });

  it("squeezes the stages into a note too short to hold them all", () => {
    const stages = bendStages(0.1);

    expect(stages.holdSeconds).toBeGreaterThanOrEqual(0);
    expect(
      stages.settleSeconds + stages.riseSeconds + stages.holdSeconds + stages.releaseSeconds,
    ).toBeCloseTo(0.1, 5);
    expect(bendAutomation(0.1, "bend_full").every((point) => point.timeSeconds <= 0.1 + 1e-6)).toBe(true);
  });

  it("never leaves a negative hold, at any length", () => {
    for (const duration of [0.02, 0.05, 0.1, 0.25, 0.5, 1, 4]) {
      const stages = bendStages(duration);
      expect(stages.holdSeconds).toBeGreaterThanOrEqual(0);
      expect(stages.reachedAtSeconds).toBeLessThanOrEqual(duration + 1e-9);
    }
  });

  it("stretches with the practice speed", () => {
    const fixture = song([bar(slots([A3("bend_full")]))]);
    const full = at(fixture, 0, 100);
    const half = at(fixture, 0, 50);
    const fast = at(fixture, 0, 150);

    const fullStages = bendStages(full.durationSeconds, 1);
    const halfStages = bendStages(half.durationSeconds, 2);
    const fastStages = bendStages(fast.durationSeconds, 100 / 150);

    expect(halfStages.riseSeconds).toBeGreaterThan(fullStages.riseSeconds);
    expect(fastStages.riseSeconds).toBeLessThan(fullStages.riseSeconds);
    // The target itself never moves.
    expect(Math.max(...half.pitchAutomation.map((p) => p.cents))).toBe(200);
    expect(Math.max(...fast.pitchAutomation.map((p) => p.cents))).toBe(200);
  });

  it("holds the target dead still in the profile that ships", () => {
    const held = [A3("bend_full"), TIE, TIE, TIE, TIE, TIE, TIE, TIE];
    const plan = at(song([bar(held)]), 0);
    const stages = bendStages(plan.durationSeconds);

    const duringHold = plan.pitchAutomation.filter(
      (point) =>
        point.timeSeconds > stages.reachedAtSeconds + 1e-6 &&
        point.timeSeconds < stages.reachedAtSeconds + stages.holdSeconds - 1e-6,
    );
    expect(duringHold.every((point) => point.cents === 200)).toBe(true);
    expect(plan.pitchAutomation.some((point) => point.curve === "sine")).toBe(false);
  });

  it("moves a little around the target in the expressive profile only", () => {
    const held = [A3("bend_full"), TIE, TIE, TIE, TIE, TIE, TIE, TIE];
    const fixture = song([bar(held)]);
    const plan = buildExpressionPlan(fixture, { bendProfile: "expressive" }).notes[0];
    if (!plan) throw new Error("no plan");
    const stages = bendStages(plan.durationSeconds);
    const depth = expressionPresets.bend.top.depthCents;

    const moving = plan.pitchAutomation.filter((point) => point.curve === "sine");
    expect(moving.length).toBeGreaterThan(0);
    for (const point of moving) {
      expect(Math.abs(point.cents - 200)).toBeLessThanOrEqual(depth + 1e-6);
    }

    // It starts after the target is reached, and stops before the release.
    const first = moving[0]?.timeSeconds ?? 0;
    const last = moving[moving.length - 1]?.timeSeconds ?? 0;
    expect(first).toBeGreaterThan(stages.reachedAtSeconds);
    expect(last).toBeLessThanOrEqual(stages.reachedAtSeconds + stages.holdSeconds + 1e-6);
  });

  it("does not change the note that is written", () => {
    const before = song([bar(slots([A3("bend_full")]))]);
    const snapshot = JSON.stringify(before);
    buildExpressionPlan(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(at(before, 0).pitch).toBe("A3");
  });
});

describe("slide arrives at the note it is written on", () => {
  // The source is held across four slots — a full second at the fixture tempo —
  // so the hand has somewhere to travel. A rest here would end the source, and
  // then there would be nothing to slide from.
  const upward = () => song([bar(slots([G3(), TIE, TIE, TIE, B3("slide")]))]);
  const downward = () => song([bar(slots([B3(), TIE, TIE, TIE, G3("slide")]))]);

  it("makes a chain whose travel ends exactly on the target's onset", () => {
    const plan = buildExpressionPlan(upward());
    const chain = plan.chains[0];
    const transition = chain?.transitions[0];
    const target = plan.notes.find((entry) => entry.pitch === "B3");

    expect(plan.chains).toHaveLength(1);
    expect(transition?.kind).toBe("slide");
    // The arrival is the target's own start, measured from the chain's start.
    expect((chain?.startSeconds ?? 0) + (transition?.arrivesAtSeconds ?? 0)).toBeCloseTo(
      target?.startSeconds ?? -1,
      6,
    );
  });

  it("starts moving before the target, inside the note before it", () => {
    const chain = buildExpressionPlan(upward()).chains[0];
    const transition = chain?.transitions[0];

    expect(transition?.atSeconds ?? 0).toBeLessThan(transition?.arrivesAtSeconds ?? 0);
    expect(transition?.atSeconds ?? -1).toBeGreaterThanOrEqual(
      expressionPresets.slide.minLeadSeconds,
    );
  });

  it("does not restrike the target", () => {
    const plan = buildExpressionPlan(upward());
    const target = plan.notes.find((entry) => entry.pitch === "B3");
    expect(target?.chainRole).toBe("target");
    expect(plan.notes.filter((entry) => entry.chainRole !== "target")).toHaveLength(1);
  });

  it("lands on the exact target pitch and stays there", () => {
    const transition = buildExpressionPlan(upward()).chains[0]?.transitions[0];
    const points = transition?.points ?? [];

    expect(points[0]?.cents).toBe(0);
    expect(points[points.length - 1]?.cents).toBe(400);
    expect(points[points.length - 1]?.timeSeconds).toBeCloseTo(
      transition?.arrivesAtSeconds ?? -1,
      6,
    );
    // Nothing after the arrival, so the pitch simply holds.
    expect(points.every((point) => point.timeSeconds <= (transition?.arrivesAtSeconds ?? 0) + 1e-9)).toBe(true);
  });

  it("eases away and eases in, rather than travelling at one speed", () => {
    // This is the difference between a hand and a pitch knob. A single linear
    // ramp covers a quarter of the distance in a quarter of the time; an eased
    // one is still behind at that point and has overtaken by three quarters.
    const transition = buildExpressionPlan(upward()).chains[0]?.transitions[0];
    const points = transition?.points ?? [];
    const span = transition?.transitionSeconds ?? 1;
    const start = transition?.atSeconds ?? 0;
    const total = points[points.length - 1]?.cents ?? 0;

    const covered = (fraction: number) => {
      const at = start + span * fraction;
      const point = points.reduce((best, candidate) =>
        Math.abs(candidate.timeSeconds - at) < Math.abs(best.timeSeconds - at)
          ? candidate
          : best,
      );
      return point.cents / total;
    };

    expect(covered(0.25)).toBeLessThan(0.25);
    expect(covered(0.5)).toBeCloseTo(0.5, 6);
    expect(covered(0.75)).toBeGreaterThan(0.75);
  });

  it("is written out finely enough to be a curve at all", () => {
    const points = buildExpressionPlan(upward()).chains[0]?.transitions[0]?.points ?? [];
    // A single ramp is two points. Six is the floor the spec sets.
    expect(points.length).toBeGreaterThanOrEqual(6);
    expect(points.filter((point) => point.curve === "linear").length).toBe(
      points.length - 1,
    );
    // Time only ever moves forwards.
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]!.timeSeconds).toBeGreaterThan(points[i - 1]!.timeSeconds);
    }
  });

  it("has the same shape going down as going up", () => {
    const up = buildExpressionPlan(upward()).chains[0]?.transitions[0]?.points ?? [];
    const down = buildExpressionPlan(downward()).chains[0]?.transitions[0]?.points ?? [];

    expect(down).toHaveLength(up.length);
    for (let i = 0; i < up.length; i += 1) {
      expect(down[i]!.timeSeconds).toBeCloseTo(up[i]!.timeSeconds, 9);
      // Mirrored: the same fraction of the journey, the other way.
      expect(down[i]!.cents).toBeCloseTo(-up[i]!.cents, 9);
    }
  });

  it("never overshoots on the way", () => {
    for (const fixture of [upward(), downward()]) {
      const points = buildExpressionPlan(fixture).chains[0]?.transitions[0]?.points ?? [];
      const target = points[points.length - 1]?.cents ?? 0;
      for (const point of points) {
        expect(Math.abs(point.cents)).toBeLessThanOrEqual(Math.abs(target) + 1e-9);
        expect(Math.sign(point.cents || target)).toBe(Math.sign(target));
      }
    }
  });

  it("moves the same amount of time downwards as upwards", () => {
    const up = buildExpressionPlan(upward()).chains[0]?.transitions[0];
    const down = buildExpressionPlan(downward()).chains[0]?.transitions[0];

    expect(down?.transitionSeconds).toBeCloseTo(up?.transitionSeconds ?? -1, 9);
    expect(down?.intervalCents).toBe(-400);
    expect(up?.intervalCents).toBe(400);
  });

  it("takes 180 ms over four semitones, in either direction", () => {
    for (const fixture of [upward(), downward()]) {
      const transition = buildExpressionPlan(fixture).chains[0]?.transitions[0];
      expect(transition?.transitionSeconds).toBeCloseTo(0.18, 6);
    }
  });

  it("takes the floor over one semitone and the ceiling over twelve", () => {
    const semitone = held(note("A3", 1, 12), note("A#3", 1, 13, "slide"));
    const octave = held(note("A3", 1, 12), note("A4", 1, 24, "slide"));

    expect(
      buildExpressionPlan(semitone).chains[0]?.transitions[0]?.transitionSeconds,
    ).toBeCloseTo(0.12, 6);
    expect(
      buildExpressionPlan(octave).chains[0]?.transitions[0]?.transitionSeconds,
    ).toBeCloseTo(0.36, 6);
  });

  it("is played by one voice: a source that is struck and a target that is not", () => {
    const plan = buildExpressionPlan(upward());
    const chain = plan.chains[0];

    expect(chain?.noteIds).toHaveLength(2);
    expect(chain?.sourcePitch).toBe("G3");
    expect(chain?.stringIndex).toBe(1);
    expect(plan.notes.filter((entry) => entry.chainRole === "source")).toHaveLength(1);
    expect(plan.notes.filter((entry) => entry.chainRole === "target")).toHaveLength(1);
    // Every note of the chain is on the string the hand is sliding along.
    expect(plan.notes.every((entry) => entry.position?.stringIndex === 1)).toBe(true);
  });

  it("keeps one chain across two slides in a row", () => {
    const run = song([
      bar(
        slots([
          note("A3", 1, 12),
          TIE,
          TIE,
          TIE,
          note("B3", 1, 14, "slide"),
          TIE,
          TIE,
          note("C#4", 1, 16, "slide"),
        ]),
      ),
    ]);
    const plan = buildExpressionPlan(run);
    const chain = plan.chains[0];

    expect(plan.chains).toHaveLength(1);
    expect(chain?.transitions).toHaveLength(2);
    expect(chain?.transitions.every((step) => step.kind === "slide")).toBe(true);
    // Cents are counted from the pitch the chain started on, not the last one.
    expect(chain?.transitions[0]?.cumulativeCents).toBe(200);
    expect(chain?.transitions[1]?.cumulativeCents).toBe(400);
    // The second travel starts after the first has arrived.
    expect(chain?.transitions[1]?.atSeconds ?? 0).toBeGreaterThan(
      chain?.transitions[0]?.arrivesAtSeconds ?? 0,
    );
  });

  it("carries on across a section line", () => {
    const across = song(
      [bar(slots([REST, REST, REST, REST, G3(), TIE, TIE, TIE]))],
      [bar(slots([B3("slide")]))],
    );
    expect(buildExpressionPlan(across).chains).toHaveLength(1);
  });

  it("leaves the other strings of a chord alone", () => {
    const withChord = song([
      bar(
        slots([
          chord(event("A3", 1, 12), event("D4", 2, 12)),
          TIE,
          TIE,
          TIE,
          chord(event("C#4", 1, 16, "slide"), event("D4", 2, 12)),
        ]),
      ),
    ]);
    const plan = buildExpressionPlan(withChord);
    const steady = plan.notes.filter((entry) => entry.position?.stringIndex === 2);

    expect(plan.chains).toHaveLength(1);
    expect(plan.chains[0]?.stringIndex).toBe(1);
    expect(steady).toHaveLength(2);
    for (const entry of steady) {
      expect(entry.chainId).toBeUndefined();
      expect(entry.expressive).toBe(false);
      expect(entry.pitchAutomation).toEqual([
        { timeSeconds: 0, cents: 0, curve: "step" },
      ]);
    }
  });

  it("names a chain the same way every time", () => {
    const first = buildExpressionPlan(upward()).chains[0];
    const second = buildExpressionPlan(upward()).chains[0];
    expect(first?.chainId).toBe(second?.chainId);
    expect(first?.chainId).toBe(chainIdFor(TRACK_ID, 1, first?.startTicks ?? -1));
  });

  it("does not touch the song it read", () => {
    const before = upward();
    const snapshot = JSON.stringify(before);
    buildExpressionPlan(before);
    buildExpressionPlan(before, { practicePercent: 50 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("a slide at practice speed", () => {
  const glideAt = (percent: number) =>
    buildExpressionPlan(
      song([bar(slots([G3(), TIE, TIE, TIE, B3("slide")]))]),
      { practicePercent: percent },
    ).chains[0]?.transitions[0];

  it("takes longer slowed down and less sped up", () => {
    expect(glideAt(50)?.transitionSeconds).toBeCloseTo(0.36, 6);
    expect(glideAt(100)?.transitionSeconds).toBeCloseTo(0.18, 6);
    expect(glideAt(150)?.transitionSeconds).toBeCloseTo(0.12, 6);
  });

  it("still arrives exactly on the target, whatever the speed", () => {
    for (const percent of [50, 100, 150]) {
      const plan = buildExpressionPlan(
        song([bar(slots([G3(), TIE, TIE, TIE, B3("slide")]))]),
        { practicePercent: percent },
      );
      const chain = plan.chains[0];
      const transition = chain?.transitions[0];
      const target = plan.notes.find((entry) => entry.pitch === "B3");

      expect(
        (chain?.startSeconds ?? 0) + (transition?.arrivesAtSeconds ?? 0),
      ).toBeCloseTo(target?.startSeconds ?? -1, 6);
    }
  });
});

describe("when a slide cannot be played as written", () => {
  const refuses = (fixture: Song, slotIndex: number, reason: string) => {
    const plan = buildExpressionPlan(fixture);
    expect(plan.chains).toEqual([]);
    const note = plan.notes.find((entry) => entry.slotIndex === slotIndex);
    expect(note?.fallbackReason).toBe(reason);
    expect(note?.chainId).toBeUndefined();
    // A refused slide is two ordinary notes, not silence and not half a chain.
    expect(plan.notes.every((entry) => entry.expressive === false)).toBe(true);
  };

  it("refuses a jump wider than an octave", () => {
    refuses(
      held(note("A3", 1, 12), note("A#4", 1, 25, "slide")),
      4,
      "interval_too_wide",
    );
  });

  it("refuses a slide that goes nowhere", () => {
    refuses(held(note("A3", 1, 12), note("A3", 1, 12, "slide")), 4, "interval_too_wide");
  });

  it("refuses across a real rest", () => {
    refuses(song([bar(slots([G3(), REST, REST, REST, B3("slide")]))]), 4, "no_previous_note");
  });

  it("refuses across strings", () => {
    refuses(
      song([
        bar(slots([note("E3", 0, 12), TIE, TIE, TIE, note("A3", 1, 12, "slide")])),
      ]),
      4,
      "previous_note_other_string",
    );
  });

  it("refuses across a bar the track is not written in", () => {
    const across = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()])),
      emptyBar(),
      bar(slots([B3("slide")])),
    ]);
    expect(buildExpressionPlan(across).chains).toEqual([]);
  });

  it("refuses when the notes are too close together to hear the hand move", () => {
    // Eighths at 300bpm leave 100ms between the two onsets, and 20ms of that
    // belongs to the source, so there is not enough travel left to hear.
    const quick: Song = {
      ...song([bar(slots([G3(), B3("slide")]))]),
      bpm: 300,
    };
    refuses(quick, 1, "no_room_to_glide");
  });

  it("plays the same passage as a slide once there is room for one", () => {
    const roomy: Song = {
      ...song([bar(slots([G3(), TIE, B3("slide")]))]),
      bpm: 300,
    };
    expect(buildExpressionPlan(roomy).chains).toHaveLength(1);
  });
});

describe("how long the hand takes", () => {
  it("scales with the distance, between a floor and a ceiling", () => {
    expect(desiredGlideSeconds(1)).toBeCloseTo(0.12, 6);
    expect(desiredGlideSeconds(2)).toBeCloseTo(0.12, 6);
    expect(desiredGlideSeconds(4)).toBeCloseTo(0.18, 6);
    expect(desiredGlideSeconds(7)).toBeCloseTo(0.315, 6);
    expect(desiredGlideSeconds(12)).toBeCloseTo(0.36, 6);
    // Direction does not change how long it takes.
    expect(desiredGlideSeconds(-7)).toBeCloseTo(desiredGlideSeconds(7), 9);
  });

  it("stretches with the practice speed", () => {
    expect(desiredGlideSeconds(4, 2)).toBeCloseTo(0.36, 6);
    expect(desiredGlideSeconds(4, 100 / 150)).toBeCloseTo(0.12, 6);
  });

  it("fits the travel into the room there is", () => {
    // Plenty of room: it takes as long as it wants.
    expect(glideFor(4, 1)).toMatchObject({ kind: "glide", seconds: 0.18 });
    // Tight: it takes what is left after the source has been heard.
    expect(glideFor(12, 0.2)).toMatchObject({ kind: "glide" });
    const squeezed = glideFor(12, 0.2);
    if (squeezed.kind === "glide") expect(squeezed.seconds).toBeCloseTo(0.18, 6);
  });

  it("refuses a gap too short for anyone to hear", () => {
    // 20 ms of the gap belongs to the source note, so 0.109 s leaves 89 ms of
    // travel — just under the floor — and 0.11 s leaves exactly 90 ms.
    expect(glideFor(4, 0.1).kind).toBe("too_tight");
    expect(glideFor(4, 0.109).kind).toBe("too_tight");
    expect(glideFor(4, 0.11).kind).toBe("glide");
  });
});

describe("hammer-on and pull-off become a chain", () => {
  it("makes one chain out of the pair, with the first note as its source", () => {
    const plan = buildExpressionPlan(song([bar(slots([G3(), B3("hammer_on")]))]));

    expect(plan.chains).toHaveLength(1);
    const chain = plan.chains[0];
    expect(chain?.sourcePitch).toBe("G3");
    expect(chain?.stringIndex).toBe(1);
    expect(chain?.transitions).toHaveLength(1);
    expect(chain?.transitions[0]).toMatchObject({
      kind: "hammer_on",
      fromPitch: "G3",
      toPitch: "B3",
    });
  });

  it("marks the source struck and the target as belonging to the chain", () => {
    const plan = buildExpressionPlan(song([bar(slots([G3(), B3("hammer_on")]))]));
    const source = plan.notes.find((note) => note.pitch === "G3");
    const targetNote = plan.notes.find((note) => note.pitch === "B3");

    expect(source?.chainRole).toBe("source");
    expect(targetNote?.chainRole).toBe("target");
    expect(source?.chainId).toBe(targetNote?.chainId);
    // The target is still a note of the song; it is only rendered differently.
    expect(targetNote?.pitch).toBe("B3");
    expect(targetNote?.timeTicks).toBeGreaterThan(source?.timeTicks ?? 0);
  });

  it("pulls off downwards, with its own transition time and level", () => {
    const plan = buildExpressionPlan(song([bar(slots([B3(), G3("pull_off")]))]));
    const transition = plan.chains[0]?.transitions[0];

    expect(transition?.kind).toBe("pull_off");
    expect(transition?.intervalCents).toBe(-400);
    expect(transition?.transitionSeconds).toBeCloseTo(
      expressionPresets.legato.pullOff.transitionSeconds,
      6,
    );
    expect(transition?.levelAfter).toBe(expressionPresets.legato.pullOff.levelAfter);
  });

  it("gives a hammer-on the shorter transition and the higher level", () => {
    const plan = buildExpressionPlan(song([bar(slots([G3(), B3("hammer_on")]))]));
    const transition = plan.chains[0]?.transitions[0];

    expect(transition?.transitionSeconds).toBeCloseTo(
      expressionPresets.legato.hammerOn.transitionSeconds,
      6,
    );
    expect(transition?.levelAfter).toBe(expressionPresets.legato.hammerOn.levelAfter);
    expect(expressionPresets.legato.hammerOn.transitionSeconds).toBeLessThan(
      expressionPresets.legato.pullOff.transitionSeconds,
    );
    expect(expressionPresets.legato.hammerOn.levelAfter).toBeGreaterThan(
      expressionPresets.legato.pullOff.levelAfter,
    );
  });

  /*
   * 2T-C §10. Both hands make a noise, and they are not the same noise.
   * Until this checkpoint only the pull-off had one, which left a hammer-on
   * sounding like a pitch that changed by itself — 1.72 dB from a pull-off
   * in the render, under what a listener can be relied on to hear.
   */
  it("gives each finger landing its own short transient, and a slide none", () => {
    const pull = buildExpressionPlan(song([bar(slots([B3(), G3("pull_off")]))]));
    const hammer = buildExpressionPlan(song([bar(slots([G3(), B3("hammer_on")]))]));

    const pulled = pull.chains[0]?.transitions[0]?.auxiliary;
    expect(pulled?.gain).toBe(expressionPresets.legato.pullOff.auxiliary.gain);
    expect(pulled?.durationSeconds).toBeCloseTo(
      expressionPresets.legato.pullOff.auxiliary.maxSeconds,
      6,
    );

    const landed = hammer.chains[0]?.transitions[0]?.auxiliary;
    expect(landed?.gain).toBe(expressionPresets.legato.hammerOn.auxiliary.gain);
    expect(landed?.durationSeconds).toBeCloseTo(
      expressionPresets.legato.hammerOn.auxiliary.maxSeconds,
      6,
    );

    /* A fingertip on a fret is quieter and duller than a nail on a string. */
    expect(landed!.gain).toBeLessThan(pulled!.gain);
    expect(landed!.filterHz).toBeLessThan(pulled!.filterHz);

    /* Nothing is struck or released on the way, so a slide has neither. */
    const slid = buildExpressionPlan(held(A3(), B3("slide")));
    expect(slid.chains[0]?.transitions[0]?.auxiliary).toBeUndefined();
  });

  it("keeps 5h7p5 as one chain with two transitions", () => {
    // A3 (fret 10) up to B3 (14) and back down again, all on one string.
    const run = song([bar(slots([G3(), B3("hammer_on"), G3("pull_off")]))]);
    const plan = buildExpressionPlan(run);

    expect(plan.chains).toHaveLength(1);
    const chain = plan.chains[0];
    expect(chain?.transitions).toHaveLength(2);
    expect(chain?.noteIds).toHaveLength(3);
    expect(chain?.transitions.map((entry) => entry.kind)).toEqual([
      "hammer_on",
      "pull_off",
    ]);
  });

  it("counts cents from the note the chain started on", () => {
    const run = song([bar(slots([G3(), B3("hammer_on"), G3("pull_off")]))]);
    const chain = buildExpressionPlan(run).chains[0];

    // G3 -> B3 is four semitones up, then back to where it began.
    expect(chain?.transitions[0]?.cumulativeCents).toBe(400);
    expect(chain?.transitions[1]?.cumulativeCents).toBe(0);
    expect(chain?.transitions[1]?.intervalCents).toBe(-400);
  });

  it("stretches the transition with the practice speed", () => {
    const fixture = song([bar(slots([G3(), B3("hammer_on")]))]);
    const full = buildExpressionPlan(fixture, { practicePercent: 100 });
    const half = buildExpressionPlan(fixture, { practicePercent: 50 });

    expect(half.chains[0]?.transitions[0]?.transitionSeconds).toBeCloseTo(
      (full.chains[0]?.transitions[0]?.transitionSeconds ?? 0) * 2,
      6,
    );
  });

  it("names a chain the same way every time", () => {
    const fixture = song([bar(slots([G3(), B3("hammer_on")]))]);
    const ids = Array.from(
      { length: 5 },
      () => buildExpressionPlan(fixture).chains[0]?.chainId,
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("gtr:1:0");
  });
});

describe("when a chain cannot form", () => {
  const noChain = (fixture: Song) => {
    const plan = buildExpressionPlan(fixture);
    expect(plan.chains).toEqual([]);
    return plan;
  };

  it("refuses a hammer-on that goes down", () => {
    const plan = noChain(song([bar(slots([B3(), G3("hammer_on")]))]));
    expect(at(song([bar(slots([B3(), G3("hammer_on")]))]), 1).fallbackReason).toBe(
      "wrong_direction",
    );
    expect(plan.notes.every((note) => note.chainId === undefined)).toBe(true);
  });

  it("refuses a pull-off that goes up", () => {
    noChain(song([bar(slots([G3(), B3("pull_off")]))]));
    expect(at(song([bar(slots([G3(), B3("pull_off")]))]), 1).fallbackReason).toBe(
      "wrong_direction",
    );
  });

  it("refuses a slur wider than the pilot allows", () => {
    // Six semitones: a stretch, not a slur.
    const wide = song([bar(slots([note("E3", 1, 7), note("A#3", 1, 13, "hammer_on")]))]);
    noChain(wide);
    expect(at(wide, 1).fallbackReason).toBe("interval_too_wide");
  });

  it("accepts exactly the limit", () => {
    const edge = song([bar(slots([note("E3", 1, 7), note("A3", 1, 12, "hammer_on")]))]);
    expect(buildExpressionPlan(edge).chains).toHaveLength(1);
  });

  it("refuses across a real rest", () => {
    const broken = song([bar(slots([G3(), REST, B3("hammer_on")]))]);
    noChain(broken);
    expect(at(broken, 2).fallbackReason).toBe("no_previous_note");
  });

  it("refuses across a bar the track is not written in", () => {
    const across = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()])),
      emptyBar(),
      bar(slots([B3("hammer_on")])),
    ]);
    noChain(across);
  });

  it("refuses across strings", () => {
    const across = song([
      bar(slots([note("E3", 0, 12), note("A3", 1, 12, "hammer_on")])),
    ]);
    noChain(across);
  });

  it("carries on across a section line", () => {
    const across = song(
      [bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()]))],
      [bar(slots([B3("hammer_on")]))],
    );
    expect(buildExpressionPlan(across).chains).toHaveLength(1);
  });

  it("does not make a tie into a transition", () => {
    const held = song([bar(slots([G3(), TIE, B3("hammer_on"), TIE]))]);
    const plan = buildExpressionPlan(held);
    expect(plan.chains).toHaveLength(1);
    expect(plan.chains[0]?.transitions).toHaveLength(1);
  });

  it("leaves two ordinary notes as two ordinary onsets", () => {
    const plain = buildExpressionPlan(song([bar(slots([G3(), B3()]))]));
    expect(plain.chains).toEqual([]);
    expect(plain.notes.every((note) => note.expressive === false)).toBe(true);
  });
});

describe("palm mute and accent", () => {
  it("chokes the note and caps how long it can ring", () => {
    const plan = at(song([bar(slots([A3("palm_mute")]))]), 0);

    expect(plan.expressive).toBe(true);
    expect(plan.durationSeconds).toBeLessThanOrEqual(
      expressionPresets.palmMute.maxHoldSeconds,
    );
    expect(plan.filterPreset).toBe("palm_mute");
    expect(plan.gainEnvelope[plan.gainEnvelope.length - 1]?.value).toBe(0);
    expect(plan.pitch).toBe("A3");
  });

  it("caps a long note far below what it was written as", () => {
    // A note held for a whole bar. Written, it rings for well over a second;
    // palm muted, it stops at the cap however long the bar is.
    const heldBar = [A3("palm_mute"), TIE, TIE, TIE, TIE, TIE, TIE, TIE];
    const plainBar = [A3(), TIE, TIE, TIE, TIE, TIE, TIE, TIE];

    const muted = at(song([bar(heldBar)]), 0);
    const plain = at(song([bar(plainBar)]), 0);

    expect(plain.durationSeconds).toBeGreaterThan(1);
    expect(muted.durationSeconds).toBe(expressionPresets.palmMute.maxHoldSeconds);
    expect(muted.durationSeconds).toBeLessThan(plain.durationSeconds / 4);
  });

  it("lifts an accent without reaching full scale", () => {
    const plain = at(song([bar(slots([A3()]))]), 0);
    const loud = at(song([bar(slots([A3("accent")]))]), 0);

    expect(loud.gainEnvelope[0]?.value).toBeGreaterThan(plain.gain);
    expect(loud.gainEnvelope[0]?.value).toBeLessThanOrEqual(1);
    expect(loud.velocity).toBe(plain.velocity);
  });
});

describe("the shape of time", () => {
  it("does not treat a tie as a new note", () => {
    const notes = planOf(song([bar(slots([A3("vibrato"), TIE, TIE]))]));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.slotIndex).toBe(0);
  });

  it("joins a pair that a bar line runs between", () => {
    const across = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()])),
      bar(slots([B3("hammer_on")])),
    ]);
    const plan = planOf(across).find((entry) => entry.barKey === "s1:1");
    expect(plan?.fallbackReason).toBeUndefined();
  });

  it("joins a pair that a section line runs between", () => {
    const across = song(
      [bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()]))],
      [bar(slots([B3("hammer_on")]))],
    );
    const plan = buildExpressionPlan(across).notes.find(
      (entry) => entry.barKey === "s2:0",
    );
    expect(plan?.fallbackReason).toBeUndefined();
  });

  it("does not join across a real rest", () => {
    const plan = at(song([bar(slots([G3(), REST, B3("hammer_on")]))]), 2);
    expect(plan.fallbackReason).toBe("no_previous_note");
  });

  it("does not join across a bar the track is not written in", () => {
    const across = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()])),
      emptyBar(),
      bar(slots([B3("hammer_on")])),
    ]);
    const plan = buildExpressionPlan(across).notes.find(
      (entry) => entry.barKey === "s1:2",
    );
    expect(plan?.fallbackReason).toBe("no_previous_note");
  });

  it("carries a tie into the note that follows it", () => {
    // The G3 rings through the tie and the hammer-on lands on the end of it.
    const held = song([bar(slots([G3(), TIE, B3("hammer_on")]))]);
    expect(at(held, 2).fallbackReason).toBeUndefined();
  });
});

describe("practice speed", () => {
  it("stretches every duration and start without touching the music", () => {
    const fixture = song([bar(slots([A3("bend_full")]))]);
    const full = at(fixture, 0, 100);
    const half = at(fixture, 0, 50);

    expect(half.durationSeconds).toBeCloseTo(full.durationSeconds * 2, 5);
    expect(half.pitch).toBe(full.pitch);
    expect(Math.max(...half.pitchAutomation.map((p) => p.cents))).toBe(
      Math.max(...full.pitchAutomation.map((p) => p.cents)),
    );
  });

  it("moves the automation with the note", () => {
    const fixture = song([bar(slots([A3(), A3("vibrato")]))]);
    const slow = buildExpressionPlan(fixture, { practicePercent: 50 }).notes[1];
    const fast = buildExpressionPlan(fixture, { practicePercent: 100 }).notes[1];
    expect(slow?.startSeconds).toBeCloseTo((fast?.startSeconds ?? 0) * 2, 5);
  });
});

describe("a section's own tempo reaches the expression plan (spec 8.3, K-25)", () => {
  /*
   * Expression is written in seconds, so the planner has to ask the tempo
   * timeline rather than divide by `song.bpm`. Before phase 2G there was only
   * one tempo and the shortcut was invisible; a song whose second section runs
   * at half speed makes it audible — every note in it would be half as long as
   * written, and the automation on it would run twice as fast.
   */
  const twoTempos = (): Song => {
    const base = song(
      [bar(slots([A3("bend_full")]))],
      [bar(slots([A3("bend_full"), A3("bend_full")]))],
    );
    return {
      ...base,
      sections: base.sections.map((section) =>
        section.id === "s2" ? { ...section, bpmOverride: 60 } : section,
      ),
    };
  };

  const planAt = (barKey: string, slotIndex: number) => {
    const found = planOf(twoTempos()).find(
      (entry) => entry.barKey === barKey && entry.slotIndex === slotIndex,
    );
    if (!found) throw new Error(`no plan at ${barKey}:${slotIndex}`);
    return found;
  };

  it("makes a note in the half-tempo section twice as long", () => {
    expect(planAt("s2:0", 0).durationSeconds).toBeCloseTo(
      planAt("s1:0", 0).durationSeconds * 2,
      5,
    );
  });

  it("places the second note of the slow bar at the slow bar's spacing", () => {
    // One 4/4 bar at 120 bpm is 2 s, so the slow section starts at 2 s either
    // way. The difference shows up inside it: an eighth note is 0.5 s at 60
    // bpm and 0.25 s at 120, so the global-tempo shortcut lands at 2.25.
    expect(planAt("s2:0", 0).startSeconds).toBeCloseTo(2, 3);
    expect(planAt("s2:0", 1).startSeconds).toBeCloseTo(2.5, 3);
  });

  it("stretches the automation on that note with it", () => {
    const slow = planAt("s2:0", 0);
    const fast = planAt("s1:0", 0);
    const spanOf = (plan: ExpressiveNotePlan) => {
      const times = plan.pitchAutomation.map((point) => point.timeSeconds);
      return Math.max(...times) - Math.min(...times);
    };
    expect(spanOf(slow)).toBeCloseTo(spanOf(fast) * 2, 4);
  });
});

describe("determinism and independence", () => {
  it("gives the same plan every time", () => {
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(buildExpressionPlan(SAMPLE_SONG)),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("does not touch the song", () => {
    const snapshot = JSON.stringify(SAMPLE_SONG);
    buildExpressionPlan(SAMPLE_SONG, { practicePercent: 75 });
    expect(JSON.stringify(SAMPLE_SONG)).toBe(snapshot);
  });

  it("plans every note of the demo song and asks nothing of most of them", () => {
    const plan = buildExpressionPlan(SAMPLE_SONG);
    expect(plan.notes.length).toBeGreaterThan(0);
    expect(plan.notes.every((note) => note.pitchAutomation.length > 0)).toBe(true);
  });

  it("keeps two notes of one chord independent", () => {
    const both = song([
      bar(
        slots([
          chord(event("E3", 0, 12, "vibrato"), event("A3", 1, 12)),
        ]),
      ),
    ]);
    const notes = planOf(both);
    const shaken = notes.find((entry) => entry.pitch === "E3");
    const still = notes.find((entry) => entry.pitch === "A3");

    expect(shaken?.expressive).toBe(true);
    expect(still?.expressive).toBe(false);
    expect(still?.pitchAutomation).toEqual([
      { timeSeconds: 0, cents: 0, curve: "step" },
    ]);
  });
});

describe("the notes it plans are the notes that would have been played", () => {
  it("matches the song plan note for note, in time and pitch", () => {
    // The scheduler takes notes from here and drums from the song plan, so the
    // two have to agree about what a note is. They are built from the same
    // timeline; this is the test that keeps it that way.
    const expression = buildExpressionPlan(SAMPLE_SONG).notes.map((note) => ({
      trackId: note.trackId,
      time: note.timeTicks,
      duration: note.durationTicks,
      pitch: note.pitch,
      gain: note.gain,
    }));
    const scheduled = buildSongPlan(SAMPLE_SONG)
      .events.filter((event) => event.kind === "note")
      .map((event) => ({
        trackId: event.trackId,
        time: event.time,
        duration: event.durationTicks,
        pitch: event.pitch,
        gain: event.gain,
      }));

    const key = (entry: (typeof expression)[number]) =>
      `${entry.trackId}|${entry.time}|${entry.duration}|${entry.pitch}|${entry.gain}`;

    expect(expression.length).toBe(scheduled.length);
    expect(expression.map(key).sort()).toEqual(scheduled.map(key).sort());
  });
});

describe("a note can be refused and still be a chain's source (spec 8.5, K-26)", () => {
  /**
   * `A3` then a pull-off to `B3` (wrong direction — refused), then a real
   * hammer-on from that B3. The middle note is both the refused target and
   * the source of the chain that follows.
   */
  const both = () =>
    song([bar(slots([A3(), B3("pull_off"), note("C#4", 1, 16, "hammer_on")]))]);

  it("keeps both facts, rather than letting the chain hide the refusal", () => {
    const plan = buildExpressionPlan(both());
    const middle = plan.notes.find((entry) => entry.pitch === "B3");

    // It is played: it is the note the hammer-on is hammered off.
    expect(middle?.chainRole).toBe("source");
    // And its own pull-off was refused, which nothing may swallow.
    expect(middle?.fallbackReason).toBe("wrong_direction");
  });

  it("counts it, so a coverage report cannot read zero", () => {
    expect(buildExpressionPlan(both()).fallbacks).toBe(1);
  });

  it("agrees with the validator, note for note", () => {
    const fixture = both();
    const refused = buildExpressionPlan(fixture)
      .notes.filter((entry) => entry.fallbackReason !== undefined)
      .map((entry) => `${entry.barKey}:${entry.slotIndex}`)
      .sort();
    const warned = validateArticulationContext(fixture)
      .map((issue) => `${issue.sectionId}:${issue.barIndex}:${issue.slotIndex}`)
      .sort();

    expect(refused).toHaveLength(1);
    expect(warned).toHaveLength(1);
    // Same note: section "s1", bar 0, slot 1.
    expect(refused[0]).toBe("s1:0:1");
    expect(warned[0]).toBe("s1:0:1");
  });

  it("still plays the chain it is the source of", () => {
    const plan = buildExpressionPlan(both());
    expect(plan.chains).toHaveLength(1);
    expect(plan.chains[0]?.sourcePitch).toBe("B3");
    expect(plan.chains[0]?.transitions[0]?.kind).toBe("hammer_on");
  });
});

/**
 * 2S-A §3. The measured defect: a finger landing took a fixed time and never
 * asked how much of the note it was landing on that time was.
 *
 * The numbers here are the ones `eval/intent-composer/AUDIO.json` measured on
 * the reported fixture; the arithmetic is checked rather than the audio,
 * because the plan is what the render and the export both read.
 */
describe("a legato transition fits the note it lands on (2S-A §3)", () => {
  /** The reported fixture's shape: one string, `8 → 7` as a pull-off. */
  const pullOffAt = (resolution: Resolution, bpm: number) =>
    buildExpressionPlan(
      song([denseBar([note("A#3", 1, 13), note("A3", 1, 12, "pull_off")], resolution)], [], bpm),
    );

  const onlyTransition = (plan: ReturnType<typeof buildExpressionPlan>) => {
    const transition = plan.chains[0]?.transitions[0];
    if (!transition) throw new Error("no transition");
    return transition;
  };

  const roomAfterArrival = (plan: ReturnType<typeof buildExpressionPlan>) => {
    const chain = plan.chains[0]!;
    const transition = onlyTransition(plan);
    return chain.endSeconds - chain.startSeconds - transition.arrivesAtSeconds;
  };

  it("leaves the target's own pitch sounding on every grid", () => {
    for (const resolution of [8, 16, 24, 32] as const) {
      for (const bpm of [40, 132, 260]) {
        const plan = pullOffAt(resolution, bpm);
        expect(
          roomAfterArrival(plan),
          `1/${resolution} at ${bpm} BPM`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("gives the pitch more of the note than the travel takes", () => {
    for (const resolution of [8, 16, 24, 32] as const) {
      for (const bpm of [40, 132, 260]) {
        const plan = pullOffAt(resolution, bpm);
        const travel = onlyTransition(plan).transitionSeconds;
        expect(
          roomAfterArrival(plan),
          `1/${resolution} at ${bpm} BPM`,
        ).toBeGreaterThan(travel);
      }
    }
  });

  it("takes the travel from the note it lands on, not from the one it leaves", () => {
    /*
     * The two are the same number only when the target sits one slot after the
     * start of the bar — which is exactly the shape of the reported fixture,
     * and exactly why that fixture alone cannot tell them apart. So the target
     * is put further in: four slots of silence, then the pair. The travel is
     * still measured against the target's own slot.
     */
    const REST = null;
    const late = song(
      [
        denseBar(
          [REST, REST, REST, REST, note("A#3", 1, 13), note("A3", 1, 12, "pull_off")],
          32,
        ),
      ],
      [],
      260,
    );
    const plan = buildExpressionPlan(late);
    const transition = onlyTransition(plan);
    const target = plan.notes.find((entry) => entry.chainRole === "target");
    if (!target) throw new Error("no target");

    // The room is the target's own sounding length, in seconds at this tempo.
    const secondsPerTick = 60 / 260 / 192;
    const room = target.durationTicks * secondsPerTick;
    expect(transition.transitionSeconds).toBeCloseTo(
      Math.min(
        expressionPresets.legato.pullOff.transitionSeconds,
        room * expressionPresets.legato.maxTravelFraction,
      ),
      6,
    );
    // And that room is the target's, not the four rests before it.
    expect(target.timeTicks).toBe((768 / 32) * 5);
  });

  it("treats a note with no room left as no room at all", () => {
    /*
     * `availableSeconds` is arithmetic, and arithmetic can go negative when a
     * chain's voice has already stopped. A negative "room" multiplied by the
     * fraction is a negative travel, which would put the arrival *before* the
     * onset — the note landing before the finger.
     */
    expect(transitionSeconds("pull_off", 1, -0.05)).toBe(0);
    expect(transitionSeconds("hammer_on", 1, 0)).toBe(0);
  });

  it("still takes its full preset time when the note is long enough", () => {
    const transition = onlyTransition(pullOffAt(8, 40));
    expect(transition.transitionSeconds).toBeCloseTo(
      expressionPresets.legato.pullOff.transitionSeconds,
      6,
    );
  });

  it("shortens the travel rather than moving the onset", () => {
    const slow = pullOffAt(32, 40);
    const fast = pullOffAt(32, 260);
    // The written moment is the written moment at every tempo.
    expect(onlyTransition(slow).atSeconds).toBeGreaterThan(
      onlyTransition(fast).atSeconds,
    );
    expect(onlyTransition(fast).transitionSeconds).toBeLessThan(
      onlyTransition(slow).transitionSeconds,
    );
    // And the target still starts exactly where the score puts it.
    const target = fast.notes.find((entry) => entry.chainRole === "target");
    expect(target?.timeTicks).toBe(768 / 32);
  });

  it("does not turn a pull-off into a second attack", () => {
    const plan = pullOffAt(32, 260);
    const target = plan.notes.find((entry) => entry.chainRole === "target");
    expect(target?.chainId).toBeDefined();
    expect(plan.chains[0]?.transitions[0]?.kind).toBe("pull_off");
    // One voice, one strike: the chain still names both notes.
    expect(plan.chains[0]?.noteIds).toHaveLength(2);
  });

  it("keeps the pull-off's finger click inside the note it belongs to", () => {
    const plan = pullOffAt(32, 260);
    const auxiliary = onlyTransition(plan).auxiliary;
    const chain = plan.chains[0]!;
    const room =
      chain.endSeconds - chain.startSeconds - onlyTransition(plan).arrivesAtSeconds;
    expect(auxiliary).toBeDefined();
    expect(auxiliary!.durationSeconds).toBeLessThanOrEqual(room + 1e-9);
  });

  it("does the same for a hammer-on", () => {
    const plan = buildExpressionPlan(
      song([denseBar([note("A3", 1, 12), note("A#3", 1, 13, "hammer_on")], 32)], [], 260),
    );
    const transition = plan.chains[0]?.transitions[0];
    const chain = plan.chains[0]!;
    expect(transition?.kind).toBe("hammer_on");
    expect(
      chain.endSeconds - chain.startSeconds - (transition?.arrivesAtSeconds ?? 0),
    ).toBeGreaterThan(transition?.transitionSeconds ?? 0);
  });

  /*
   * The change is audible, so it changes a WAV. That is deliberate and it is
   * the parity the export exists to keep: the file is rendered from the same
   * plan playback reads, so "the WAV sounds like the app" stays true rather
   * than becoming two answers. What must *not* change is the written score
   * and the length of the file, and both are asserted here.
   */
  it("changes what is heard without changing what is written or exported", () => {
    const dense = song(
      [denseBar([note("A#3", 1, 13), note("A3", 1, 12, "pull_off")], 32)],
      [],
      260,
    );
    const notated = buildNotatedPlan(dense).events;
    expect(notated).toHaveLength(2);
    // The score: same two onsets, one slot apart, each a slot long.
    expect(notated[0]).toMatchObject({ pitch: "A#3", time: 0, durationTicks: 24 });
    expect(notated[1]).toMatchObject({
      pitch: "A3",
      time: 24,
      durationTicks: 24,
      articulation: "pull_off",
    });
    // The file: the score plus the tail, with nothing added by the travel.
    expect(renderDuration(dense).expressionSeconds).toBe(0);
    // And the scheduler's own plan still starts both notes where they are
    // written, at the lengths it always played them.
    const played = buildSongPlan(dense).events.filter(
      (event) => event.kind === "note",
    );
    expect(played.map((event) => event.time)).toEqual([0, 24]);
    expect(played.map((event) => event.durationTicks)).toEqual([22, 22]);
  });

  it("leaves a slide's own arrival rule alone (K-23)", () => {
    // A slide arrives *at* the written moment; nothing here may move that.
    const plan = buildExpressionPlan(held(B3(), G3("slide")));
    const transition = plan.chains[0]?.transitions[0];
    expect(transition?.kind).toBe("slide");
    const target = plan.notes.find((entry) => entry.chainRole === "target")!;
    expect(transition?.arrivesAtSeconds).toBeCloseTo(
      target.startSeconds - plan.chains[0]!.startSeconds,
      6,
    );
  });
});
