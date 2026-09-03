/**
 * What each bend actually does to the pitch (2V-C.1 §6).
 *
 * The four kinds have to be four different sounds, and each of them has to be
 * the sound its name claims — a `bend` that quietly returned at the end would
 * be a `bend_release` with the wrong label, which is exactly the ambiguity
 * this contract exists to remove. So each assertion is about the *ending* and
 * the *beginning*, which is where the four differ, rather than about the
 * curve between them, which they share.
 */
import { describe, expect, it } from "vitest";

import {
  bendGestureAutomation,
  centsAt,
  openSlideAutomation,
  pitchGestureAutomation,
} from "@/lib/audio/pitch-gesture";
import { bendAutomation } from "@/lib/audio/expression-plan";
import type { BendKind } from "@/lib/song/schema";

const DURATION = 1.2;
const TARGET = 200;
const bend = (kind: BendKind, extra: object = {}) =>
  bendGestureAutomation({ kind, targetCents: TARGET, ...extra }, DURATION);

const last = (points: readonly { cents: number }[]) => points[points.length - 1]!.cents;
const first = (points: readonly { cents: number }[]) => points[0]!.cents;
const peak = (points: readonly { cents: number }[]) =>
  Math.max(...points.map((point) => point.cents));

describe("82. four bends, four different sounds", () => {
  it("bend rises from the written pitch and stays up", () => {
    const points = bend("bend");
    expect(first(points)).toBe(0);
    expect(last(points)).toBe(TARGET);
  });

  it("bend_release rises and comes back to the written pitch", () => {
    const points = bend("bend_release");
    expect(first(points)).toBe(0);
    expect(peak(points)).toBe(TARGET);
    expect(last(points)).toBe(0);
  });

  it("prebend is already there when the string is struck", () => {
    const points = bend("prebend");
    expect(first(points)).toBe(TARGET);
    expect(last(points)).toBe(TARGET);
    /* No rise to hear: nothing below the target anywhere in the gesture. */
    expect(Math.min(...points.map((point) => point.cents))).toBe(TARGET);
  });

  it("prebend_release starts bent and comes down", () => {
    const points = bend("prebend_release");
    expect(first(points)).toBe(TARGET);
    expect(last(points)).toBe(0);
  });

  it("arrives at exactly the target, never at 197 or 205", () => {
    for (const cents of [100, 200, 400]) {
      const points = bendGestureAutomation(
        { kind: "bend", targetCents: cents },
        DURATION,
      );
      expect(peak(points)).toBe(cents);
    }
  });

  it("keeps every point inside the note and finite", () => {
    for (const kind of ["bend", "bend_release", "prebend", "prebend_release"] as const) {
      /* A note far too short to hold three stages is where negative holds and
         automation past the end would appear if they were going to. */
      for (const duration of [0.02, 0.08, DURATION, 6]) {
        const points = bendGestureAutomation({ kind, targetCents: TARGET }, duration);
        for (const point of points) {
          expect(Number.isFinite(point.timeSeconds)).toBe(true);
          expect(Number.isFinite(point.cents)).toBe(true);
          expect(point.timeSeconds).toBeGreaterThanOrEqual(0);
          expect(point.timeSeconds).toBeLessThanOrEqual(duration + 1e-6);
        }
        /* Time never runs backwards. */
        for (let index = 1; index < points.length; index += 1) {
          expect(points[index]!.timeSeconds).toBeGreaterThanOrEqual(
            points[index - 1]!.timeSeconds,
          );
        }
      }
    }
  });
});

describe("83. vibrato happens at the top, after the hand arrives", () => {
  const vibrato = { startAfterTarget: true as const, depthCents: 20, rateHz: 5 };

  it("reaches the target before it starts moving", () => {
    const points = bend("bend", { vibrato });
    const plain = bend("bend");
    const reachedAt = plain.find((point) => point.cents === TARGET)!.timeSeconds;
    for (const point of points) {
      if (point.timeSeconds >= reachedAt) continue;
      /* Everything before the arrival is the rise, unshaken. */
      expect(point.cents).toBeLessThanOrEqual(TARGET);
    }
    expect(points.length).toBeGreaterThan(plain.length);
  });

  it("shakes around the target rather than away from it", () => {
    const points = bend("bend", { vibrato });
    for (const point of points) {
      expect(point.cents).toBeLessThanOrEqual(TARGET + vibrato.depthCents + 1e-6);
    }
    expect(peak(points)).toBeGreaterThan(TARGET);
  });

  it("still ends where its kind says it ends", () => {
    expect(last(bend("bend", { vibrato }))).toBe(TARGET);
    expect(last(bend("bend_release", { vibrato }))).toBe(0);
  });
});

