"use client";

/**
 * The note-editing session (2L-R): edit mode, the selected cell, and the
 * onset-group selection that moves music around (spec 13.1).
 *
 * This is the command bridge for single-note edits and group moves: it
 * prepares the target the pure cores need, delegates the result to the one
 * unified commit with its typed action, and routes refusals into the error
 * strings the sheets show. The algorithms themselves live in
 * `@/lib/song/edit` and `@/lib/song/move`; nothing here re-implements them,
 * touches storage, or builds an engine.
 */
import { useCallback, useMemo, useState } from "react";

import type { FretSheetTarget } from "@/components/workspace/FretSheet";
import { applyEdit, type EditCommand } from "@/lib/song/edit";
import { applyMoveOnsetGroup, type OnsetMovement } from "@/lib/song/move";
import {
  blockContaining,
  findSection,
  sectionOnsetBlocks,
  type OnsetRef,
} from "@/lib/song/onset-block";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song, Track } from "@/lib/song/schema";
import {
  chooseOnset,
  type SelectMode,
  type Selection,
} from "@/lib/song/selection";
import type { TrackTimeline } from "@/lib/tab/timeline";
import { validateArticulationContext } from "@/lib/validators";

export type EditedCell = {
  barKey: string;
  slotIndex: number;
  stringIndex: number;
};

export type GroupSelection = {
  readonly selection: Selection | null;
  readonly moveError: string | null;
  /** Slots to draw as selected, tie tails included — it is the same sound. */
  readonly selectionView: {
    sectionId: string;
    onsets: Map<number, Set<number>>;
    selected: Map<number, Set<number>>;
  } | null;
  /** Every onset of every section, keyed `sectionId:barIndex`. */
  readonly onsetsOfSection: Map<string, Set<number>>;
  pick(sectionId: string, ref: OnsetRef, mode: SelectMode): void;
  move(movement: OnsetMovement): void;
  clear(): void;
};

export type NoteEditing = {
  readonly editing: boolean;
  readonly cell: EditedCell | null;
  readonly editError: string | null;
  readonly currentFret: number | null;
  readonly currentArticulation: string | null;
  readonly fretTarget: FretSheetTarget | null;
  readonly group: GroupSelection;
  toggleEdit(): void;
  /** Leave edit mode without touching the cell/selection resets. */
  exitEditMode(): void;
  selectCell(next: EditedCell | null): void;
  closeCell(): void;
  nudge(delta: { slot?: number; string?: number }): void;
  /** The command bridge: target prepared here, algorithm in the pure core. */
  runCommand(
    build: (target: {
      sectionId: string;
      trackId: string;
      barIndex: number;
      slotIndex: number;
    }) => EditCommand,
  ): void;
  /** Cell, error and group selection down. Edit mode itself stays. */
  reset(): void;
  /** What a track change costs: mode off, cell down, group selection down. */
  stopForTrackChange(): void;
};

