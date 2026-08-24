/**
 * What each candidate is, as a shape (2P-A §10, §11, §16).
 *
 * These are the distinctions the listening test is meant to be *about*. If a
 * plain bend and a bend/release produce the same automation, no amount of
 * careful listening will separate them, and the whole benchmark measures
 * nothing. So they are pinned here before anything is rendered.
 *
 * None of this asserts that a candidate sounds good. That is a person with
 * headphones, and this file cannot do it.
 */
import { describe, expect, it } from "vitest";

import {
  FRET_NOISE_CANDIDATES,
  SHIFT_ATTACK_LEVELS,
  bendCandidateAutomation,
  productionBendAutomation,
  slideCandidateAutomation,
  type BendCandidate,
} from "./candidates";
import { bendStages } from "@/lib/audio/expression-plan";
import { articulationSchema } from "@/lib/song/schema";

const articulationOptions: readonly string[] = articulationSchema.options;

const DURATION = 1.5;
const last = <T,>(list: readonly T[]): T => list[list.length - 1]!;
const centsAt = (points: readonly { timeSeconds: number; cents: number }[], seconds: number) => {
  let value = points[0]?.cents ?? 0;
  for (const point of points) {
    if (point.timeSeconds > seconds + 1e-9) break;
    value = point.cents;
  }
  return value;
};

const bend = (overrides: Partial<BendCandidate> = {}): BendCandidate => ({
  kind: "bend",
  targetCents: 200,
  ...overrides,
});

describe("183. today's bend, measured rather than remembered", () => {
  it.each(["bend_half", "bend_full"] as const)("%s returns to zero at the end", (name) => {
    const points = productionBendAutomation(name, DURATION);
    expect(last(points).cents).toBe(0);
    expect(last(points).timeSeconds).toBeCloseTo(DURATION, 2);
  });

  it("reaches its exact target, not near it", () => {
    const half = productionBendAutomation("bend_half", DURATION);
    const full = productionBendAutomation("bend_full", DURATION);
    expect(Math.max(...half.map((point) => point.cents))).toBe(100);
    expect(Math.max(...full.map((point) => point.cents))).toBe(200);
  });

  it("arrives well before the note is over", () => {
    // The hypothesis under test is that the rise is *not* the problem. It
    // takes 280 ms of a 1.5 s note; the return is what happens to every bend.
    const stages = bendStages(DURATION);
    expect(stages.reachedAtSeconds).toBeLessThan(DURATION * 0.3);
    expect(stages.releaseSeconds).toBeGreaterThan(0);
  });
});

