/**
 * Getting an existing musician into the library without losing their song
 * (spec 13.21 §9, 2O-A).
 *
 * Everyone who already uses Aranje has one song under one key. This is the
 * only code that moves it, and it is the most dangerous code in the
 * checkpoint: it runs unattended, on a device whose state nobody chose, and it
 * ends by deleting something.
 *
 * ## The one rule
 *
 * **The old key is never removed until the new one has been read back and
 * verified.** Not "written successfully" — read back. A `setItem` that
 * returned without throwing is not evidence that the bytes are there and
 * parse; a `getItem` that produces the same music is.
 *
 * Everything else follows from it. If any step fails, the old bytes are
 * exactly where they were, the reader can still play and back up their song,
 * and the next load tries again. Failure is never reported as success.
 *
 * ## What it does not do
 *
 * It does not decide what a stored song *means*. `loadSong` already answers
 * that — legacy, envelope, rescued from previous, corrupt, from a newer
 * version — and it quarantines and repairs where it should. Re-deciding here
 * would be a second recovery engine, and two engines that mostly agree are
 * worse than either. So migration asks `loadSong` and migrates whatever it is
 * handed, or refuses when it is handed nothing it may write.
 *
 * ## Settling, every load
 *
 * The same entry point also finishes work a previous session was interrupted
 * in the middle of: a delete that got as far as the note, a create whose
 * catalog write never landed. Both are ordinary states here rather than
 * corruption, because the write orders in `project-storage.ts` were chosen to
 * make them ordinary.
 */
import {
  initialCatalog,
  rebuildCatalog,
  serializeCatalog,
  type ProjectCatalogV1,
} from "@/lib/projects/project-catalog";
import type { ProjectErrorCode } from "@/lib/projects/project-errors";
import {
  CATALOG_KEY,
  canWriteProjects,
  clearPending,
  readCatalog,
  readPending,
  readRecord,
  removeRecord,
  scanProjectIds,
  writeCatalog,
  writeRecord,
  type EnumerableStorage,
} from "@/lib/projects/project-storage";
import { sameSong } from "@/lib/song/edit-history";
import { SONG_KEY, loadSong, type Clock } from "@/lib/song/storage";
import type { Song } from "@/lib/song/schema";

export const FIRST_PROJECT_ID = "project-1";

export type SettleOutcome = {
  /** Null only when nothing could be established at all. */
  readonly catalog: ProjectCatalogV1 | null;
  /** The active project's song, when it could be read. */
  readonly song: Song | null;
  /** False when this session must not write. */
  readonly canPersist: boolean;
  /** One safe sentence's worth of news, or nothing. */
  readonly notice: ProjectErrorCode | null;
  /** What happened, for the report and the tests. Never shown to a reader. */
  readonly steps: readonly string[];
};

const step = (steps: string[], name: string) => {
  steps.push(name);
};

/**
 * Read a project back and confirm it is the music that was just written.
 *
 * The whole migration rests on this function being strict. A record that
 * parses but holds a different song is not a successful write.
 */
function verifyRecord(
  storage: EnumerableStorage,
  id: string,
  expected: Song,
): boolean {
  const back = readRecord(storage, id);
  return back.kind === "record" && sameSong(back.song, expected);
}

function verifyCatalog(storage: EnumerableStorage, expected: ProjectCatalogV1): boolean {
  const back = readCatalog(storage);
  return (
    back.kind === "catalog" && serializeCatalog(back.catalog) === serializeCatalog(expected)
  );
}

/**
 * Finish a delete a previous session was interrupted in the middle of.
 *
 * The note is only ever written after the reader confirmed the deletion, so
 * completing it carries out their instruction. Nothing here decides on its own
 * that a project should go.
 */
function finishPending(storage: EnumerableStorage, steps: string[]): void {
  const pending = readPending(storage);
  if (pending === null) return;
  step(steps, `finish_pending_delete:${pending.projectId}`);

  const catalog = readCatalog(storage);
  if (catalog.kind === "catalog" && catalog.catalog.projectIds.includes(pending.projectId)) {
    /*
     * The catalog write never landed, so the project is still listed. Its
     * payload stays exactly where it is and the note is dropped: an unfinished
     * delete resolves *towards keeping the music*, and the reader can simply
     * ask again.
     */
    step(steps, "pending_delete_abandoned_catalog_intact");
    clearPending(storage);
    return;
  }
  removeRecord(storage, pending.projectId);
  clearPending(storage);
  step(steps, "pending_delete_completed");
}

