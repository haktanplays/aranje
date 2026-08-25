/**
 * What the speed is allowed to be tied to (2R-A §12, §17).
 *
 * The load-bearing claim in this file is a negative one: the only input that
 * moves the speed is a completed loop. Nothing here measures playing, because
 * the app cannot, and a test that let a "quality" argument in would be the
 * first step to a tool that claims it can.
 */
import { describe, expect, it } from "vitest";

import {
  afterLoop,
  afterManualChange,
  AUTOMATION_STOPPED_MESSAGE,
  isRunning,
  MIN_STEP_PERCENT,
  progressiveNotice,
  progressivePlan,
  startProgressive,
  type ProgressiveState,
} from "@/lib/practice/progressive-rate";
import { practiceRateLimits } from "@/lib/limits";

const plan = (from: number, to: number) => {
  const made = progressivePlan(from, to);
  if (!made) throw new Error("expected a plan");
  return made;
};

/** Run the loop `passes` times and report where the speed ended up. */
const afterPasses = (state: ProgressiveState, passes: number): ProgressiveState => {
  let current = state;
  for (let index = 0; index < passes; index += 1) current = afterLoop(current);
  return current;
};

describe("254. a plan describes getting faster, or it is refused", () => {
  it("takes a start below a target", () => {
    expect(plan(70, 100)).toEqual({
      fromPercent: 70,
      toPercent: 100,
      stepPercent: MIN_STEP_PERCENT,
    });
  });

  it("refuses a target below the start rather than swapping them", () => {
    /*
     * Silently reversing would start a loop doing the opposite of what the
     * numbers on screen say — and the reader would only find out by ear.
     */
    expect(progressivePlan(100, 70)).toBeNull();
  });

  it("refuses a target equal to the start", () => {
    expect(progressivePlan(90, 90)).toBeNull();
  });

  it("refuses a step smaller than the one the manual control uses", () => {
    expect(progressivePlan(70, 100, MIN_STEP_PERCENT - 1)).toBeNull();
    expect(progressivePlan(70, 100, 0)).toBeNull();
    expect(progressivePlan(70, 100, Number.NaN)).toBeNull();
  });

  it("clamps both ends to the rates the app allows", () => {
    const made = plan(-50, 500);
    expect(made.fromPercent).toBe(practiceRateLimits.minPercent);
    expect(made.toPercent).toBe(practiceRateLimits.maxPercent);
  });

  it("starts at the starting speed with nothing completed", () => {
    const state = startProgressive(plan(70, 100));
    expect(state.percent).toBe(70);
    expect(state.completedLoops).toBe(0);
    expect(state.stopped).toBeNull();
    expect(isRunning(state)).toBe(true);
  });
});

describe("255. only a completed loop moves the speed", () => {
  it("steps once per pass, by the same rung the manual control uses", () => {
    const state = afterLoop(startProgressive(plan(70, 100)));
    expect(state.percent).toBe(70 + practiceRateLimits.stepPercent);
    expect(state.completedLoops).toBe(1);
  });

  it("counts passes rather than anything about the playing", () => {
    const state = afterPasses(startProgressive(plan(50, 150)), 4);
    expect(state.completedLoops).toBe(4);
    expect(state.percent).toBe(50 + 4 * practiceRateLimits.stepPercent);
  });

  it("stops at the target instead of running past it", () => {
    const state = afterPasses(startProgressive(plan(90, 100)), 10);
    expect(state.percent).toBe(100);
    expect(state.stopped).toBe("reached_target");
    expect(isRunning(state)).toBe(false);
  });

  it("does nothing more once it has arrived", () => {
    const arrived = afterPasses(startProgressive(plan(95, 100)), 5);
    const again = afterLoop(arrived);
    expect(again).toEqual(arrived);
  });

  it("never exceeds the app's maximum rate", () => {
    const state = afterPasses(startProgressive(plan(140, 150)), 20);
    expect(state.percent).toBeLessThanOrEqual(practiceRateLimits.maxPercent);
  });

  it("lands only on speeds the manual control could also reach", () => {
    let state = startProgressive(plan(50, 150));
    const seen: number[] = [state.percent];
    for (let index = 0; index < 25; index += 1) {
      state = afterLoop(state);
      seen.push(state.percent);
    }
    expect(
      seen.every((percent) => percent % practiceRateLimits.stepPercent === 0),
    ).toBe(true);
  });
});

describe("256. the reader's hand stops it, and it says so", () => {
  it("stops the automation at the speed they chose", () => {
    const running = afterPasses(startProgressive(plan(60, 120)), 3);
    const taken = afterManualChange(running, 85);
    expect(taken.percent).toBe(85);
    expect(taken.stopped).toBe("manual_change");
    expect(isRunning(taken)).toBe(false);
  });

  it("does not resume on the next pass", () => {
    const taken = afterManualChange(startProgressive(plan(60, 120)), 85);
    expect(afterLoop(taken)).toEqual(taken);
    expect(afterPasses(taken, 5).percent).toBe(85);
  });

  it("says the one sentence the spec fixes", () => {
    const taken = afterManualChange(startProgressive(plan(60, 120)), 85);
    expect(progressiveNotice(taken)).toBe(AUTOMATION_STOPPED_MESSAGE);
    expect(AUTOMATION_STOPPED_MESSAGE).toBe("Otomatik hızlandırma durdu.");
  });

  it("keeps the first reason when it had already arrived", () => {
    const arrived = afterPasses(startProgressive(plan(95, 100)), 5);
    const then = afterManualChange(arrived, 60);
    expect(then.stopped).toBe("reached_target");
    expect(then.percent).toBe(60);
  });

  it("clamps a hand-set speed like every other rate in the app", () => {
    const taken = afterManualChange(startProgressive(plan(60, 120)), 9_000);
    expect(taken.percent).toBe(practiceRateLimits.maxPercent);
  });
});

describe("257. what it tells the reader is never a claim about their playing", () => {
  it("says nothing when no automation is running", () => {
    expect(progressiveNotice(null)).toBeNull();
  });

  it("reports passes completed, not repetitions played correctly", () => {
    const notice = progressiveNotice(afterPasses(startProgressive(plan(60, 120)), 3));
    expect(notice).toBe("%75 — 3 tur tamamlandı.");
    /*
     * The words this must never contain. "tur" is a pass of the loop, which
     * the app knows; anything about how it went is something it does not.
     */
    for (const forbidden of ["doğru", "başarı", "temiz", "hatasız", "puan"]) {
      expect(notice).not.toContain(forbidden);
    }
  });

  it("says it arrived without saying anything about why", () => {
    const notice = progressiveNotice(afterPasses(startProgressive(plan(95, 100)), 5));
    expect(notice).toBe("Hedef hıza ulaşıldı: %100.");
  });
});
