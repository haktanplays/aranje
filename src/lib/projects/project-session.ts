/**
 * The one library this tab has open (spec 13.21 §8, 2O-A).
 *
 * There is still exactly one song store and exactly one commit path. What this
 * module adds is the answer to "which project is that store writing to", and
 * it keeps that answer in one place so nothing else has to know the shape of a
 * storage key.
 *
 * It owns the singleton because the store already had to be a singleton: the
 * audio engine and the debug handle read the song without being components,
 * and a second store would give them a different song from the one on screen.
 * Moving the singleton here rather than adding a second one is what keeps that
 * true now that the song has a project behind it.
 *
 * Everything React-facing is somewhere else. This module has no hooks, no
 * components and no opinions about the screen.
 */
import { createActiveProjectPort, type ActiveProjectPort } from "@/lib/projects/active-project";
import type { ProjectCatalogV1 } from "@/lib/projects/project-catalog";
import type { ProjectErrorCode } from "@/lib/projects/project-errors";
import { settleProjects } from "@/lib/projects/project-migration";
import { readRecord, type EnumerableStorage } from "@/lib/projects/project-storage";
import { createSongStore, type SongStore } from "@/lib/song/song-store";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { LoadResult } from "@/lib/song/storage";
import type { Song } from "@/lib/song/schema";

export type ProjectSession = {
  readonly store: SongStore;
  /** Null when there is no library to write to — read-only session. */
  readonly port: ActiveProjectPort | null;
  readonly storage: EnumerableStorage | null;
  /** The library as this tab last saw it. */
  catalog: ProjectCatalogV1 | null;
  /** One safe sentence's worth of news from the load, or nothing. */
  readonly notice: ProjectErrorCode | null;
  readonly canPersist: boolean;
  /**
   * Point the store and the port at another project.
   *
   * Called only after the target has been read and verified: the baseline is
   * the song that was actually on disk, and the history starts again from it
   * (§2.11, §2.12 — a project switch is not an edit and undo may not cross it).
   */
  openProject(id: string, song: Song, catalog: ProjectCatalogV1): void;
};

function browserStorage(): EnumerableStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Turn the settle outcome into the shape the store already understands.
 *
 * `LoadResult` is the single-song loader's vocabulary and the store speaks it
 * fluently; translating here rather than teaching the store a second one keeps
 * the store's recovery handling exactly as it was.
 */
function asLoadResult(
  song: Song | null,
  canPersist: boolean,
  notice: ProjectErrorCode | null,
): LoadResult {
  if (song === null) {
    return {
      song: SAMPLE_SONG,
      outcome: "unavailable",
      canPersist: false,
      ...(notice === null ? {} : { recovery: "storage_unavailable" as const }),
    };
  }
  return {
    song,
    outcome: "stored",
    canPersist,
    ...(canPersist ? {} : { recovery: "storage_unavailable" as const }),
  };
}

export function createProjectSession(
  storage: EnumerableStorage | null,
  now: () => number = () => Date.now(),
): ProjectSession {
  const settled = settleProjects(storage, now);

  const activeId = settled.catalog?.activeProjectId ?? null;
  const revision =
    storage !== null && activeId !== null
      ? (() => {
          const record = readRecord(storage, activeId);
          return record.kind === "record" || record.kind === "recovered_previous"
            ? record.revision
            : 0;
        })()
      : 0;

  const port =
    storage !== null && activeId !== null && settled.canPersist
      ? createActiveProjectPort({ storage, id: activeId, revision, now })
      : null;

  const store = createSongStore(
    asLoadResult(settled.song, settled.canPersist && port !== null, settled.notice),
    storage,
    port ?? undefined,
  );

  const session: ProjectSession = {
    store,
    port,
    storage,
    catalog: settled.catalog,
    notice: settled.notice,
    canPersist: settled.canPersist && port !== null,
    openProject(id, song, catalog) {
      port?.retarget(id, readRevision(storage, id));
      session.catalog = catalog;
      store.replaceBaseline(song);
    },
  };
  return session;
}

function readRevision(storage: EnumerableStorage | null, id: string): number {
  if (storage === null) return 0;
  const record = readRecord(storage, id);
  return record.kind === "record" || record.kind === "recovered_previous"
    ? record.revision
    : 0;
}

let session: ProjectSession | null = null;

/** The session the screen uses. Created once, on the client. */
export function getProjectSession(): ProjectSession {
  session ??= createProjectSession(browserStorage());
  return session;
}
