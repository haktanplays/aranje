import { describe, expect, it } from "vitest";

import {
  barStartTicks,
  metronomeClicks,
  nearestBarKey,
  positionAtTicks,
  sectionLoopBounds,
  barBeats,
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
    expect(bar && barBeats(bar).map((beat) => beat.slots)).toEqual([2, 2, 2, 2]);
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
    expect(barBeats(compound).map((beat) => beat.slots)).toEqual([3, 3]);
    expect(
      metronomeClicks({ events: [], bars: [compound], totalTicks: PPQ * 3 }),
    ).toEqual([
      { time: 0, downbeat: true },
      { time: PPQ * 1.5, downbeat: false },
    ]);
  });

  it("clicks a 7/8 three times, unevenly, on the beats it is felt in", () => {
    /*
     * The 2V-D.2 §12 fix, heard rather than described: this bar used to
     * produce seven identical eighth clicks with only the first accented,
     * which is a 7/8 nobody counts. Felt `2+2+3` it is three clicks at the
     * first, third and fifth eighths — and the gap before the last one is
     * longer, which is the whole character of the metre.
     */
    const bar = {
      barKey: "x:0",
      sectionId: "x",
      barNumber: 1,
      time: 0,
      durationTicks: (PPQ * 7) / 2,
      slotCount: 7,
      timeSignature: [7, 8] as const,
      resolution: 8,
      grouping: [2, 2, 3] as const,
    };
    expect(
      metronomeClicks({ events: [], bars: [bar], totalTicks: bar.durationTicks }),
    ).toEqual([
      { time: 0, downbeat: true },
      { time: PPQ, downbeat: false },
      { time: PPQ * 2, downbeat: false },
    ]);

    /* The other feel of the same bar moves the long beat, and the clicks
       move with it. If they did not, the bar's own field would be decoration. */
    expect(
      metronomeClicks({
        events: [],
        bars: [{ ...bar, grouping: [3, 2, 2] as const }],
        totalTicks: bar.durationTicks,
      }).map((click) => click.time),
    ).toEqual([0, PPQ * 1.5, PPQ * 2.5]);
  });
});

/*
 * Structural edits move bars around (spec 13.12), so a bar key held across a
 * song change can name a bar that is gone — or one that still exists and now
 * means a different bar. These are the cases that decide where the transport
 * lands afterwards.
 */
describe("the nearest bar a plan still has", () => {
  it("keeps a bar that is still there", () => {
    expect(nearestBarKey(PLAN, "main-riff:1")).toBe("main-riff:1");
  });

  it("clamps to the last bar of a section that got shorter", () => {
    const shorter = buildSongPlan({
      ...SAMPLE_SONG,
      sections: SAMPLE_SONG.sections.map((section) =>
        section.id === "main-riff"
          ? { ...section, bars: section.bars.slice(0, 1) }
          : section,
      ),
    });
    expect(nearestBarKey(shorter, "main-riff:3")).toBe("main-riff:0");
  });

  it("falls back to a bar of the song when the section is gone", () => {
    const without = buildSongPlan({
      ...SAMPLE_SONG,
      sections: SAMPLE_SONG.sections.filter((section) => section.id !== "main-riff"),
    });
    const answer = nearestBarKey(without, "main-riff:1");
    expect(answer).not.toBeNull();
    expect(PLAN.bars.some((bar) => bar.barKey === answer)).toBe(true);
    expect(answer?.startsWith("main-riff:")).toBe(false);
  });

  it("has no answer when there are no bars at all", () => {
    const empty = buildSongPlan({ ...SAMPLE_SONG, sections: [] });
    expect(nearestBarKey(empty, "main-riff:0")).toBeNull();
  });
});
