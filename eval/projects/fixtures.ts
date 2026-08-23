/**
 * The thirteen start states a real device can be in when 2O-A opens it.
 *
 * Written once, here, because the migration has to be judged against the same
 * inputs from three directions: the pure unit tests, the physical-ledger
 * measurement, and the browser acceptance run. Three hand-written copies of
 * "a legacy song" would drift, and the one that drifted would be the one that
 * passed.
 *
 * Every fixture is a *stored string* or the absence of one — not a parsed
 * object — because that is what the app actually meets.
 */
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { SONG_ENVELOPE_FORMAT, SONG_ENVELOPE_VERSION } from "@/lib/song/storage-envelope";
import type { Song } from "@/lib/song/schema";

/** A small, valid song that is visibly not the sample. */
export const legacySong = (): Song => ({
  ...SAMPLE_SONG,
  title: "Eski Şarkı",
  sections: SAMPLE_SONG.sections.slice(0, 1),
});

export const otherSong = (): Song => ({
  ...SAMPLE_SONG,
  title: "İkinci Şarkı",
  sections: SAMPLE_SONG.sections.slice(0, 1),
});

const envelope = (current: unknown, previous: unknown, revision = 4) =>
  JSON.stringify({
    format: SONG_ENVELOPE_FORMAT,
    version: SONG_ENVELOPE_VERSION,
    revision,
    current,
    previous,
  });

export type StartState = {
  readonly id: string;
  /** What the description says it is, in one line, for the report table. */
  readonly what: string;
  /** The raw value under `aranje.song`, or null for "no key at all". */
  readonly raw: string | null;
  /** The song the reader must still be able to reach, when there is one. */
  readonly reachable: Song | null;
};

export const START_STATES: readonly StartState[] = [
  { id: "empty", what: "hiç anahtar yok", raw: null, reachable: null },
  {
    id: "legacy",
    what: "geçerli ham legacy Song",
    raw: JSON.stringify(legacySong()),
    reachable: legacySong(),
  },
  {
    id: "envelope",
    what: "geçerli V1 envelope",
    raw: envelope(legacySong(), otherSong()),
    reachable: legacySong(),
  },
  {
    id: "current_broken",
    what: "current bozuk, previous sağlam",
    raw: envelope({ version: 2, title: 9 }, otherSong()),
    reachable: otherSong(),
  },
  {
    id: "both_broken",
    what: "iki slot da bozuk",
    raw: envelope({ nope: true }, { nope: true }),
    reachable: null,
  },
  { id: "malformed", what: "bozuk JSON", raw: "{not json", reachable: null },
  {
    id: "future",
    what: "gelecek sürüm envelope",
    raw: JSON.stringify({ format: SONG_ENVELOPE_FORMAT, version: 99, anything: 1 }),
    reachable: null,
  },
];
