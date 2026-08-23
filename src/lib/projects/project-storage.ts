/**
 * Where projects live on the device (spec 13.21 §8, 2O-A).
 *
 * One key per project, one key for the catalog, and one for the note a
 * multi-step operation leaves behind. Every key is built here, from a
 * validated project id — a component that could name a key could name any
 * key, and a typo in one would silently address another project's payload.
 *
 * ## Why localStorage's honesty matters here
 *
 * `localStorage` writes one key at a time. Creating a project is a payload
 * write *and* a catalog write, and a device can die between them. Pretending
 * otherwise — calling the pair "a save" — is how libraries end up with
 * catalogs that name payloads which are not there.
 *
 * So the order is chosen so that every interruption leaves one of two states,
 * and both are recoverable:
 *
 * - **Create-shaped** (create, duplicate, import-as-new): payload **first**,
 *   catalog second. Interrupted, the payload is an orphan — and because a
 *   record carries its own `projectId`, startup can find it and adopt it. The
 *   music exists; the library merely had not been told yet.
 * - **Delete**: a pending note **first**, then the catalog, then the payload,
 *   then the note. Interrupted, startup reads the note and finishes the job.
 *   The note is what makes finishing honest: it records that the reader
 *   already confirmed this deletion, so completing it is carrying out their
 *   instruction rather than deciding to destroy something on their behalf.
 *
 * Without the note, a half-deleted project would look exactly like a
 * half-created one, and startup would adopt back the project the reader had
 * just asked to remove.
 */
import {
  decideCatalog,
  serializeCatalog,
  type CatalogDecision,
  type ProjectCatalogV1,
} from "@/lib/projects/project-catalog";
import { isProjectId } from "@/lib/projects/project-id";
import {
  decideRecord,
  nextRecord,
  serializeRecord,
  type ProjectRecordV1,
  type RecordDecision,
} from "@/lib/projects/project-record";
import { STORAGE_PREFIX, type StorageLike } from "@/lib/song/storage";
import type { Song } from "@/lib/song/schema";

export const CATALOG_KEY = `${STORAGE_PREFIX}projects`;
export const PROJECT_KEY_PREFIX = `${STORAGE_PREFIX}project.`;
/** The note a delete leaves so an interrupted one can be finished. */
export const PENDING_KEY = `${STORAGE_PREFIX}project-pending`;

/**
 * The key a project's payload lives under.
 *
 * Returns null rather than building a key from an id it does not recognise:
 * an id is the only user-reachable thing that becomes part of a key name, and
 * this is where that stops.
 */
export function projectKey(id: string): string | null {
  return isProjectId(id) ? `${PROJECT_KEY_PREFIX}${id}` : null;
}

/** The id inside a project key, or null when the key is not one of ours. */
export function projectIdFromKey(key: string): string | null {
  if (!key.startsWith(PROJECT_KEY_PREFIX)) return null;
  const id = key.slice(PROJECT_KEY_PREFIX.length);
  return isProjectId(id) ? id : null;
}

/** Storage that can also be walked, for finding payloads nothing points at. */
export type EnumerableStorage = StorageLike & {
  readonly length: number;
  key(index: number): string | null;
};

export type WriteFailure =
  | "storage_unavailable"
  | "storage_quota_exceeded"
  | "storage_write_failed";

/**
 * Quota, or something else.
 *
 * Worth separating because the two mean different things to a reader: a full
 * device is something they can act on, and anything else is not. Browsers
 * disagree about the name and the code, so both are checked.
 */
function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  return error instanceof Error && /quota/i.test(error.message);
}

export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: WriteFailure };

function put(storage: StorageLike, key: string, value: string): WriteResult {
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: isQuotaError(error) ? "storage_quota_exceeded" : "storage_write_failed",
    };
  }
}

function drop(storage: StorageLike, key: string): WriteResult {
  try {
    storage.removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, reason: "storage_write_failed" };
  }
}

function read(storage: StorageLike, key: string): string | null | "unreadable" {
  try {
    return storage.getItem(key);
  } catch {
    return "unreadable";
  }
}

/* ------------------------------------------------------------- the catalog */

export function readCatalog(storage: StorageLike): CatalogDecision {
  const raw = read(storage, CATALOG_KEY);
  if (raw === "unreadable") return { kind: "invalid", issues: ["not_json"] };
  return decideCatalog(raw);
}

