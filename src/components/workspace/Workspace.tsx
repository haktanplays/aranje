"use client";

/**
 * The composition root (2L-R).
 *
 * Workspace calls the stores and the main controllers, hands each surface its
 * typed view-model and handler groups, chooses between the tab and the
 * arrangement, and composes the sheets. It carries no domain algorithm, no
 * browser file API, no storage access and no history internals — those live
 * with their owners:
 *
 * - navigation (view, track, bar focus, scroll targets)  → use-workspace-navigation
 * - selections, clipboards, staged commands, their sheets → use-selection-session
 * - edit mode, the selected cell, the onset group         → use-note-editing
 * - which top-level sheet is open                         → use-workspace-overlays
 * - project backup/import                                 → use-project-file
 * - the Copilot request/preview machine                   → use-co-arranger
 *
 * What remains here is exactly the glue that needs more than one owner at
 * once: undo/redo grounding, the project-apply ground, the Copilot gates,
 * and the layout.
 */
import { useMemo } from "react";

import { WorkspaceShelf } from "@/components/workspace/WorkspaceShelf";
import { TransportBar } from "@/components/workspace/TransportBar";
import { WorkspaceOverlays } from "@/components/workspace/WorkspaceOverlays";
import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import { WorkspaceSurface } from "@/components/workspace/WorkspaceSurface";
import { usePlayback } from "@/lib/audio/use-playback";
import { useDebugHandle } from "@/lib/audio/use-debug-handle";
import { editorSelectionProbe } from "@/lib/workspace/editor-selection-probe";
import { availableSkills } from "@/lib/copilot/ui-options";
import { copilotGates } from "@/lib/copilot/gates";
import { useCoArranger } from "@/lib/copilot/use-co-arranger";
import { useSong } from "@/lib/song/use-song";
import { useSessionGround } from "@/lib/workspace/use-session-ground";
import { useTimingChange } from "@/lib/workspace/use-timing-change";
import { useSettings } from "@/lib/settings/use-settings";
import { editGate } from "@/lib/workspace/edit-gate";
import { useArrangementModels } from "@/lib/workspace/use-arrangement-models";
import { useLifecycle } from "@/lib/workspace/use-lifecycle";
import { mixerAudioOf } from "@/lib/workspace/mixer-audio";
import { useEventEntry } from "@/lib/workspace/use-event-entry";
import { useCoveredRun } from "@/lib/workspace/use-covered-run";
import { useTransportHandles } from "@/lib/workspace/use-transport-handles";
import { usePracticeSession } from "@/lib/workspace/use-practice-session";
import { useMultiTrackView } from "@/lib/workspace/use-multitrack-session";
import { useSelectTrack } from "@/lib/workspace/use-select-track";
import { useMixer } from "@/lib/workspace/use-mixer";
import { useComposerDoors } from "@/lib/workspace/use-composer-doors";
import { useIntentComposer, withPen } from "@/lib/workspace/use-intent-composer";
import { useNoteEditing } from "@/lib/workspace/use-note-editing";
import { useWorkspaceFiles } from "@/lib/workspace/use-workspace-files";
import { useSelectionSession } from "@/lib/workspace/use-selection-session";
import { useTabView } from "@/lib/workspace/use-tab-view";
import { useWorkspaceNavigation } from "@/lib/workspace/use-workspace-navigation";
import { useWorkspaceOverlays } from "@/lib/workspace/use-workspace-overlays";

