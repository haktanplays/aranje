"use client";

/**
 * The two doors that open a sheet somebody else owns (2S-A §11).
 *
 * "Diğer şekiller" opens the chord builder and "Ölçü ve ritim ızgarası" opens
 * the timing sheet, and both of those want a *target* — a beat, a section —
 * that the door itself does not have. Working it out is controller work, so
 * it is here rather than in the root or in a component.
 *
 * Each one is `null` when there is nothing for it to be about. A builder with
 * no beat and a grid sheet with no section are sheets that can only be closed
 * again, and offering them would be offering a control that refuses.
 */
import { useMemo } from "react";

import { chordTargetAt } from "@/lib/chords/chord-target";
import type { ChordBuilderHandle } from "@/lib/workspace/use-chord-builder";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { TimingChangeHandle } from "@/lib/workspace/use-timing-change";
import type { Song, Track } from "@/lib/song/schema";

export type ComposerDoors = {
  readonly catalogue: ((power: boolean) => void) | null;
  readonly rhythm: (() => void) | null;
};

export function useComposerDoors(options: {
  song: Song;
  track: Track | undefined;
  noteEditing: NoteEditing;
  chords: ChordBuilderHandle;
  timing: TimingChangeHandle;
  viewedSectionId: string | null;
}): ComposerDoors {
  const { song, track, noteEditing, chords, timing, viewedSectionId } = options;

  const catalogue = useMemo(() => {
    const cell = noteEditing.cell;
    if (!cell || !track) return null;
    const [sectionId, barIndexText] = cell.barKey.split(":");
    const barIndex = Number(barIndexText);
    if (!sectionId || !Number.isInteger(barIndex)) return null;
    return (power: boolean) => {
      const target = chordTargetAt(song, {
        sectionId,
        trackId: track.id,
        barIndex,
        slotIndex: cell.slotIndex,
        barNumber: noteEditing.fretTarget?.barNumber ?? barIndex + 1,
        anchorFret: noteEditing.currentFret,
      });
      if (!target) return;
      noteEditing.closeCell();
      chords.open(target);
      // The door the reader pressed already answered the first step, so the
      // builder opens on the root grid rather than asking it again.
      chords.chooseType(power);
    };
  }, [chords, noteEditing, song, track]);

  const rhythm = useMemo(() => {
    if (!viewedSectionId) return null;
    return () =>
      timing.open({
        sectionId: viewedSectionId,
        scope: { kind: "section" },
        title: "Bölümün ölçüsü ve ritmi",
      });
  }, [timing, viewedSectionId]);

  return { catalogue, rhythm };
}
