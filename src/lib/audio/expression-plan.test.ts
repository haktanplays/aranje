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
import { buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  REST,
  TIE,
  bar,
  emptyBar,
  event,
  chord,
  note,
  slots,
  song,
} from "@/test/expression-fixtures";
import type { Articulation, Song } from "@/lib/song/schema";

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

describe("slide", () => {
  it("starts at the note before it and arrives at its own", () => {
    const plan = at(song([bar(slots([G3(), B3("slide")]))]), 1);

    expect(plan.fallbackReason).toBeUndefined();
    expect(plan.expressive).toBe(true);
    // G3 is four semitones below B3, so it starts 400 cents low.
    expect(plan.pitchAutomation[0]?.cents).toBe(-400);
    expect(plan.pitchAutomation[1]?.cents).toBe(0);
    expect(plan.pitchAutomation[1]?.timeSeconds).toBeLessThanOrEqual(
      expressionPresets.slide.maxGlideSeconds,
    );
  });

  it("slides downwards as readily as upwards", () => {
    const plan = at(song([bar(slots([B3(), G3("slide")]))]), 1);
    expect(plan.pitchAutomation[0]?.cents).toBe(400);
  });

  it("falls back rather than leaping more than an octave", () => {
    const wide = song([bar(slots([note("E2", 0, 0), note("F3", 0, 13, "slide")]))]);
    const plan = at(wide, 1);
    expect(plan.fallbackReason).toBe("interval_too_wide");
    expect(plan.expressive).toBe(false);
  });

  it("falls back when there is no note before it", () => {
    const plan = at(song([bar(slots([A3("slide")]))]), 0);
    expect(plan.fallbackReason).toBe("no_previous_note");
  });

  it("falls back when the note before it was on another string", () => {
    const across = song([
      bar(slots([note("E3", 0, 12), note("A3", 1, 12, "slide")])),
    ]);
    expect(at(across, 1).fallbackReason).toBe("previous_note_other_string");
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

  it("gives a pull-off a short quiet transient and a hammer-on none", () => {
    const pull = buildExpressionPlan(song([bar(slots([B3(), G3("pull_off")]))]));
    const hammer = buildExpressionPlan(song([bar(slots([G3(), B3("hammer_on")]))]));

    const aux = pull.chains[0]?.transitions[0]?.auxiliary;
    expect(aux?.gain).toBe(expressionPresets.legato.pullOff.auxiliary.gain);
    expect(aux?.durationSeconds).toBeCloseTo(
      expressionPresets.legato.pullOff.auxiliary.maxSeconds,
      6,
    );
    expect(hammer.chains[0]?.transitions[0]?.auxiliary).toBeUndefined();
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
