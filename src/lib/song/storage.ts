/**
 * Safe localStorage access (spec 5.6, 13.14).
 *
 * Keys use the ASCII `aranje.` prefix. A parse or validation failure must never
 * crash the app and must never throw the musician's work away: the raw value is
 * quarantined under `aranje.corrupt.<timestamp>` and something usable is loaded
 * instead.
 *
 * Since 2K-B the song is written inside a recovery envelope that also keeps the
 * last readable version (`storage-envelope.ts`). The *decisions* about what a
 * stored value means live there and are pure; this file is the part that
 * touches storage, and it is deliberately thin because everything it does is
 * irreversible.
 *
 * ## Reading never repairs destructively
 *
 * Three rules hold together and are the whole point of the checkpoint:
 *
 * - Anything unreadable is **preserved** before anything is written over it —
 *   and if preserving it fails, nothing is written over it at all.
 * - Anything from a *newer* version is left completely alone — not quarantined,
 *   not overwritten, not deleted. This app not understanding a file is not
 *   evidence that the file is broken.
 * - A session that cannot write does not edit (2K-B.1). There is no
 *   memory-only editing mode: an edit that looks saved and dies with the tab
 *   is the exact loss the envelope exists to prevent, delivered by the app
 *   itself. The song stays visible and playable; mutation is closed.
 */
import { BRAND_NAME } from "@/lib/brand";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";

export const STORAGE_PREFIX = "aranje.";
export const SONG_KEY = `${STORAGE_PREFIX}song`;
export const HISTORY_KEY = `${STORAGE_PREFIX}history`;
export const CORRUPT_KEY_PREFIX = `${STORAGE_PREFIX}corrupt.`;
/** Written and removed once per load, to learn whether writing works at all. */
export const WRITE_CHECK_KEY = `${STORAGE_PREFIX}probe`;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LoadOutcome =
  /** A valid stored song was read. */
  | "stored"
  /** Nothing stored yet; the sample song is the starting point. */
  | "empty"
  /** Stored data was unreadable; it was quarantined and the sample loaded. */
  | "recovered"
  /** Storage itself is not usable; the sample is used in memory only. */
  | "unavailable";

/**
 * What the reader is told, if anything.
 *
 * Four states and no free text, so a technical diagnostic cannot reach a
 * musician by accident. The sentences live in one table below.
 */
export type RecoveryState =
  /** The last save was unreadable; the one before it came back. */
  | "recovered_previous"
  /** Nothing readable at all; the raw value was kept and the sample opened. */
  | "corrupt_fallback"
  /** Written by a newer Aranje. Nothing was touched, and nothing may be. */
  | "unsupported_version"
  /** Storage refused a write. Nothing was lost, but nothing was saved either. */
  | "storage_write_failed"
  /**
   * The device cannot save at all — no storage, access throws, or the
   * capability probe failed at startup. Editing is closed rather than run in
   * memory: work that looks saved and dies with the tab is worse than no
   * editing, because nobody mourns an edit they were never allowed to make.
   */
  | "storage_unavailable";

export const RECOVERY_MESSAGES: Readonly<Record<RecoveryState, string>> = {
  recovered_previous:
    "Son kayıt açılamadı. Bir önceki sağlam sürüm geri yüklendi.",
  corrupt_fallback:
    "Kaydedilmiş şarkı açılamadı. Bozuk veri korundu ve örnek şarkı açıldı.",
  // The brand is interpolated rather than typed: source files stay ASCII and
  // the reader still sees the real name (spec 1.4).
  unsupported_version:
    `Bu kayıt ${BRAND_NAME}'nin daha yeni bir sürümüyle oluşturulmuş. ` +
    "Verinin üzerine yazılmadı.",
  storage_write_failed:
    "Şarkı cihazına kaydedilemedi. Cihazda alan açıp tekrar dene.",
  storage_unavailable:
    "Cihazda kayıt açılamadı. Çalışmanı kaybetmemek için düzenleme kapatıldı; " +
    "şarkıyı dinlemeye devam edebilirsin.",
};

export type LoadResult = {
  song: Song;
  outcome: LoadOutcome;
  /** Reader-facing explanation, set when the outcome needs one. */
  message?: string;
  /** Which banner to show, if any. Never a diagnostic. */
  recovery?: RecoveryState;
  /** Key the unreadable value was preserved under. */
  backupKey?: string;
  /**
   * False when this session must not write to the song key at all.
   *
   * Set by a file from a newer version, and by a rescue whose repair write was
   * itself refused: in both cases a commit would either destroy data this app
   * cannot read or silently fail to save, and saying so up front is better
   * than finding out one edit later.
   */
  canPersist: boolean;
};

