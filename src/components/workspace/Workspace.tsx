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
import { buildArrangementModel } from "@/lib/arrangement/model";
import { usePlayback } from "@/lib/audio/use-playback";
import { useDebugHandle } from "@/lib/audio/use-debug-handle";
import { availableSkills } from "@/lib/copilot/ui-options";
import { useCoArranger } from "@/lib/copilot/use-co-arranger";
import { formatTimeSignature } from "@/lib/music/timing";
import { useProjectFile } from "@/lib/project/use-project-file";
import { useSong } from "@/lib/song/use-song";
import { useSettings } from "@/lib/settings/use-settings";
import { buildTrackTimeline, sectionRuns } from "@/lib/tab/timeline";
import { useEditShortcuts } from "@/lib/ui/use-edit-shortcuts";
import { editGate } from "@/lib/workspace/edit-gate";
import { useLifecycle } from "@/lib/workspace/use-lifecycle";
import { useMixer } from "@/lib/workspace/use-mixer";
import { useNoteEditing } from "@/lib/workspace/use-note-editing";
import { useSelectionSession } from "@/lib/workspace/use-selection-session";
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

  const timeline = useMemo(
    () => buildTrackTimeline(song, track?.id ?? ""),
    [song, track?.id],
  );
  const runs = useMemo(() => sectionRuns(song), [song]);

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

  /* ---------------------------------------------------------------- mixer */

  const mixerAudio = useMemo(
    () => ({
      previewMix: controller.setTrackMix.bind(controller),
      clearPreview: controller.clearTrackMixPreview.bind(controller),
      setAudibility: controller.setTrackAudibility.bind(controller),
    }),
    [controller],
  );
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

  /* ------------------------------------------------------- undo and redo */

  const resetSelections = session.resetAll;
  const resetNoteEditing = noteEditing.reset;
  /* Stable member, like `closeCopilot`: the handle itself is rebuilt each
     render, and depending on it would rebuild every callback that grounds. */
  const clearAudition = mixer.clearAudition;

  /**
   * Put every editing surface down before the song moves under it.
   *
   * A selection is a range of ticks or bars in the song as it stands, a ghost
   * is a command staged against it, and a Copilot candidate was measured
   * against the song as it was when it was asked for. After an undo none of
   * those describe anything. The clipboards stay: someone who copied a bar,
   * undid an unrelated edit and came back would rightly expect them.
   */
  const resetEditSurfaces = useCallback(() => {
    resetSelections();
    resetNoteEditing();
    // Disposes the preview engine as well as closing the sheet, so no second
    // graph is left playing a candidate that is no longer on the table.
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

  /* ------------------------------------------------------- project file */

  /**
   * The ground a project lands on (spec 13.15).
   *
   * Opening a project replaces the whole song, so everything measured against
   * the old one goes first: playback pauses, the loop is dropped *before* the
   * rewind (a rewind with a loop on seeks to the loop, not the top), and the
   * playhead goes to the start. Unlike an undo, the clipboards go too — a
   * clipboard cut from a song that has been wholly replaced would paste
   * another song's music.
   */
  const prepareForProjectApply = useCallback(() => {
    controller.pause();
    controller.setLoopSection(null);
    controller.rewind();
    resetEditSurfaces();
    session.clearClipboards();
    noteEditing.exitEditMode();
    navigation.resetForNewSong();
    // Different music: nothing carried over about who was being listened to.
    clearAudition();
  }, [clearAudition, controller, navigation, noteEditing, resetEditSurfaces, session]);

  const project = useProjectFile({
    song,
    canPersist,
    commit,
    onBeforeApply: prepareForProjectApply,
    onApplied: overlays.close,
  });

  /* ----------------------------------------------------------- the gates */

  const toggleLoop = useCallback(() => {
    const current =
      navigation.activeSectionId ?? runs[0]?.sectionId ?? null;
    controller.setLoopSection(state.loopSectionId ? null : current);
  }, [controller, navigation.activeSectionId, runs, state.loopSectionId]);

  const { canEdit, editDisabledReason } = editGate({
    track,
    previewOpen,
    canPersist,
  });

  /** A track change costs the edit session; composed here, owned there. */
  const selectTrack = useCallback(
    (trackId: string) => {
      noteEditing.stopForTrackChange();
      // A selection belongs to one track and one section (2I-A V1), so it
      // cannot survive a change of either.
      session.time.clear();
      navigation.selectTrack(trackId);
    },
    [navigation, noteEditing, session.time],
  );

  const openCopilot = useCallback(() => {
    pause();
    noteEditing.stopForTrackChange();
    copilot.open();
  }, [copilot, noteEditing, pause]);

  /* ------------------------------------------------------------ lifecycle */

  /**
   * The structural ground (2L-B §6/§7): pause, then selections, ghosts, staged
   * commands, clipboards and the bar focus — everything measured against a
   * shape about to change. Loop and playhead are not touched: the engine
   * re-derives both from the committed song, on undo/redo's own path.
   */
  const prepareForStructuralApply = useCallback(() => {
    pause();
    resetEditSurfaces();
    session.clearClipboards();
    navigation.dropBarFocus();
  }, [navigation, pause, resetEditSurfaces, session]);

  const focusSection = useCallback(
    (sectionId: string) => navigation.setActiveBarKey(`${sectionId}:0`),
    [navigation],
  );

  const lifecycle = useLifecycle({
    song,
    canPersist,
    commit,
    onBeforeNewSong: prepareForProjectApply,
    onBeforeStructural: prepareForStructuralApply,
    activeSectionId: navigation.activeSectionId,
    selectedTrackId: track?.id ?? null,
    setActiveSection: focusSection,
    selectTrack,
  });

  /* -------------------------------------------------------------- models */

  const arrangement = useMemo(() => buildArrangementModel(song), [song]);

  /**
   * The arrangement a staged command would leave behind: the ghost song,
   * built and thrown away with the preview. Nothing here reaches the store,
   * the history or the playback plan.
   */
  const ghostArrangement = useMemo(
    () =>
      session.bars.handle.previewSong
        ? buildArrangementModel(session.bars.handle.previewSong)
        : null,
    [session.bars.handle.previewSong],
  );

  const firstBar = song.sections[0]?.bars[0];
  const meter = firstBar ? formatTimeSignature(firstBar.timeSignature) : "";

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
          if (next === "arrange") {
            /*
             * A time selection belongs to the tab: it is a span of time on
             * one track, drawn on a staff that is about to be unmounted.
             * It goes — without committing whatever it had staged. The
             * clipboards and the history stay; they belong to the song.
             */
            session.time.clear();
            navigation.showArrange();
          } else {
            navigation.showTab();
          }
        }}
      />

      {/* Only on the tab: the arrangement already draws every section with
          its own header, bar count and tempo. */}
      {navigation.view === "tab" ? (
        <SectionNavigator
          runs={runs}
          activeSectionId={navigation.activeSectionId}
          loopSectionId={state.loopSectionId}
          onJump={navigation.jumpToSection}
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
        plan={plan}
        getPosition={getPosition}
        running={state.status === "playing"}
        canPersist={canPersist}
        copilotOwnsScreen={previewOpen || arrangeOpen}
      />

      <SelectionActionArea session={session} />

      {navigation.view === "tab" ? (
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
        canToggleEdit={navigation.view === "tab"}
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
        copilot={copilot}
        copilotSkills={skills}
        previewOpen={previewOpen}
        arrangeOpen={arrangeOpen}
        project={project}
        lifecycle={lifecycle}
        mixer={mixer}
        canPersist={canPersist}
        songBpm={state.songBpm}
        practicePercent={state.practicePercent}
        onPracticePercent={setPracticeRatePercent}
        onSelectTrack={selectTrack}
      />
    </div>
  );
}
