/**
 * What the tempo number means (2V-D.2 §13).
 *
 * The measurement came first: playback and export already agree that the
 * stored BPM is quarters per minute, so nothing here migrates anything. What
 * these tests hold is that the agreement is stated rather than assumed, and
 * that a compound or asymmetric metre is described honestly.
 */
import { describe, expect, it } from "vitest";

import { buildTempoMap, secondsPerTickAt } from "@/lib/audio/tempo";
import { PPQ } from "@/lib/music/timing";
import type { Song } from "@/lib/song/schema";
import {
  BPM_UNIT_TICKS,
  feltBeatsPerMinute,
  readTempo,
} from "@/lib/music/tempo-reading";

/** One bar at a given tempo, which is all the tempo map needs to be asked. */
const songAt = (bpm: number): Song =>
  ({
    version: 4,
    title: "t",
    bpm,
    key: "E minor",
    tracks: [],
    sections: [
      {
        id: "s",
        name: "S",
        status: "fixed",
        bars: [{ timeSignature: [4, 4], resolution: 4, slots: {} }],
      },
    ],
  }) as unknown as Song;

describe("356. the stored number counts quarters, and everything agrees", () => {
  it("uses the same unit the playback clock does", () => {
    /*
     * `secondsPerTick` is `60 / (bpm * PPQ)`, so PPQ ticks take exactly one
     * unit's worth of time. Asserting it here is what makes `BPM_UNIT_TICKS`
     * a reading of the engine rather than a second opinion about it.
     */
    expect(BPM_UNIT_TICKS).toBe(PPQ);
    for (const bpm of [60, 120, 132]) {
      const map = buildTempoMap(songAt(bpm));
      expect(secondsPerTickAt(map, 0) * BPM_UNIT_TICKS).toBeCloseTo(60 / bpm, 10);
    }
  });

  it("shows the canonical line with its unit spelled out", () => {
    const reading = readTempo({ bpm: 132, meter: [4, 4], resolution: 16 });
    expect(reading.canonical).toBe("Tempo: 132 dörtlük/dk");
  });

  it("adds nothing when the beat already is the quarter", () => {
    /* "4/4 ana vuruşu: 132/dk" beside "Tempo: 132 dörtlük/dk" is the same
       number twice, and two lines saying one thing teach a reader to skip
       both. */
    expect(readTempo({ bpm: 132, meter: [4, 4], resolution: 16 }).feltBeat).toBeNull();
    expect(readTempo({ bpm: 132, meter: [3, 4], resolution: 16 }).feltBeat).toBeNull();
  });
});

describe("357. compound time is given the number a player counts", () => {
  it("turns 132 quarters into 88 dotted quarters in 6/8", () => {
    /* The brief's own example. A dotted quarter is a quarter and a half, so
       88 of them go past in the time 132 quarters do. */
    expect(feltBeatsPerMinute({ bpm: 132, meter: [6, 8], resolution: 16 })).toBe(88);
    expect(readTempo({ bpm: 132, meter: [6, 8], resolution: 16 }).feltBeat).toBe(
      "6/8 ana vuruşu: 88/dk",
    );
  });

  it("keeps the stored number visible beside the derived one", () => {
    /* The derived line never replaces the canonical one. A reader who exports
       to MIDI gets 132, and the screen must have said 132 somewhere. */
    const reading = readTempo({ bpm: 132, meter: [6, 8], resolution: 16 });
    expect(reading.canonical).toContain("132");
    expect(reading.bpm).toBe(132);
  });

  it("gives 12/8 the same four dotted beats", () => {
    expect(feltBeatsPerMinute({ bpm: 120, meter: [12, 8], resolution: 16 })).toBe(80);
  });
});

describe("358. an uneven metre is told the truth about itself", () => {
  it("refuses a single beats-per-minute for 7/8", () => {
    /*
     * Two of its beats are a quarter and one is a dotted quarter. Any single
     * number would be an average of two things nobody plays, and printing one
     * would be the module inventing a tempo the music does not have.
     */
    expect(feltBeatsPerMinute({ bpm: 120, meter: [7, 8], resolution: 16 })).toBeNull();
    const reading = readTempo({ bpm: 120, meter: [7, 8], resolution: 16 });
    expect(reading.unevenBeats).toBe(true);
    expect(reading.feltBeat).toBeNull();
    expect(reading.canonical).toBe("Tempo: 120 dörtlük/dk");
  });

  it("says the same of 5/8 and 9/8 felt asymmetrically", () => {
    expect(feltBeatsPerMinute({ bpm: 100, meter: [5, 8], resolution: 16 })).toBeNull();
    expect(
      feltBeatsPerMinute({
        bpm: 100,
        meter: [9, 8],
        resolution: 16,
        grouping: [2, 2, 2, 3],
      }),
    ).toBeNull();
  });

  it("answers 9/8 felt 3+3+3, because that one is even", () => {
    /* `unevenBeats` is a fact about the bar's feel, not about its numerator.
       The same metre gets a number when the reader groups it evenly. */
    expect(
      feltBeatsPerMinute({
        bpm: 120,
        meter: [9, 8],
        resolution: 16,
        grouping: [3, 3, 3],
      }),
    ).toBe(80);
  });

  it("never rounds a real tempo into a whole number", () => {
    /* 100 quarters a minute in 6/8 is 66.67 dotted quarters, and saying 67
       would put the two lines out of step with each other. */
    expect(
      readTempo({ bpm: 100, meter: [6, 8], resolution: 16 }).feltBeat,
    ).toBe("6/8 ana vuruşu: 66.7/dk");
  });
});
