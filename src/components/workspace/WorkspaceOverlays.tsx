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
import { InfoSheet } from "@/components/workspace/InfoSheet";
import { MixerSheet } from "@/components/workspace/MixerSheet";
import { NewSongSheet } from "@/components/workspace/NewSongSheet";
import { PracticeRateControl } from "@/components/workspace/PracticeRateControl";
import { PreviewSheet } from "@/components/workspace/PreviewSheet";
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
import type { ProjectFileHandle } from "@/lib/project/use-project-file";
import type { Song } from "@/lib/song/schema";
import type { SectionRun } from "@/lib/tab/timeline";
import type { LifecycleHandle } from "@/lib/workspace/use-lifecycle";
import type { MixerHandle } from "@/lib/workspace/use-mixer";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { WorkspaceNavigation } from "@/lib/workspace/use-workspace-navigation";
import type { WorkspaceOverlayState } from "@/lib/workspace/use-workspace-overlays";

export function WorkspaceOverlays({
  song,
  runs,
  overlays,
  navigation,
  noteEditing,
  copilot,
  copilotSkills,
  previewOpen,
  arrangeOpen,
  project,
  lifecycle,
  mixer,
  canPersist,
  songBpm,
  practicePercent,
  onPracticePercent,
  onSelectTrack,
}: {
  song: Song;
  runs: readonly SectionRun[];
  overlays: WorkspaceOverlayState;
  navigation: WorkspaceNavigation;
  noteEditing: NoteEditing;
  copilot: CoArrangerHandle;
  copilotSkills: readonly ArrangeSkill[];
  previewOpen: boolean;
  arrangeOpen: boolean;
  project: ProjectFileHandle;
  lifecycle: LifecycleHandle;
  mixer: MixerHandle;
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
          lifecycle={lifecycle}
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
          activeSectionId={navigation.activeSectionId}
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
        />
      ) : null}

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

      <SectionSheet
        runs={runs}
        activeSectionId={navigation.activeSectionId}
        open={overlays.isOpen("section")}
        onJump={navigation.jumpToSection}
        onClose={overlays.close}
        onManage={() => overlays.open("sectionManage")}
      />

      <ProjectFileSheet
        open={overlays.isOpen("project")}
        onClose={overlays.close}
        handle={project}
        canPersist={canPersist}
      />

      <InfoSheet
        open={overlays.isOpen("info")}
        onClose={overlays.close}
        onProjectBackup={project.downloadBackup}
        projectBackupError={project.exportError}
        onOpenProjectFile={() => overlays.open("project")}
        onNewSong={() => overlays.open("newSong")}
        onSongInfo={() => overlays.open("songInfo")}
      />
    </>
  );
}