export function Workspace() {
  const {
    song,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    recovery,
    recoveryMessage,
    canPersist,
    commit,
    undo,
    redo,
    dismissRecovery,
  } = useSong();
  const { practiceRatePercent, setPracticeRatePercent } = useSettings();
  const { controller, state } = usePlayback(song, practiceRatePercent);

  const { pause, seek, getPosition } = useTransportHandles(controller, practiceRatePercent);

  /* ------------------------------------------------------ the controllers */

  const navigation = useWorkspaceNavigation({ song, seek });
  const track = navigation.track;
  const practice = usePracticeSession({
    song,
    controller,
    practicePercent: practiceRatePercent,
    viewedSectionId: navigation.viewedSectionId,
    activeBarKey: navigation.activeBarKey,
  });

  const tab = useTabView({ song, track, canPersist, commit, pause });
  const { chords, timeline, runs } = tab;

  const noteEditing = useNoteEditing({ song, track, timeline, commit, pause });

  /*
   * The intent layer (2S-A §6). It holds one tool, and the surface asks it
   * what a touch means before falling back to what a touch has always meant.
   */
  const composer = useIntentComposer({
    song,
    track,
    sectionId: navigation.viewedSectionId,
    commit,
  });

  const editingSurface = withPen(noteEditing, composer);

  const session = useSelectionSession({
    song,
    track,
    timeline,
    commit,
    pause,
    scrollRef: navigation.scrollRef,
    editing: noteEditing.editing,
    onApplied: (structural) =>
      structural ? navigation.dropBarFocus() : navigation.clearPendingScroll(),
  });

  const overlays = useWorkspaceOverlays();

  /* How a bar is counted, reachable from the bar sheet and from section
     management — one sheet, two doors (spec 13.20 §6). */
  const timing = useTimingChange({ getSnapshot: () => ({ song }), commit }, song);

  /* ---------------------------------------------------------------- mixer */

  const doors = useComposerDoors({
    song,
    track,
    noteEditing,
    chords,
    timing,
    viewedSectionId: navigation.viewedSectionId,
  });

  const mixerAudio = useMemo(() => mixerAudioOf(controller), [controller]);
  const mixer = useMixer({ song, canPersist, commit, audio: mixerAudio });

  const copilot = useCoArranger(song, {
    onApply: (candidate, skill) => commit(candidate, { kind: "copilot_apply", skill }),
    onBeforePreviewPlay: pause,
    practicePercent: state.practicePercent,
  });
  /*
   * Pulled out so the undo path can depend on it. `copilot` is rebuilt every
   * render, so a callback depending on the whole handle would be rebuilt too —
   * and the keyboard listener behind it resubscribed on every keystroke.
   */
  const closeCopilot = copilot.close;
  const { previewOpen, arrangeOpen } = copilotGates(copilot.state.status);

  const skills = useMemo(() => availableSkills(song), [song]);

  /* ------------------------------------------------- grounding the session */

  /*
   * Undo, a new project, a structural command and a section change all leave
   * the same things behind, and they differ only in how far they go. That
   * difference is one module's job rather than four call sites' (2N-A §6).
   */
  const ground = useSessionGround({
    session,
    noteEditing,
    navigation,
    closeCopilot,
    openCopilot: copilot.open,
    clearAudition: mixer.clearAudition,
    pause,
    transport: controller,
    canUndo,
    canRedo,
    undo,
    redo,
    composer,
    overlays,
    setPracticePercent: setPracticeRatePercent,
  });
  const { undoEdit, redoEdit, focusSection } = ground;

  /* ------------------------------------- backups, exports and the library */

  /* Three owners that all move a whole song, and all stand on one ground. */
  const { project, exporter, library } = useWorkspaceFiles({
    song,
    canPersist,
    commit,
    audibleTrackIds: mixer.audibleTrackIds,
    pausePlayback: pause,
    onBeforeApply: ground.prepareForProjectApply,
    onApplied: overlays.close,
  });

  /* Writing a hit or a note on an instrument the tab cannot draw (2Q-B). */
  const entry = useEventEntry({
    song,
    track: track ?? null,
    sectionId: navigation.viewedSectionId,
    commit,
    pause,
  });

  /* Every instrument of the whole song, and what this sitting folded. */
  const multi = useMultiTrackView({
    song,
    activeTrackId: track?.id ?? "",
    projectId: library.activeProjectId,
  });

  /* ----------------------------------------------------------- the gates */

  const { canEdit, editDisabledReason } = editGate({
    track,
    previewOpen,
    canPersist,
  });

  const selectTrack = useSelectTrack({
    stopEditing: noteEditing.stopForTrackChange,
    clearTimeSelection: session.time.clear,
    setTrack: navigation.selectTrack,
  });

  /* ------------------------------------------------------------ lifecycle */

  const lifecycle = useLifecycle({
    song,
    canPersist,
    commit,
    onBeforeStructural: ground.prepareForStructuralApply,
    activeSectionId: navigation.viewedSectionId,
    selectedTrackId: track?.id ?? null,
    setActiveSection: focusSection,
    selectTrack,
  });

  /* -------------------------------------------------------------- models */

  const { arrangement, ghostArrangement, meter } = useArrangementModels({
    song,
    previewSong: session.bars.handle.previewSong,
  });

  /* What a covered run says, offers and lets you hear (K-59 §3, 2V-A §3). */
  const { covered, listening } = useCoveredRun({
    song,
    controller,
    session,
    editing: noteEditing.editing,
    /* Reading counts too (2V-B §1); the Copilot's screens still do not. */
    listenable: canPersist && !previewOpen && !arrangeOpen,
  });
  /* Reading only, and only on `/eval/` (spec 8.4/8.5, 2V-B.2c §4). */
  useDebugHandle(controller, () => editorSelectionProbe(session, song));
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <WorkspaceChrome
        song={song}
        meter={meter}
        state={state}
        navigation={navigation}
        session={session}
        runs={runs}
        recovery={recovery}
        recoveryMessage={recoveryMessage}
        onDismissRecovery={dismissRecovery}
        onInfo={() => overlays.open("info")}
        onProjects={library.open}
        onOpenSectionList={() => overlays.open("section")}
        onJumpSection={focusSection}
        editing={noteEditing.editing}
        editSelection={covered?.header ?? null}
        onDoneEditing={noteEditing.toggleEdit}
      />

      <div className="workspace-body">
      <WorkspaceSurface
        navigation={navigation}
        session={session}
        noteEditing={editingSurface}
        composer={composer}
        song={song}
        arrangement={arrangement}
        ghostArrangement={ghostArrangement}
        tab={tab}
        multi={multi}
        entry={entry}
        onSelectTrack={selectTrack}
        getPosition={getPosition}
        running={state.status === "playing"}
        canPersist={canPersist}
        copilotOwnsScreen={previewOpen || arrangeOpen}
      />

      <WorkspaceShelf
        session={session}
        song={song}
        listening={listening}
        practice={practice}
        covered={covered}
        onOpenTiming={timing.open}
        view={navigation.view}
        zoom={navigation.zoom}
        track={track}
        onOpenTrack={() => overlays.open("track")}
        composer={composer}
        noteEditing={noteEditing}
        onOpenChordBuilder={doors.catalogue}
        onOpenRhythm={doors.rhythm}
        intent={tab.intent}
        toolbar={{
          editing: noteEditing.editing,
          canEdit,
          editDisabledReason,
          onToggleEdit: noteEditing.toggleEdit,
          onArrange: ground.enterCopilot,
          arrangeDisabled: skills.length === 0 || previewOpen || !canPersist,
          canUndo,
          canRedo,
          undoLabel,
          redoLabel,
          onUndo: undoEdit,
          onRedo: redoEdit,
          // Both notation surfaces; the arrangement has no staff (2Q-A §8).
          canToggleEdit: navigation.view !== "arrange",
        }}
      />
      </div>

      <TransportBar
        state={state}
        runs={runs}
        onPlayPause={() => controller.toggle()}
        onRewind={() => controller.rewind()}
        practice={practice}
        onToggleMetronome={() => controller.setMetronome(!state.metronome)}
        onOpenMixer={() => {
          mixer.begin();
          overlays.open("mixer");
        }}
        auditioning={mixer.auditioning}
        onOpenPracticeRate={() => overlays.open("practice")}
      />

      <WorkspaceOverlays
        song={song}
        runs={runs}
        overlays={overlays}
        navigation={navigation}
        noteEditing={editingSurface}
        entry={entry}
        onNoteAudition={tab.audition.note}
        chords={chords}
        onAudition={tab.audition.voicing}
        copilot={copilot}
        copilotSkills={skills}
        previewOpen={previewOpen}
        arrangeOpen={arrangeOpen}
        project={project}
        lifecycle={lifecycle}
        mixer={mixer}
        practice={practice}
        exporter={exporter}
        library={library}
        canPersist={canPersist}
        songBpm={state.songBpm}
        practicePercent={state.practicePercent}
        onPracticePercent={setPracticeRatePercent}
        onSelectTrack={selectTrack}
        onChooseSection={focusSection}
        timing={timing}
      />
    </div>
  );
}
