import { describe, expect, it } from "vitest";

import {
  barStartTicks,
  metronomeClicks,
  positionAtTicks,
  sectionLoopBounds,
  slotsPerBeat,
} from "@/lib/audio/position";
import { buildSongPlan } from "@/lib/audio/schedule";
import { PPQ, ticksPerSlot } from "@/lib/music/timing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const PLAN = buildSongPlan(SAMPLE_SONG);
const BAR = PPQ * 4;

describe("transport position", () => {
  it("starts in the first bar of the first section", () => {
    const at = positionAtTicks(PLAN, 0);
    expect(at.barIndex).toBe(0);
    expect(at.barKey).toBe("intro-riff:0");
    expect(at.sectionId).toBe("intro-riff");
    expect(at.slotIndex).toBe(0);
    expect(at.barProgress).toBe(0);
  });

  it("moves to the next bar exactly on the bar line", () => {
    expect(positionAtTicks(PLAN, BAR - 1).barIndex).toBe(0);
    expect(positionAtTicks(PLAN, BAR).barIndex).toBe(1);
    expect(positionAtTicks(PLAN, BAR).barKey).toBe("intro-riff:1");
  });

  it("crosses into the next section on its first bar", () => {
    const at = positionAtTicks(PLAN, BAR * 4);
    expect(at.sectionId).toBe("main-riff");
    expect(at.barKey).toBe("main-riff:0");
  });

  it("reports the slot inside the bar", () => {
    const step = ticksPerSlot(8);
    expect(positionAtTicks(PLAN, step * 3).slotIndex).toBe(3);
    expect(positionAtTicks(PLAN, step * 3 + step / 2).slotIndex).toBe(3);
    expect(positionAtTicks(PLAN, step * 7).slotIndex).toBe(7);
  });

  it("never runs past the last slot of a bar", () => {
    const at = positionAtTicks(PLAN, BAR - 1);
    expect(at.slotIndex).toBe(7);
    expect(at.barProgress).toBeLessThan(1);
  });

  it("reports nowhere once the song has ended", () => {
    const at = positionAtTicks(PLAN, PLAN.totalTicks);
    expect(at.barIndex).toBe(-1);
    expect(at.barKey).toBeNull();
  });

  it("clamps a negative position rather than throwing", () => {
    expect(positionAtTicks(PLAN, -100).barIndex).toBe(-1);
  });
});

describe("seeking", () => {
  it("finds the first tick of a bar", () => {
    expect(barStartTicks(PLAN, "intro-riff:0")).toBe(0);
    expect(barStartTicks(PLAN, "intro-riff:2")).toBe(BAR * 2);
    expect(barStartTicks(PLAN, "main-riff:0")).toBe(BAR * 4);
  });

  it("returns nothing for a bar that does not exist", () => {
    expect(barStartTicks(PLAN, "nope:0")).toBeNull();
  });

  it("round-trips a seek back to the same bar", () => {
    for (const bar of PLAN.bars) {
      const start = barStartTicks(PLAN, bar.barKey);
      expect(start).not.toBeNull();
      expect(positionAtTicks(PLAN, start ?? 0).barKey).toBe(bar.barKey);
    }
  });
});

describe("section loop bounds", () => {
  it("snaps to whole bars", () => {
    expect(sectionLoopBounds(PLAN, "intro-riff")).toEqual({
      startTicks: 0,
      endTicks: BAR * 4,
    });
    expect(sectionLoopBounds(PLAN, "main-riff")).toEqual({
      startTicks: BAR * 4,
      endTicks: BAR * 8,
    });
  });

  it("ends a loop exactly where the next section begins", () => {
    const intro = sectionLoopBounds(PLAN, "intro-riff");
    const main = sectionLoopBounds(PLAN, "main-riff");
    expect(intro?.endTicks).toBe(main?.startTicks);
  });

  it("covers the whole song when both loops are laid end to end", () => {
    const main = sectionLoopBounds(PLAN, "main-riff");
    expect(main?.endTicks).toBe(PLAN.totalTicks);
  });

  it("returns nothing for an unknown section", () => {
    expect(sectionLoopBounds(PLAN, "nope")).toBeNull();
  });
});

describe("metronome", () => {
  it("counts four beats in a 4/4 bar", () => {
    const bar = PLAN.bars[0];
    expect(bar && slotsPerBeat(bar)).toBe(2);
    const clicks = metronomeClicks(PLAN).filter(
      (click) => click.time < BAR,
    );
    expect(clicks).toHaveLength(4);
    expect(clicks[0]?.downbeat).toBe(true);
    expect(clicks.slice(1).every((click) => !click.downbeat)).toBe(true);
  });

  it("puts a click on every quarter note", () => {
    const clicks = metronomeClicks(PLAN);
    expect(clicks).toHaveLength(32);
    for (const [index, click] of clicks.entries()) {
      expect(click.time).toBe((index * PPQ * 4) / 4);
    }
  });

  it("marks a downbeat once per bar", () => {
    expect(metronomeClicks(PLAN).filter((c) => c.downbeat)).toHaveLength(8);
  });

  it("counts a compound bar in dotted beats", () => {
    const compound = {
      barKey: "x:0",
      sectionId: "x",
      barNumber: 1,
      time: 0,
      durationTicks: PPQ * 3,
      slotCount: 6,
      timeSignature: [6, 8] as const,
      resolution: 8,
    };
    // 6/8 is felt in two, not in six.
    expect(slotsPerBeat(compound)).toBe(3);
    expect(
      metronomeClicks({ events: [], bars: [compound], totalTicks: PPQ * 3 }),
    ).toEqual([
      { time: 0, downbeat: true },
      { time: PPQ * 1.5, downbeat: false },
    ]);
  });
});
