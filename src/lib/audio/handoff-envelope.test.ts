/**
 * The handoff, and the two ways it could quietly stop working (2V-C.4 §7, §8).
 *
 * It could stop bridging — a tail so short or so quiet that the hole comes
 * back, which is the defect the founder heard. Or it could over-bridge — a
 * source loud enough or long enough to sit on top of the target's attack,
 * which would answer the complaint by burying its subject. Both are checked,
 * because a single test that the envelope "does something" would pass either.
 */
import { describe, expect, it } from "vitest";

import { expressionPresets } from "@/lib/audio/expression";
import {
  handoffEnvelope,
  MAX_OVERLAP_FRACTION,
  MAX_OVERLAP_SECONDS,
  MAX_SOURCE_SUM,
  MIN_OVERLAP_SECONDS,
  SOURCE_RELEASE_SECONDS,
} from "@/lib/audio/handoff-envelope";

const base = {
  sourceGain: 0.8,
  handoverSeconds: 0.45,
  travelSeconds: 0.12,
  targetAttackSeconds: 0.006,
  targetDurationSeconds: 0.45,
  voiceCount: 1,
};

const valueAt = (
  points: readonly { timeSeconds: number; value: number }[],
  at: number,
): number => {
  let previous = points[0]!;
  for (const point of points) {
    if (point.timeSeconds >= at) {
      const span = point.timeSeconds - previous.timeSeconds;
      if (span <= 0) return point.value;
      const ratio = (at - previous.timeSeconds) / span;
      return previous.value + (point.value - previous.value) * ratio;
    }
    previous = point;
  }
  return previous.value;
};

describe("129. the source keeps sounding across the target's attack", () => {
  it("does not stop at the onset", () => {
    /* The whole defect in one assertion: C.3 ended the source here, and the
       rendered waveform dipped to a fiftieth of its surroundings for the
       next fourteen milliseconds. */
    const envelope = handoffEnvelope(base);
    expect(envelope.endSeconds).toBeGreaterThan(base.handoverSeconds);
    expect(envelope.overlapSeconds).toBeGreaterThan(0);
  });

  it("is still sounding through the middle of the hole", () => {
    /* Measured at +10 ms, which is where the quietest frame was. */
    const envelope = handoffEnvelope(base);
    const at = valueAt(envelope.points, base.handoverSeconds + 0.01);
    expect(at).toBeGreaterThan(0.1 * base.sourceGain);
  });

  it("reaches exactly silence, so the voice ends on nothing", () => {
    const envelope = handoffEnvelope(base);
    const last = envelope.points.at(-1)!;
    expect(last.value).toBe(0);
    expect(last.timeSeconds).toBeCloseTo(envelope.endSeconds, 9);
  });

  it("holds full level until the hand leaves", () => {
    const envelope = handoffEnvelope(base);
    expect(envelope.fadeStartSeconds).toBeCloseTo(
      base.handoverSeconds - base.travelSeconds,
      9,
    );
    expect(valueAt(envelope.points, envelope.fadeStartSeconds)).toBeCloseTo(
      base.sourceGain,
      6,
    );
  });

  it("never sits at full level once the target has been struck", () => {
    /* §8 allows an overlap and forbids two full-level voices. The source is
       already well down when the target lands and only goes down from there. */
    const envelope = handoffEnvelope(base);
    expect(envelope.gainAtTargetOnset).toBeLessThan(0.75 * base.sourceGain);
    for (const point of envelope.points) {
      if (point.timeSeconds >= base.handoverSeconds) {
        expect(point.value).toBeLessThanOrEqual(envelope.gainAtTargetOnset);
      }
    }
  });
});

