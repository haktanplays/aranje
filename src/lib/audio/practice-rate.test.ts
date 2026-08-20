/**
 * Practice speed as a number (spec 13.8, phase 2E).
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRACTICE_PERCENT,
  DEFAULT_PRACTICE_RATE,
  clampPercent,
  effectiveBpm,
  formatBpm,
  isDefaultPercent,
  rateOf,
  stepPercent,
} from "@/lib/audio/practice-rate";
import { copilotRequestSchema } from "@/lib/copilot/contract";
import { requestFingerprint } from "@/lib/copilot/fingerprint";
import { practiceRateLimits } from "@/lib/limits";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema } from "@/lib/song/schema";

describe("the bounds", () => {
  it("comes from the one central source", () => {
    expect(practiceRateLimits).toEqual({
      minPercent: 50,
      maxPercent: 150,
      stepPercent: 5,
      defaultPercent: 100,
    });
  });

  it("starts at the song's own tempo", () => {
    expect(DEFAULT_PRACTICE_PERCENT).toBe(100);
    expect(DEFAULT_PRACTICE_RATE).toBe(1);
    expect(isDefaultPercent(100)).toBe(true);
    expect(isDefaultPercent(95)).toBe(false);
  });

  it("does not go below the minimum or above the maximum", () => {
    expect(clampPercent(10)).toBe(50);
    expect(clampPercent(1000)).toBe(150);
    expect(stepPercent(50, -1)).toBe(50);
    expect(stepPercent(150, 1)).toBe(150);
  });

  it("moves in steps of five", () => {
    expect(stepPercent(100, -1)).toBe(95);
    expect(stepPercent(95, -1)).toBe(90);
    expect(stepPercent(100, 1)).toBe(105);
  });

  it("snaps a value that is not on a step", () => {
    expect(clampPercent(97)).toBe(95);
    expect(clampPercent(98)).toBe(100);
  });

  it("treats an unreadable number as the song's own tempo", () => {
    expect(clampPercent(Number.NaN)).toBe(100);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampPercent(Number.NEGATIVE_INFINITY)).toBe(100);
  });
});

describe("effective tempo", () => {
  it("is the song's tempo times the rate", () => {
    expect(effectiveBpm(132, 75)).toBe(99);
    expect(effectiveBpm(132, 100)).toBe(132);
    expect(effectiveBpm(120, 50)).toBe(60);
    expect(effectiveBpm(120, 150)).toBe(180);
  });

  it("keeps a fractional result exactly, rather than rounding the sound", () => {
    expect(effectiveBpm(132, 85)).toBe(112.2);
    expect(effectiveBpm(133, 95)).toBeCloseTo(126.35, 10);
  });

  it("shows at most one decimal, and no pointless zero", () => {
    expect(formatBpm(99)).toBe("99");
    expect(formatBpm(112.2)).toBe("112.2");
    expect(formatBpm(126.35)).toBe("126.4");
  });

  it("is the multiplier the spec names", () => {
    expect(rateOf(75)).toBe(0.75);
    expect(SAMPLE_SONG.bpm * rateOf(75)).toBeCloseTo(effectiveBpm(SAMPLE_SONG.bpm, 75), 10);
  });
});

describe("the song is not touched", () => {
  it("leaves the song's own tempo where it was", () => {
    const before = SAMPLE_SONG.bpm;
    effectiveBpm(SAMPLE_SONG.bpm, 50);
    effectiveBpm(SAMPLE_SONG.bpm, 150);
    expect(SAMPLE_SONG.bpm).toBe(before);
  });
});

describe("what practice speed is not part of", () => {
  const request = {
    operation: "arrange_track" as const,
    skill: "drums" as const,
    sectionId: SAMPLE_SONG.sections[0]?.id ?? "",
    targetTrackId: "drums",
    lockedTrackIds: ["gtr"],
    subjectId: "local",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    song: SAMPLE_SONG,
  };

  it("is not a field the Song Contract accepts", () => {
    const withRate = { ...SAMPLE_SONG, practiceRate: 0.75 };
    expect(songSchema.safeParse(withRate).success).toBe(false);
  });

  it("is not a field a copilot request accepts", () => {
    expect(
      copilotRequestSchema.safeParse({ ...request, practiceRatePercent: 75 }).success,
    ).toBe(false);
    expect(copilotRequestSchema.safeParse(request).success).toBe(true);
  });

  it("cannot change the idempotency fingerprint, because it is not in the request", async () => {
    const parsed = copilotRequestSchema.parse(request);
    const first = await requestFingerprint(parsed);

    // The whole point: practising at half speed and at full speed asks the
    // same question of the model, so it must replay the same answer.
    effectiveBpm(SAMPLE_SONG.bpm, 50);
    effectiveBpm(SAMPLE_SONG.bpm, 150);
    const second = await requestFingerprint(copilotRequestSchema.parse(request));

    expect(second).toBe(first);
  });
});
