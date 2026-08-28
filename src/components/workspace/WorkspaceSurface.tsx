"use client";

/**
 * The main work area: the arrangement, the multi-track view or the tab —
 * one at a time (2L-R, 2Q-A §4).
 *
 * One surface at a time, and the others are unmounted rather than hidden.
 * Hiding would leave a second horizontal scroller alive behind the one on
 * screen and a second animation frame running against it — two things the
 * workspace promises there is exactly one of, and a third surface is a third
 * chance to get it wrong. The playback controller is not here; it lives
 * above all three, so switching surfaces rebuilds no engine, schedules
 * nothing, and stops nothing.
 */
import { useState } from "react";

import type { ArrangementModel } from "@/lib/arrangement/model";
import type { Lazy } from "@/lib/ui/lazy-value";
import { ArrangementCanvas } from "@/components/workspace/ArrangementCanvas";
import { MultiTrackCanvas } from "@/components/workspace/MultiTrackCanvas";
import { TabCanvas } from "@/components/workspace/TabCanvas";
import { TimeSelectionBand } from "@/components/workspace/TimeSelectionBand";
import { GUTTER_WIDTH } from "@/components/workspace/geometry";
import type { PlayPosition } from "@/lib/audio/position";
import type { CellSelection } from "@/components/workspace/FrettedBarBlock";
import { armedPenGhost } from "@/lib/workspace/pen-preview";
import type { IntentComposer } from "@/lib/workspace/use-intent-composer";
import type { Song } from "@/lib/song/schema";
import type { TrackTimeline } from "@/lib/tab/timeline";
import type { DrumPiece } from "@/lib/instruments/registry";
import type { EventEntry } from "@/lib/workspace/use-event-entry";
import type { MultiTrackView } from "@/lib/workspace/use-multitrack-session";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { WorkspaceNavigation } from "@/lib/workspace/use-workspace-navigation";

/** One frozen empty set, so a bar with nothing in it does not allocate. */
const EMPTY_SLOTS: ReadonlySet<number> = new Set<number>();

