/**
 * Where the open project's edits go (spec 13.21 §8, §16, 2O-A).
 *
 * The song store has always had exactly one way to save. That does not change
 * here — what changes is *which key* it saves to, and that the key is decided
 * in one place rather than by whoever happens to be committing.
 *
 * ## The stale-tab gate
 *
 * Two tabs can open the same project. `localStorage` gives no transaction and
 * no compare-and-swap, so this cannot be a merge and must not pretend to be
 * one. What it can be is a **loss gate**: the revision this tab last saw is
 * remembered, and every commit re-reads the revision on disk first. If they
 * differ, another tab has written since — and this tab refuses, rather than
 * overwriting work it never saw.
 *
 * That is strictly weaker than an atomic CAS: two tabs saving in the same
 * instant can still interleave between the read and the write. It is called a
 * loss gate rather than synchronisation for exactly that reason. What it does
 * buy is the case that actually happens — a tab left open in the background
 * for an hour, whose owner returns and types one note.
 */
import {
  readRecord,
  writeRecord,
  type EnumerableStorage,
} from "@/lib/projects/project-storage";
import type { SaveResult } from "@/lib/song/storage";
import type { Song } from "@/lib/song/schema";

export type ActiveProject = {
  /** Which project the store is writing to right now. */
  readonly id: string;
  /** The revision this tab believes is on disk. */
  readonly revision: number;
};

export type ActiveProjectPort = {
  current(): ActiveProject;
  /** Point the store at another project, at the revision just read from it. */
  retarget(id: string, revision: number): void;
  /** One physical write, or a typed refusal. Never a partial save. */
  save(song: Song): SaveResult;
  /** True when the record on disk has moved since this tab last wrote. */
  isStale(): boolean;
};

export function createActiveProjectPort(options: {
  readonly storage: EnumerableStorage;
  readonly id: string;
  readonly revision: number;
  readonly now: () => number;
}): ActiveProjectPort {
  let active: ActiveProject = { id: options.id, revision: options.revision };

  const diskRevision = (): number | null => {
    const record = readRecord(options.storage, active.id);
    if (record.kind === "record" || record.kind === "recovered_previous") {
      return record.revision;
    }
    return null;
  };

  return {
    current: () => active,

    retarget(id, revision) {
      active = { id, revision };
    },

    isStale() {
      const onDisk = diskRevision();
      /*
       * A record that cannot be read is not "stale" — it is a different
       * problem, and reporting it as staleness would tell the reader to
       * refresh when refreshing will not help.
       */
      return onDisk !== null && onDisk !== active.revision;
    },

    save(song) {
      const onDisk = diskRevision();
      if (onDisk !== null && onDisk !== active.revision) {
        /*
         * Someone else moved this project on. Refusing is the whole point:
         * the alternative is this tab's `previous` slot being an hour old and
         * its `current` quietly replacing an edit nobody has seen.
         */
        return { ok: false, reason: "write_failed" };
      }

      const written = writeRecord(options.storage, active.id, song, options.now());
      if (!written.ok) {
        return {
          ok: false,
          reason:
            written.reason === "project_future_version"
              ? "unsupported_version"
              : written.reason === "storage_unavailable"
                ? "unavailable"
                : "write_failed",
        };
      }
      active = { id: active.id, revision: written.record.revision };
      return { ok: true, revision: written.record.revision };
    },
  };
}
