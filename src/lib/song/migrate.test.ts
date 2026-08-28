import { describe, expect, it } from "vitest";

import { migrateSong } from "@/lib/song/migrate";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { SONG_VERSION, songSchema, type Song } from "@/lib/song/schema";

const asV2 = (song: Song): Song => ({ ...song, version: 2 });

describe("migrateSong", () => {
  it("writes the current version", () => {
    expect(SONG_VERSION).toBe(3);
    expect(migrateSong(asV2(SAMPLE_SONG)).song.version).toBe(3);
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
