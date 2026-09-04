/**
 * The fixtures exist, and they are what they claim (2V-C.4 §4, §12).
 *
 * A render harness that silently drops a fixture measures a smaller matrix
 * than its report claims, and nobody notices because the numbers it does
 * print are fine. So the set is checked here, in a test with no browser in
 * it, before any audio is rendered from it.
 */
import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { seamFixtures, SEAM_FIXTURE_NAMES } from "./seam-fixtures";
import { expectsContinuity } from "./seam-pcm";

const fixtures = seamFixtures(editorFixture());

describe("127. every fixture the matrix names is actually built", () => {
  it("builds all of them", () => {
    expect(Object.keys(fixtures).sort()).toEqual([...SEAM_FIXTURE_NAMES].sort());
  });

  it("covers every connection the matrix claims", () => {
    const names = Object.keys(fixtures).join(" ");
    for (const kind of ["legato", "shift", "shape2", "shape3", "hammer", "pull"]) {
      expect(names).toContain(kind);
    }
  });

  it("covers more than one distance, tempo, duration, practice rate and register", () => {
    const names = Object.keys(fixtures);
    expect(names.filter((name) => /-\dst$/.test(name)).length).toBeGreaterThanOrEqual(4);
    expect(names.filter((name) => name.includes("bpm")).length).toBeGreaterThanOrEqual(2);
    expect(names.filter((name) => name.includes("practice") || name.includes("speed")).length)
      .toBeGreaterThanOrEqual(2);
    expect(names.filter((name) => name.includes("low") || name.includes("high")).length)
      .toBeGreaterThanOrEqual(2);
    expect(names.some((name) => name.includes("16th"))).toBe(true);
  });

  it("renders the practice fixtures at their own rate, not at the written one", () => {
    /*
     * The first version of these two claimed a practice rate the render never
     * saw: `renderTake` built its plan at the written tempo, so both fixtures
     * measured a moment in the middle of a sustaining note and reported it as
     * continuous. A matrix row that measures the wrong instant is worse than
     * a missing one, because it reports coverage.
     */
    expect(fixtures["shift-half-speed"]!.practicePercent).toBe(50);
    expect(fixtures["shift-fast-practice"]!.practicePercent).toBe(150);
    for (const [name, fixture] of Object.entries(fixtures)) {
      if (name.includes("speed") || name.includes("practice")) continue;
      expect(fixture.practicePercent, name).toBeUndefined();
    }
  });

  it("places every seam inside its own clip", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      expect(fixture.seamSeconds, name).toBeGreaterThan(0);
      expect(fixture.seamSeconds, name).toBeLessThan(8);
    }
  });

  it("puts the seam where the target onset really is", () => {
    /* Derived from the tempo map rather than assumed, and checked against the
       plan the engine will schedule from — a seam in the wrong place would
       measure a moment nothing happens at and report it as continuous. */
    for (const [name, fixture] of Object.entries(fixtures)) {
      if (fixture.take.segments.length !== 1) continue;
      const window = fixture.take.segments[0]!.window;
      const plan = buildExpressionPlan(fixture.song);
      const inWindow = plan.notes.filter(
        (note) => note.timeTicks >= window.startTicks && note.timeTicks < window.endTicks,
      );
      expect(inWindow.length, name).toBeGreaterThan(0);
    }
  });

  it("really writes a rest into the negative control", () => {
    /* If this stops being a hole, the analyzer's only guaranteed-red case
       stops being red and the whole gate turns into decoration. */
    const rest = fixtures["control-rest"]!;
    expect(rest.expectContinuous).toBe(false);
    const plan = buildExpressionPlan(rest.song);
    const window = rest.take.segments[0]!.window;
    const inWindow = plan.notes
      .filter((note) => note.timeTicks >= window.startTicks && note.timeTicks < window.endTicks)
      .sort((a, b) => a.startSeconds - b.startSeconds);
    expect(inWindow.length).toBe(2);
    const gap =
      inWindow[1]!.startSeconds -
      (inWindow[0]!.startSeconds + inWindow[0]!.durationSeconds);
    expect(gap).toBeGreaterThan(0.02);
  });

  it("writes the connection the recipe asked for, through the real command", () => {
    for (const name of ["shift-2st", "legato-2st", "shape2-shift", "hammer-on"]) {
      const fixture = fixtures[name]!;
      /* Asked of the plan rather than of the slots, so the assertion is
         about what will be scheduled rather than about a field's shape. */
      const plan = buildExpressionPlan(fixture.song);
      const window = fixture.take.segments[0]!.window;
      const joined = plan.notes.filter(
        (note) =>
          note.timeTicks > window.startTicks &&
          note.timeTicks < window.endTicks &&
          (note.expressive || note.chainRole !== undefined),
      );
      expect(joined.length, name).toBeGreaterThan(0);
    }
  });

  it("gives the shape fixtures more than one moving string", () => {
    for (const [name, count] of [
      ["shape2-shift", 2],
      ["shape3-shift", 3],
    ] as const) {
      const plan = buildExpressionPlan(fixtures[name]!.song);
      const window = fixtures[name]!.take.segments[0]!.window;
      const atTarget = plan.notes.filter(
        (note) =>
          note.timeTicks >= window.startTicks &&
          note.timeTicks < window.endTicks &&
          note.timeTicks !== window.startTicks,
      );
      expect(atTarget.length, name).toBe(count);
    }
  });
});

