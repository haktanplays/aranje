import { describe, expect, it } from "vitest";

import { songLimits } from "@/lib/limits";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  barSchema,
  isDrumSlotArray,
  isMelodicSlotArray,
  melodicSlotSchema,
  songSchema,
} from "@/lib/song/schema";
import { drumTrack, guitarTrack, section, song } from "@/lib/song/fixtures";
import {
  RESOLUTIONS,
  TIME_SIGNATURES,
  isRepresentableGrid,
} from "@/lib/music/timing";

describe("song schema (spec 5)", () => {
  it("accepts the sample song", () => {
    const result = songSchema.safeParse(SAMPLE_SONG);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown top-level field", () => {
    const result = songSchema.safeParse({ ...SAMPLE_SONG, tempo: 120 });
    expect(result.success).toBe(false);
  });

  it("pins the contract version", () => {
    expect(songSchema.safeParse({ ...SAMPLE_SONG, version: 1 }).success).toBe(
      false,
    );
  });

  it("requires the documented key form", () => {
    expect(songSchema.safeParse({ ...SAMPLE_SONG, key: "E minor" }).success).toBe(
      true,
    );
    expect(songSchema.safeParse({ ...SAMPLE_SONG, key: "Em" }).success).toBe(
      false,
    );
    expect(
      songSchema.safeParse({ ...SAMPLE_SONG, key: "H minor" }).success,
    ).toBe(false);
  });

  it("holds bpm inside the documented range", () => {
    expect(songSchema.safeParse({ ...SAMPLE_SONG, bpm: 39 }).success).toBe(false);
    expect(songSchema.safeParse({ ...SAMPLE_SONG, bpm: 261 }).success).toBe(
      false,
    );
  });

  it("caps tracks at the central limit", () => {
    const tracks = Array.from({ length: songLimits.maxTracks + 1 }, (_, i) =>
      guitarTrack({ id: `t${i}` }),
    );
    expect(
      songSchema.safeParse({ ...SAMPLE_SONG, tracks, sections: [] }).success,
    ).toBe(false);
  });

  it("caps bars per section at the central limit", () => {
    const bar = { timeSignature: [4, 4], resolution: 8, slots: {} };
    const overLimit = {
      ...SAMPLE_SONG,
      sections: [
        {
          id: "s1",
          name: "Test",
          status: "fixed",
          bars: Array.from(
            { length: songLimits.barsPerSection + 1 },
            () => bar,
          ),
        },
      ],
    };
    expect(songSchema.safeParse(overLimit).success).toBe(false);
  });

  it("reads a rest, a tie and a chord", () => {
    expect(melodicSlotSchema.safeParse(null).success).toBe(true);
    expect(melodicSlotSchema.safeParse("-").success).toBe(true);
    expect(
      melodicSlotSchema.safeParse({
        notes: [{ pitch: "E2" }, { pitch: "B2" }],
      }).success,
    ).toBe(true);
  });

  it("rejects an empty note list", () => {
    expect(melodicSlotSchema.safeParse({ notes: [] }).success).toBe(false);
  });

  it("rejects an unknown tie marker", () => {
    expect(melodicSlotSchema.safeParse("~").success).toBe(false);
  });

  it("keeps melodic and drum slot arrays apart, even when both are silent", () => {
    const silentMelodic = barSchema.safeParse({
      timeSignature: [4, 4],
      resolution: 8,
      slots: { gtr: [null, null, null, null, null, null, null, null] },
    });
    expect(silentMelodic.success).toBe(true);
    if (silentMelodic.success) {
      const slots = silentMelodic.data.slots.gtr ?? [];
      expect(isMelodicSlotArray(slots)).toBe(true);
      expect(isDrumSlotArray(slots)).toBe(false);
    }

    const silentDrums = barSchema.safeParse({
      timeSignature: [4, 4],
      resolution: 8,
      slots: { drums: [[], [], [], [], [], [], [], []] },
    });
    expect(silentDrums.success).toBe(true);
    if (silentDrums.success) {
      const slots = silentDrums.data.slots.drums ?? [];
      expect(isDrumSlotArray(slots)).toBe(true);
      expect(isMelodicSlotArray(slots)).toBe(false);
    }
  });

  it("allows several drum hits in one slot", () => {
    const result = barSchema.safeParse({
      timeSignature: [4, 4],
      resolution: 8,
      slots: {
        drums: [
          [{ piece: "kick" }, { piece: "closed_hat" }, { piece: "crash" }],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a drum piece outside the vocabulary", () => {
    const result = barSchema.safeParse({
      timeSignature: [4, 4],
      resolution: 8,
      slots: { drums: [[{ piece: "cowbell" }], [], [], [], [], [], [], []] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts every documented meter on every grid it can be written on", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        const parsed = barSchema.safeParse({
          timeSignature,
          resolution,
          slots: {},
        });
        expect(parsed.success).toBe(
          isRepresentableGrid(timeSignature, resolution),
        );
      }
    }
  });

  it("takes the six named grids and the one lattice, and nothing else", () => {
    for (const resolution of [8, 12, 16, 24, 32]) {
      expect(
        barSchema.safeParse({ timeSignature: [4, 4], resolution, slots: {} })
          .success,
      ).toBe(true);
    }
    /*
     * 48 joined at 2V-B.4 Completion §5 and is a different kind of member: it
     * is a **lattice**, not a grid anyone is offered. It exists so straight
     * sixteenths (every 48 ticks) and their triplets (every 32) can be written
     * exactly in one measure, which under six grids they could not be. It is
     * never in a picker and never in the Copilot's vocabulary — the format
     * accepts it, the vocabulary does not.
     */
    expect(
      barSchema.safeParse({ timeSignature: [4, 4], resolution: 48, slots: {} })
        .success,
    ).toBe(true);
    expect(RESOLUTIONS as readonly number[]).not.toContain(48);

    // 64 is the one people will ask for; it is deliberately not here. 4 is,
    // since 2N-A — a quarter grid, which is why it left this list.
    for (const rejected of [1, 6, 10, 20, 64, 96, 128, 16.5, -16]) {
      expect(
        barSchema.safeParse({
          timeSignature: [4, 4],
          resolution: rejected,
          slots: {},
        }).success,
      ).toBe(false);
    }
  });

  it("lets a bar say which grid its reader is reading, and only an offered one", () => {
    const onLattice = (notation: unknown) =>
      barSchema.safeParse({
        timeSignature: [4, 4],
        resolution: 48,
        notation,
        slots: {},
      }).success;
    expect(onLattice(16)).toBe(true);
    expect(onLattice(8)).toBe(true);
    /* A bar cannot claim to be read on a grid nobody counts. */
    expect(onLattice(48)).toBe(false);
    expect(onLattice(64)).toBe(false);
    /* And absence is the ordinary case: every song written before now. */
    expect(
      barSchema.safeParse({ timeSignature: [4, 4], resolution: 16, slots: {} }).success,
    ).toBe(true);
  });

  it("refuses a meter that cannot be written on the grid it declares", () => {
    // Nine whole slots, none of which is an eighth.
    const compoundTriplet = barSchema.safeParse({
      timeSignature: [6, 8],
      resolution: 12,
      slots: {},
    });
    expect(compoundTriplet.success).toBe(false);
    if (!compoundTriplet.success) {
      expect(compoundTriplet.error.issues[0]?.path).toEqual(["resolution"]);
    }
    // Ten and a half slots.
    expect(
      barSchema.safeParse({
        timeSignature: [7, 8],
        resolution: 12,
        slots: {},
      }).success,
    ).toBe(false);
  });

  it("still refuses a meter that is not in the contract", () => {
    expect(
      barSchema.safeParse({
        timeSignature: [5, 4],
        resolution: 8,
        slots: {},
      }).success,
    ).toBe(false);
  });

  it("keeps velocity inside MIDI bounds", () => {
    expect(
      melodicSlotSchema.safeParse({ notes: [{ pitch: "E2", velocity: 0 }] })
        .success,
    ).toBe(false);
    expect(
      melodicSlotSchema.safeParse({ notes: [{ pitch: "E2", velocity: 128 }] })
        .success,
    ).toBe(false);
    expect(
      melodicSlotSchema.safeParse({ notes: [{ pitch: "E2", velocity: 127 }] })
        .success,
    ).toBe(true);
  });

  it("keeps capo inside its documented range", () => {
    const bad = song([guitarTrack({ fretboard: { tuning: ["E2"], capo: 13 } })], []);
    expect(songSchema.safeParse(bad).success).toBe(false);
    const good = song([guitarTrack({ fretboard: { tuning: ["E2"], capo: 12 } })], []);
    expect(songSchema.safeParse(good).success).toBe(true);
  });

  it("allows a bar to omit a track, meaning that track is silent", () => {
    const result = songSchema.safeParse(
      song(
        [guitarTrack(), drumTrack()],
        [
          section([
            {
              timeSignature: [4, 4],
              resolution: 8,
              slots: { gtr: [null, null, null, null, null, null, null, null] },
            },
          ]),
        ],
      ),
    );
    expect(result.success).toBe(true);
  });
});