export function useNoteEditing(options: {
  song: Song;
  track: Track | undefined;
  timeline: TrackTimeline;
  commit(next: Song, action: HistoryAction): boolean;
  /** Editing and playback do not share the screen (spec 13.1). */
  pause(): void;
}): NoteEditing {
  const { song, track, timeline, commit, pause } = options;

  const [editing, setEditing] = useState(false);
  const [cell, setCell] = useState<EditedCell | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // A group selection belongs to one track and one section at a time, so the
  // section it was made in is part of the state rather than derived (spec 13.1).
  const [selection, setSelection] = useState<Selection | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const clearGroup = useCallback(() => {
    setSelection(null);
    setMoveError(null);
  }, []);

  const toggleEdit = useCallback(() => {
    setEditError(null);
    setCell(null);
    clearGroup();
    setEditing((was) => {
      if (!was) pause();
      return !was;
    });
  }, [clearGroup, pause]);

  const exitEditMode = useCallback(() => {
    setEditing(false);
  }, []);

  const selectCell = useCallback((next: EditedCell | null) => {
    setEditError(null);
    setCell(next);
  }, []);

  const closeCell = useCallback(() => {
    setCell(null);
    setEditError(null);
  }, []);

  /** The span under the selected cell, if there is a note there. */
  const currentSpan = useMemo(() => {
    if (!cell || timeline.kind !== "fretted") return null;
    const bar = timeline.bars.find((entry) => entry.key === cell.barKey);
    return (
      bar?.spans.find(
        (entry) =>
          entry.startSlot === cell.slotIndex &&
          !entry.openStart &&
          entry.stringIndex === cell.stringIndex,
      ) ?? null
    );
  }, [cell, timeline]);

  const currentFret = currentSpan?.fret ?? null;
  const currentArticulation = currentSpan?.articulation ?? null;

  /**
   * What the validators say about the articulation on the selected cell.
   * A warning is information, not a refusal: it is shown, and the edit stands.
   */
  const articulationWarning = useMemo(() => {
    if (!cell || !track) return null;
    const [sectionId, barIndexText] = cell.barKey.split(":");
    const barIndex = Number(barIndexText);
    if (!sectionId || !Number.isInteger(barIndex)) return null;

    const issue = validateArticulationContext(song).find(
      (entry) =>
        entry.trackId === track.id &&
        entry.sectionId === sectionId &&
        entry.barIndex === barIndex &&
        entry.slotIndex === cell.slotIndex,
    );
    return issue?.message ?? null;
  }, [cell, song, track]);

  const fretTarget: FretSheetTarget | null = useMemo(() => {
    if (!cell || timeline.kind !== "fretted") return null;
    const bar = timeline.bars.find((entry) => entry.key === cell.barKey);
    if (!bar) return null;
    return {
      barNumber: bar.barNumber,
      slotIndex: cell.slotIndex,
      stringIndex: cell.stringIndex,
      currentFret,
      currentArticulation,
      articulationWarning,
    };
  }, [articulationWarning, cell, currentArticulation, currentFret, timeline]);

  /*
   * The builder gets the whole target: every command aims at the selected
   * cell, so the one place that knows the cell is the one place that spells
   * the target out.
   */
  const runCommand = useCallback(
    (
      build: (target: {
        sectionId: string;
        trackId: string;
        barIndex: number;
        slotIndex: number;
      }) => EditCommand,
    ) => {
      if (!cell || !track) return;
      const [sectionId, barIndexText] = cell.barKey.split(":");
      const barIndex = Number(barIndexText);
      if (!sectionId || !Number.isInteger(barIndex)) return;

      const result = applyEdit(
        song,
        build({ sectionId, trackId: track.id, barIndex, slotIndex: cell.slotIndex }),
      );
      if (!result.ok) {
        setEditError(result.error.message);
        return;
      }
      setEditError(null);
      commit(result.song, { kind: "note_edit" });
    },
    [cell, commit, song, track],
  );

  const nudge = useCallback(
    (delta: { slot?: number; string?: number }) => {
      if (!cell || timeline.kind !== "fretted") return;
      const bar = timeline.bars.find((entry) => entry.key === cell.barKey);
      if (!bar) return;
      const slotIndex = Math.min(
        bar.slotCount - 1,
        Math.max(0, cell.slotIndex + (delta.slot ?? 0)),
      );
      const stringIndex = Math.min(
        timeline.strings.length - 1,
        Math.max(0, cell.stringIndex + (delta.string ?? 0)),
      );
      setEditError(null);
      setCell({ ...cell, slotIndex, stringIndex });
    },
    [cell, timeline],
  );

  /**
   * The onset blocks of the section a selection is in, so the tab knows which
   * slots may be picked up and which are already part of the selection. The
   * tie tail is drawn as selected too: it is the same sound.
   */
  const selectionView = useMemo(() => {
    if (!selection || !track) return null;
    const section = findSection(song, selection.sectionId);
    if (!section) return null;

    const blocks = sectionOnsetBlocks(section, track.id);
    const selected = new Map<number, Set<number>>();
    for (const ref of selection.refs) {
      const block = blockContaining(blocks, ref);
      if (!block) continue;
      for (const slot of [block.start, ...block.tail]) {
        const bucket = selected.get(slot.barIndex) ?? new Set<number>();
        bucket.add(slot.slotIndex);
        selected.set(slot.barIndex, bucket);
      }
    }

    const onsets = new Map<number, Set<number>>();
    for (const block of blocks) {
      const bucket = onsets.get(block.start.barIndex) ?? new Set<number>();
      bucket.add(block.start.slotIndex);
      onsets.set(block.start.barIndex, bucket);
    }

    return { sectionId: selection.sectionId, onsets, selected };
  }, [selection, song, track]);

  /** Every onset of the section a bar belongs to, whether or not one is chosen. */
  const onsetsOfSection = useMemo(() => {
    const byBar = new Map<string, Set<number>>();
    if (!track) return byBar;
    for (const section of song.sections) {
      for (const block of sectionOnsetBlocks(section, track.id)) {
        const key = `${section.id}:${block.start.barIndex}`;
        const bucket = byBar.get(key) ?? new Set<number>();
        bucket.add(block.start.slotIndex);
        byBar.set(key, bucket);
      }
    }
    return byBar;
  }, [song, track]);

  const pick = useCallback(
    (sectionId: string, ref: OnsetRef, mode: SelectMode) => {
      setMoveError(null);
      setSelection((current) => chooseOnset(current, sectionId, ref, mode));
    },
    [],
  );

  const move = useCallback(
    (movement: OnsetMovement) => {
      if (!selection || !track) return;
      // Moving music while it is playing would leave the ear behind the eye.
      pause();

      const result = applyMoveOnsetGroup(song, {
        kind: "move_onset_group",
        sectionId: selection.sectionId,
        trackId: track.id,
        origins: selection.refs,
        movement,
        // The message has to name the bar the musician can see, which is the
        // tab's running number, not the section's own count.
        barLabel: (barIndex) => {
          const bar =
            timeline.kind === "fretted"
              ? timeline.bars.find(
                  (entry) =>
                    entry.sectionId === selection.sectionId &&
                    entry.barIndex === barIndex,
                )
              : undefined;
          return `Bar ${bar?.barNumber ?? barIndex + 1}`;
        },
      });

      if (!result.ok) {
        setMoveError(result.error.message);
        return;
      }
      setMoveError(null);
      // One commit: one storage write and one step of history (spec 5.6).
      commit(result.song, { kind: "group_move" });
      setSelection({ sectionId: selection.sectionId, refs: result.origins });
    },
    [commit, pause, selection, song, timeline, track],
  );

  const reset = useCallback(() => {
    clearGroup();
    setCell(null);
    setEditError(null);
  }, [clearGroup]);

  const stopForTrackChange = useCallback(() => {
    setEditing(false);
    setCell(null);
    clearGroup();
  }, [clearGroup]);

  return {
    editing,
    cell,
    editError,
    currentFret,
    currentArticulation,
    fretTarget,
    group: {
      selection,
      moveError,
      selectionView,
      onsetsOfSection,
      pick,
      move,
      clear: clearGroup,
    },
    toggleEdit,
    exitEditMode,
    selectCell,
    closeCell,
    nudge,
    runCommand,
    reset,
    stopForTrackChange,
  };
}
