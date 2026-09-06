"use client";

/**
 * Which screen the app is on, and what Home needs to draw (2V-E.1 §3, §4).
 *
 * Two things live here and they belong together: *where the reader is* and
 * *what the library looks like from there*. Splitting them would mean two
 * owners agreeing about whether a create had happened, and the moment they
 * disagreed the reader would be on Home looking at a project that is already
 * open — or in an editor whose project no longer exists.
 *
 * ## Back is a real key
 *
 * Opening a project pushes a history entry, so the phone's own Back gesture
 * comes home instead of leaving the app. Nothing else is stored in the entry:
 * the project the app has open is a fact about storage, not about the URL,
 * and putting it in the URL would give the two a way to disagree.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { FIRST_SONG_TEMPLATE } from "@/lib/home/first-song";
import { homeModel, type HomeModel } from "@/lib/home/home-model";
import { materializeTemplate } from "@/lib/song/song-templates";
import { useProjectLibrary } from "@/lib/workspace/use-project-library";

export type HomeRoute = "home" | "editor";

export type HomeHandle = {
  /**
   * False until the browser has been asked what is on the device.
   *
   * The library lives in the browser's own store, so the server has no way to
   * know whether a project is open. Rendering a guess and correcting it on
   * hydration is how a reader is shown the wrong screen for a frame — and how
   * React ends up reconciling two different trees. So the shell draws nothing
   * until this is true, which is one frame on an app that needs its script to
   * do anything at all.
   */
  readonly ready: boolean;
  readonly route: HomeRoute;
  readonly model: HomeModel;
  /** The project the editor should be showing, or null when there is none. */
  readonly activeProjectId: string | null;
  /** The last refusal, as one sentence. Never a code. */
  readonly error: string | null;
  /** False when nothing can be created — a device that cannot be written to. */
  readonly canStart: boolean;
  /** Make a project with the safe defaults and go straight to the editor. */
  start(): void;
  /** Open one that already exists. */
  open(id: string): void;
  /** Leave the editor without closing the project. */
  goHome(): void;
  /** Return to the project that is already open. */
  goEditor(): void;
  dismissError(): void;
};

const HOME_STATE = { aranje: "home" } as const;

export function useHome(options: {
  /** Everything that must be put down before another song appears. */
  onBeforeSwitch(): void;
  canPersist: boolean;
}): HomeHandle {
  const library = useProjectLibrary({
    onBeforeSwitch: options.onBeforeSwitch,
    canPersist: options.canPersist,
  });

  /*
   * Whether the browser has been read yet.
   *
   * `useSyncExternalStore` with a server snapshot of `false` is the one way
   * to ask this that React itself understands: the server and the first
   * client render both get `false`, the second gets `true`, and no state is
   * written from an effect to make it happen.
   */
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  /*
   * Where the reader has *asked* to be, when they have asked.
   *
   * Null means "wherever the library says": the editor when a project is
   * open, Home when none is. A device with no library has nothing to open, so
   * it lands on Home — which is the whole point of not adopting the demo.
   */
  const [asked, setAsked] = useState<HomeRoute | null>(null);
  const route: HomeRoute =
    asked ?? (library.activeProjectId === null ? "home" : "editor");
  const [openedAt, setOpenedAt] = useState(0);

  const model = useMemo(
    () => homeModel(library.projects, openedAt),
    [library.projects, openedAt],
  );

  const enterEditor = useCallback(() => {
    setAsked("editor");
    if (typeof window !== "undefined") {
      window.history.pushState(HOME_STATE, "");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPop = () => setAsked("home");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const start = useCallback(() => {
    const song = materializeTemplate(FIRST_SONG_TEMPLATE);
    if (!song) return;
    /*
     * Two doors, one journey. A device with no library takes the first-create
     * path; one that already has projects takes the ordinary create, which
     * names the new project around the ones already there.
     */
    const made =
      library.activeProjectId === null
        ? library.startFirst(song)
        : library.createFrom(FIRST_SONG_TEMPLATE);
    if (made) enterEditor();
  }, [enterEditor, library]);

  const open = useCallback(
    (id: string) => {
      if (id === library.activeProjectId) {
        enterEditor();
        return;
      }
      if (library.openProject(id)) enterEditor();
    },
    [enterEditor, library],
  );

  return {
    ready,
    route,
    model,
    activeProjectId: library.activeProjectId,
    error: library.error,
    canStart: library.canStart,
    start,
    open,
    goHome: () => {
      setOpenedAt(Date.now());
      setAsked("home");
    },
    goEditor: enterEditor,
    dismissError: library.dismissError,
  };
}
