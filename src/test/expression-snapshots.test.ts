/**
 * The articulations phase 2F.1 did **not** touch (spec 8.5, K-22).
 *
 * Hammer-on, pull-off and bend were rebuilt in this checkpoint. Vibrato,
 * slide, palm mute and accent were not, and a rebuild that quietly moved one
 * of them would be a regression nobody asked for. These are their numbers,
 * written out rather than referred to, so a change to any of them has to be a
 * deliberate edit to this file.
 */
import { describe, expect, it } from "vitest";

import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { expressionPresets } from "@/lib/audio/expression";
import { bar, note, slots, song, TIE } from "@/test/expression-fixtures";
import type { Articulation, MelodicSlot } from "@/lib/song/schema";

/** The plan for the first note of a one-bar fixture. */
function planOf(written: readonly MelodicSlot[]) {
  const found = buildExpressionPlan(song([bar(slots(written))])).notes[0];
  if (!found) throw new Error("no plan");
  return found;
}

const held = (articulation?: Articulation): MelodicSlot[] => [
  note("A3", 1, 12, articulation),
  TIE,
  TIE,
  TIE,
  TIE,
  TIE,
  TIE,
  TIE,
];

describe("vibrato is where phase 2F left it", () => {
  const preset = expressionPresets.vibrato;

  it("keeps its depth, rate, delay and resolution", () => {
    expect(preset).toEqual({
      depthCents: 35,
      rateHz: 5.5,
      maxDelaySeconds: 0.12,
      delayFraction: 0.25,
      pointsPerCycle: 12,
    });
  });

  it("produces the same curve it did before", () => {
    const plan = planOf(held("vibrato"));
    const cents = plan.pitchAutomation.map((point) => point.cents);

    expect(plan.pitchAutomation[0]).toEqual({ timeSeconds: 0, cents: 0, curve: "step" });
    expect(plan.pitchAutomation[1]).toEqual({
      timeSeconds: 0.12,
      cents: 0,
      curve: "linear",
    });
    expect(Math.max(...cents)).toBe(35);
    expect(Math.min(...cents)).toBe(-35);
    expect(plan.pitchAutomation[2]).toEqual({
      timeSeconds: 0.135152,
      cents: 17.5,
      curve: "sine",
    });
  });
});

describe("slide is where phase 2F left it", () => {
  it("keeps its glide and its octave limit", () => {
    expect(expressionPresets.slide).toEqual({
      maxGlideSeconds: 0.16,
      glideFraction: 0.35,
      maxIntervalSemitones: 12,
    });
  });

  it("still starts at the note before it and arrives in one ramp", () => {
    const plan = buildExpressionPlan(
      song([bar(slots([note("G3", 1, 10), note("B3", 1, 14, "slide")]))]),
    ).notes.find((entry) => entry.pitch === "B3");

    // The glide is the shorter of the cap and a third of the note; this note
    // is short, so the note decides.
    expect(plan?.pitchAutomation).toEqual([
      { timeSeconds: 0, cents: -400, curve: "step" },
      { timeSeconds: 0.080208, cents: 0, curve: "linear" },
    ]);
    expect(plan?.pitchAutomation[1]?.timeSeconds).toBeLessThanOrEqual(
      expressionPresets.slide.maxGlideSeconds,
    );
  });
});

describe("palm mute is where phase 2F left it", () => {
  it("keeps its cap, its release and its filter", () => {
    expect(expressionPresets.palmMute).toEqual({
      holdFraction: 0.45,
      maxHoldSeconds: 0.18,
      releaseSeconds: 0.04,
      filterHz: 2200,
      filterQ: 0.7,
    });
  });

  it("still chokes a long note to the cap", () => {
    const plan = planOf(held("palm_mute"));
    expect(plan.durationSeconds).toBe(0.18);
    expect(plan.filterPreset).toBe("palm_mute");
    expect(plan.gainEnvelope[plan.gainEnvelope.length - 1]?.value).toBe(0);
    expect(plan.pitchAutomation).toEqual([
      { timeSeconds: 0, cents: 0, curve: "step" },
    ]);
  });
});

describe("accent is where phase 2F left it", () => {
  it("keeps its multiplier", () => {
    expect(expressionPresets.accent).toEqual({ gainMultiplier: 1.18 });
  });

  it("still lifts the level and moves no pitch", () => {
    const plain = planOf(held());
    const loud = planOf(held("accent"));

    expect(loud.gainEnvelope[0]?.value).toBeCloseTo(plain.gain * 1.18, 6);
    expect(loud.pitchAutomation).toEqual([
      { timeSeconds: 0, cents: 0, curve: "step" },
    ]);
  });
});

describe("an ordinary note is still ordinary", () => {
  it("has no automation, no envelope and no voice of its own", () => {
    const plan = planOf(held());
    expect(plan.expressive).toBe(false);
    expect(plan.chainId).toBeUndefined();
    expect(plan.gainEnvelope).toEqual([]);
  });
});
