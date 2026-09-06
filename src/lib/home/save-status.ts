/**
 * What the app is allowed to tell a reader about their saved music
 * (2V-E.1 §7).
 *
 * There is no `Kaydet` button and there never was: every commit goes through
 * the store, which writes and reads back before it reports success. What was
 * missing is the *sentence* — the reader had no way to know whether the thing
 * they just wrote was on the device, and "no news" is the same shape as "it
 * failed silently".
 *
 * Three states and no fourth. In particular there is no optimistic one: this
 * is derived from the store's `persisted`, which is set **after** the write
 * has been read back, so "Kaydedildi" can never appear before the bytes are
 * there. A pure function of the snapshot rather than a timer, because a
 * status driven by a timer says "saved" on a schedule instead of on a fact.
 */
export type SaveState = "saved" | "saving" | "failed" | "read_only";

export type SaveStatus = {
  readonly state: SaveState;
  /** The sentence, or null when there is nothing worth a line. */
  readonly text: string | null;
  /** True when the reader can do something about it. */
  readonly retryable: boolean;
};

const SAVED = "Kaydedildi";
const SAVING = "Kaydediliyor…";
const FAILED = "Kaydedilemedi";
const READ_ONLY = "Bu cihaza kaydedilemiyor";

export function saveStatus(snapshot: {
  /** The last write landed and was read back. */
  readonly persisted: boolean;
  /** This device and this project can be written to at all. */
  readonly canPersist: boolean;
  /** True between a commit and its write coming back. */
  readonly pending: boolean;
}): SaveStatus {
  if (!snapshot.canPersist) {
    return { state: "read_only", text: READ_ONLY, retryable: false };
  }
  if (snapshot.pending) return { state: "saving", text: SAVING, retryable: false };
  if (!snapshot.persisted) return { state: "failed", text: FAILED, retryable: true };
  return { state: "saved", text: SAVED, retryable: false };
}

/** The label the retry control carries, so one table owns the whole row. */
export const SAVE_RETRY_LABEL = "Tekrar dene";
