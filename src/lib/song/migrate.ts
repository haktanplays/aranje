/**
 * Lifting a stored song to the version this app writes (2T §4).
 *
 * There is exactly one rule here and it is worth stating before the code:
 * **a migration may not change what a song sounds like.** A file written
 * before Score Truth v2 has notes with no `durationTicks`, and the absence of
 * that field is not a gap to be filled in — it *is* the old rule, spelled the
 * old way: the note lasts until its tie run ends. So the migration stamps a
 * number and returns the same music.
 *
 * Version 4 is the same story told again. It added five articulations —
 * ghost, dead, tapping and the two harmonics (2T-C §9) — and adding a way to
 * say something new takes nothing away from a song that never said it. A
 * version 3 file has none of them, and none of them is a default: their
 * absence is a note played the ordinary way, which is exactly what it always
 * was.
 *
 * That makes this function look trivial, and it is. It exists anyway, because
 * the alternative is the version boundary being implicit — a loader that
 * accepts three shapes and hopes they mean the same thing. This one says so
 * out loud, and `migrate.test.ts` holds it to byte equality on everything but
 * the version field.
 */
import { SONG_VERSION, type Song } from "@/lib/song/schema";

export type Migration = {
  readonly song: Song;
  /** True when the song was written by an older version and was lifted. */
  readonly lifted: boolean;
  readonly from: number;
};

export function migrateSong(song: Song): Migration {
  if (song.version === SONG_VERSION) {
    return { song, lifted: false, from: song.version };
  }
  /*
   * A shallow copy with a new version. Nothing is walked, because there is
   * nothing to walk: no note, bar, section or track means anything different
   * under version 4 than it did under 3, or under 3 than under 2.
   */
  return {
    song: { ...song, version: SONG_VERSION },
    lifted: true,
    from: song.version,
  };
}
