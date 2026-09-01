/**
 * The fixture as the guided route's own storage holds it (K-59.1 §6).
 *
 * The watcher needs three numbers about the song — its bytes, its revision
 * and how many notes it carries — and it must not build the storage key to
 * get them: exactly one module names project keys (spec 13.21 §8), and a
 * component that spelled one out would be a second place to get it wrong.
 *
 * Reading only. Nothing here writes, and the storage it reads is the page's
 * own `Map`, never the device's.
 */
import { ACCEPTANCE_PROJECT_ID } from "@/lib/acceptance/session";
import { projectKey } from "@/lib/projects/project-storage";
import type { MemoryStorage } from "@/lib/acceptance/memory-storage";
import type { StorageLike } from "@/lib/song/storage";

export type FixtureReading = {
  /** Canonical bytes of the song, so two readings can be compared. */
  readonly song: string;
  /** How many times the record has been written since it was created. */
  readonly revision: number;
  /** Slots holding a fret. A rest is null and a tie is "-"; neither is one. */
  readonly notes: number;
};

const EMPTY: FixtureReading = { song: "", revision: 0, notes: 0 };

export function readFixture(storage: StorageLike): FixtureReading {
  const key = projectKey(ACCEPTANCE_PROJECT_ID);
  if (key === null) return EMPTY;
  const raw = storage.getItem(key);
  if (raw === null) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as { revision?: number; current?: unknown };
    const song = JSON.stringify(parsed.current ?? null);
    return {
      song,
      revision: parsed.revision ?? 0,
      notes: (song.match(/"fret":\s*\d+/g) ?? []).length,
    };
  } catch {
    /* Unparseable is still comparable: the bytes are the bytes. */
    return { song: raw, revision: 0, notes: 0 };
  }
}

/**
 * A short, comparable stand-in for the whole song.
 *
 * The harness needs to know whether the fixture changed, and putting a whole
 * song into a DOM attribute to find out would be a page that renders a
 * megabyte to answer a yes/no question. FNV-1a over the canonical bytes: not
 * a security hash, just a cheap one that changes when the music does.
 */
export function fixtureDigest(reading: FixtureReading): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < reading.song.length; index += 1) {
    hash ^= reading.song.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `r${reading.revision}n${reading.notes}h${hash.toString(36)}`;
}

/**
 * How many times the fixture's own record has been written since a mark.
 *
 * Here rather than in the component that needs it (spec 13.21 §8, and the
 * §138 boundary that enforces it): the count is "writes to *this key*", and
 * a component that could build the key is a component that could write to
 * it. The journal is the disposable storage's own, so this counts physical
 * mutations rather than inferring them from bytes.
 */
export function fixtureSongWrites(storage: MemoryStorage, fromIndex: number): number {
  const key = projectKey(ACCEPTANCE_PROJECT_ID);
  if (key === null) return 0;
  return storage
    .journal()
    .slice(fromIndex)
    .filter((entry) => entry.kind === "set" && entry.key === key).length;
}

/**
 * Does this storage snapshot contain the acceptance fixture's key?
 *
 * Asked of the *device's* snapshot, where the answer must be no. A yes means
 * either the fixture escaped into the reader's storage or the watcher is
 * reading the wrong store — and the second is the dangerous one, because
 * every "zero writes" number above it would then be measuring the clone
 * (2V-B.1 §4, §16).
 */
export function mentionsFixtureKey(bytes: string): boolean {
  const key = projectKey(ACCEPTANCE_PROJECT_ID);
  return key !== null && bytes.includes(key);
}