/**
 * Payloads on the device that the catalog does not mention.
 *
 * A create writes the payload before the catalog, so an interrupted one leaves
 * exactly this. Only records that actually verify are adopted — a corrupt or
 * future-version payload is left alone and stays out of the list rather than
 * being adopted into it as a project that cannot be opened.
 */
function adoptOrphans(
  storage: EnumerableStorage,
  catalog: ProjectCatalogV1,
  steps: string[],
): ProjectCatalogV1 {
  const known = new Set(catalog.projectIds);
  const adopted: string[] = [];
  for (const id of scanProjectIds(storage)) {
    if (known.has(id)) continue;
    if (readRecord(storage, id).kind !== "record") continue;
    adopted.push(id);
  }
  if (adopted.length === 0) return catalog;

  step(steps, `adopt_orphans:${adopted.join(",")}`);
  const ids = [...catalog.projectIds, ...adopted];
  return rebuildCatalog(ids, catalog.activeProjectId) ?? catalog;
}

/**
 * Bring the library up on this device, whatever state it is in.
 *
 * Order matters and is the order of §9: finish what was interrupted, then read
 * the catalog, then — only if there is no library at all — migrate the single
 * song.
 */
export function settleProjects(
  storage: EnumerableStorage | null,
  /**
   * Required, with no default.
   *
   * A default of `() => Date.now()` would read a clock on the production path
   * while every test passed a fixed one — which is exactly how a module ends
   * up being deterministic only where it is being watched. The one caller
   * that has a real clock is the session, and it says so.
   */
  now: Clock,
): SettleOutcome {
  const steps: string[] = [];
  if (!storage) {
    return {
      catalog: null,
      song: null,
      canPersist: false,
      notice: "project_storage_unavailable",
      steps: ["no_storage"],
    };
  }

  const writable = canWriteProjects(storage);
  step(steps, writable ? "write_probe_ok" : "write_probe_failed");

  if (writable) finishPending(storage, steps);

  const decision = readCatalog(storage);

  if (decision.kind === "future_version") {
    /*
     * Not corrupt — newer. Nothing is quarantined, nothing is removed and
     * nothing may be written. The projects it names may still be readable, so
     * the reader is not locked out of their music, only out of changing it.
     */
    step(steps, "catalog_future_version");
    return {
      catalog: null,
      song: null,
      canPersist: false,
      notice: "project_catalog_future_version",
      steps,
    };
  }

  if (decision.kind === "catalog") {
    const catalog = writable
      ? adoptOrphans(storage, decision.catalog, steps)
      : decision.catalog;
    if (writable && catalog !== decision.catalog) writeCatalog(storage, catalog);
    return finishWithCatalog(storage, catalog, writable, steps);
  }

  /*
   * No usable catalog. Before reaching for the single song, look for payloads
   * that are already here.
   *
   * Both "no catalog at all" and "a catalog that will not parse" arrive here,
   * and both can have real projects sitting behind them — a create that was
   * interrupted before its catalog write leaves exactly the first case. Going
   * straight to migration would write the sample song over one of them, which
   * is how a recovery path becomes the thing it was built to prevent.
   */
  if (decision.kind === "invalid") step(steps, "catalog_invalid");
  const verified = scanProjectIds(storage).filter(
    (id) => readRecord(storage, id).kind === "record",
  );
  const rebuilt = rebuildCatalog(verified, null);
  if (rebuilt !== null) {
    step(steps, `catalog_rebuilt:${verified.join(",")}`);
    if (writable) writeCatalog(storage, rebuilt);
    return finishWithCatalog(
      storage,
      rebuilt,
      writable,
      steps,
      decision.kind === "invalid" ? "project_catalog_invalid" : null,
    );
  }

  return migrateSingleSong(storage, writable, now, steps);
}