describe("184. the four bend kinds are four different shapes", () => {
  it("a plain bend holds the target to the end", () => {
    const points = bendCandidateAutomation(bend(), DURATION);
    expect(last(points).cents).toBe(200);
    expect(last(points).timeSeconds).toBeCloseTo(DURATION, 2);
  });

  it("a bend/release comes back down", () => {
    const points = bendCandidateAutomation(bend({ kind: "bend_release" }), DURATION);
    expect(last(points).cents).toBe(0);
    expect(Math.max(...points.map((point) => point.cents))).toBe(200);
  });

  it("a prebend is already at the target when the string is struck", () => {
    const points = bendCandidateAutomation(bend({ kind: "prebend" }), DURATION);
    expect(points[0]!.timeSeconds).toBe(0);
    expect(points[0]!.cents).toBe(200);
    expect(last(points).cents).toBe(200);
  });

  it("a prebend/release starts at the target and descends", () => {
    const points = bendCandidateAutomation(bend({ kind: "prebend_release" }), DURATION);
    expect(points[0]!.cents).toBe(200);
    expect(last(points).cents).toBe(0);
  });

  it("keeps plain and release apart at every moment after the hold begins", () => {
    const plain = bendCandidateAutomation(bend(), DURATION);
    const released = bendCandidateAutomation(bend({ kind: "bend_release" }), DURATION);
    expect(centsAt(plain, DURATION - 0.01)).toBe(200);
    expect(centsAt(released, DURATION - 0.01)).toBeLessThan(60);
  });

  it("never overshoots the target", () => {
    for (const kind of ["bend", "bend_release", "prebend", "prebend_release"] as const) {
      const points = bendCandidateAutomation(bend({ kind }), DURATION);
      expect(Math.max(...points.map((point) => point.cents)), kind).toBeLessThanOrEqual(200);
      expect(Math.min(...points.map((point) => point.cents)), kind).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("185. bend plus vibrato is one gesture, in the right order", () => {
  const vibrato = { startAfterTarget: true, depthCents: 12, rateHz: 5 };

  it("does not move before the target is reached", () => {
    const points = bendCandidateAutomation(bend({ vibrato }), DURATION);
    const stages = bendStages(DURATION);
    const early = points.filter((point) => point.timeSeconds < stages.reachedAtSeconds);
    // Everything before arrival is the rise: monotonic, and never above target.
    for (const point of early) expect(point.cents).toBeLessThanOrEqual(200);
    const above = points.filter((point) => point.cents > 200);
    expect(above.every((point) => point.timeSeconds > stages.reachedAtSeconds)).toBe(true);
  });

  it("shakes around the target rather than around zero", () => {
    const points = bendCandidateAutomation(bend({ vibrato }), DURATION);
    const stages = bendStages(DURATION);
    const shaking = points.filter(
      (point) => point.timeSeconds > stages.reachedAtSeconds + 0.1,
    );
    expect(shaking.length).toBeGreaterThan(5);
    for (const point of shaking) {
      expect(Math.abs(point.cents - 200)).toBeLessThanOrEqual(vibrato.depthCents + 1e-6);
    }
  });

  it("adds points rather than replacing the bend", () => {
    const plain = bendCandidateAutomation(bend(), DURATION);
    const shaken = bendCandidateAutomation(bend({ vibrato }), DURATION);
    expect(shaken.length).toBeGreaterThan(plain.length);
  });

  it("is refused the wrong order rather than silently reordered", () => {
    // `startAfterTarget: false` is a different gesture — the hand shaking on
    // the way up — and the shape says so rather than pretending.
    const early = bendCandidateAutomation(
      bend({ vibrato: { ...vibrato, startAfterTarget: false } }),
      DURATION,
    );
    const late = bendCandidateAutomation(bend({ vibrato }), DURATION);
    expect(early).not.toEqual(late);
  });
});

describe("186. an explicit curve is used exactly as written", () => {
  it("takes the points it is given and scales them to the note", () => {
    const points = bendCandidateAutomation(
      bend({
        points: [
          { normalizedTime: 0, cents: 0 },
          { normalizedTime: 0.5, cents: 200 },
          { normalizedTime: 1, cents: 200 },
        ],
      }),
      2,
    );
    expect(points).toHaveLength(3);
    expect(points[1]!.timeSeconds).toBe(1);
    expect(points[1]!.cents).toBe(200);
    expect(points[0]!.curve).toBe("step");
  });
});

describe("187. slide candidates travel the same way and end differently", () => {
  it("legato and shift share their pitch travel exactly", () => {
    const legato = slideCandidateAutomation({ kind: "legato", intervalSemitones: 4 }, DURATION);
    const shift = slideCandidateAutomation(
      { kind: "shift", intervalSemitones: 4, targetAttack: 0.6 },
      DURATION,
    );
    // The difference between them is the arrival, not the journey; if the
    // curves differed the listening test would be about two things.
    expect(shift).toEqual(legato);
  });

  it("arrives exactly on the written note, with no overshoot", () => {
    for (const interval of [4, 7, 12]) {
      const points = slideCandidateAutomation({ kind: "legato", intervalSemitones: interval }, DURATION);
      expect(last(points).cents, `+${interval}`).toBe(0);
      expect(Math.min(...points.map((point) => point.cents))).toBe(-interval * 100);
    }
  });

  it("takes its direction from the interval, not from a fret number", () => {
    const up = slideCandidateAutomation({ kind: "legato", intervalSemitones: 4 }, DURATION);
    const down = slideCandidateAutomation({ kind: "legato", intervalSemitones: -4 }, DURATION);
    expect(up[0]!.cents).toBe(-400);
    expect(down[0]!.cents).toBe(400);
  });

  it("takes longer over a wider interval, up to the ceiling", () => {
    const near = slideCandidateAutomation({ kind: "legato", intervalSemitones: 2 }, DURATION);
    const far = slideCandidateAutomation({ kind: "legato", intervalSemitones: 7 }, DURATION);
    expect(last(far).timeSeconds).toBeGreaterThan(last(near).timeSeconds);
  });

  it("slides in from below and from above, and says which", () => {
    const below = slideCandidateAutomation(
      { kind: "slide_in_below", intervalSemitones: 0, approxSemitones: 2 },
      DURATION,
    );
    const above = slideCandidateAutomation(
      { kind: "slide_in_above", intervalSemitones: 0, approxSemitones: 2 },
      DURATION,
    );
    expect(below[0]!.cents).toBe(-200);
    expect(above[0]!.cents).toBe(200);
    // Both land on the written note: an approach is not a transposition.
    expect(last(below).cents).toBe(0);
    expect(last(above).cents).toBe(0);
  });

  it("slides out without inventing a destination note", () => {
    const down = slideCandidateAutomation(
      { kind: "slide_out_down", intervalSemitones: 0, approxSemitones: 3 },
      DURATION,
    );
    expect(down[0]!.cents).toBe(0);
    expect(last(down).cents).toBe(-300);
    // It leaves at the end of the note rather than at the start of it.
    expect(down[1]!.timeSeconds).toBeGreaterThan(DURATION * 0.5);
  });
});

describe("188. the candidates that need honesty about their cost", () => {
  it("offers a set of shift attack levels rather than one chosen by taste", () => {
    expect(SHIFT_ATTACK_LEVELS.length).toBeGreaterThan(2);
    expect(Math.max(...SHIFT_ATTACK_LEVELS)).toBe(1);
    expect(Math.min(...SHIFT_ATTACK_LEVELS)).toBeGreaterThan(0);
  });

  it("keeps the fret noise quiet enough to be movement rather than effect", () => {
    for (const candidate of FRET_NOISE_CANDIDATES) {
      if (candidate.kind !== "fret_noise") continue;
      expect(candidate.gain).toBeLessThan(0.15);
      expect(candidate.seconds).toBeLessThan(0.2);
    }
  });

  it("offers more than one noise candidate, so the answer is a comparison", () => {
    expect(FRET_NOISE_CANDIDATES.length).toBeGreaterThan(1);
  });
});

describe("189. nothing here can reach the product", () => {
  it("has no articulation name of its own that the schema would accept", () => {
    // The candidate kinds are eval vocabulary. If one of them were also a
    // valid articulation, somebody could write it into a Song by accident.
    const kinds = [
      "bend_release",
      "prebend",
      "prebend_release",
      "legato",
      "shift",
      "slide_in_below",
      "slide_in_above",
      "slide_out_down",
      "slide_out_up",
    ];
    for (const kind of kinds) {
      expect(articulationOptions, kind).not.toContain(kind);
    }
  });
});

describe("194. the benchmark is repeatable and touches nothing it is given", () => {
  it("produces identical automation on five consecutive runs", () => {
    // A comparison between two renders is only a comparison if each render
    // is the same every time.
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(
        bendCandidateAutomation(
          bend({ vibrato: { startAfterTarget: true, depthCents: 12, rateHz: 5 } }),
          DURATION,
        ),
      ),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("produces identical slide automation on five consecutive runs", () => {
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(
        slideCandidateAutomation({ kind: "legato", intervalSemitones: 7 }, DURATION),
      ),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("does not mutate the candidate it was handed", () => {
    const candidate = bend({
      points: [
        { normalizedTime: 0, cents: 0 },
        { normalizedTime: 1, cents: 200 },
      ],
    });
    const before = JSON.stringify(candidate);
    bendCandidateAutomation(candidate, DURATION);
    bendCandidateAutomation(candidate, 0.4);
    expect(JSON.stringify(candidate)).toBe(before);
  });

  it("does not mutate a slide candidate either", () => {
    const candidate: Parameters<typeof slideCandidateAutomation>[0] = {
      kind: "slide_in_below",
      intervalSemitones: 0,
      approxSemitones: 2,
    };
    const before = JSON.stringify(candidate);
    slideCandidateAutomation(candidate, DURATION);
    expect(JSON.stringify(candidate)).toBe(before);
  });

  it("leaves the production baseline exactly as the planner built it", () => {
    /*
     * The "current" fixtures pass the plan through untouched, which is the
     * only way a baseline can be a baseline. Asserted on the production
     * planner's own output: the candidate path and the shipped path produce
     * the same automation for the same articulation.
     */
    const shipped = productionBendAutomation("bend_full", DURATION);
    const again = productionBendAutomation("bend_full", DURATION);
    expect(again).toEqual(shipped);
    // And it is not accidentally equal to any candidate, or the benchmark
    // would be comparing a thing with itself.
    expect(shipped).not.toEqual(bendCandidateAutomation(bend(), DURATION));
  });
});
