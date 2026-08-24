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
import { useCallback, useEffect, useMemo } from "react";

import { EditToolbar } from "@/components/workspace/EditToolbar";
import { RecoveryBanner } from "@/components/workspace/RecoveryBanner";
import { SectionNavigator } from "@/components/workspace/SectionNavigator";
import { SelectionActionArea } from "@/components/workspace/SelectionActionArea";
import { SelectionBar } from "@/components/workspace/SelectionBar";
import { TrackControl } from "@/components/workspace/TrackControl";
import { TransportBar } from "@/components/workspace/TransportBar";
import { ViewSwitch } from "@/components/workspace/ViewSwitch";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceOverlays } from "@/components/workspace/WorkspaceOverlays";
import { WorkspaceSurface } from "@/components/workspace/WorkspaceSurface";
import { usePlayback } from "@/lib/audio/use-playback";
import { useDebugHandle } from "@/lib/audio/use-debug-handle";
import { availableSkills } from "@/lib/copilot/ui-options";
import { useCoArranger } from "@/lib/copilot/use-co-arranger";
import { useSong } from "@/lib/song/use-song";
import { useSessionGround } from "@/lib/workspace/use-session-ground";
import { useTimingChange } from "@/lib/workspace/use-timing-change";
import { useSettings } from "@/lib/settings/use-settings";
import { editGate } from "@/lib/workspace/edit-gate";
import { useArrangementModels } from "@/lib/workspace/use-arrangement-models";
import { useLifecycle } from "@/lib/workspace/use-lifecycle";
import { mixerAudioOf } from "@/lib/workspace/mixer-audio";
import { useMultiTrackView } from "@/lib/workspace/use-multitrack-session";
import { useSelectTrack } from "@/lib/workspace/use-select-track";
import { useMixer } from "@/lib/workspace/use-mixer";
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
  useDebugHandle(controller);

  // The setting is the source of truth; the controller is the audio system it
  // is applied to. Retuning a running transport is not a re-render, and it
  // never rebuilds the engine or reschedules an event (spec 13.8).
  useEffect(() => {
    controller.setPracticePercent(practiceRatePercent);
  }, [controller, practiceRatePercent]);

  const pause = useCallback(() => controller.pause(), [controller]);
  const seek = useCallback(
    (barKey: string) => controller.seekToBar(barKey),
    [controller],
  );
  const getPosition = useCallback(() => controller.getPosition(), [controller]);

  /* ------------------------------------------------------ the controllers */

  const navigation = useWorkspaceNavigation({ song, seek });
  const track = navigation.track;

  const tab = useTabView({ song, track, canPersist, commit, pause });
  const { chords, timeline, runs } = tab;

  const noteEditing = useNoteEditing({ song, track, timeline, commit, pause });

  const session = useSelectionSession({
    song,
    track,
    timeline,
    commit,
    pause,
    scrollRef: navigation.scrollRef,
    onApplied: (structural) =>
      structural ? navigation.dropBarFocus() : navigation.clearPendingScroll(),
  });

  const overlays = useWorkspaceOverlays();

  /* How a bar is counted, reachable from the bar sheet and from section
     management — one sheet, two doors (spec 13.20 §6). */
  const timing = useTimingChange({ getSnapshot: () => ({ song }), commit }, song);

  /* ---------------------------------------------------------------- mixer */

  const mixerAudio = useMemo(() => mixerAudioOf(controller), [controller]);
  const mixer = useMixer({ song, canPersist, commit, audio: mixerAudio });

  const copilot = useCoArranger(song, {
    onApply: (candidate, skill) => commit(candidate, { kind: "copilot_apply", skill }),
    onBeforePreviewPlay: pause,
    practicePercent: state.practicePercent,
  });
  /*
   * Pulled out so the undo path can depend on it.
   *
   * `copilot` is rebuilt every render, so a callback depending on the whole
   * handle would be rebuilt too — and the keyboard listener behind it
   * resubscribed on every keystroke, scroll and animation frame.
   */
  const closeCopilot = copilot.close;
  const previewOpen =
    copilot.state.status === "preview_ready" ||
    copilot.state.status === "preview_playing" ||
    copilot.state.status === "applying";
  const arrangeOpen =
    copilot.state.status === "editing_request" ||
    copilot.state.status === "submitting" ||
    copilot.state.status === "error";

  const skills = useMemo(() => availableSkills(song), [song]);
  const plan = controller.getPlan();

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
    clearAudition: mixer.clearAudition,
    pause,
    transport: controller,
    canUndo,
    canRedo,
    undo,
    redo,
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

  /* Every instrument of the viewed section, and what this sitting folded. */
  const multi = useMultiTrackView({
    song,
    viewedSectionId: navigation.viewedSectionId,
    activeTrackId: track?.id ?? "",
    projectId: library.activeProjectId,
  });

  /* ----------------------------------------------------------- the gates */

  const toggleLoop = useCallback(() => {
    // The loop belongs to the section being *read*, not to wherever the
    // transport is. That id is always a real section, so there is no fallback.
    controller.setLoopSection(state.loopSectionId ? null : navigation.viewedSectionId);
  }, [controller, navigation.viewedSectionId, state.loopSectionId]);

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

  const openCopilot = useCallback(() => {
    pause();
    noteEditing.stopForTrackChange();
    copilot.open();
  }, [copilot, noteEditing, pause]);

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

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <WorkspaceHeader
        title={song.title}
        songKey={song.key}
        bpm={song.bpm}
        meter={meter}
        activeBpm={state.activeBpm}
        hasTempoChanges={state.hasTempoChanges}
        onInfo={() => overlays.open("info")}
        onProjects={library.open}
      />

      {/* One strip, and the recovery state owns it: four states, four
          sentences, and no path from a diagnostic to a musician. */}
      {recovery && recoveryMessage ? (
        <RecoveryBanner
          state={recovery}
          message={recoveryMessage}
          onDismiss={dismissRecovery}
        />
      ) : null}

      <ViewSwitch
        view={navigation.view}
        onChange={(next) => {
          /*
           * A time selection belongs to the tab: it is a span of time on one
           * track, drawn on a staff that is about to be unmounted. Leaving
           * for either of the other two surfaces drops it — without
           * committing whatever it had staged. The clipboards and the history
           * stay; they belong to the song.
           */
          if (next !== "tab") session.time.clear();
          if (next === "arrange") navigation.showArrange();
          else if (next === "multi") navigation.showMulti();
          else navigation.showTab();
        }}
      />

      {/* Not on the arrangement: it draws every section already (2Q-A §6). */}
      {navigation.view !== "arrange" ? (
        <SectionNavigator
          runs={runs}
          activeSectionId={navigation.viewedSectionId}
          loopSectionId={state.loopSectionId}
          onJump={focusSection}
          onOpenList={() => overlays.open("section")}
        />
      ) : null}

      <WorkspaceSurface
        navigation={navigation}
        session={session}
        noteEditing={noteEditing}
        arrangement={arrangement}
        ghostArrangement={ghostArrangement}
        timeline={timeline}
        multi={multi}
        onSelectTrack={selectTrack}
        plan={plan}
        getPosition={getPosition}
        running={state.status === "playing"}
        canPersist={canPersist}
        copilotOwnsScreen={previewOpen || arrangeOpen}
      />

      <SelectionActionArea session={session} onOpenTiming={timing.open} />

      {/* Both notation surfaces; the multi view needs this door too (§8). */}
      {navigation.view !== "arrange" ? (
        <TrackControl track={track} onOpen={() => overlays.open("track")} />
      ) : null}

      {noteEditing.editing ? (
        <SelectionBar
          count={noteEditing.group.selection?.refs.length ?? 0}
          error={noteEditing.group.moveError}
          onMove={noteEditing.group.move}
          onClear={noteEditing.group.clear}
        />
      ) : null}

      <EditToolbar
        editing={noteEditing.editing}
        canEdit={canEdit}
        editDisabledReason={editDisabledReason}
        onToggleEdit={noteEditing.toggleEdit}
        onArrange={openCopilot}
        arrangeDisabled={skills.length === 0 || previewOpen || !canPersist}
        canUndo={canUndo}
        canRedo={canRedo}
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        onUndo={undoEdit}
        onRedo={redoEdit}
        // Both notation surfaces; the arrangement has no staff (2Q-A §8).
        canToggleEdit={navigation.view !== "arrange"}
      />

      <TransportBar
        state={state}
        runs={runs}
        onPlayPause={() => controller.toggle()}
        onRewind={() => controller.rewind()}
        onToggleLoop={toggleLoop}
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
        noteEditing={noteEditing}
        chords={chords}
        onAudition={tab.audition}
        copilot={copilot}
        copilotSkills={skills}
        previewOpen={previewOpen}
        arrangeOpen={arrangeOpen}
        project={project}
        lifecycle={lifecycle}
        mixer={mixer}
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
