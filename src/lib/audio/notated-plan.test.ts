/**
 * One traversal, two readers (spec 13.19, 2M-A §4, §16).
 *
 * `buildNotatedPlan` is what the score says; `buildSongPlan` is that played.
 * The MIDI export reads the first and the audio engine reads the second, so
 * the thing worth proving is that they cannot drift: same onsets, same
 * events, same order, across every metre and grid the contract allows.
 *
 * The one deliberate difference is duration — playback lifts the finger early
 * so a palm mute sounds like one — and that difference is asserted too,
 * rather than left as an implicit convention.
 */
import { describe, expect, it } from "vitest";

import { articulationHold, buildNotatedPlan, buildSongPlan } from "@/lib/audio/schedule";
import { PPQ, ticksPerSlot } from "@/lib/music/timing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";

const GUITAR = ["E2", "A2", "D3", "G3", "B3", "E4"];
const rest = (count: number) => Array.from({ length: count }, () => null);
const note = (pitch: string, extra: Record<string, unknown> = {}) => ({
  notes: [{ pitch, position: { string: 0, fret: 0 }, ...extra }],
});

function song(
  bars: { timeSignature: [number, number]; resolution: number; slots: unknown[] }[],
): Song {
  return songSchema.parse({
    version: 2,
    title: "Plan",
    bpm: 120,
    key: "E minor",
    tracks: [
      {
        id: "gtr",
        name: "Gitar",
        instrumentId: "electric_guitar",
        presetId: "high_gain",
        volumeDb: 0,
        fretboard: { tuning: GUITAR, capo: 0 },
      },
    ],
    sections: [
      {
        id: "s1",
        name: "Bölüm",
        status: "fixed",
        bars: bars.map((bar) => ({
          timeSignature: bar.timeSignature,
          resolution: bar.resolution,
          slots: { gtr: bar.slots },
        })),
      },
    ],
  });
}

const onsets = (plan: { events: { time: number }[] }) =>
  plan.events.map((event) => event.time);

describe("76. the score and the performance start together", () => {
  it("agrees on every onset in the sample song", () => {
    expect(onsets(buildSongPlan(SAMPLE_SONG))).toEqual(
      onsets(buildNotatedPlan(SAMPLE_SONG)),
    );
  });

  it("agrees on how many events there are, and of which kind", () => {
    const played = buildSongPlan(SAMPLE_SONG).events;
    const written = buildNotatedPlan(SAMPLE_SONG).events;
    expect(played.length).toBe(written.length);
    expect(played.map((event) => event.kind)).toEqual(
      written.map((event) => event.kind),
    );
    expect(played.map((event) => event.trackId)).toEqual(
      written.map((event) => event.trackId),
    );
  });

  it("agrees across every metre the contract allows", () => {
    for (const meter of [
      [4, 4],
      [3, 4],
      [6, 8],
      [7, 8],
    ] as [number, number][]) {
      const slots = meter[0] * (8 / meter[1]);
      const fixture = song([
        { timeSignature: meter, resolution: 8, slots: [note("E2"), ...rest(slots - 1)] },
        { timeSignature: meter, resolution: 8, slots: [note("E2"), ...rest(slots - 1)] },
      ]);
      const written = buildNotatedPlan(fixture);
      expect(onsets(buildSongPlan(fixture)), `${meter[0]}/${meter[1]}`).toEqual(
        onsets(written),
      );
      // ...and the second bar starts exactly one bar in.
      expect(written.events[1]?.time, `${meter[0]}/${meter[1]}`).toBe(
        slots * ticksPerSlot(8),
      );
    }
  });

  it("agrees across a mixed grid", () => {
    const fixture = song([
      { timeSignature: [4, 4], resolution: 12, slots: [note("E2"), ...rest(11)] },
      { timeSignature: [4, 4], resolution: 32, slots: [note("E2"), ...rest(31)] },
      { timeSignature: [4, 4], resolution: 8, slots: [note("E2"), ...rest(7)] },
    ]);
    expect(onsets(buildSongPlan(fixture))).toEqual([0, 4 * PPQ, 8 * PPQ]);
    expect(onsets(buildNotatedPlan(fixture))).toEqual([0, 4 * PPQ, 8 * PPQ]);
  });
});

describe("77. and differ only where they are meant to", () => {
  it("gives the score the whole note and playback the shortened one", () => {
    const fixture = song([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [note("E2", { articulation: "palm_mute" }), "-", ...rest(6)],
      },
    ]);
    const written = buildNotatedPlan(fixture).events[0]!;
    const played = buildSongPlan(fixture).events[0]!;

    expect(written.kind).toBe("note");
    expect(played.kind).toBe("note");
    if (written.kind !== "note" || played.kind !== "note") return;

    // Two slots tied: the score says two, playback lifts early.
    expect(written.durationTicks).toBe(2 * ticksPerSlot(8));
    expect(played.durationTicks).toBe(
      Math.round(written.durationTicks * articulationHold("palm_mute")),
    );
    expect(played.durationTicks).toBeLessThan(written.durationTicks);
  });

  it("keeps a written velocity as written, and as a gain when played", () => {
    const fixture = song([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [note("E2", { velocity: 64 }), ...rest(7)],
      },
    ]);
    const written = buildNotatedPlan(fixture).events[0]!;
    const played = buildSongPlan(fixture).events[0]!;
    expect(written.velocity).toBe(64);
    expect(played.gain).toBeCloseTo(64 / 127, 6);
  });

  it("defaults a missing velocity to the contract's own default", () => {
    const fixture = song([
      { timeSignature: [4, 4], resolution: 8, slots: [note("E2"), ...rest(7)] },
    ]);
    expect(buildNotatedPlan(fixture).events[0]?.velocity).toBe(96);
  });

  it("never lets an articulation shorten what the score reports", () => {
    // Every articulation, one slot each: the written length is the slot.
    for (const articulation of ["palm_mute", "staccato", "sustain", "accent"]) {
      const fixture = song([
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: [note("E2", { articulation }), ...rest(7)],
        },
      ]);
      const written = buildNotatedPlan(fixture).events[0]!;
      expect(written.kind === "note" && written.durationTicks, articulation).toBe(
        ticksPerSlot(8),
      );
    }
  });
});