export type Clock = () => number;

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Keep the unreadable value, then clear the key.
 *
 * The suffix loop is not paranoia: two quarantines in the same millisecond are
 * possible on a fast machine, and a collision would mean the second rescue
 * writing over the first one's evidence — the exact failure this function
 * exists to prevent, one level down.
 */
function quarantine(
  storage: StorageLike,
  raw: string,
  now: Clock,
  /**
   * Whether to clear the song key afterwards.
   *
   * A total loss clears it — there is nothing left in there worth reading. A
   * rescue does not: the key is about to be repaired with the song that came
   * back, and clearing it first would open a window in which the app has no
   * song at all.
   */
  clear: boolean,
): string | undefined {
  const stamp = `${CORRUPT_KEY_PREFIX}${now()}`;
  let backupKey = stamp;
  try {
    for (let attempt = 1; storage.getItem(backupKey) !== null; attempt += 1) {
      backupKey = `${stamp}.${attempt}`;
      // A deterministic, bounded search: nobody has a thousand rescues.
      if (attempt > 1000) return undefined;
    }
    storage.setItem(backupKey, raw);
    if (clear) storage.removeItem(SONG_KEY);
    return backupKey;
  } catch {
    return undefined;
  }
}

/**
 * A read-only session, with whatever song could still be read.
 *
 * The sample when storage could not even be read; the reader's own song when
 * it could. Both carry the same non-dismissible state: editing is closed, and
 * the sentence says so without naming a browser API.
 */
const unavailable = (song: Song = SAMPLE_SONG): LoadResult => ({
  song,
  outcome: song === SAMPLE_SONG ? "unavailable" : "stored",
  message: RECOVERY_MESSAGES.storage_unavailable,
  recovery: "storage_unavailable",
  canPersist: false,
});

/**
 * Can this storage actually take a write?
 *
 * Asked once, at load, with a real `setItem` on a dedicated key — because the
 * only honest answer to "can I save here?" is an attempt. A session that
 * cannot write must not offer editing (2K-B.1): the alternative is a musician
 * who edits for an hour, sees no error, and loses everything with the tab.
 *
 * The probe is one `setItem` and one `removeItem` on `aranje.probe`, and it is
 * reported as such in the write accounting — a physical operation the app
 * performs is never hidden under "the app wrote nothing".
 */
function canWrite(storage: StorageLike): boolean {
  try {
    storage.setItem(WRITE_CHECK_KEY, "1");
  } catch {
    return false;
  }
  try {
    storage.removeItem(WRITE_CHECK_KEY);
  } catch {
    // The write itself worked; a failed cleanup does not make writing broken.
  }
  return true;
}

/**
 * Read the stored song. Always returns a usable song; never throws.
 */
