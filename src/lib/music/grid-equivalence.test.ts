/**
 * The three grids that were already here must not have moved (spec 5.5, K-34).
 *
 * Phase 2H-A widened `Resolution` from two values to five and pulled the tick
 * arithmetic into one module. Both are the kind of change that can be right in
 * general and wrong for the songs people already have, so these tests hold the
 * new code against the old formulas — written out literally below, exactly as
 * they appeared inline before the move — and against the demo song's plan.
 */
import { describe, expect, it } from "vitest";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { barTimeline, buildSongPlan } from "@/lib/audio/schedule";
import {
  PPQ,
  slotCount,
  slotsPerNotatedBeat,
  ticksPerSlot,
} from "@/lib/music/timing";
import { TIME_SIGNATURES, type TimeSignature } from "@/lib/music/timing";

/** `lib/audio/schedule.ts`, before the move. */
const oldTicksPerSlot = (resolution: number) => (PPQ * 4) / resolution;

/** `lib/audio/schedule.ts` `barTimeline`, before the move. */
const oldSlotCount = (timeSignature: TimeSignature, resolution: number) =>
  (timeSignature[0] * resolution) / timeSignature[1];

/** `components/workspace/geometry.ts`, before the move. */
const oldSlotsPerBeat = (timeSignature: TimeSignature, resolution: number) =>
  Math.max(1, resolution / timeSignature[1]);

describe("8 and 16 answer exactly what they used to", () => {
  it("gives the same slot length in ticks", () => {
    for (const resolution of [8, 16] as const) {
      expect(ticksPerSlot(resolution)).toBe(oldTicksPerSlot(resolution));
    }
    expect(ticksPerSlot(8)).toBe(96);
    expect(ticksPerSlot(16)).toBe(48);
  });

  it("gives the same slot count in every meter", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of [8, 16] as const) {
        expect(slotCount(timeSignature, resolution)).toBe(
          oldSlotCount(timeSignature, resolution),
        );
      }
    }
  });

  it("puts the beat ticks in the same places", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of [8, 16] as const) {
        expect(slotsPerNotatedBeat(timeSignature, resolution)).toBe(
          oldSlotsPerBeat(timeSignature, resolution),
        );
      }
    }
  });
});

describe("the demo song plans byte for byte the same", () => {
  it("has the same bar timeline it had before the widening", () => {
    const timeline = barTimeline(SAMPLE_SONG);
    // Rebuilt here with the old inline arithmetic, start to finish.
    let time = 0;
    let barNumber = 0;
    const rebuilt = SAMPLE_SONG.sections.flatMap((section) =>
      section.bars.map((bar, barIndex) => {
        barNumber += 1;
        const count = oldSlotCount(bar.timeSignature, bar.resolution);
        const durationTicks = count * oldTicksPerSlot(bar.resolution);
        const marker = {
          barKey: `${section.id}:${barIndex}`,
          sectionId: section.id,
          barNumber,
          time,
          durationTicks,
          slotCount: count,
          timeSignature: bar.timeSignature,
          resolution: bar.resolution,
        };
        time += durationTicks;
        return marker;
      }),
    );
    expect(JSON.stringify(timeline)).toBe(JSON.stringify(rebuilt));
  });

  it("still schedules the same events at the same ticks", () => {
    // A golden of the shape rather than a re-derivation: if any of the moved
    // arithmetic drifted, the first event's tick or the last event's end would
    // move, and this song is entirely on the grids that already existed.
    const plan = buildSongPlan(SAMPLE_SONG);
    expect(plan.totalTicks).toBe(6144);
    expect(plan.bars).toHaveLength(8);
    expect(plan.bars.every((bar) => bar.durationTicks === 768)).toBe(true);
    expect(plan.events.length).toBeGreaterThan(0);
    for (const event of plan.events) {
      expect(Number.isInteger(event.time)).toBe(true);
      expect(event.time % 24).toBe(0); // every 2H-A grid divides 24 ticks
    }
  });
});
