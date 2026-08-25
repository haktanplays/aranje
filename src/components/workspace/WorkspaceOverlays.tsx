"use client";

/**
 * Every workspace sheet, composed in one place (2L-R).
 *
 * View only: each sheet's *state* lives with its owner — the overlay enum in
 * `useWorkspaceOverlays`, the edit session in its hooks, the Copilot in its
 * own controller — and this component wires them to the sheet components.
 * The one piece of state that lives here is the arrange form, because the
 * form is the sheet's own draft: nothing outside the sheet reads it, and its
 * value dies with a submitted or abandoned request, not with the song.
 */
import { useState } from "react";

import { ArrangeSheet, type ArrangeForm } from "@/components/workspace/ArrangeSheet";
import { FretSheet } from "@/components/workspace/FretSheet";
import { NoteEntrySheet } from "@/components/workspace/NoteEntrySheet";
import { InfoSheet } from "@/components/workspace/InfoSheet";
import { MixerSheet } from "@/components/workspace/MixerSheet";
import { PracticeSheet } from "@/components/workspace/PracticeSheet";
import { NewSongSheet } from "@/components/workspace/NewSongSheet";
import { PracticeRateControl } from "@/components/workspace/PracticeRateControl";
import { PreviewSheet } from "@/components/workspace/PreviewSheet";
import { ExportSheet } from "@/components/workspace/ExportSheet";
import { ProjectFileSheet } from "@/components/workspace/ProjectFileSheet";
import { SectionManagerSheet } from "@/components/workspace/SectionManagerSheet";
import { SectionSheet } from "@/components/workspace/SectionSheet";
import { Sheet } from "@/components/workspace/Sheet";
import { SongInfoSheet } from "@/components/workspace/SongInfoSheet";
import { TrackManagerSheet } from "@/components/workspace/TrackManagerSheet";
import { TrackSheet } from "@/components/workspace/TrackSheet";
import { targetsFor } from "@/lib/copilot/ui-options";
import type { ArrangeSkill } from "@/lib/copilot/contract";
import type { CoArrangerHandle } from "@/lib/copilot/use-co-arranger";
import type { ExportHandle } from "@/lib/workspace/use-export";
import { ProjectDeleteSheet } from "@/components/workspace/ProjectDeleteSheet";
import { ProjectLibrarySheet } from "@/components/workspace/ProjectLibrarySheet";
import { SONG_TEMPLATES } from "@/lib/song/song-templates";
import type { ProjectFileHandle } from "@/lib/project/use-project-file";
import type { ProjectLibraryHandle } from "@/lib/workspace/use-project-library";
import type { Song } from "@/lib/song/schema";
import type { SectionRun } from "@/lib/tab/timeline";
import type { LifecycleHandle } from "@/lib/workspace/use-lifecycle";
import type { MixerHandle } from "@/lib/workspace/use-mixer";
import type { PracticeSession } from "@/lib/workspace/use-practice-session";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { EventEntry } from "@/lib/workspace/use-event-entry";
import { isPlayablePreset } from "@/lib/audio/preset-availability";
import type { ChordBuilderHandle } from "@/lib/workspace/use-chord-builder";
import { chordTargetAt } from "@/lib/chords/chord-target";
import { ChordBuilderSheet } from "@/components/workspace/ChordBuilderSheet";
import type { WorkspaceNavigation } from "@/lib/workspace/use-workspace-navigation";
import type { WorkspaceOverlayState } from "@/lib/workspace/use-workspace-overlays";
import type { TimingChangeHandle } from "@/lib/workspace/use-timing-change";
import { TimingSheet } from "@/components/workspace/TimingSheet";

/**
 * How loudly a previewed note is played.
 *
 * The contract's own default for a written note, so what the reader hears is
 * what they are about to write and not a louder or quieter version of it.
 */
const NOTE_PREVIEW_VELOCITY = 100;

