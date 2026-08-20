import { describe, expect, it } from "vitest";

import { DEFAULT_VELOCITY, articulationHold, barTimeline, buildSongPlan, ticks, velocityGain } from "@/lib/audio/schedule";
import { PPQ, ticksPerSlot } from "@/lib/music/timing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema } from "@/lib/song/schema";
import fixture from "@/lib/song/visual-fixture.json";

const FIXTURE = songSchema.parse(fixture);

describe("tick maths (spec 8.3)", () => {
  it("derives a slot from the note value, not from seconds", () => {
    expect(ticksPerSlot(8)).toBe(PPQ / 2);
    expect(ticksPerSlot(16)).toBe(PPQ / 4);
  });

  it("gives a 4/4 bar four quarter notes at either resolution", () => {
    expect(8 * ticksPerSlot(8)).toBe(PPQ * 4);
    expect(16 * ticksPerSlot(16)).toBe(PPQ * 4);
  });

  it("gives a 6/8 bar six eighths", () => {
    expect(6 * ticksPerSlot(8)).toBe(PPQ * 3);
  });

  it("writes a tick count in the notation Tone reads", () => {
    expect(ticks(384)).toBe("384i");
    expect(ticks(-5)).toBe("0i");
    expect(ticks(10.4)).toBe("10i");
  });
});

describe("bar timeline", () => {
  it("lays the demo bars end to end", () => {
    const bars = barTimeline(SAMPLE_SONG);
    expect(bars).toHaveLength(8);
    expect(bars[0]?.time).toBe(0);
    expect(bars[1]?.time).toBe(PPQ * 4);
    expect(bars[7]?.time).toBe(PPQ * 4 * 7);
  });

  it("names bars the same way the tab view does", () => {
    expect(barTimeline(SAMPLE_SONG)[4]?.barKey).toBe("main-riff:0");
  });
});

describe("dynamics", () => {
  it("chokes a palm mute and lets a sustain ring", () => {
    expect(articulationHold("palm_mute")).toBeLessThan(0.5);
    expect(articulationHold("staccato")).toBeLessThan(
      articulationHold("palm_mute"),
    );
    expect(articulationHold("sustain")).toBe(1);
  });

  it("turns velocity into gain and clamps what is out of range", () => {
    expect(velocityGain(127)).toBe(1);
    expect(velocityGain(undefined)).toBeCloseTo(DEFAULT_VELOCITY / 127, 5);
    expect(velocityGain(0)).toBeCloseTo(1 / 127, 5);
    expect(velocityGain(9000)).toBe(1);
  });
});

describe("song plan", () => {
  const plan = buildSongPlan(SAMPLE_SONG);

  it("covers the whole song", () => {
    expect(plan.totalTicks).toBe(PPQ * 4 * 8);
    expect(plan.bars).toHaveLength(8);
  });

  it("plays every track of the demo", () => {
    const tracks = new Set(plan.events.map((event) => event.trackId));
    expect([...tracks].sort()).toEqual(["acc", "bass", "drums", "gtr"]);
  });

  it("is sorted in playing order", () => {
    const times = plan.events.map((event) => event.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("starts the first downbeat at zero", () => {
    expect(plan.events[0]?.time).toBe(0);
  });

  it("carries velocity from the score into the gain", () => {
    const first = plan.events.find(
      (event) => event.kind === "note" && event.trackId === "gtr",
    );
    // The opening note is a palm mute written at velocity 92.
    expect(first?.gain).toBeCloseTo(92 / 127, 5);
  });

  it("shortens a palm mute relative to its slot", () => {
    const note = plan.events.find(
      (event) => event.kind === "note" && event.trackId === "gtr",
    );
    expect(note?.kind).toBe("note");
    if (note?.kind !== "note") return;
    expect(note.durationTicks).toBeLessThan(ticksPerSlot(8));
  });

  it("keeps a drum stack on one tick", () => {
    const downbeat = plan.events.filter(
      (event) => event.kind === "drum" && event.time === 0,
    );
    expect(downbeat.length).toBeGreaterThanOrEqual(3);
  });

  it("schedules a tie once, at its onset, for its whole length", () => {
    const fixturePlan = buildSongPlan(FIXTURE);
    // The chord in bar 2 is held over four slots by ties.
    const held = fixturePlan.events.filter(
      (event) => event.kind === "note" && event.time === PPQ * 4,
    );
    expect(held).toHaveLength(3);
    for (const event of held) {
      if (event.kind !== "note") continue;
      expect(event.durationTicks).toBeGreaterThan(3 * ticksPerSlot(8));
    }
  });

  it("does not re-trigger a note that carried over a bar line", () => {
    const fixturePlan = buildSongPlan(FIXTURE);
    const barThreeStart = PPQ * 4 * 2;
    const atBarThree = fixturePlan.events.filter(
      (event) => event.time === barThreeStart,
    );
    expect(atBarThree).toEqual([]);
  });

  it("plays nothing during a section the track is silent in", () => {
    const fixturePlan = buildSongPlan(FIXTURE);
    const silentStart = PPQ * 4 * 3;
    const during = fixturePlan.events.filter(
      (event) => event.time >= silentStart,
    );
    expect(during).toEqual([]);
  });
});
