import { describe, expect, it } from "vitest";

import { migrateSong } from "@/lib/song/migrate";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { SONG_VERSION, songSchema, type Song } from "@/lib/song/schema";

const asV2 = (song: Song): Song => ({ ...song, version: 2 });

describe("migrateSong", () => {
  it("writes the current version", () => {
    expect(SONG_VERSION).toBe(4);
    expect(migrateSong(asV2(SAMPLE_SONG)).song.version).toBe(SONG_VERSION);
  });

  /*
   * The one rule. A migration that changed a note would change what a song
   * sounds like, and a reader who opened an old project would hear something
   * they did not write.
   */
  it("changes the version and not one other byte", () => {
    const before = asV2(SAMPLE_SONG);
    const { song } = migrateSong(before);
    expect(JSON.stringify({ ...song, version: 2 })).toBe(JSON.stringify(before));
  });

  it("adds no duration to a note that never had one", () => {
    const { song } = migrateSong(asV2(SAMPLE_SONG));
    for (const section of song.sections) {
      for (const bar of section.bars) {
        for (const slots of Object.values(bar.slots)) {
          for (const slot of slots) {
            if (slot === null || slot === "-" || Array.isArray(slot)) continue;
            for (const note of slot.notes) {
              expect(note.durationTicks).toBeUndefined();
              expect(note.letRing).toBeUndefined();
            }
          }
        }
      }
    }
  });

  it("says whether it lifted anything, and leaves a current song alone", () => {
    expect(migrateSong(asV2(SAMPLE_SONG))).toMatchObject({ lifted: true, from: 2 });
    const current = migrateSong(asV2(SAMPLE_SONG)).song;
    const again = migrateSong(current);
    expect(again.lifted).toBe(false);
    expect(again.song).toBe(current);
  });

  it("produces a song the schema accepts", () => {
    expect(songSchema.safeParse(migrateSong(asV2(SAMPLE_SONG)).song).success).toBe(true);
  });
});

/**
 * 2T-C §9. Version 4 added five articulations. Adding a way to say something
 * new takes nothing away from a song that never said it, and none of the five
 * is a default — their absence is a note played the ordinary way, which is
 * what it always was.
 */
describe("version 4 lifts a version 3 song without changing it", () => {
  const v3 = (): Song => ({
    version: 3,
    title: "Eski",
    bpm: 120,
    key: "E minor",
    tracks: [
      {
        id: "gtr",
        name: "Gitar",
        instrumentId: "electric_guitar",
        presetId: "clean",
        volumeDb: -6,
        fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
      },
    ],
    sections: [
      {
        id: "s1",
        name: "A",
        status: "fixed",
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 16,
            slots: {
              gtr: [
                {
                  notes: [
                    {
                      pitch: "E2",
                      position: { string: 0, fret: 0 },
                      durationTicks: 192,
                      letRing: true,
                      articulation: "palm_mute",
                    },
                  ],
                },
                ...Array.from({ length: 15 }, () => null),
              ],
            },
          },
        ],
      },
    ],
  });

  it("changes the version and nothing else", () => {
    const before = v3();
    const after = migrateSong(before);
    expect(after.lifted).toBe(true);
    expect(after.from).toBe(3);
    expect(JSON.stringify({ ...after.song, version: 3 })).toBe(JSON.stringify(before));
  });

  it("still reads as a valid song", () => {
    expect(songSchema.safeParse(migrateSong(v3()).song).success).toBe(true);
  });

  it("gives no note an articulation it did not have", () => {
    const after = migrateSong(v3()).song;
    const slot = after.sections[0]!.bars[0]!.slots.gtr![0];
    if (slot === null || slot === undefined || slot === "-" || Array.isArray(slot)) {
      throw new Error("lost");
    }
    expect(slot.notes[0]!.articulation).toBe("palm_mute");
  });
});