export function WorkspaceOverlays({
  song,
  runs,
  overlays,
  navigation,
  noteEditing,
  entry,
  onNoteAudition,
  chords,
  onAudition,
  copilot,
  copilotSkills,
  previewOpen,
  arrangeOpen,
  project,
  exporter,
  library,
  lifecycle,
  mixer,
  practice,
  canPersist,
  songBpm,
  practicePercent,
  onPracticePercent,
  onSelectTrack,
  onChooseSection,
  timing,
}: {
  song: Song;
  runs: readonly SectionRun[];
  overlays: WorkspaceOverlayState;
  navigation: WorkspaceNavigation;
  /**
   * Move to a section and clear what belonged to the last one.
   *
   * Injected rather than reached for: the list is one of several doors onto a
   * section (spec 13.20 §3) and they all have to leave the same nothing
   * behind, so the door itself does not get to decide.
   */
  onChooseSection: (sectionId: string) => void;
  /** The meter-and-rhythm sheet, opened from the bar sheet or from here. */
  timing: TimingChangeHandle;
  noteEditing: NoteEditing;
  /** Writing one event on an instrument the tab has no notation for (2Q-B §7). */
  entry: EventEntry;
  /** Hearing one note, offered only when the track's preset can sound. */
  onNoteAudition: (pitch: string, velocity: number) => void;
  /** The chord builder session, and the one way to hear a shape. */
  chords: ChordBuilderHandle;
  onAudition: (voicingId: string) => void;
  copilot: CoArrangerHandle;
  copilotSkills: readonly ArrangeSkill[];
  previewOpen: boolean;
  arrangeOpen: boolean;
  project: ProjectFileHandle;
  exporter: ExportHandle;
  /** Every project on the device, and the five things that can be done to one. */
  library: ProjectLibraryHandle;
  lifecycle: LifecycleHandle;
  mixer: MixerHandle;
  /** The practice loop's session state and its sheet (2R-A §14). */
  practice: PracticeSession;
  canPersist: boolean;
  songBpm: number;
  practicePercent: number;
  onPracticePercent: (percent: number) => void;
  /** Composed at the root: a track change also costs the edit session. */
  onSelectTrack: (trackId: string) => void;
}) {
  const [form, setForm] = useState<ArrangeForm>(() => {
    const skill = copilotSkills[0] ?? "drums";
    return {
      sectionId: song.sections[0]?.id ?? "",
      skill,
      targetTrackId: targetsFor(song, skill)[0]?.id ?? "",
      styleId: null,
      instruction: "",
    };
  });

  const track = navigation.track;
  const fretboard = track?.fretboard;

  return (
    <>
      {/*
        The practice-rate controls, on demand. Practice rate is a thing you
        set and then work at, not a thing you adjust continuously.
      */}
      {/*
        The practice loop's own sheet. Beside the practice-rate one because
        they are the two things a reader adjusts while drilling, and apart
        from it because one is a speed and the other is a place.
      */}
      <PracticeSheet
        open={practice.sheetOpen}
        onClose={practice.closeSheet}
        session={practice}
        view={practice.view}
      />

      <Sheet
        open={overlays.isOpen("practice")}
        title="Çalışma hızı"
        onClose={overlays.close}
        labelledBy="practice-sheet-title"
      >
        <PracticeRateControl
          songBpm={songBpm}
          percent={practicePercent}
          onChange={onPracticePercent}
        />
        <p className="text-muted mt-3 text-xs">
          Şarkının kendi temposu değişmez; yalnız çalma hızı değişir.
        </p>
      </Sheet>

      {track ? (
        <TrackSheet
          tracks={song.tracks}
          selectedTrackId={track.id}
          onSelect={onSelectTrack}
          open={overlays.isOpen("track")}
          onClose={overlays.close}
          onManage={() => overlays.open("trackManage")}
        />
      ) : null}

      {/*
        The lifecycle sheets (2L-B). Mounted only while open, so each opening
        starts from a fresh draft — the draft is the sheet's own state, and a
        sheet that remembered a half-typed form from last week would be
        presenting stale intentions as current ones.
      */}
      {overlays.isOpen("newSong") ? (
        <NewSongSheet
          open
          onClose={overlays.close}
          onCreate={library.createFrom}
          createError={library.error}
          canCreate={library.canModify}
          onBackup={project.downloadBackup}
          backupError={project.exportError}
        />
      ) : null}
      {overlays.isOpen("songInfo") ? (
        <SongInfoSheet
          open
          onClose={overlays.close}
          song={song}
          lifecycle={lifecycle}
        />
      ) : null}
      {overlays.isOpen("sectionManage") ? (
        <SectionManagerSheet
          open
          onClose={overlays.close}
          song={song}
          activeSectionId={navigation.viewedSectionId}
          onOpenTiming={timing.open}
          lifecycle={lifecycle}
        />
      ) : null}
      {overlays.isOpen("mixer") ? (
        <MixerSheet
          open
          onClose={overlays.close}
          mixer={mixer}
          canPersist={canPersist}
        />
      ) : null}
      {overlays.isOpen("trackManage") ? (
        <TrackManagerSheet
          open
          onClose={overlays.close}
          song={song}
          selectedTrackId={track?.id ?? null}
          lifecycle={lifecycle}
        />
      ) : null}

      {noteEditing.editing && fretboard && track ? (
        <FretSheet
          key={`${noteEditing.cell?.barKey}:${noteEditing.cell?.slotIndex}:${noteEditing.cell?.stringIndex}:${noteEditing.currentFret}:${noteEditing.currentArticulation}`}
          open={noteEditing.cell !== null && !previewOpen}
          fretboard={fretboard}
          target={noteEditing.fretTarget}
          error={noteEditing.editError}
          onClose={noteEditing.closeCell}
          onNudge={noteEditing.nudge}
          onArticulation={(articulation) =>
            noteEditing.runCommand((target) => ({
              kind: "set_articulation",
              target,
              stringIndex: noteEditing.cell?.stringIndex ?? 0,
              articulation,
            }))
          }
          onCommit={(fret) =>
            noteEditing.runCommand((target) => ({
              kind: "set_note",
              target,
              stringIndex: noteEditing.cell?.stringIndex ?? 0,
              fret,
            }))
          }
          onClearString={() =>
            noteEditing.runCommand((target) => ({
              kind: "clear_string",
              target,
              stringIndex: noteEditing.cell?.stringIndex ?? 0,
            }))
          }
          onRest={() =>
            noteEditing.runCommand((target) => ({ kind: "set_rest", target }))
          }
          onTie={() =>
            noteEditing.runCommand((target) => ({ kind: "set_tie", target }))
          }
          /*
           * The two doors onto the chord builder, from the cell the reader is
           * already standing on. Which of them is offered says out loud what
           * will happen: an empty vurus gets written, an occupied one gets
           * stood in for.
           */
          onChord={(power) => {
            const cell = noteEditing.cell;
            if (!cell || !track) return;
            const [sectionId, barIndexText] = cell.barKey.split(":");
            const barIndex = Number(barIndexText);
            if (!sectionId || !Number.isInteger(barIndex)) return;
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
            // The door the reader pressed already answered the first step,
            // so the sheet opens on the root grid rather than asking again.
            chords.chooseType(power);
          }}
        />
      ) : null}

      {/*
        The note sheet. Keyed by the moment it is asking about, so moving to
        another one starts the fields from that moment rather than leaving the
        last answer behind.
      */}
      {entry.noteTarget && track && !previewOpen ? (
        <NoteEntrySheet
          key={`${entry.noteTarget.ticks}:${entry.noteTarget.pitches.join(",")}`}
          open
          target={entry.noteTarget}
          error={entry.entryError}
          onClose={entry.closeNote}
          onWrite={(pitch, options) =>
            entry.writePitchedNote(
              { sectionId: navigation.viewedSectionId, trackId: track.id, ticks: entry.noteTarget!.ticks },
              { pitch },
              options,
            )
          }
          onRemove={() =>
            entry.erasePitchedNote({
              sectionId: navigation.viewedSectionId,
              trackId: track.id,
              ticks: entry.noteTarget!.ticks,
            })
          }
          onPreview={(pitch) => onNoteAudition(pitch, NOTE_PREVIEW_VELOCITY)}
          /*
           * The same builder the tab opens, on the same moment. What changes
           * is only what a shape *is* for this instrument: a stack of pitches
           * rather than a fingering, which the voicing search already knew
           * how to answer (2O-B) and had no door onto until now.
           */
          onChord={() => {
            const moment = entry.noteTarget;
            if (!moment) return;
            const chordTarget = chordTargetAt(song, {
              sectionId: navigation.viewedSectionId,
              trackId: track.id,
              barIndex: moment.barIndex,
              slotIndex: moment.slotIndex,
              barNumber: moment.barNumber,
              octave: moment.octave,
            });
            if (!chordTarget) return;
            entry.closeNote();
            chords.open(chordTarget);
            // A fretless instrument has no power-chord shape to offer first.
            chords.chooseType(false);
          }}
        />
      ) : null}

      <ChordBuilderSheet
        builder={chords}
        capo={fretboard?.capo ?? 0}
        audible={
          track === undefined
            ? false
            : isPlayablePreset(track.instrumentId, track.presetId)
        }
        onAudition={onAudition}
      />

      <ArrangeSheet
        open={arrangeOpen}
        song={song}
        form={form}
        onChange={setForm}
        onClose={copilot.close}
        submitting={copilot.state.status === "submitting"}
        demo={copilot.demo}
        error={copilot.state.error?.message ?? null}
        onSubmit={() =>
          copilot.submit({
            operation: "arrange_track",
            skill: form.skill,
            sectionId: form.sectionId,
            targetTrackId: form.targetTrackId,
            ...(form.styleId ? { styleId: form.styleId } : {}),
            ...(form.instruction.trim()
              ? { instruction: form.instruction.trim() }
              : {}),
          })
        }
      />

      <PreviewSheet
        open={previewOpen}
        status={copilot.state.status}
        source={copilot.state.source}
        diff={copilot.state.diff}
        warnings={copilot.state.warnings}
        error={copilot.state.error?.message ?? null}
        stale={copilot.isStaleNow}
        onPlay={copilot.play}
        onStop={copilot.stop}
        onApply={copilot.apply}
        onReject={copilot.close}
      />

      <TimingSheet timing={timing} />

      <SectionSheet
        runs={runs}
        activeSectionId={navigation.viewedSectionId}
        open={overlays.isOpen("section")}
        onJump={onChooseSection}
        onClose={overlays.close}
        onManage={() => overlays.open("sectionManage")}
      />

      <ExportSheet
        open={overlays.isOpen("export")}
        onClose={overlays.close}
        handle={exporter}
        canPersist={canPersist}
      />

      <ProjectFileSheet
        open={overlays.isOpen("project")}
        onClose={overlays.close}
        handle={project}
        canPersist={canPersist}
        onAddAsNew={(imported) => {
          if (library.importAsNew(imported)) {
            project.cancel();
            overlays.close();
          }
        }}
      />

      {/*
        The library, and the confirmation that stands in front of a deletion.
        Two sheets rather than one, so the confirmation cannot disappear with
        the row that opened it.
      */}
      {library.isOpen ? (
        <ProjectLibrarySheet
          library={library}
          templates={SONG_TEMPLATES}
          onNew={(templateId) => library.createFrom(templateId)}
          onImport={() => {
            library.close();
            overlays.open("project");
          }}
          onBackup={(projectId) => project.downloadProject(library.songOf(projectId))}
          now={library.openedAt}
        />
      ) : null}

      <ProjectDeleteSheet
        target={library.pendingDelete}
        onBackup={() =>
          project.downloadProject(
            library.pendingDelete ? library.songOf(library.pendingDelete.id) : null,
          )
        }
        onCancel={library.cancelDelete}
        onDelete={library.confirmDelete}
      />

      <InfoSheet
        open={overlays.isOpen("info")}
        onClose={overlays.close}
        onProjectBackup={project.downloadBackup}
        onExport={() => overlays.open("export")}
        projectBackupError={project.exportError}
        onOpenProjectFile={() => overlays.open("project")}
        onNewSong={() => overlays.open("newSong")}
        onSongInfo={() => overlays.open("songInfo")}
        onProjects={library.open}
      />
    </>
  );
}