describe("84. a written slide-in or slide-out invents no note", () => {
  it("comes from below and arrives at the written pitch", () => {
    const points = openSlideAutomation({ kind: "slide_in", from: "below" }, DURATION);
    expect(first(points)).toBeLessThan(0);
    expect(last(points)).toBe(0);
  });

  it("comes from above and arrives at the written pitch", () => {
    const points = openSlideAutomation({ kind: "slide_in", from: "above" }, DURATION);
    expect(first(points)).toBeGreaterThan(0);
    expect(last(points)).toBe(0);
  });

  it("leaves downwards and upwards from the written pitch", () => {
    const down = openSlideAutomation({ kind: "slide_out", to: "down" }, DURATION);
    const up = openSlideAutomation({ kind: "slide_out", to: "up" }, DURATION);
    expect(first(down)).toBe(0);
    expect(last(down)).toBeLessThan(0);
    expect(first(up)).toBe(0);
    expect(last(up)).toBeGreaterThan(0);
  });

  it("takes only part of the note, so the pitch is heard before it leaves", () => {
    const points = openSlideAutomation({ kind: "slide_out", to: "down" }, DURATION);
    const leaves = points[1]!.timeSeconds;
    expect(leaves).toBeGreaterThan(DURATION * 0.5);
  });

  it("routes both families through one entry point", () => {
    expect(pitchGestureAutomation({ kind: "bend", targetCents: 100 }, DURATION)).toEqual(
      bendGestureAutomation({ kind: "bend", targetCents: 100 }, DURATION),
    );
    expect(pitchGestureAutomation({ kind: "slide_in", from: "below" }, DURATION)).toEqual(
      openSlideAutomation({ kind: "slide_in", from: "below" }, DURATION),
    );
  });
});

describe("85. the pitch can be asked where it is, mid-note", () => {
  it("reads a prebend as already bent one millisecond in", () => {
    const points = bend("prebend");
    expect(centsAt(points, 0)).toBe(TARGET);
    expect(centsAt(points, 0.001)).toBe(TARGET);
  });

  it("reads a plain bend as still flat before it rises", () => {
    expect(centsAt(bend("bend"), 0)).toBe(0);
  });

  it("reads the end of each kind as that kind's ending", () => {
    expect(centsAt(bend("bend"), DURATION)).toBe(TARGET);
    expect(centsAt(bend("bend_release"), DURATION)).toBe(0);
  });

  it("never reads outside the range the automation actually covers", () => {
    const points = bend("bend_release");
    const values = points.map((point) => point.cents);
    for (const time of [0, 0.3, 0.6, 0.9, DURATION, DURATION * 2]) {
      const read = centsAt(points, time);
      expect(read).toBeGreaterThanOrEqual(Math.min(...values) - 1e-6);
      expect(read).toBeLessThanOrEqual(Math.max(...values) + 1e-6);
    }
  });
});

describe("86. the legacy bend is not routed through any of this", () => {
  it("still produces its own curve, unchanged", () => {
    /* `bend-and-release` is the closest new shape to what `bend_full` has
       always done, and "closest" is not "identical" — so the legacy path
       stays its own function and this pins that it is still being called. */
    const legacy = bendAutomation(DURATION, "bend_full");
    expect(first(legacy)).toBe(0);
    expect(peak(legacy)).toBe(200);
    expect(last(legacy)).toBe(0);
  });

  it("is a different object from the gesture with the same target", () => {
    const legacy = bendAutomation(DURATION, "bend_full");
    const gesture = bendGestureAutomation(
      { kind: "bend_release", targetCents: 200 },
      DURATION,
    );
    /* They may or may not be point-for-point equal; what must be true is that
       nothing in the app makes the legacy note *take* the gesture path, which
       `expression-plan` proves. Here we only assert both are real curves. */
    expect(legacy.length).toBeGreaterThan(3);
    expect(gesture.length).toBeGreaterThan(3);
  });
});