export function writeCatalog(
  storage: StorageLike,
  catalog: ProjectCatalogV1,
): WriteResult {
  return put(storage, CATALOG_KEY, serializeCatalog(catalog));
}

/* ------------------------------------------------------------- one project */

export function readRecord(storage: StorageLike, id: string): RecordDecision {
  const key = projectKey(id);
  if (key === null) return { kind: "corrupt" };
  const raw = read(storage, key);
  if (raw === "unreadable") return { kind: "corrupt" };
  return decideRecord(raw);
}

/**
 * Write a project's song, keeping the rung below it.
 *
 * The record on disk is re-read first, exactly as the single-song save does:
 * `previous` has to be what is *there*, not what this tab remembers putting
 * there, or another tab's edit would be the rung that quietly disappears.
 *
 * Refuses to overwrite a record from a newer version. Everything else is a
 * normal write — including a corrupt one, which has already been quarantined
 * or is being deliberately replaced by a create.
 */
export function writeRecord(
  storage: StorageLike,
  id: string,
  song: Song,
  now: number,
  options: { readonly allowOverwriteCorrupt?: boolean } = {},
): { readonly ok: true; readonly record: ProjectRecordV1 } | { readonly ok: false; readonly reason: WriteFailure | "project_future_version" | "project_corrupt" } {
  const key = projectKey(id);
  if (key === null) return { ok: false, reason: "storage_write_failed" };

  const onDisk = readRecord(storage, id);
  if (onDisk.kind === "future_version") {
    return { ok: false, reason: "project_future_version" };
  }
  if (onDisk.kind === "corrupt" && options.allowOverwriteCorrupt !== true) {
    /*
     * The only copy of whatever that was is the key itself. Writing over it
     * would finish a loss this app has not been asked to finish; the caller
     * quarantines first and asks again.
     */
    return { ok: false, reason: "project_corrupt" };
  }

  const record = nextRecord(id, song, onDisk, now);
  const written = put(storage, key, serializeRecord(record));
  return written.ok ? { ok: true, record } : { ok: false, reason: written.reason };
}

export function removeRecord(storage: StorageLike, id: string): WriteResult {
  const key = projectKey(id);
  if (key === null) return { ok: false, reason: "storage_write_failed" };
  return drop(storage, key);
}

/* --------------------------------------------------------- the pending note */

export type PendingOperation = { readonly kind: "delete"; readonly projectId: string };

export function readPending(storage: StorageLike): PendingOperation | null {
  const raw = read(storage, PENDING_KEY);
  if (raw === null || raw === "unreadable") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { kind?: unknown }).kind === "delete" &&
      isProjectId((parsed as { projectId?: unknown }).projectId)
    ) {
      return { kind: "delete", projectId: (parsed as { projectId: string }).projectId };
    }
  } catch {
    /* An unreadable note is no note: nothing is deleted on a guess. */
  }
  return null;
}

export function writePending(
  storage: StorageLike,
  operation: PendingOperation,
): WriteResult {
  return put(storage, PENDING_KEY, JSON.stringify(operation));
}

export function clearPending(storage: StorageLike): WriteResult {
  return drop(storage, PENDING_KEY);
}

/* ------------------------------------------------------------- finding them */

/**
 * Every project id with a payload on the device, in id order.
 *
 * Walked rather than taken from the catalog, because the whole point is to
 * find the ones the catalog does not know about — the orphan a half-finished
 * create left behind. Sorted by number so a rebuild is deterministic.
 */
export function scanProjectIds(storage: EnumerableStorage): string[] {
  const ids: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      const id = projectIdFromKey(key);
      if (id !== null) ids.push(id);
    }
  } catch {
    return [];
  }
  return ids.sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
}

/**
 * Can this storage take a write at all?
 *
 * One real `setItem` and one `removeItem` on the existing probe key — the same
 * question the single-song loader already asks, and the same honest answer: an
 * attempt. Reported as the two physical operations it is.
 */
export function canWriteProjects(storage: StorageLike): boolean {
  const probe = `${STORAGE_PREFIX}probe`;
  try {
    storage.setItem(probe, "1");
  } catch {
    return false;
  }
  try {
    storage.removeItem(probe);
  } catch {
    /* The write worked; a failed cleanup does not make writing broken. */
  }
  return true;
}