export function WorkspaceSurface({
  navigation,
  session,
  noteEditing,
  composer,
  song,
  arrangement,
  ghostArrangement,
  timeline,
  multi,
  entry,
  onSelectTrack,
  getPosition,
  running,
  canPersist,
  copilotOwnsScreen,
}: {
  navigation: WorkspaceNavigation;
  session: SelectionSession;
  noteEditing: NoteEditing;
  /** Only the pen preview is read here; the edit area owns the doors. */
  composer: Pick<IntentComposer, "penArmed" | "previewPen">;
  /** The song both reading surfaces lay their one axis over (2Q-C §4). */
  song: Song;
  arrangement: Lazy<ArrangementModel>;
  /** The song a staged bar command would produce, drawn half-lit. */
  ghostArrangement: Lazy<ArrangementModel> | null;
  timeline: TrackTimeline;
  multi: MultiTrackView;
  /** Writing a hit or a note on an instrument the tab cannot draw (2Q-B). */
  entry: EventEntry;
  /**
   * The composed track change, not the navigation's raw setter.
   *
   * A lane tap in the multi view happens while an edit session may be armed,
   * so it has to go through the one that stops it and clears the selection.
   * The arrangement keeps the raw setter it already used: nothing is armed
   * on that surface, so there is nothing to stand down.
   */
  onSelectTrack: (trackId: string) => void;
  getPosition: () => PlayPosition;
  running: boolean;
  canPersist: boolean;
  /** True while a Copilot request or candidate owns the screen. */
  copilotOwnsScreen: boolean;
}) {
  const { time, bars } = session;
  const track = navigation.track;

  /*
   * A time selection is a tab gesture. The arrangement has no staff to draw a
   * band on and no slot to press, so the press machine is not armed there at
   * all — rather than armed and then ignored, which is how a gesture ends up
   * half-working on a surface nobody meant it for. `canPersist` is the harder
   * gate: a session that cannot save does not arm edit gestures (spec 13.14).
   */
  /*
   * The beat under the finger while a pen is held (K-59 §6).
   *
   * A pen writes on the tap, so the only moment a preview can exist is the
   * press itself — and it is the only one that does not need a sheet in front
   * of the staff to have somewhere to live. Transient by construction: it is
   * set on pointer down and cleared on up, leave and cancel.
   */
  const [penTarget, setPenTarget] = useState<
    (CellSelection & { barKey: string }) | null
  >(null);

  const selectionEnabled =
    navigation.view === "tab" &&
    canPersist &&
    !copilotOwnsScreen &&
    track !== undefined;

  /**
   * The onset-first selection for one bar of the **active** track.
   *
   * One reading, used by both surfaces that can edit. The group model is
   * built against the active track and knows no other, so handing it to a
   * lane is what makes "the selection belongs to one track" structural
   * rather than a rule somebody has to keep (spec 13.1, 2N-A §1).
   */
  const onsetsForBar = (bar: { sectionId: string; barIndex: number }) => {
    const group = noteEditing.group;
    const onsetSlots =
      group.onsetsOfSection.get(`${bar.sectionId}:${bar.barIndex}`) ?? EMPTY_SLOTS;
    const selectedSlots =
      (group.selectionView?.sectionId === bar.sectionId
        ? group.selectionView.selected.get(bar.barIndex)
        : undefined) ?? EMPTY_SLOTS;
    return {
      onsetSlots,
      selectedSlots,
      active: group.selection !== null,
      onToggle: (slotIndex: number) =>
        group.pick(bar.sectionId, { barIndex: bar.barIndex, slotIndex }, "toggle"),
      onLongPress: (slotIndex: number) =>
        group.pick(
          bar.sectionId,
          { barIndex: bar.barIndex, slotIndex },
          group.selection?.sectionId === bar.sectionId ? "toggle" : "replace",
        ),
    };
  };

  /*
   * The kit, armed. Same gate as every other edit gesture: edit mode, a
   * session that can save, and no Copilot candidate on the screen. The
   * target's section is the one being read, so a tap in the Çoklu view and a
   * tap on the Tab name the same moment.
   */
  const drumEntry =
    noteEditing.editing && canPersist && !copilotOwnsScreen && entry.drumStep
      ? {
          model: entry.drumStep,
          toggle: (ticks: number, piece: DrumPiece) =>
            entry.toggleDrumHit(
              {
                sectionId: navigation.viewedSectionId,
                trackId: entry.drumStep!.trackId,
                ticks,
              },
              piece,
            ),
        }
      : null;

  /*
   * The fretless strip, armed behind the same gate. A tap here does not
   * write: it opens the note sheet, because where a finger landed says when,
   * and nothing on this lane says which note (§7.1).
   */
  const pitchedEntry =
    noteEditing.editing && canPersist && !copilotOwnsScreen && entry.pitchedStep
      ? { model: entry.pitchedStep, open: entry.openNote }
      : null;

  return (
    <main className="min-h-0 flex-1">
      {navigation.view === "arrange" ? (
        <ArrangementCanvas
          /* Called here and nowhere else: this branch is the only reader,
             which is what makes deferring the build worth anything (§IV). */
          model={(ghostArrangement ?? arrangement)()}
          ghost={ghostArrangement !== null}
          scrollRef={navigation.arrangeScrollRef}
          activeBarKey={navigation.activeBarKey}
          selectedTrackId={track?.id ?? ""}
          getPosition={getPosition}
          running={running}
          onActiveBarChange={navigation.setActiveBarKey}
          onOpenBar={navigation.openBarInTab}
          onSeekBar={navigation.seekToBar}
          onSelectTrack={navigation.selectTrack}
          /*
           * No outline over the ghost. The selection is a range of bar
           * *indices* in the song as it stands, and in the song a command
           * would produce those indices are different bars — an outline drawn
           * from them would be pointing at the wrong music while claiming to
           * show what is about to change.
           */
          barSelection={ghostArrangement ? null : bars.handle.selection}
          onSelectBars={canPersist ? bars.select : undefined}
          onExtendBars={canPersist ? bars.extend : undefined}
        />
      ) : navigation.view === "multi" ? (
        <MultiTrackCanvas
          song={song}
          model={multi.model()}
          session={multi.session}
          getPosition={getPosition}
          running={running}
          activeBarKey={navigation.activeBarKey}
          /*
           * Edit mode, and only for the lane that is active. A session that
           * cannot save arms nothing, exactly as on the tab, and a Copilot
           * candidate owning the screen arms nothing either.
           */
          editing={
            noteEditing.editing && canPersist && !copilotOwnsScreen && track
              ? {
                  cell: noteEditing.cell,
                  onCellSelect: noteEditing.selectCell,
                  onsetsForBar,
                }
              : null
          }
          scrollRef={navigation.scrollRef}
          drumEntry={drumEntry}
          pitchedEntry={pitchedEntry}
          onActivateTrack={onSelectTrack}
          onSelectBar={navigation.seekToBar}
          onActiveBarChange={navigation.setActiveBarKey}
          onScrolledToSection={navigation.scrolledToSection}
          pendingScroll={navigation.pendingScroll}
          onPendingHandled={navigation.clearPendingScroll}
        />
      ) : (
        <TabCanvas
          song={song}
          timeline={timeline}
          getPosition={getPosition}
          running={running}
          activeBarKey={navigation.activeBarKey}
          onActiveBarChange={navigation.setActiveBarKey}
          onSeekBar={navigation.seekToBar}
          onBarLongPress={
            /*
             * Not while the Copilot owns the screen, and not while a
             * candidate is on it: a bar selection is an edit gesture, and a
             * candidate is measured against the song as it was asked for.
             */
            copilotOwnsScreen || !canPersist ? undefined : bars.selectFromTab
          }
          onScrolledToSection={navigation.scrolledToSection}
          pendingScroll={navigation.pendingScroll}
          onPendingHandled={navigation.clearPendingScroll}
          scrollRef={navigation.scrollRef}
          onSlotLongPress={selectionEnabled ? time.onSlotLongPress : undefined}
          onHandleMove={time.onHandleMove}
          onHandleUp={time.onHandleUp}
          selectionBand={
            time.handle.selection && time.selectedSection && time.band ? (
              <TimeSelectionBand
                section={time.selectedSection}
                selection={time.handle.selection}
                height={time.bandHeight}
                label={time.handle.summary?.text ?? "Seçim"}
                left={time.band.left + GUTTER_WIDTH}
                width={time.band.width}
                onHandleDown={time.onHandleDown}
              />
            ) : null
          }
          drumEntry={drumEntry}
          pitchedEntry={pitchedEntry}
          editing={noteEditing.editing}
          selectedCell={noteEditing.cell}
          duration={noteEditing.duration}
          /* The whole shape an armed pen would write, before it writes it. */
          penGhost={armedPenGhost({
            composer,
            cell: penTarget,
            song,
            trackId: track?.id,
          })}
          {...(composer.penArmed ? { onPenTarget: setPenTarget } : {})}
          onCellSelect={noteEditing.selectCell}
          onsetsForBar={onsetsForBar}
        />
      )}
    </main>
  );
}
