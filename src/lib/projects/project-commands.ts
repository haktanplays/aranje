/**
 * Everything a reader can do to their library (spec 13.21 §11, 2O-A).
 *
 * One typed command per action, all of them here. They touch storage because
 * they have to — a project that was not persisted is not a project — but they
 * import no React, hold no state, read no clock and make no decision about
 * what a song *means*: the Song Contract, the central validator chain and the
 * recovery rules all belong to modules that already existed.
 *
 * ## The shape every command keeps
 *
 * 1. refuse, if the command cannot be carried out at all;
 * 2. build the candidate and settle it through the strict schema and the
 *    validators — an error is an atomic refusal, warnings ride along;
 * 3. write the payload and **read it back**;
 * 4. only then write the catalog, which is where "the library changed" and
 *    "which project is open" both live — one write, so the two cannot
 *    disagree;
 * 5. verify the catalog too.
 *
 * A failure at any step leaves the reader's previous view whole. The one thing
 * that can survive a failure is a payload nobody points at yet, and that is
 * deliberate: `settleProjects` adopts it on the next load.
 */
import {
  allocateProjectId,
  serializeCatalog,
  type ProjectCatalogV1,
} from "@/lib/projects/project-catalog";
import { projectFail, type ProjectFailure } from "@/lib/projects/project-errors";
import { duplicateTitle, newProjectTitle } from "@/lib/projects/project-names";
import {
  readCatalog,
  readRecord,
  removeRecord,
  clearPending,
  writeCatalog,
  writePending,
  writeRecord,
  type EnumerableStorage,
} from "@/lib/projects/project-storage";
import { settle } from "@/lib/song/edit";
import { sameSong } from "@/lib/song/edit-history";
import { survivorIndex } from "@/lib/song/lifecycle-guard";
import { materializeTemplate } from "@/lib/song/song-templates";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators";

/** What a command is handed. No globals, no clock of its own. */
export type ProjectEnv = {
  readonly storage: EnumerableStorage;
  readonly catalog: ProjectCatalogV1;
  /** Milliseconds. Injected, so five runs of a test are byte-equal. */
  readonly now: number;
};

export type ProjectCommandResult =
  | {
      readonly ok: true;
      readonly catalog: ProjectCatalogV1;
      /** The project now open, and its song. */
      readonly activeProjectId: string;
      readonly song: Song;
      readonly warnings: readonly ValidationIssue[];
    }
  | { readonly ok: false; readonly error: ProjectFailure };

/* --------------------------------------------------------------- helpers */

/** The titles already in the library, for the deterministic naming. */
function existingTitles(env: ProjectEnv): string[] {
  const titles: string[] = [];
  for (const id of env.catalog.projectIds) {
    const record = readRecord(env.storage, id);
    if (record.kind === "record" || record.kind === "recovered_previous") {
      titles.push(record.song.title);
    }
  }
  return titles;
}

/**
 * Write a song into a project and prove it landed.
 *
 * The read-back is the point. Everything downstream — removing a legacy key,
 * pointing the catalog at a new project, telling the reader it worked — is
 * only allowed to happen after the bytes have been read and found to be the
 * music that was written.
 */
function persist(
  env: ProjectEnv,
  id: string,
  song: Song,
): { ok: true } | { ok: false; error: ProjectFailure } {
  const written = writeRecord(env.storage, id, song, env.now);
  if (!written.ok) {
    return projectFail(
      written.reason === "storage_quota_exceeded"
        ? "project_storage_quota_exceeded"
        : written.reason === "project_future_version"
          ? "project_future_version"
          : written.reason === "project_corrupt"
            ? "project_corrupt"
            : "project_storage_write_failed",
    );
  }
  const back = readRecord(env.storage, id);
  if (back.kind !== "record" || !sameSong(back.song, song)) {
    return projectFail("project_storage_write_failed");
  }
  return { ok: true };
}

function commitCatalog(
  env: ProjectEnv,
  catalog: ProjectCatalogV1,
): { ok: true } | { ok: false; error: ProjectFailure } {
  const written = writeCatalog(env.storage, catalog);
  if (!written.ok) {
    return projectFail(
      written.reason === "storage_quota_exceeded"
        ? "project_storage_quota_exceeded"
        : "project_storage_write_failed",
    );
  }
  const back = readCatalog(env.storage);
  if (back.kind !== "catalog" || serializeCatalog(back.catalog) !== serializeCatalog(catalog)) {
    return projectFail("project_storage_write_failed");
  }
  return { ok: true };
}

/**
 * The shared tail of every command that adds a project.
 *
 * Create, duplicate and import-as-new differ only in where the song comes
 * from, so they share the part that can go wrong.
 */
function addProject(env: ProjectEnv, song: Song): ProjectCommandResult {
  const settled = settle(song);
  if (!settled.ok) return projectFail("project_validation_failed");

  const allocated = allocateProjectId(env.catalog);
  const written = persist(env, allocated.id, settled.song);
  if (!written.ok) return written;

  const catalog: ProjectCatalogV1 = {
    ...allocated.catalog,
    projectIds: [...allocated.catalog.projectIds, allocated.id],
    activeProjectId: allocated.id,
  };
  const committed = commitCatalog(env, catalog);
  if (!committed.ok) {
    /*
     * The payload is on the device and nothing points at it. It is not lost
     * and it is not garbage: `settleProjects` adopts it next load, because a
     * record knows which project it is. The reader keeps the project they had.
     */
    return committed;
  }

  return {
    ok: true,
    catalog,
    activeProjectId: allocated.id,
    song: settled.song,
    warnings: settled.warnings,
  };
}

