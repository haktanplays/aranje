"use client";

/**
 * The main work area: the arrangement or the tab, one at a time (2L-R).
 *
 * One surface at a time, and the other is unmounted rather than hidden.
 * Hiding would leave a second horizontal scroller alive behind the one on
 * screen and a second animation frame running against it — two things the
 * workspace promises there is exactly one of. The playback controller is not
 * here; it lives above both, so switching surfaces rebuilds no engine,
 * schedules nothing, and stops nothing.
 */
import type { ArrangementModel } from "@/lib/arrangement/model";
import { ArrangementCanvas } from "@/components/workspace/ArrangementCanvas";
import { TabCanvas } from "@/components/workspace/TabCanvas";
import { TimeSelectionBand } from "@/components/workspace/TimeSelectionBand";
import { GUTTER_WIDTH } from "@/components/workspace/geometry";
import type { PlayPosition } from "@/lib/audio/position";
import type { SongPlan } from "@/lib/audio/schedule";
import type { TrackTimeline } from "@/lib/tab/timeline";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { WorkspaceNavigation } from "@/lib/workspace/use-workspace-navigation";

/** One frozen empty set, so a bar with nothing in it does not allocate. */
const EMPTY_SLOTS: ReadonlySet<number> = new Set<number>();

export function WorkspaceSurface({
  navigation,
  session,
  noteEditing,
  arrangement,
  ghostArrangement,
  timeline,
  plan,
  getPosition,
  running,
  canPersist,
  copilotOwnsScreen,
}: {
  navigation: WorkspaceNavigation;
  session: SelectionSession;
  noteEditing: NoteEditing;
  arrangement: ArrangementModel;
  /** The song a staged bar command would produce, drawn half-lit. */
  ghostArrangement: ArrangementModel | null;
  timeline: TrackTimeline;
  plan: SongPlan;
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
  const selectionEnabled =
    navigation.view === "tab" &&
    canPersist &&
    !copilotOwnsScreen &&
    track !== undefined;

  return (
    <main className="min-h-0 flex-1">
      {navigation.view === "arrange" ? (
        <ArrangementCanvas
          model={ghostArrangement ?? arrangement}
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
      ) : (
        <TabCanvas
          timeline={timeline}
          plan={plan}
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
          editing={noteEditing.editing}
          selectedCell={noteEditing.cell}
          onCellSelect={noteEditing.selectCell}
          onsetsForBar={(bar) => {
            const group = noteEditing.group;
            const onsetSlots =
              group.onsetsOfSection.get(`${bar.sectionId}:${bar.barIndex}`) ??
              EMPTY_SLOTS;
            const selectedSlots =
              (group.selectionView?.sectionId === bar.sectionId
                ? group.selectionView.selected.get(bar.barIndex)
                : undefined) ?? EMPTY_SLOTS;
            return {
              onsetSlots,
              selectedSlots,
              active: group.selection !== null,
              onToggle: (slotIndex) =>
                group.pick(
                  bar.sectionId,
                  { barIndex: bar.barIndex, slotIndex },
                  "toggle",
                ),
              onLongPress: (slotIndex) =>
                group.pick(
                  bar.sectionId,
                  { barIndex: bar.barIndex, slotIndex },
                  group.selection?.sectionId === bar.sectionId
                    ? "toggle"
                    : "replace",
                ),
            };
          }}
        />
      )}
    </main>
  );
}