describe("130. the tail is the recording's length, not a constant", () => {
  it("gives a slow recording a longer tail than a fast one", () => {
    const fast = handoffEnvelope({ ...base, targetAttackSeconds: 0.003 });
    const slow = handoffEnvelope({ ...base, targetAttackSeconds: 0.031 });
    expect(slow.overlapSeconds).toBeGreaterThan(fast.overlapSeconds);
  });

  it("covers the recording's attack and the source's own release", () => {
    const attack = 0.02;
    const envelope = handoffEnvelope({ ...base, targetAttackSeconds: attack });
    expect(envelope.overlapSeconds).toBeCloseTo(attack + SOURCE_RELEASE_SECONDS, 6);
  });

  it("stays inside its bounds however extreme the recording", () => {
    /*
     * The numbers are written out rather than read from the module. A test
     * that compares a value against the constant it is testing moves with
     * it: widen the bound and the assertion widens too, and a mutation run
     * finds nothing. The literals are the second opinion.
     */
    for (const attack of [0, 0.0005, 0.05, 5]) {
      const envelope = handoffEnvelope({ ...base, targetAttackSeconds: attack });
      expect(envelope.overlapSeconds).toBeGreaterThanOrEqual(0.012);
      expect(envelope.overlapSeconds).toBeLessThanOrEqual(0.045);
    }
    expect(MIN_OVERLAP_SECONDS).toBe(0.012);
    expect(MAX_OVERLAP_SECONDS).toBe(0.045);
  });

  it("arrives higher when there is more to cover", () => {
    const fast = handoffEnvelope({ ...base, targetAttackSeconds: 0.003 });
    const slow = handoffEnvelope({ ...base, targetAttackSeconds: 0.031 });
    expect(slow.onsetFraction).toBeGreaterThan(fast.onsetFraction);
    /* The two ends written out rather than read from the preset, so lowering
       one cannot lower the assertion with it. */
    expect(fast.onsetFraction).toBeGreaterThanOrEqual(0.45);
    expect(slow.onsetFraction).toBeLessThanOrEqual(0.6);
    const preset = expressionPresets.slide;
    expect(preset.handoverGainFraction).toBe(0.45);
    expect(preset.handoverSlowFraction).toBe(0.6);
  });

  it("does not apply one number to every sample", () => {
    /* The thing §7 forbids, checked directly: three different recordings must
       not produce three identical envelopes. */
    const shapes = [0.003, 0.012, 0.031].map((attack) => {
      const envelope = handoffEnvelope({ ...base, targetAttackSeconds: attack });
      return `${envelope.onsetFraction}/${envelope.overlapSeconds}`;
    });
    expect(new Set(shapes).size).toBe(3);
  });
});

describe("131. what the overlap must never do", () => {
  it("does not bury a short fast note under the one before it", () => {
    const short = handoffEnvelope({
      ...base,
      handoverSeconds: 0.06,
      travelSeconds: 0.06,
      targetDurationSeconds: 0.06,
      targetAttackSeconds: 0.031,
    });
    /* Written out, not read from the module: see the bounds test above. */
    expect(short.overlapSeconds).toBeLessThanOrEqual(0.06 * 0.35 + 1e-9);
    expect(MAX_OVERLAP_FRACTION).toBe(0.35);
  });

  it("shares the ceiling between the strings of a shape", () => {
    const alone = handoffEnvelope({ ...base, targetAttackSeconds: 0.031 });
    const three = handoffEnvelope({ ...base, targetAttackSeconds: 0.031, voiceCount: 3 });
    /*
     * Fractions are rounded to a millionth, so three of them can exceed the
     * ceiling by three millionths. Compared at that grain, not exactly — and
     * against the number itself rather than against the constant, so raising
     * the ceiling cannot raise the assertion with it.
     */
    expect(three.onsetFraction * 3).toBeLessThanOrEqual(1.4 + 3e-6);
    expect(MAX_SOURCE_SUM).toBe(1.4);
    expect(three.onsetFraction).toBeLessThanOrEqual(alone.onsetFraction);
  });

  it("never writes a point before the source's own onset", () => {
    for (const travel of [0, 0.01, 0.45, 9]) {
      const envelope = handoffEnvelope({ ...base, travelSeconds: travel });
      for (const point of envelope.points) {
        expect(point.timeSeconds).toBeGreaterThanOrEqual(0);
      }
      expect(envelope.fadeStartSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it("stays ordered in time and monotonically down after the fade", () => {
    const envelope = handoffEnvelope({ ...base, targetAttackSeconds: 0.02 });
    for (let index = 1; index < envelope.points.length; index += 1) {
      expect(envelope.points[index]!.timeSeconds).toBeGreaterThanOrEqual(
        envelope.points[index - 1]!.timeSeconds,
      );
    }
    expect(envelope.gainAtTargetOnset).toBeLessThan(envelope.points[1]!.value);
  });

  it("survives a handover of zero without writing nonsense", () => {
    const envelope = handoffEnvelope({ ...base, handoverSeconds: 0, travelSeconds: 0.2 });
    expect(envelope.fadeStartSeconds).toBe(0);
    expect(Number.isFinite(envelope.endSeconds)).toBe(true);
    expect(envelope.points.every((point) => Number.isFinite(point.value))).toBe(true);
  });
});