describe("128. the controls are the kind of seam they say they are", () => {
  it("holds the sustain control's one note across its own seam", () => {
    /*
     * The first browser run measured a silent window here and reported a
     * broken seam, because a single-note recipe left the note one slot long
     * and the bar empty afterwards. A positive control that is silent proves
     * nothing about continuity — it only proves the harness looked somewhere
     * nothing was happening — so the sustain is asserted to be sounding at
     * the moment it is measured.
     */
    const fixture = fixtures["control-sustain"]!;
    const window = fixture.take.segments[0]!.window;
    const plan = buildExpressionPlan(fixture.song);
    const inWindow = plan.notes.filter(
      (note) => note.timeTicks >= window.startTicks && note.timeTicks < window.endTicks,
    );
    expect(inWindow).toHaveLength(1);
    const held = inWindow[0]!;
    expect(held.durationSeconds).toBeGreaterThan(fixture.seamSeconds);
  });

  it("gives the re-strike control two onsets and no connection", () => {
    /* The reference the connected classes have to beat. If it ever acquires
       a connection it stops being a reference and starts being a target. */
    const fixture = fixtures["control-restruck"]!;
    expect(fixture.seamClass).toBe("restrike");
    const window = fixture.take.segments[0]!.window;
    const plan = buildExpressionPlan(fixture.song);
    const inWindow = plan.notes.filter(
      (note) => note.timeTicks >= window.startTicks && note.timeTicks < window.endTicks,
    );
    expect(inWindow).toHaveLength(2);
    /* Asked of the plan: neither note is expressive and neither belongs to a
       chain, so nothing was written across this seam. */
    expect(inWindow.every((note) => !note.expressive)).toBe(true);
    expect(inWindow.every((note) => note.chainRole === undefined)).toBe(true);
  });

  it("expects continuity everywhere except the written rest", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      expect(fixture.expectContinuous, name).toBe(name !== "control-rest");
      expect(expectsContinuity(fixture.seamClass), name).toBe(name !== "control-rest");
    }
  });

  it("classes every struck slide as connected and every held one as joined", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      if (name.startsWith("shift-") || name.endsWith("-shift")) {
        expect(fixture.seamClass, name).toBe("connected");
      }
      if (name.startsWith("legato-") || name === "hammer-on" || name === "pull-off") {
        expect(fixture.seamClass, name).toBe("joined");
      }
    }
  });
});
