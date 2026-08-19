/**
 * Safe localStorage access (spec 5.6).
 *
 * Keys use the ASCII `aranje.` prefix. A parse or validation failure must never
 * crash the app: the raw value is quarantined under `aranje.corrupt.<timestamp>`
 * and the sample song is loaded instead.
 */
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";

export const STORAGE_PREFIX = "aranje.";
export const SONG_KEY = `${STORAGE_PREFIX}song`;
export const HISTORY_KEY = `${STORAGE_PREFIX}history`;
export const CORRUPT_KEY_PREFIX = `${STORAGE_PREFIX}corrupt.`;

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

export type LoadResult = {
  song: Song;
  outcome: LoadOutcome;
  /** Reader-facing explanation, set when the outcome needs one. */
  message?: string;
  /** Key the unreadable value was preserved under. */
  backupKey?: string;
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

function quarantine(
  storage: StorageLike,
  raw: string,
  now: Clock,
): string | undefined {
  const backupKey = `${CORRUPT_KEY_PREFIX}${now()}`;
  try {
    storage.setItem(backupKey, raw);
    storage.removeItem(SONG_KEY);
    return backupKey;
  } catch {
    return undefined;
  }
}

/**
 * Read the stored song. Always returns a usable song; never throws.
 */
export function loadSong(
  storage: StorageLike | null = browserStorage(),
  now: Clock = () => Date.now(),
): LoadResult {
  if (!storage) {
    return {
      song: SAMPLE_SONG,
      outcome: "unavailable",
      message:
        "Tarayıcı deposuna erişilemedi. Örnek şarkı geçici olarak yüklendi; " +
        "bu oturumdaki değişiklikler kaydedilmeyecek.",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(SONG_KEY);
  } catch {
    return {
      song: SAMPLE_SONG,
      outcome: "unavailable",
      message:
        "Tarayıcı deposuna erişilemedi. Örnek şarkı geçici olarak yüklendi; " +
        "bu oturumdaki değişiklikler kaydedilmeyecek.",
    };
  }

  if (raw === null) {
    return { song: SAMPLE_SONG, outcome: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const backupKey = quarantine(storage, raw, now);
    return {
      song: SAMPLE_SONG,
      outcome: "recovered",
      backupKey,
      message:
        "Kayıtlı şarkı okunamadı. Bozuk veri silinmedi, yedeğe alındı ve " +
        "örnek şarkı yüklendi.",
    };
  }

  const result = songSchema.safeParse(parsed);
  if (!result.success) {
    const backupKey = quarantine(storage, raw, now);
    return {
      song: SAMPLE_SONG,
      outcome: "recovered",
      backupKey,
      message:
        "Kayıtlı şarkı bu sürümün şema kurallarına uymuyor. Bozuk veri " +
        "yedeğe alındı ve örnek şarkı yüklendi.",
    };
  }

  return { song: result.data, outcome: "stored" };
}

/**
 * Persist the song. Returns false when storage refused the write; callers keep
 * working in memory rather than failing.
 */
export function saveSong(
  song: Song,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const result = songSchema.safeParse(song);
  if (!result.success) return false;
  try {
    storage.setItem(SONG_KEY, JSON.stringify(result.data));
    return true;
  } catch {
    return false;
  }
}