/* -------------------------------------------------------------- commands */

/** A new project from one of the three templates. The open one is untouched. */
export function createProject(env: ProjectEnv, templateId: string): ProjectCommandResult {
  const created = materializeTemplate(templateId);
  if (!created) return projectFail("project_validation_failed");
  return addProject(env, { ...created, title: newProjectTitle(existingTitles(env)) });
}

/**
 * Open a project that already exists.
 *
 * The target is read and verified **before** the catalog moves. A library
 * whose active project cannot be opened is worse than one that refused to
 * switch, because the reader is then looking at nothing and has no way back.
 */
export function openProject(env: ProjectEnv, id: string): ProjectCommandResult {
  if (!env.catalog.projectIds.includes(id)) return projectFail("project_not_found");
  if (id === env.catalog.activeProjectId) return projectFail("project_no_change");

  const record = readRecord(env.storage, id);
  if (record.kind === "future_version") return projectFail("project_future_version");
  if (record.kind === "empty") return projectFail("project_not_found");
  if (record.kind === "corrupt") return projectFail("project_corrupt");

  const catalog: ProjectCatalogV1 = { ...env.catalog, activeProjectId: id };
  const committed = commitCatalog(env, catalog);
  if (!committed.ok) return committed;

  return {
    ok: true,
    catalog,
    activeProjectId: id,
    song: record.song,
    warnings: [],
  };
}

/**
 * A copy of a project, as a new project.
 *
 * The source is read and never written. Its recovery `previous` is not copied
 * either: a duplicate is a new piece of work, and handing it somebody else's
 * undo rung would let an undo in the copy produce the original's older music.
 */
export function duplicateProject(env: ProjectEnv, id: string): ProjectCommandResult {
  if (!env.catalog.projectIds.includes(id)) return projectFail("project_not_found");
  const record = readRecord(env.storage, id);
  if (record.kind === "future_version") return projectFail("project_future_version");
  if (record.kind !== "record" && record.kind !== "recovered_previous") {
    return projectFail("project_corrupt");
  }
  return addProject(env, {
    ...record.song,
    title: duplicateTitle(record.song.title, existingTitles(env)),
  });
}

/** A song from a `.aranje.json` file, as a new project. */
export function importProjectAsNew(env: ProjectEnv, song: Song): ProjectCommandResult {
  return addProject(env, song);
}

/**
 * Remove a project, permanently.
 *
 * The last one cannot go (§2.13): a library with nothing in it has no active
 * project, and the app would have to invent one. The note is written first so
 * an interruption can be finished rather than guessed at — see
 * `project-storage.ts` for why that direction is the safe one.
 */
export function deleteProject(env: ProjectEnv, id: string): ProjectCommandResult {
  if (!env.catalog.projectIds.includes(id)) return projectFail("project_not_found");
  if (env.catalog.projectIds.length <= 1) return projectFail("cannot_delete_last_project");

  const index = env.catalog.projectIds.indexOf(id);
  const remaining = env.catalog.projectIds.filter((entry) => entry !== id);

  /*
   * Which project the reader is left looking at: the one that takes the
   * deleted one's place, or the one before it. The same rule sections and
   * tracks already use, so "what happens when I delete the thing I am in" has
   * one answer across the app.
   */
  const active =
    id === env.catalog.activeProjectId
      ? remaining[survivorIndex(index, remaining.length)]
      : env.catalog.activeProjectId;
  if (active === undefined) return projectFail("cannot_delete_active_without_survivor");

  /*
   * A survivor nobody can open is not a survivor. Checked before anything is
   * written, so a library whose other project is corrupt keeps both.
   */
  const survivor = readRecord(env.storage, active);
  if (survivor.kind !== "record" && survivor.kind !== "recovered_previous") {
    return projectFail("cannot_delete_active_without_survivor");
  }

  const noted = writePending(env.storage, { kind: "delete", projectId: id });
  if (!noted.ok) return projectFail("project_storage_write_failed");

  const catalog: ProjectCatalogV1 = {
    ...env.catalog,
    projectIds: remaining,
    activeProjectId: active,
  };
  const committed = commitCatalog(env, catalog);
  if (!committed.ok) {
    /* Nothing was removed. The note resolves towards keeping the music. */
    clearPending(env.storage);
    return committed;
  }

  const removed = removeRecord(env.storage, id);
  clearPending(env.storage);
  if (!removed.ok) {
    /*
     * The catalog no longer lists it and the payload is still there. That is
     * a recoverable orphan, and the next load will adopt it back rather than
     * leave the reader with bytes nothing can reach — the honest outcome of a
     * delete that only half happened.
     */
    return projectFail("project_operation_incomplete");
  }

  return {
    ok: true,
    catalog,
    activeProjectId: active,
    song: survivor.song,
    warnings: [],
  };
}
