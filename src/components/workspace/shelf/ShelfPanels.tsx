"use client";

/**
 * Which panel is open, drawn (2V-B.4 §4).
 *
 * The shelf has one region and five things that can be in it. This is the
 * mapping, and only the mapping: every panel here reaches a command that
 * already existed, through a handle its owner already had. Nothing decides
 * anything, nothing writes, and the grid stays on the screen behind all five.
 *
 * It is its own file because `EditArea` is a layout — toolbar, dock, zoom,
 * selection bar — and a layout that also carried five panels' worth of wiring
 * would be the third file in this app to quietly become a workspace.
 */
import { ChordPanel } from "@/components/workspace/shelf/ChordPanel";
import { DurationPanel } from "@/components/workspace/shelf/DurationPanel";
import { FastSequencePanel } from "@/components/workspace/shelf/FastSequencePanel";
import { NotePanel } from "@/components/workspace/shelf/NotePanel";
import { PhrasePanel } from "@/components/workspace/shelf/PhrasePanel";
import { PlayingPanel } from "@/components/workspace/shelf/PlayingPanel";
import { TransposePanel } from "@/components/workspace/shelf/TransposePanel";
import { pitchAt } from "@/lib/song/edit";
import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { EditTarget } from "@/lib/workspace/edit-target";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { ShelfPanelId } from "@/lib/workspace/shelf-panel";
import { isMelodicSlotArray, type Song, type Track } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

/**
 * How many voices sound at the position under the finger.
 *
 * One is a note, more is a chord, none is a stretch of time — which is the
 * whole of what "Sesi taşı" needs to name its own scope (§14).
 */
function voicesAt(song: Song, target: EditTarget | null): number {
  if (!target) return 0;
  const bar = song.sections.find((entry) => entry.id === target.sectionId)?.bars[
    target.barIndex
  ];
  const lane = bar?.slots[target.trackId];
  if (!lane || !isMelodicSlotArray(lane)) return 0;
  const slot = lane[target.startTicks / target.slotTicks];
  return slot && slot !== "-" ? slot.notes.length : 0;
}

/** What a position sounds on this track, or null when there is no note. */
function pitchOf(
  track: Track | undefined,
  stringIndex: number,
  fret: number | null,
): string | null {
  if (!track?.fretboard || fret === null) return null;
  return pitchAt(track.fretboard, stringIndex, fret);
}

export function ShelfPanels({
  panel,
  song,
  track,
  target,
  selection,
  noteEditing,
  draft,
  onPropose,
  onDiscard,
  onPreview,
  onApply,
  onOpenPanel,
}: {
  panel: ShelfPanelId;
  song: Song;
  track: Track | undefined;
  /** Where the panels point, or null when nothing is under the finger. */
  target: EditTarget | null;
  selection: TimeSelection | null;
  noteEditing: NoteEditing;
  draft: EditDraft | null;
  onPropose: (next: EditDraft) => void;
  onDiscard: () => void;
  onPreview: (candidate: Song) => void;
  onApply: (proposal: EditDraft) => void;
  onOpenPanel: (id: ShelfPanelId) => void;
}) {
  const stringIndex = noteEditing.cell?.stringIndex ?? 0;

  /*
   * Taşı is the one panel that does not need a target: a reader may put the
   * whole song into another key without having touched a note first.
   */
  if (panel === "transpose") {
    return (
      <TransposePanel
        song={song}
        selection={
          selection
            ? { startTicks: selection.startTicks, endTicks: selection.endTicks }
            : null
        }
        sectionId={selection?.sectionId ?? song.sections[0]?.id ?? ""}
        trackId={track?.id ?? ""}
        /* How many voices are under the finger, so "Sesi taşı" can say
           whether it is about a note or a chord (§14). */
        voices={voicesAt(song, target)}
        draft={draft}
        onPropose={onPropose}
        onPreview={onPreview}
        onApply={onApply}
      />
    );
  }

  /*
   * Cümle is about the held range and the section it is in, so it needs the
   * selection rather than a position under the finger.
   */
  if (panel === "phrase") {
    return (
      <PhrasePanel
        song={song}
        sectionId={selection?.sectionId ?? song.sections[0]?.id ?? ""}
        trackId={track?.id ?? ""}
        selection={
          selection
            ? { startTicks: selection.startTicks, endTicks: selection.endTicks }
            : null
        }
        barNumber={target?.barNumber ?? 1}
        onApply={onApply}
      />
    );
  }

  if (!target) return null;

  /*
   * Bend and Kaydır are about one note under the finger, so unlike Taşı they
   * need a target — and the panel asks the write command itself which of the
   * six slides that note can take (2V-C.1 §13).
   */
  if (panel === "playing") {
    return (
      <PlayingPanel
        song={song}
        target={target}
        noteIndex={0}
        fret={noteEditing.currentFret}
        draft={draft}
        onPropose={onPropose}
        onPreview={onPreview}
        onApply={onApply}
      />
    );
  }

  if (panel === "note") {
    return (
      <NotePanel
        target={target}
        fret={noteEditing.currentFret}
        /* The sounding note, derived where the fretboard is rather than
           guessed here: the panel names it, it does not compute it. */
        pitch={pitchOf(track, stringIndex, noteEditing.currentFret)}
        articulation={noteEditing.currentArticulation}
        error={noteEditing.editError}
        onFret={(next) =>
          noteEditing.runCommand((where) => ({
            kind: "set_note",
            target: where,
            stringIndex,
            fret: next,
            durationTicks: noteEditing.rhythm.ticks,
          }))
        }
        onClear={() =>
          noteEditing.runCommand((where) => ({
            kind: "clear_string",
            target: where,
            stringIndex,
          }))
        }
        onConnection={(id) =>
          noteEditing.runCommand((where) => ({
            kind: "set_articulation",
            target: where,
            stringIndex,
            articulation: id as never,
          }))
        }
        onOpenDuration={() => onOpenPanel("duration")}
        onOpenDetails={noteEditing.openDetails}
      />
    );
  }

  if (panel === "duration") {
    return (
      <DurationPanel
        target={target}
        onSetLength={(ticks) => noteEditing.rhythm.choose(ticks)}
        /* Dividing a length and densifying a passage are the same question
           asked twice, and the fast-sequence panel is where it is answered. */
        onDivide={() => onOpenPanel("fast_sequence")}
        onDensify={() => onOpenPanel("fast_sequence")}
      />
    );
  }

  if (panel === "fast_sequence") {
    return (
      <FastSequencePanel
        song={song}
        target={target}
        draft={draft}
        onPropose={onPropose}
        onDiscard={onDiscard}
        onPreview={onPreview}
        onApply={onApply}
      />
    );
  }

  if (panel === "chord" && track) {
    return (
      <ChordPanel
        song={song}
        track={track}
        target={target}
        selectionEndTicks={selection?.endTicks ?? null}
        onPropose={onPropose}
        onPreview={onPreview}
        onApply={onApply}
      />
    );
  }

  return null;
}
