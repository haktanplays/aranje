/**
 * What is actually written to `aranje.song`, and how it is read back
 * (spec 5.6, 13.14, K-45).
 *
 * Every successful edit already saved the song. What it did not do was keep
 * the song it was replacing — so a write that landed half-formed, a schema
 * that moved under a stored file, or any other way a single slot can go bad
 * took the musician's work with it and left them the sample song.
 *
 * The envelope keeps two: the song as it is, and the last one that was known
 * to be readable. One object, so a normal commit is still **one**
 * `setItem` — two slots with a pointer between them would be two or three
 * physical writes, and the moment a write can be half-done is the moment this
 * whole checkpoint is trying to remove.
 *
 * ## Reading is a decision, and the decision is pure
 *
 * `decideLoad` takes the raw string and returns what should happen. It touches
 * no storage, so every branch — including the ones that only occur when
 * something has already gone wrong — can be tested exactly, and the same input
 * always gives the same answer.
 *
 * ## The version is read before the shape
 *
 * A future version may not have this shape at all. So the format tag and the
 * version number are read with a *loose* schema first: if the version is not
 * one this app knows, the answer is "leave it alone", not "this is corrupt".
 * Quarantining a file written by a newer Aranje would be this version
 * destroying the newer one's work on the grounds that it could not read it.
 */
import { z } from "zod";

import { migrateSong } from "@/lib/song/migrate";
import { songSchema, type Song } from "@/lib/song/schema";

export const SONG_ENVELOPE_FORMAT = "aranje.song";
export const SONG_ENVELOPE_VERSION = 1;

/**
 * Only the tag, and loosely.
 *
 * Deliberately not strict and deliberately says nothing about the rest: its
 * whole job is to answer "was this written by an Aranje, and which one?"
 * before anything decides the file is unreadable.
 */
const envelopeTagSchema = z.object({
  format: z.literal(SONG_ENVELOPE_FORMAT),
  version: z.number().int().min(1),
});

/**
 * The V1 shell.
 *
 * Strict, so an unknown key means a file this version does not understand
 * rather than one it can half-read. `current` and `previous` are left as
 * `unknown` on purpose: they are validated **separately**, because the entire
 * point of keeping two is that one of them may be broken.
 */
const envelopeShellSchema = z.strictObject({
  format: z.literal(SONG_ENVELOPE_FORMAT),
  version: z.literal(SONG_ENVELOPE_VERSION),
  revision: z.number().int().min(0),
  current: z.unknown(),
  previous: z.unknown(),
});

export type SongStorageEnvelopeV1 = {
  readonly format: typeof SONG_ENVELOPE_FORMAT;
  readonly version: typeof SONG_ENVELOPE_VERSION;
  readonly revision: number;
  readonly current: Song;
  readonly previous: Song | null;
};

/**
 * What reading the key means.
 *
 * A closed set, so the caller cannot invent a fifth outcome, and every one of
 * them says what to do about it rather than what went wrong.
 */
export type LoadDecision =
  /** Nothing stored yet. A first run, not a failure. */
  | { readonly kind: "empty" }
  /** A raw Song from before the envelope existed. */
  | { readonly kind: "legacy"; readonly song: Song }
  /** A V1 envelope whose current slot is readable. */
  | {
      readonly kind: "envelope";
      readonly song: Song;
      readonly revision: number;
      readonly previous: Song | null;
    }
  /** The current slot is unreadable and the previous one saved it. */
  | {
      readonly kind: "recovered_previous";
      readonly song: Song;
      readonly revision: number;
    }
  /** Nothing readable in there. The raw value is the musician's, so it is kept. */
  | { readonly kind: "corrupt" }
  /** Written by a newer Aranje. Not corrupt — just not ours to touch. */
  | { readonly kind: "unsupported_version"; readonly version: number };

/**
 * Decide what a stored value means. Pure: reads nothing, writes nothing.
 *
 * The order is the order of spec 13.14 and it matters:
 *
 * 1. no value at all
 * 2. unparseable text
 * 3. a legacy raw Song — checked before the envelope because it is the older
 *    format and the two cannot be confused (a Song has no `format` key and an
 *    envelope has no `tracks`)
 * 4. an envelope tag with a version this app does not know
 * 5. a V1 envelope: current, then previous
 * 6. anything else
 */
export function decideLoad(raw: string | null): LoadDecision {
  if (raw === null) return { kind: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt" };
  }

  /*
   * Everything that comes off disk is lifted to the version this app writes
   * (2T §4). It happens here, at the one door, rather than in each reader —
   * a song that reached the engine still carrying an older version number
   * would be a second shape for everything downstream to know about.
   *
   * The lift changes the version and nothing else, so this is not a place
   * where old music can quietly become different music.
   */
  const legacy = songSchema.safeParse(parsed);
  if (legacy.success) {
    return { kind: "legacy", song: migrateSong(legacy.data).song };
  }

  const tag = envelopeTagSchema.safeParse(parsed);
  if (tag.success && tag.data.version !== SONG_ENVELOPE_VERSION) {
    return { kind: "unsupported_version", version: tag.data.version };
  }

  const shell = envelopeShellSchema.safeParse(parsed);
  if (!shell.success) return { kind: "corrupt" };

  const current = songSchema.safeParse(shell.data.current);
  const previous = songSchema.safeParse(shell.data.previous);

  if (current.success) {
    return {
      kind: "envelope",
      song: migrateSong(current.data).song,
      revision: shell.data.revision,
      previous: previous.success ? migrateSong(previous.data).song : null,
    };
  }
  if (previous.success) {
    return {
      kind: "recovered_previous",
      song: migrateSong(previous.data).song,
      revision: shell.data.revision,
    };
  }
  return { kind: "corrupt" };
}

/**
 * The next envelope to write.
 *
 * `previous` is whatever was readable on disk a moment ago — not the song
 * before it in the *history*, which is a different idea entirely. History is a
 * session's editing; this is the one rung of a ladder that a crash can be
 * caught on, and an undo needs catching as much as an edit does.
 */
export function nextEnvelope(
  song: Song,
  onDisk: LoadDecision,
): SongStorageEnvelopeV1 {
  const previous =
    onDisk.kind === "envelope"
      ? onDisk.song
      : onDisk.kind === "legacy"
        ? onDisk.song
        : onDisk.kind === "recovered_previous"
          ? onDisk.song
          : null;

  const revision =
    onDisk.kind === "envelope" || onDisk.kind === "recovered_previous"
      ? onDisk.revision + 1
      : /*
         * A legacy file has no revision, and neither has an empty or corrupt
         * one. Starting at 1 makes "0" mean "nothing has been written through
         * an envelope yet", which is a fact worth being able to see.
         */
        1;

  return {
    format: SONG_ENVELOPE_FORMAT,
    version: SONG_ENVELOPE_VERSION,
    revision,
    current: song,
    previous,
  };
}
