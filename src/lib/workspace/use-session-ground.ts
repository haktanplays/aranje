"use client";

/**
 * Putting the editing surfaces down before the song moves under them (2N-A).
 *
 * Four different things replace or reshape the piece — an undo, a project
 * being opened, a structural bar or section command, and a move to another
 * section — and every one of them has the same problem: a selection is a range
 * of ticks in the song *as it stands*, a ghost is a command staged against it,
 * and a Copilot candidate was measured against the song as it was when it was
 * asked for. After any of those four, none of them describes anything.
 *
 * The four grounds differ only in how far they go, and that difference is the
 * whole reason this is one module rather than four call sites:
 *
 * - **undo/redo** — surfaces down, playback paused. Clipboards stay: someone
 *   who copied a bar, undid an unrelated edit and came back would rightly
 *   expect them.
 * - **structural** — the same, plus the clipboards and the highlighted bar,
 *   because after bars shift the same key is a different bar. Loop and
 *   playhead are left alone: the engine re-derives both from the committed
 *   song.
 * - **a new project** — everything, including the loop, the playhead, edit
 *   mode and who was being auditioned. It is a different song.
 * - **a section change** — surfaces down, nothing else. The music has not
 *   moved; the reader has.
 *
 * It composes handles it is *given* rather than reaching for controllers of
 * its own, so it stays a sibling of them rather than a layer above.
 */
import { useCallback } from "react";

import { useEditShortcuts } from "@/lib/ui/use-edit-shortcuts";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { WorkspaceNavigation } from "@/lib/workspace/use-workspace-navigation";

export type SessionGround = {
  /** Selection, ghosts and any Copilot candidate. The clipboards stay. */
  resetEditSurfaces(): void;
  undoEdit(): void;
  redoEdit(): void;
  /** Before a whole new song lands. */
  prepareForProjectApply(): void;
  /** Before a command that changes how many bars there are, or which is which. */
  prepareForStructuralApply(): void;
  /** The one door onto a section: move the reader, leave the last one behind. */
  focusSection(sectionId: string): void;
  /**
   * The one door onto the Copilot.
   *
   * Opening it is a grounding act like every other one here: the music stops
   * and the edit session ends, because a candidate is about to be measured
   * against the song as it was asked for and not against a half-finished
   * edit still open on the screen.
   */
  enterCopilot(): void;
};

export function useSessionGround(options: {
  session: SelectionSession;
  noteEditing: NoteEditing;
  navigation: WorkspaceNavigation;
  /** Closing the Copilot disposes its preview engine as well as its sheet. */
  closeCopilot(): void;
  openCopilot(): void;
  /** Forget who was being listened to on their own. */
  clearAudition(): void;
  pause(): void;
  /** The transport, for the parts of a reset only it can do. */
  transport: {
    pause(): void;
    setLoopSection(sectionId: string | null): void;
    rewind(): void;
  };
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}): SessionGround {
  const {
    session,
    noteEditing,
    navigation,
    closeCopilot,
    openCopilot,
    clearAudition,
    pause,
    transport,
    canUndo,
    canRedo,
    undo,
    redo,
  } = options;

  /*
   * Stable members rather than the handles themselves: a handle is rebuilt
   * every render, and depending on one would rebuild every callback here.
   */
  const resetSelections = session.resetAll;
  const clearClipboards = session.clearClipboards;
  const resetNoteEditing = noteEditing.reset;
  const exitEditMode = noteEditing.exitEditMode;
  const stopEditing = noteEditing.stopForTrackChange;

  const resetEditSurfaces = useCallback(() => {
    resetSelections();
    resetNoteEditing();
    closeCopilot();
  }, [closeCopilot, resetNoteEditing, resetSelections]);

  /**
   * Step the history, once.
   *
   * Playback stops first and does not start again on its own: the music under
   * the playhead is about to become different music, and resuming into it
   * would be the app deciding to play something the reader did not ask for.
   */
  const undoEdit = useCallback(() => {
    if (!canUndo) return;
    pause();
    resetEditSurfaces();
    undo();
  }, [canUndo, pause, resetEditSurfaces, undo]);

  const redoEdit = useCallback(() => {
    if (!canRedo) return;
    pause();
    resetEditSurfaces();
    redo();
  }, [canRedo, pause, redo, resetEditSurfaces]);

  useEditShortcuts({ canUndo, canRedo, onUndo: undoEdit, onRedo: redoEdit });

  /**
   * The ground a project lands on (spec 13.15).
   *
   * The loop is dropped *before* the rewind: a rewind with a loop on seeks to
   * the loop rather than to the top. The clipboards go too, unlike an undo — a
   * clipboard cut from a song that has been wholly replaced would paste
   * another song's music.
   */
  const prepareForProjectApply = useCallback(() => {
    transport.pause();
    transport.setLoopSection(null);
    transport.rewind();
    resetEditSurfaces();
    clearClipboards();
    exitEditMode();
    navigation.resetForNewSong();
    clearAudition();
  }, [
    clearAudition,
    clearClipboards,
    exitEditMode,
    navigation,
    resetEditSurfaces,
    transport,
  ]);

  /** The structural ground (2L-B §6/§7). */
  const prepareForStructuralApply = useCallback(() => {
    pause();
    resetEditSurfaces();
    clearClipboards();
    navigation.dropBarFocus();
  }, [clearClipboards, navigation, pause, resetEditSurfaces]);

  /**
   * Move the reader to a section (spec 13.20 §3).
   *
   * A selection, a ghost or an open cell sheet describes music that is about
   * to leave the screen, so it leaves with it — otherwise "Sil" can land on
   * bars nobody can see.
   */
  const focusSection = useCallback(
    (sectionId: string) => {
      resetEditSurfaces();
      navigation.viewSection(sectionId);
    },
    [navigation, resetEditSurfaces],
  );

  const enterCopilot = useCallback(() => {
    pause();
    stopEditing();
    openCopilot();
  }, [openCopilot, pause, stopEditing]);

  return {
    enterCopilot,
    resetEditSurfaces,
    undoEdit,
    redoEdit,
    prepareForProjectApply,
    prepareForStructuralApply,
    focusSection,
  };
}
