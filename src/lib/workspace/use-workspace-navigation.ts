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
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";

import type { WorkspaceView } from "@/components/workspace/ViewSwitch";
import type { Song, Track } from "@/lib/song/schema";
import {
  initialSectionView,
  nextSectionView,
  sectionNeighbours,
  type SectionNavEvent,
} from "@/lib/workspace/section-navigation";

export type WorkspaceNavigation = {
  readonly view: WorkspaceView;
  readonly activeBarKey: string | null;
  /**
   * The section the reader is looking at (spec 13.20 §3).
   *
   * Its own state, never read off `activeBarKey`. The transport's section is
   * `playingSectionId`, and the two are allowed to differ — that is what
   * happens the moment someone steps away from the playhead to read ahead.
   */
  readonly viewedSectionId: string;
  /** The section the transport is on, which is a different question. */
  readonly playingSectionId: string | null;
  /** True while the transport may still carry the view along. */
  readonly followsPlayback: boolean;
  /**
   * A bar a reading surface has been asked to bring into view, or null.
   *
   * Named rather than scrolled to from here (2Q-C §4, §8). Navigation knows
   * which bar the reader asked for; only the surface knows where that bar is,
   * and under windowing the bar may not be in the DOM at all — so a
   * `querySelector` for it would find nothing and quietly do nothing.
   */
  readonly pendingBarKey: string | null;
  /** The step either side, for the stepper's arrows. */
  readonly neighbourSections: { previous: string | null; next: string | null };
  /** The selected track, resolved against the current song. */
  readonly track: Track | undefined;
  /** The tab's scroller. Lives here because scroll targets are navigation. */
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly arrangeScrollRef: RefObject<HTMLDivElement | null>;
  setActiveBarKey(barKey: string | null): void;
  /** The stepper, the list, the arrangement: an explicit choice of section. */
  viewSection(sectionId: string): void;
  /** The reader scrolled the reading surface into a different section. */
  scrolledToSection(sectionId: string): void;
  selectTrack(trackId: string): void;
  showArrange(): void;
  showMulti(): void;
  showTab(): void;
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

  /*
   * The viewed section, held rather than derived (spec 13.20 §3).
   *
   * The song's section ids are passed to every transition, so a section that
   * has just been deleted cannot go on being the thing the reader is looking
   * at, and the fallback is deterministic.
   */
  const sectionIds = useMemo(
    () => song.sections.map((section) => section.id),
    [song.sections],
  );
  const [sectionView, setSectionView] = useState(() => initialSectionView(sectionIds));

  const dispatchSection = useCallback(
    (event: SectionNavEvent) => {
      setSectionView((current) => nextSectionView(current, event, sectionIds));
    },
    [sectionIds],
  );

  /*
   * A song whose sections changed under the view — a delete, an import, an
   * undo — is resolved when the value is *read*, not by an effect that writes
   * state back. An effect would mean one render in which the view still names
   * a section that is gone, and every reader downstream would have to survive
   * it. `nextSectionView` settles the stored value on every transition; this
   * settles what comes out in between.
   */
  const viewedSectionId = sectionIds.includes(sectionView.viewedSectionId)
    ? sectionView.viewedSectionId
    : (sectionIds[0] ?? "");

  /**
   * Choose a section: the stepper, the list, the arrangement's header.
   *
   * The choice is recorded first and the scroll follows from it. That order is
   * the point of §3 — scrolling is what the view *does* about the reader's
   * choice, not where the choice comes from. Queuing the scroll through the
   * same pending-bar mechanism the bar tap uses means it also works when the
   * tab is not on screen yet.
   */
  const viewSection = useCallback(
    (sectionId: string) => {
      dispatchSection({ kind: "choose_section", sectionId });
      setPendingTabBar(`${sectionId}:0`);
    },
    [dispatchSection],
  );

  /**
   * The reader scrolled themselves into another section.
   *
   * It is a choice like any other — they moved the surface to get there — so
   * it takes the view over from the transport. It asks for **no** scroll:
   * they are already looking at it, and scrolling to where somebody already
   * is would be the surface fighting the finger that moved it.
   */
  const scrolledToSection = useCallback(
    (sectionId: string) => {
      dispatchSection({ kind: "choose_section", sectionId });
    },
    [dispatchSection],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const arrangeScrollRef = useRef<HTMLDivElement | null>(null);

  const track =
    song.tracks.find((entry) => entry.id === selectedTrackId) ?? song.tracks[0];

  const seekToBar = useCallback(
    (barKey: string) => {
      seek(barKey);
      setActiveBarKey(barKey);
      // Pointing at a bar is a choice as well as a seek: the reader has said
      // where they want to be, so the view is with the music again.
      dispatchSection({ kind: "open_bar", barKey });
    },
    [dispatchSection, seek],
  );

  /**
   * The transport moved to a new bar.
   *
   * It carries the view only while the reader has not taken over. Playback is
   * never allowed to drag someone off the section they chose to read.
   */
  const reportPlaybackBar = useCallback(
    (barKey: string | null) => {
      setActiveBarKey(barKey);
      dispatchSection({ kind: "playback_moved", barKey });
    },
    [dispatchSection],
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

  const showArrange = useCallback(() => {
    setView("arrange");
  }, []);

  /*
   * The third surface goes through the same one owner (2Q-A §4).
   *
   * No second `useState` for "am I in the multi view": there is one
   * `WorkspaceView` and one setter, so two surfaces can never both believe
   * they are on screen. Switching does not touch the section being viewed,
   * the transport, the loop or the active track — a view change is a change
   * of what the reader is looking at and nothing else.
   */
  const showMulti = useCallback(() => {
    setView("multi");
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
    dispatchSection({ kind: "song_replaced" });
    // Empty on purpose: the resolver above falls back to the new song's
    // first track, which is the deterministic place to meet an unknown song.
    setSelectedTrackId("");
    setView("arrange");
  }, [dispatchSection]);

  const playingSectionId = activeBarKey?.split(":")[0] ?? null;

  return {
    view,
    activeBarKey,
    viewedSectionId,
    playingSectionId,
    followsPlayback: sectionView.followsPlayback,
    neighbourSections: sectionNeighbours(sectionIds, viewedSectionId),
    pendingBarKey: pendingTabBar,
    track,
    scrollRef,
    arrangeScrollRef,
    setActiveBarKey: reportPlaybackBar,
    viewSection,
    scrolledToSection,
    selectTrack: setSelectedTrackId,
    showArrange,
    showMulti,
    showTab,
    seekToBar,
    openBarInTab,
    dropBarFocus,
    clearPendingScroll,
    resetForNewSong,
  };
}