export function loadSong(
  storage: StorageLike | null = browserStorage(),
  now: Clock = () => Date.now(),
): LoadResult {
  if (!storage) return unavailable();

  let raw: string | null;
  try {
    raw = storage.getItem(SONG_KEY);
  } catch {
    return unavailable();
  }

  /*
   * The capability probe, before any decision that might want to write. A
   * storage that answers reads and refuses writes — full, sandboxed, denied —
   * has to close editing the same way a missing one does, and it has to be
   * found out now rather than at the first edit.
   */
  const writable = canWrite(storage);

  const decision = decideLoad(raw);

  switch (decision.kind) {
    case "empty":
      return writable
        ? { song: SAMPLE_SONG, outcome: "empty", canPersist: true }
        : unavailable();

    /*
     * A song from before the envelope. It opens normally and is *not* migrated
     * here: rewriting it at load would be a write nobody asked for, on a path
     * where a failed write would be the first thing a reader saw. The first
     * real edit writes the envelope, and carries this song into `previous`.
     */
    case "legacy":
      return writable
        ? { song: decision.song, outcome: "stored", canPersist: true }
        : unavailable(decision.song);

    case "envelope":
      return writable
        ? { song: decision.song, outcome: "stored", canPersist: true }
        : unavailable(decision.song);

    /*
     * The last save is unreadable and the one before it is not. The reader
     * gets the older song and a sentence saying so — and the key is repaired,
     * because leaving a known-bad current slot there means the next reload
     * rescues all over again from a `previous` that is now two edits old.
     *
     * The order is loss-proof: nothing writes over the broken envelope until
     * a copy of it exists. Quarantine first; repair only if that landed; and
     * an unwritable storage attempts neither — the rescue is re-run by a
     * session that can actually keep its results.
     */
    case "recovered_previous": {
      if (!writable) return unavailable(decision.song);

      const backupKey = raw === null ? undefined : quarantine(storage, raw, now, false);
      const repaired =
        backupKey !== undefined &&
        writeEnvelope(
          storage,
          nextEnvelope(decision.song, {
            kind: "envelope",
            song: decision.song,
            revision: decision.revision,
            previous: null,
          }),
        );
      return {
        song: decision.song,
        outcome: "stored",
        recovery: repaired ? "recovered_previous" : "storage_write_failed",
        message: RECOVERY_MESSAGES[
          repaired ? "recovered_previous" : "storage_write_failed"
        ],
        ...(backupKey === undefined ? {} : { backupKey }),
        canPersist: repaired,
      };
    }

    /*
     * A newer Aranje wrote this. Nothing is quarantined, nothing is removed and
     * nothing may be written: the sample song is a surface to look at, not a
     * replacement, and this session is read-only until the reader opens the app
     * that can read the file.
     */
    case "unsupported_version":
      return {
        song: SAMPLE_SONG,
        outcome: "stored",
        recovery: "unsupported_version",
        message: RECOVERY_MESSAGES.unsupported_version,
        canPersist: false,
      };

    case "corrupt": {
      /*
       * An unwritable storage cannot quarantine, and without a quarantine the
       * raw value must not be touched — it is the musician's, however broken.
       * The sample opens read-only and the data waits for a session that can
       * rescue it properly.
       */
      if (!writable) return unavailable();

      const backupKey = raw === null ? undefined : quarantine(storage, raw, now, true);
      if (raw !== null && backupKey === undefined) {
        /*
         * The quarantine write itself failed, so the raw value is still in
         * the key, byte-identical — `quarantine` clears only after a
         * successful copy. Editing closes: a commit would write over the one
         * copy of whatever this used to be.
         */
        return {
          song: SAMPLE_SONG,
          outcome: "recovered",
          recovery: "storage_write_failed",
          message: RECOVERY_MESSAGES.storage_write_failed,
          canPersist: false,
        };
      }
      return {
        song: SAMPLE_SONG,
        outcome: "recovered",
        recovery: "corrupt_fallback",
        message: RECOVERY_MESSAGES.corrupt_fallback,
        ...(backupKey === undefined ? {} : { backupKey }),
        canPersist: true,
      };
    }
  }
}

function writeEnvelope(
  storage: StorageLike,
  envelope: ReturnType<typeof nextEnvelope>,
): boolean {
  try {
    storage.setItem(SONG_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export type SaveFailure =
  /** No storage at all: the session runs in memory and says so. */
  | "unavailable"
  /** The candidate is not a Song. Never written, never recorded. */
  | "invalid"
  /** A newer version's file is in the way. Writing would destroy it. */
  | "unsupported_version"
  /** `setItem` threw — quota, permissions, or anything else. */
  | "write_failed";

export type SaveResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: SaveFailure };

/**
 * Persist the song inside a fresh envelope. Exactly one `setItem`.
 *
 * The song on disk a moment ago becomes `previous`, so the file always carries
 * one rung to climb back to. Reading it first costs a `getItem` and no write —
 * and reading the *disk* rather than trusting a value held in memory is what
 * makes the rung true even when another tab has been editing.
 */
export function saveSong(
  song: Song,
  storage: StorageLike | null = browserStorage(),
): SaveResult {
  if (!storage) return { ok: false, reason: "unavailable" };

  const parsed = songSchema.safeParse(song);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  let raw: string | null;
  try {
    raw = storage.getItem(SONG_KEY);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const onDisk = decideLoad(raw);
  // Fail closed rather than overwrite something a newer version wrote.
  if (onDisk.kind === "unsupported_version") {
    return { ok: false, reason: "unsupported_version" };
  }
  /*
   * Corrupt at save time means an unpreserved raw value: the normal path
   * quarantines and clears the key at load, so anything still corrupt here is
   * a value whose only copy is the key itself. Writing over it would finish
   * the loss the load refused to start.
   */
  if (onDisk.kind === "corrupt") {
    return { ok: false, reason: "write_failed" };
  }

  const envelope = nextEnvelope(parsed.data, onDisk);
  if (!writeEnvelope(storage, envelope)) {
    return { ok: false, reason: "write_failed" };
  }
  return { ok: true, revision: envelope.revision };
}
