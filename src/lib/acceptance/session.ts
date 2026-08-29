/**
 * The session the guided Android test runs in (K-59.1 §3).
 *
 * The route opens the **real** workspace on a fixed riff, and must leave the
 * reader's own music exactly where it was. It gets that by building the
 * project session and the settings store out of a storage the page owns, so
 * every write the test makes — an edit, a practice speed, a project revision —
 * lands in a `Map` and dies with the tab.
 *
 * Installed once, before anything asks for a session. Both installers refuse
 * if one already exists, so a page that somehow mounted twice would report the
 * refusal rather than quietly run the test against `localStorage`.
 */
import { acceptanceRiff } from "@/lib/acceptance/riff";
import { createMemoryStorage, type MemoryStorage } from "@/lib/acceptance/memory-storage";
import { initialCatalog } from "@/lib/projects/project-catalog";
import { projectId } from "@/lib/projects/project-id";
import { installProjectSession } from "@/lib/projects/project-session";
import { writeCatalog, writeRecord } from "@/lib/projects/project-storage";
import { installSettingsStore } from "@/lib/settings/use-settings";
import type { Song } from "@/lib/song/schema";

/*
 * A real project id, not a descriptive name. `projectKey` refuses anything
 * outside `project-<n>`, so a friendlier-looking id would have failed the very
 * first write and left the route showing the sample song instead of the riff.
 */
export const ACCEPTANCE_PROJECT_ID = projectId(1);

export type AcceptanceSession = {
  readonly ok: boolean;
  /** Why not, when the session was already built from something else. */
  readonly reason: string | null;
  readonly storage: MemoryStorage;
};

/**
 * Build the fixture's session in memory and hand it to the app.
 *
 * `now` is fixed rather than `Date.now`, so two runs of the guided test on the
 * same phone produce byte-identical records and a diff of the storage means
 * something.
 */
export function startAcceptanceSession(
  now = 1_700_000_000_000,
  /*
   * Which fixture the session is built around (2U-A handoff §3).
   *
   * The listening route and the editor route need different music — one has
   * to make six techniques audible, the other has to make every editor
   * operation possible — but they need exactly the same isolation. Passing
   * the song keeps the seam single: there is still one place that installs a
   * memory storage over the app's, and still only one that can be installed.
   */
  song: Song = acceptanceRiff(),
): AcceptanceSession {
  const storage = createMemoryStorage();
  const written = writeRecord(storage, ACCEPTANCE_PROJECT_ID, song, now);
  if (!written.ok) {
    return { ok: false, reason: `fixture yazılamadı: ${written.reason}`, storage };
  }
  writeCatalog(storage, initialCatalog(ACCEPTANCE_PROJECT_ID));

  const project = installProjectSession(storage, () => now);
  const settings = installSettingsStore(storage);
  if (!project) {
    return {
      ok: false,
      reason: "proje oturumu zaten kurulmuş; test kendi deposunu kuramadı",
      storage,
    };
  }
  return { ok: true, reason: settings ? null : "ayarlar deposu zaten kurulmuştu", storage };
}

/**
 * The session, asked for as many times as anything likes.
 *
 * `startAcceptanceSession` installs; this remembers what it installed. The
 * difference matters because a React tree can render — and therefore ask —
 * more than once for a single mount: a hydration mismatch, a StrictMode
 * double-invoke or a suspended re-render would each call the installer again,
 * and the second call is refused by design. Without this the route would
 * report "the session was already set up" about *itself* and refuse to run.
 */
let started: AcceptanceSession | null = null;

export function acceptanceSession(song?: Song): AcceptanceSession {
  started ??= startAcceptanceSession(undefined, song);
  return started;
}