function finishWithCatalog(
  storage: EnumerableStorage,
  catalog: ProjectCatalogV1,
  writable: boolean,
  steps: string[],
  notice: ProjectErrorCode | null = null,
): SettleOutcome {
  const active = readRecord(storage, catalog.activeProjectId);
  if (active.kind === "record" || active.kind === "recovered_previous") {
    return {
      catalog,
      song: active.song,
      canPersist: writable,
      notice:
        notice ??
        (active.kind === "recovered_previous" ? "project_corrupt" : null),
      steps: [...steps, `active_${active.kind}`],
    };
  }
  if (active.kind === "future_version") {
    return {
      catalog,
      song: null,
      canPersist: false,
      notice: "project_future_version",
      steps: [...steps, "active_future_version"],
    };
  }
  return {
    catalog,
    song: null,
    canPersist: writable,
    notice: active.kind === "empty" ? "project_not_found" : "project_corrupt",
    steps: [...steps, `active_${active.kind}`],
  };
}

/**
 * The single song becomes the first project — or nothing happens at all.
 *
 * Five steps, and the removal is last. Between them the device may die at any
 * point; every one of those points leaves the old key intact and the new one
 * either absent or adoptable.
 */
function migrateSingleSong(
  storage: EnumerableStorage,
  writable: boolean,
  now: Clock,
  steps: string[],
): SettleOutcome {
  const legacy = loadSong(storage, now);
  step(steps, `legacy_${legacy.outcome}`);

  if (!legacy.canPersist || !writable) {
    /*
     * A newer version's file, or a device that cannot write. The song is
     * still handed back so it can be played and backed up (§2.18) — what is
     * refused is the migration, not the music.
     */
    return {
      catalog: null,
      song: legacy.song,
      canPersist: false,
      notice: legacy.recovery === "unsupported_version"
        ? "project_future_version"
        : "project_storage_unavailable",
      steps: [...steps, "migration_skipped_read_only"],
    };
  }

  /*
   * The first project's key must be free. It is, by construction — the scan
   * above found no readable record anywhere — but a corrupt or future-version
   * payload could still be sitting there, and neither is ours to write over.
   */
  const existing = readRecord(storage, FIRST_PROJECT_ID);
  if (existing.kind !== "empty") {
    step(steps, `first_slot_occupied:${existing.kind}`);
    return {
      catalog: null,
      song: legacy.song,
      canPersist: false,
      notice:
        existing.kind === "future_version"
          ? "project_future_version"
          : "project_migration_failed",
      steps,
    };
  }

  const written = writeRecord(storage, FIRST_PROJECT_ID, legacy.song, now());
  if (!written.ok) {
    step(steps, `payload_write_failed:${written.reason}`);
    return {
      catalog: null,
      song: legacy.song,
      canPersist: false,
      notice: "project_migration_failed",
      steps,
    };
  }
  step(steps, "payload_written");

  if (!verifyRecord(storage, FIRST_PROJECT_ID, legacy.song)) {
    step(steps, "payload_verify_failed");
    return {
      catalog: null,
      song: legacy.song,
      canPersist: false,
      notice: "project_migration_failed",
      steps,
    };
  }
  step(steps, "payload_verified");

  const catalog = initialCatalog(FIRST_PROJECT_ID);
  const catalogWritten = writeCatalog(storage, catalog);
  if (!catalogWritten.ok || !verifyCatalog(storage, catalog)) {
    /*
     * The payload is on the device and the catalog is not. The old key is
     * untouched, so nothing is lost either way, and the payload will be
     * adopted as an orphan on a later load if the catalog then writes.
     */
    step(steps, "catalog_write_failed");
    return {
      catalog: null,
      song: legacy.song,
      canPersist: false,
      notice: "project_migration_failed",
      steps,
    };
  }
  step(steps, "catalog_written_and_verified");

  /*
   * Only now. Both halves have been read back and agree with the song that
   * was migrated, so the old key is a duplicate rather than the only copy.
   */
  let cleaned = true;
  try {
    storage.removeItem(SONG_KEY);
  } catch {
    cleaned = false;
  }
  step(steps, cleaned ? "legacy_key_removed" : "legacy_key_remove_failed");

  return {
    catalog,
    song: legacy.song,
    canPersist: true,
    /*
     * A failed cleanup is not lost data — the song is in the project, twice
     * over. It is still recorded rather than smoothed away, because the next
     * load will see a legacy key beside a valid catalog and must not migrate
     * again (it does not: a valid catalog returns before this path).
     */
    notice: null,
    steps,
  };
}

/** Exported for the ledger tests: the key the single song used to live under. */
export { SONG_KEY as LEGACY_SONG_KEY, CATALOG_KEY };
