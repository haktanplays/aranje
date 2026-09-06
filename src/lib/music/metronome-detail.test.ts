/**
 * The Pro click setting, and the promise it may not make (2V-D.2 completion
 * §8, §9).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DETAIL_LABEL,
  METRONOME_DETAILS,
  detailNote,
} from "@/lib/music/metronome-detail";
import { CLICK_GAIN, metronomeClicks } from "@/lib/audio/position";
import { buildSongPlan } from "@/lib/audio/schedule";
import { countInClicks } from "@/lib/practice/count-in";
import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { buildRhythmTakes } from "@/lib/listening/rhythm-take";
import type { Bar } from "@/lib/song/schema";

const seven = (grouping: readonly number[]) =>
  ({
    meter: [7, 8] as const,
    resolution: 8 as const,
    grouping: [...grouping],
  }) as const;

describe("380. how closely the click counts", () => {
  it("offers two settings and names them for what they sound like", () => {
    /* No "subdivision", no "pulse", no "resolution": a reader choosing how to
       count a 7/8 is choosing between hearing the three and hearing all
       seven, and the labels say exactly that. */
    expect([...METRONOME_DETAILS]).toEqual(["beats", "units"]);
    expect(DETAIL_LABEL.beats).toBe("Yalnız ana vuruşlar");
    expect(DETAIL_LABEL.units).toBe("Tüm sekizlikleri duy");
    for (const label of Object.values(DETAIL_LABEL)) {
      expect(label).not.toMatch(/pulse|subdivision|slot|tick|resolution/i);
    }
  });

  it("explains 7/8 in the vocabulary the panel already uses", () => {
    expect(detailNote(seven([2, 2, 3]))).toBe(
      "Grup başları daha güçlü, diğer sekizlikler daha hafif çalar.",
    );
    expect(detailNote(seven([3, 2, 2]))).toBe(detailNote(seven([2, 2, 3])));
  });

  it("promises nothing extra when the beats already are the units", () => {
    /* In 4/4 the four main beats *are* the four notated quarters. A sentence
       offering "hear all of them" would be describing a difference that does
       not exist, so there is no sentence. */
    expect(detailNote({ meter: [4, 4], resolution: 8 })).toBeNull();
    expect(detailNote({ meter: [3, 4], resolution: 8 })).toBeNull();
    expect(detailNote({ meter: [6, 8], resolution: 8, grouping: [3, 3] })).toBe(
      "Grup başları daha güçlü, diğer sekizlikler daha hafif çalar.",
    );
  });
});

describe("381. one pulse, one click, three levels", () => {
  /* L33's own song, because it really has a 7/8 bar in it — the acceptance
     fixture opens in 4/4 and a metre change onto a full bar is refused. */
  const takes = buildRhythmTakes(editorFixture());
  if (!takes) throw new Error("rhythm takes did not build");
  const song = takes.L33a.song;
  const plan = buildSongPlan(song);
  /* The window the 7/8 bars occupy, from the take rather than from a guess. */
  const from = plan.bars.find((bar) => bar.timeSignature[0] === 7)?.time ?? 0;
  const inBar = (time: number) => time >= from && time < from + 672;

  it("schedules every notated unit and never two clicks on one", () => {
    const all = metronomeClicks(plan, { subdivisions: true }).filter((beat) =>
      inBar(beat.time),
    );
    expect(all).toHaveLength(7);
    expect(new Set(all.map((beat) => beat.time)).size).toBe(7);
  });

  it("leaves the main beats on their own ticks when the fine ones join", () => {
    /*
     * The whole of the two-layer promise: turning subdivisions on may add
     * quiet clicks, and may not move or re-strength a single main beat.
     */
    const beats = metronomeClicks(plan).filter((beat) => inBar(beat.time));
    const units = metronomeClicks(plan, { subdivisions: true }).filter((beat) =>
      inBar(beat.time),
    );
    for (const beat of beats) {
      const same = units.find((unit) => unit.time === beat.time);
      expect(same?.strength, `${beat.time}`).toBe(beat.strength);
    }
    /* 2+2+3 eighths, and an eighth is 96 ticks: the third group starts late
       and stays there whichever way the switch is set. */
    expect(beats.map((beat) => beat.time - from)).toEqual([0, 192, 384]);
    expect(units.map((beat) => beat.time - from)).toEqual([
      0, 96, 192, 288, 384, 480, 576,
    ]);
  });

  it("keeps downbeat, group start and fine click three different loudnesses", () => {
    expect(CLICK_GAIN.downbeat).toBeGreaterThan(CLICK_GAIN.secondary);
    expect(CLICK_GAIN.secondary).toBeGreaterThan(CLICK_GAIN.subdivision);
    expect(CLICK_GAIN.subdivision).toBeGreaterThan(0);
  });
});

describe("383. the switch is read when the click fires, not when it is scheduled", () => {
  const source = readFileSync("src/lib/audio/engine.ts", "utf8");

  it("schedules every pulse, whatever the reader currently wants", () => {
    /*
     * Scheduling only the wanted pulses is the version of this that leaks:
     * turning subdivisions off would leave the already-scheduled quiet clicks
     * on the transport, and turning them on mid-bar would do nothing until
     * the next start. So the schedule is complete and unconditional.
     */
    expect(source).toContain("metronomeClicks(engine.plan, { subdivisions: true })");
  });

  it("decides inside the callback, beside the one that was already there", () => {
    const callback = source.slice(
      source.indexOf("transport.schedule((time) => {", source.indexOf("engine.metronome")),
      source.indexOf("}, ticks(beat.time));"),
    );
    expect(callback).toContain("options.metronomeEnabled?.()");
    expect(callback).toContain("options.metronomeSubdivisions?.()");
    expect(callback).toContain('beat.strength === "subdivision"');
  });
});

describe("382. the count-in reads the reader's own setting", () => {
  const bar: Bar = {
    timeSignature: [7, 8],
    resolution: 8,
    grouping: [2, 2, 3],
    slots: {},
  };
  const input = { bars: 1 as const, firstBar: bar, bpm: 120, practicePercent: 100 };

  it("counts three when the click counts three", () => {
    const clicks = countInClicks(input);
    expect(clicks).toHaveLength(3);
    expect(clicks.map((click) => click.beat)).toEqual([1, 2, 3]);
    expect(clicks.map((click) => click.strength)).toEqual([
      "downbeat",
      "secondary",
      "secondary",
    ]);
  });

  it("counts seven when the click counts seven, and still says one two three", () => {
    /*
     * A count-in that taught a different pulse from the bars after it would
     * be worse than none: the reader would set themselves up on one feel and
     * the music would arrive on another. The spoken number stays the main
     * beat's, because a player counting a 7/8 in still says three numbers.
     */
    const clicks = countInClicks({ ...input, subdivisions: true });
    expect(clicks).toHaveLength(7);
    expect(clicks.map((click) => click.strength)).toEqual([
      "downbeat",
      "subdivision",
      "secondary",
      "subdivision",
      "secondary",
      "subdivision",
      "subdivision",
    ]);
    expect(clicks.map((click) => click.beat)).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });

  it("ends every count-in exactly at the first tick, either way", () => {
    for (const subdivisions of [false, true]) {
      const clicks = countInClicks({ ...input, subdivisions });
      expect(clicks[0]?.beforeSeconds).toBeCloseTo(
        countInClicks(input)[0]?.beforeSeconds ?? 0,
        6,
      );
      expect(clicks[clicks.length - 1]?.beforeSeconds).toBeGreaterThan(0);
    }
  });
});
