"use client";

/**
 * Where the reader is looking (2L-R).
 *
 * The one owner of the workspace's navigation state: which surface is on
 * screen, which track is active, which bar has the transport's focus, and the
 * scroll targets a view change carries across. Nothing here mutates the song,
 * touches storage, parses a file or builds an audio node — navigation moves
 * the reader, never the music.
 *
 * Leaving a surface has side effects that belong to *other* owners (a time
 * selection dies with the tab, for instance). Those are composed at the root:
 * this hook only ever changes what it owns.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { BAR_KEY_ATTRIBUTE, GUTTER_WIDTH } from "@/components/workspace/geometry";
import type { WorkspaceView } from "@/components/workspace/ViewSwitch";
import type { Song, Track } from "@/lib/song/schema";

export type WorkspaceNavigation = {
  readonly view: WorkspaceView;
  readonly activeBarKey: string | null;
  readonly activeSectionId: string | null;
  /** The selected track, resolved against the current song. */
  readonly track: Track | undefined;
  /** The tab's scroller. Lives here because scroll targets are navigation. */
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly arrangeScrollRef: RefObject<HTMLDivElement | null>;
  setActiveBarKey(barKey: string | null): void;
  selectTrack(trackId: string): void;
  showArrange(): void;
  showTab(): void;
  jumpToSection(sectionId: string): void;
  seekToBar(barKey: string): void;
  /** Track, transport, surface, scroll — the one tap that crosses both. */
  openBarInTab(barKey: string): void;
  /** After a structural edit: the highlighted key may now be a different bar. */
  dropBarFocus(): void;
  /** A queued tab scroll names a bar key the song may no longer have. */
  clearPendingScroll(): void;
  /** A wholly new song: back to the arrangement, nothing remembered. */
  resetForNewSong(): void;
};

export function useWorkspaceNavigation(options: {
  song: Song;
  /** Move the transport. Injected: navigation never owns the engine. */
  seek(barKey: string): void;
}): WorkspaceNavigation {
  const { song, seek } = options;

  const firstTrackId = song.tracks[0]?.id ?? "";
  const [selectedTrackId, setSelectedTrackId] = useState(firstTrackId);
  const [activeBarKey, setActiveBarKey] = useState<string | null>(null);

  /*
   * Which surface is on screen (spec 13.10, K-39).
   *
   * "Düzen" opens first, because the first question about a song someone has
   * not seen before is what shape it is, not what the third bar of the first
   * guitar looks like. This is a view preference and lives only here: it is
   * never written to the Song, never reaches the fingerprint, and never
   * enters a Copilot request — none of those are about what the reader is
   * looking at.
   */
  const [view, setView] = useState<WorkspaceView>("arrange");
  /** A bar the tab has to scroll to once it is actually mounted. */
  const [pendingTabBar, setPendingTabBar] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const arrangeScrollRef = useRef<HTMLDivElement | null>(null);

  const track =
    song.tracks.find((entry) => entry.id === selectedTrackId) ?? song.tracks[0];

  const jumpToSection = useCallback((sectionId: string) => {
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[${BAR_KEY_ATTRIBUTE}="${sectionId}:0"]`,
    );
    if (!scroller || !target) return;
    scroller.scrollTo({
      left: Math.max(0, target.offsetLeft - GUTTER_WIDTH),
      behavior: "smooth",
    });
  }, []);

  const seekToBar = useCallback(
    (barKey: string) => {
      seek(barKey);
      setActiveBarKey(barKey);
    },
    [seek],
  );

  /**
   * A bar cell tap: the one navigation that crosses both surfaces.
   *
   * The transport moves to the bar, the tab takes the screen, and the tab
   * scrolls to the bar. The scroll cannot happen here — the tab is not
   * mounted yet — so the bar is remembered and the effect below does it once
   * the element exists.
   */
  const openBarInTab = useCallback(
    (barKey: string) => {
      seekToBar(barKey);
      setPendingTabBar(barKey);
      setView("tab");
    },
    [seekToBar],
  );

  useEffect(() => {
    if (view !== "tab" || pendingTabBar === null) return;
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[${BAR_KEY_ATTRIBUTE}="${pendingTabBar}"]`,
    );
    if (!scroller || !target) return;
    scroller.scrollLeft = Math.max(0, target.offsetLeft - GUTTER_WIDTH);
    setPendingTabBar(null);
  }, [view, pendingTabBar]);

  const showArrange = useCallback(() => {
    setView("arrange");
  }, []);

  const showTab = useCallback(() => {
    setView("tab");
  }, []);

  const dropBarFocus = useCallback(() => {
    setActiveBarKey(null);
    setPendingTabBar(null);
  }, []);

  const clearPendingScroll = useCallback(() => {
    setPendingTabBar(null);
  }, []);

  const resetForNewSong = useCallback(() => {
    setActiveBarKey(null);
    setPendingTabBar(null);
    // Empty on purpose: the resolver above falls back to the new song's
    // first track, which is the deterministic place to meet an unknown song.
    setSelectedTrackId("");
    setView("arrange");
  }, []);

  return {
    view,
    activeBarKey,
    activeSectionId: activeBarKey?.split(":")[0] ?? null,
    track,
    scrollRef,
    arrangeScrollRef,
    setActiveBarKey,
    selectTrack: setSelectedTrackId,
    showArrange,
    showTab,
    jumpToSection,
    seekToBar,
    openBarInTab,
    dropBarFocus,
    clearPendingScroll,
    resetForNewSong,
  };
}
