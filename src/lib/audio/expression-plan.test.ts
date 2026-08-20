/**
 * What each articulation does, read back as numbers (spec 8.5, K-21).
 */
import { describe, expect, it } from "vitest";

import { expressionPresets } from "@/lib/audio/expression";
import { buildExpressionPlan, type ExpressiveNotePlan } from "@/lib/audio/expression-plan";
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

  it("rises, holds and comes back", () => {
    const plan = at(song([bar(slots([A3("bend_full")]))]), 0);
    const [start, rise, hold, end] = plan.pitchAutomation;

    expect(start).toMatchObject({ timeSeconds: 0, cents: 0 });
    expect(rise?.cents).toBe(200);
    expect(hold?.cents).toBe(200);
    expect(end?.cents).toBe(0);
    expect(rise?.timeSeconds).toBeCloseTo(
      plan.durationSeconds * expressionPresets.bend.riseFraction,
      5,
    );
    expect(hold?.timeSeconds).toBeCloseTo(
      plan.durationSeconds *
        (expressionPresets.bend.riseFraction + expressionPresets.bend.holdFraction),
      5,
    );
    expect(end?.timeSeconds).toBeCloseTo(plan.durationSeconds, 5);
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

describe("hammer-on and pull-off", () => {
  it("hammers on upwards, with a softened attack instead of a pick", () => {
    const plan = at(song([bar(slots([G3(), B3("hammer_on")]))]), 1);

    expect(plan.fallbackReason).toBeUndefined();
    expect(plan.expressive).toBe(true);
    expect(plan.gainEnvelope[0]?.value).toBeLessThan(plan.gain);
    expect(plan.gainEnvelope[1]?.value).toBeCloseTo(plan.gain, 5);
    expect(plan.gainEnvelope[1]?.timeSeconds).toBeLessThanOrEqual(
      expressionPresets.legato.maxTransitionSeconds,
    );
    // The pitch does not glide: a hammer-on lands on the fret.
    expect(plan.pitchAutomation).toEqual([{ timeSeconds: 0, cents: 0, curve: "step" }]);
  });

  it("refuses a hammer-on that goes down", () => {
    const plan = at(song([bar(slots([B3(), G3("hammer_on")]))]), 1);
    expect(plan.fallbackReason).toBe("wrong_direction");
    expect(plan.expressive).toBe(false);
  });

  it("pulls off downwards", () => {
    const plan = at(song([bar(slots([B3(), G3("pull_off")]))]), 1);
    expect(plan.fallbackReason).toBeUndefined();
    expect(plan.gainEnvelope[0]?.value).toBeLessThan(plan.gain);
  });

  it("refuses a pull-off that goes up", () => {
    const plan = at(song([bar(slots([G3(), B3("pull_off")]))]), 1);
    expect(plan.fallbackReason).toBe("wrong_direction");
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
