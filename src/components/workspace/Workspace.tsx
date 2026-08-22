"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrangeSheet, type ArrangeForm } from "@/components/workspace/ArrangeSheet";
import {
  ArrangementCanvas,
  type BarSelectEdge,
  type BarSelectRequest,
} from "@/components/workspace/ArrangementCanvas";
import {
  BarActionBar,
  type BarRepeatChoice,
} from "@/components/workspace/BarActionBar";
import { buildArrangementModel } from "@/lib/arrangement/model";
import { ViewSwitch, type WorkspaceView } from "@/components/workspace/ViewSwitch";
import { EditToolbar } from "@/components/workspace/EditToolbar";
import { FretSheet, type FretSheetTarget } from "@/components/workspace/FretSheet";
import { InfoSheet } from "@/components/workspace/InfoSheet";
import { PreviewSheet } from "@/components/workspace/PreviewSheet";
import { RecoveryBanner } from "@/components/workspace/RecoveryBanner";
import { PracticeRateControl } from "@/components/workspace/PracticeRateControl";
import { SectionNavigator } from "@/components/workspace/SectionNavigator";
import { Sheet } from "@/components/workspace/Sheet";
import { SectionSheet } from "@/components/workspace/SectionSheet";
import { SelectionBar } from "@/components/workspace/SelectionBar";
import { BAR_KEY_ATTRIBUTE, TabCanvas } from "@/components/workspace/TabCanvas";
import { TrackSheet, trackLine } from "@/components/workspace/TrackSheet";
import { TransportBar } from "@/components/workspace/TransportBar";
import { useDebugHandle } from "@/lib/audio/use-debug-handle";
import { useSettings } from "@/lib/settings/use-settings";
import { usePlayback } from "@/lib/audio/use-playback";
import { SelectionActionBar } from "@/components/workspace/SelectionActionBar";
import { TimeSelectionBand } from "@/components/workspace/TimeSelectionBand";
import {
  TransformSheet,
  type TransformSheetKind,
} from "@/components/workspace/TransformSheet";
import {
  bandInTimeline,
  slotAtX,
} from "@/components/workspace/selection-geometry";
import { useTransform } from "@/lib/song/use-transform";
import { useBarTransform } from "@/lib/song/use-bar-transform";
import {
  isStructuralBarCommand,
  type BarCommand,
} from "@/lib/song/bar-transform";
import { sameBarSelection, type BarSelection } from "@/lib/song/bar-selection";
import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  GUTTER_WIDTH,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import { sectionBarStartTicks } from "@/lib/song/onset-block";
import { ticksPerBar, ticksPerSlot, slotsPerNotatedBeat } from "@/lib/music/timing";
import { ProjectFileSheet } from "@/components/workspace/ProjectFileSheet";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { useProjectFile } from "@/lib/project/use-project-file";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { availableSkills, targetsFor } from "@/lib/copilot/ui-options";
import { useCoArranger } from "@/lib/copilot/use-co-arranger";
import { formatTimeSignature } from "@/lib/music/timing";
import { applyEdit, isEditableTrack, type EditCommand } from "@/lib/song/edit";
import { applyMoveOnsetGroup, type OnsetMovement } from "@/lib/song/move";
import {
  blockContaining,
  findSection,
  sectionOnsetBlocks,
  type OnsetRef,
} from "@/lib/song/onset-block";
import {
  chooseOnset,
  type SelectMode,
  type Selection,
} from "@/lib/song/selection";
import { useSong } from "@/lib/song/use-song";
import { useEditShortcuts } from "@/lib/ui/use-edit-shortcuts";
import { buildTrackTimeline, sectionRuns } from "@/lib/tab/timeline";
import { validateArticulationContext } from "@/lib/validators";

type Cell = { barKey: string; slotIndex: number; stringIndex: number };

/** One frozen empty set, so a bar with nothing in it does not allocate. */
const EMPTY_SLOTS: ReadonlySet<number> = new Set<number>();

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

  const firstTrackId = song.tracks[0]?.id ?? "";
  const [selectedTrackId, setSelectedTrackId] = useState(firstTrackId);
  const [activeBarKey, setActiveBarKey] = useState<string | null>(null);
  const [trackSheetOpen, setTrackSheetOpen] = useState(false);
  const [sectionSheetOpen, setSectionSheetOpen] = useState(false);
  const [practiceSheetOpen, setPracticeSheetOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  /*
   * Which surface is on screen (spec 13.10, K-39).
   *
   * "Düzen" opens first, because the first question about a song someone has
   * not seen before is what shape it is, not what the third bar of the first
   * guitar looks like. This is a view preference and lives only here: it is
   * never written to the Song, never reaches the fingerprint, and never enters
   * a Copilot request — none of those are about what the reader is looking at.
   */
  const [view, setView] = useState<WorkspaceView>("arrange");
  /** A bar the tab has to scroll to once it is actually mounted. */
  const [pendingTabBar, setPendingTabBar] = useState<string | null>(null);
  const arrangeScrollRef = useRef<HTMLDivElement | null>(null);

  const [editing, setEditing] = useState(false);
  const [cell, setCell] = useState<Cell | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // A group selection belongs to one track and one section at a time, so the
  // section it was made in is part of the state rather than derived (spec 13.1).
  const [selection, setSelection] = useState<Selection | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setMoveError(null);
  }, []);

  /*
   * The time selection (2I-B). Its store adapter is memoised on the song so
   * `apply` always reads the latest one — a stale snapshot here would commit
   * an edit onto a song that has already moved on.
   */
  const transformStore = useMemo(
    () => ({ getSnapshot: () => ({ song }), commit }),
    [song, commit],
  );
  const transform = useTransform(transformStore, song);

  /*
   * Bar operations (2J.1). Same store, same "one apply, one write, one undo"
   * promise, and the same reason it goes through a hook: a component that ran
   * a bar command and committed the result itself would produce a second
   * history entry that looks exactly like the first.
   */
  const trackNameOf = useCallback(
    (trackId: string) =>
      song.tracks.find((entry) => entry.id === trackId)?.name ?? trackId,
    [song.tracks],
  );
  const barTransform = useBarTransform(transformStore, song, trackNameOf);
  const [barSheet, setBarSheet] = useState<"more" | "move" | "repeat" | null>(
    null,
  );
  const [sheet, setSheet] = useState<TransformSheetKind>(null);
  /**
   * Where a paste is in its flow.
   *
   * "choosing" means the next long press picks a target instead of making a
   * new selection. Nothing is written until the reader confirms, so a paste
   * that lands somewhere occupied is shown as a refusal rather than undone
   * afterwards.
   */
  const [pasteAt, setPasteAt] = useState<
    { kind: "idle" } | { kind: "choosing" } | { kind: "at"; ticks: number }
  >({ kind: "idle" });

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const track =
    song.tracks.find((entry) => entry.id === selectedTrackId) ?? song.tracks[0];

  const copilot = useCoArranger(song, {
    onApply: (candidate, skill) => commit(candidate, { kind: "copilot_apply", skill }),
    onBeforePreviewPlay: () => controller.pause(),
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
  const [form, setForm] = useState<ArrangeForm>(() => {
    const skill = skills[0] ?? "drums";
    return {
      sectionId: song.sections[0]?.id ?? "",
      skill,
      targetTrackId: targetsFor(song, skill)[0]?.id ?? "",
      styleId: null,
      instruction: "",
    };
  });

  const timeline = useMemo(
    () => buildTrackTimeline(song, track?.id ?? ""),
    [song, track?.id],
  );
  const runs = useMemo(() => sectionRuns(song), [song]);
  const plan = controller.getPlan();


  /** The section a time selection lives in, resolved once. */
  const selectedSection = useMemo(
    () =>
      transform.selection
        ? (song.sections.find((entry) => entry.id === transform.selection?.sectionId) ?? null)
        : null,
    [song.sections, transform.selection],
  );

  /*
   * Selection is an edit gesture, so it is unavailable while the Copilot owns
   * the screen. Two things that both rewrite the same bars must not be live at
   * once (spec 13.1).
   */
  /*
   * A time selection is a tab gesture. The arrangement has no staff to draw a
   * band on and no slot to press, so the press machine is not armed there at
   * all — rather than armed and then ignored, which is how a gesture ends up
   * half-working on a surface nobody meant it for.
   */
  const selectionEnabled =
    view === "tab" &&
    canPersist &&
    !previewOpen &&
    !arrangeOpen &&
    track !== undefined;

  /** Where the band sits in tab coordinates, and how tall the staff is. */
  const band = useMemo(
    () =>
      transform.selection && selectedSection && timeline.kind !== "unsupported"
        ? bandInTimeline(
            timeline.bars,
            selectedSection,
            transform.selection.startTicks,
            transform.selection.endTicks,
          )
        : null,
    [selectedSection, timeline, transform.selection],
  );

  const bandHeight =
    timeline.kind === "fretted"
      ? BAR_HEADER_HEIGHT + timeline.strings.length * STRING_ROW_HEIGHT
      : timeline.kind === "drums"
        ? BAR_HEADER_HEIGHT + timeline.lanes.length * DRUM_ROW_HEIGHT
        : 0;

  /**
   * Step sizes for the move sheet, taken from the bar the selection starts in.
   *
   * "One grid step" has to mean a step of the grid the music is actually on,
   * or the nudge would move a triplet by a sixteenth and the reader would have
   * no way to see why it refused.
   */
  const selectionSteps = useMemo(() => {
    const fallback = { step: ticksPerSlot(16), beat: ticksPerSlot(16) * 4, bar: ticksPerSlot(16) * 16 };
    if (!selectedSection || !transform.selection) return fallback;
    const starts = sectionBarStartTicks(selectedSection);
    const index = starts.findIndex((start, position) => {
      const next = starts[position + 1] ?? Number.POSITIVE_INFINITY;
      return transform.selection!.startTicks >= start && transform.selection!.startTicks < next;
    });
    const bar = selectedSection.bars[index === -1 ? 0 : index];
    if (!bar) return fallback;
    const step = ticksPerSlot(bar.resolution);
    return {
      step,
      beat: step * slotsPerNotatedBeat(bar.timeSignature, bar.resolution),
      bar: ticksPerBar(bar.timeSignature, bar.resolution),
    };
  }, [selectedSection, transform.selection]);

  const selectionStepTicks = selectionSteps.step;
  const selectionBeatTicks = selectionSteps.beat;
  const selectionBarTicks = selectionSteps.bar;

  /**
   * Dragging a selection handle.
   *
   * Only from the handle itself: once selection mode is on, a drag anywhere
   * else is still the tab scrolling. The move is applied on pointerup, so a
   * cancelled gesture leaves the selection exactly as it was rather than
   * half-resized.
   */
  const dragEdge = useRef<"start" | "end" | null>(null);

  const onHandleDown = useCallback(
    (edge: "start" | "end", event: React.PointerEvent) => {
      dragEdge.current = edge;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.stopPropagation();
    },
    [],
  );

  const onHandleMove = useCallback(
    (event: React.PointerEvent) => {
      const edge = dragEdge.current;
      const selection = transform.selection;
      if (!edge || !selection || !selectedSection || timeline.kind === "unsupported") return;
      const content = scrollRef.current?.querySelector("[data-tab-content]");
      if (!content) return;

      const x = event.clientX - content.getBoundingClientRect().left - GUTTER_WIDTH;
      const hit = slotAtX(timeline.bars, x);
      if (!hit || hit.sectionId !== selection.sectionId) return;
      const bar = selectedSection.bars[hit.barIndex];
      if (!bar) return;

      const starts = sectionBarStartTicks(selectedSection);
      const step = ticksPerSlot(bar.resolution);
      const ticks = (starts[hit.barIndex] ?? 0) + hit.slotIndex * step;

      // The edges may not cross: dragging start past end keeps one slot.
      const next =
        edge === "start"
          ? { ...selection, startTicks: Math.min(ticks, selection.endTicks - step) }
          : { ...selection, endTicks: Math.max(ticks + step, selection.startTicks + step) };
      transform.select(next);
    },
    [selectedSection, timeline, transform],
  );

  const onHandleUp = useCallback(() => {
    dragEdge.current = null;
  }, []);

  /** The paste being confirmed, if any. Built here so its ghost is real. */
  const pasteCommand = useMemo(
    () =>
      pasteAt.kind === "at" && transform.hasClipboard
        ? ({
            kind: "paste_selection" as const,
            clipboard: transform.clipboard,
            atTicks: pasteAt.ticks,
          })
        : null,
    [pasteAt, transform.clipboard, transform.hasClipboard],
  );

  const pastePreview = useMemo(
    () => (pasteCommand ? transform.previewOf(pasteCommand) : null),
    [pasteCommand, transform],
  );

  /**
   * What the ghost says, in words.
   *
   * The preview is the real command run against the real song with its result
   * thrown away, so this describes what would actually happen rather than what
   * we hope would.
   */
  const previewText = useMemo(() => {
    const shown = pastePreview ?? transform.preview;
    if (!shown) return null;
    if (!shown.ok) return shown.message;
    const warnings = shown.warnings.length;
    return warnings > 0
      ? "Uygulanabilir. Birkaç yerde el pozisyonu zorlanıyor olabilir."
      : "Uygulanmaya hazır.";
  }, [pastePreview, transform.preview]);

  /**
   * A long press picks the slot under the finger and asks the core to
   * normalise it. What comes back is the whole chord, and the whole chain it
   * belongs to — so the band the reader sees is the music that will move.
   */
  const onSlotLongPress = useCallback(
    (x: number) => {
      if (!track) return;
      const hit = slotAtX(timeline.kind === "unsupported" ? [] : timeline.bars, x);
      if (!hit) return;
      const section = song.sections.find((entry) => entry.id === hit.sectionId);
      const bar = section?.bars[hit.barIndex];
      if (!section || !bar) return;

      // Selecting is an edit gesture, and edits and playback do not share the
      // screen (spec 13.1). Pause rather than tear the engine down.
      controller.pause();

      const starts = sectionBarStartTicks(section);
      const step = ticksPerSlot(bar.resolution);
      const startTicks = (starts[hit.barIndex] ?? 0) + hit.slotIndex * step;

      // Mid-paste the press names a destination instead of a new selection.
      if (pasteAt.kind === "choosing") {
        setPasteAt({ kind: "at", ticks: startTicks });
        setSheet("paste");
        return;
      }

      // The other selection model lets go, for the same reason a bar press
      // clears this one: one press, one thing selected.
      barTransform.clear();
      setBarSheet(null);

      transform.select({
        sectionId: section.id,
        trackId: track.id,
        startTicks,
        endTicks: startTicks + step,
      });
    },
    [
      barTransform,
      controller,
      pasteAt.kind,
      song.sections,
      timeline,
      track,
      transform,
    ],
  );

  const getPosition = useCallback(() => controller.getPosition(), [controller]);

  /*
   * The arrangement, rebuilt only when the song changes.
   *
   * It is a value: the same song gives a byte-equivalent model, so the view can
   * re-render from it as often as it likes. An undo therefore shows the old
   * structure for free — there is no separate arrangement state to invalidate.
   */
  const arrangement = useMemo(() => buildArrangementModel(song), [song]);

  /**
   * The arrangement a staged command would leave behind.
   *
   * Built from the ghost song rather than described in words, so "two bars
   * will be removed" is something the reader can *see* — including which two.
   * It is thrown away the moment the command is cancelled or applied; nothing
   * here reaches the store, the history or the playback plan.
   */
  const ghostArrangement = useMemo(
    () =>
      barTransform.previewSong
        ? buildArrangementModel(barTransform.previewSong)
        : null,
    [barTransform.previewSong],
  );

  /**
   * Leave for the structure view.
   *
   * A selection belongs to the tab: it is a span of time on one track, drawn on
   * a staff that is about to be unmounted. Carrying it across would leave the
   * reader with an action bar acting on something they cannot see. So the
   * selection goes and any open sheet closes — *without* committing whatever it
   * had staged, which is the whole point of a pending command.
   *
   * The clipboard stays. It is not tied to a surface, and someone who copied a
   * bar, went to look at the structure and came back would rightly expect it to
   * still be there. So does the undo history, which belongs to the song.
   */
  const enterArrange = useCallback(() => {
    transform.clear();
    setSheet(null);
    setPasteAt({ kind: "idle" });
    setView("arrange");
  }, [transform]);

  const jumpToSection = useCallback((sectionId: string) => {
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[${BAR_KEY_ATTRIBUTE}="${sectionId}:0"]`,
    );
    if (!scroller || !target) return;
    scroller.scrollTo({
      left: Math.max(0, target.offsetLeft - GUTTER_WIDTH),
      behavior: "smooth",
    });
  }, []);

  const seekToBar = useCallback(
    (barKey: string) => {
      controller.seekToBar(barKey);
      setActiveBarKey(barKey);
    },
    [controller],
  );

  /**
   * A bar cell tap: the one navigation that crosses both surfaces.
   *
   * Four things, in the order a reader would expect them: the track becomes
   * the active one, the transport moves to that bar, the tab takes the screen,
   * and the tab scrolls to the bar. The scroll cannot happen here — the tab is
   * not mounted yet — so the bar is remembered and an effect does it once the
   * element exists.
   */
  const openBarInTab = useCallback(
    (barKey: string) => {
      seekToBar(barKey);
      setPendingTabBar(barKey);
      setView("tab");
    },
    [seekToBar],
  );

  useEffect(() => {
    if (view !== "tab" || pendingTabBar === null) return;
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[${BAR_KEY_ATTRIBUTE}="${pendingTabBar}"]`,
    );
    if (!scroller || !target) return;
    scroller.scrollLeft = Math.max(0, target.offsetLeft - GUTTER_WIDTH);
    setPendingTabBar(null);
  }, [view, pendingTabBar]);

  /* ------------------------------------------------------ bar selection */

  /**
   * Take hold of bars (spec 13.12).
   *
   * The time selection goes first, and unconditionally. Both models describe
   * the same music — one as a span of ticks on one track, the other as whole
   * bars — and two action bars claiming the same bars is how a reader ends up
   * pressing "Sil" without knowing which of the two answers it.
   */
  const selectBars = useCallback(
    (request: BarSelectRequest) => {
      transform.clear();
      setSheet(null);
      setPasteAt({ kind: "idle" });
      setBarSheet(null);
      barTransform.select(
        request.trackId === undefined
          ? {
              scope: "full",
              sectionId: request.sectionId,
              startBarIndex: request.barIndex,
              endBarIndex: request.barIndex,
            }
          : {
              scope: "track",
              sectionId: request.sectionId,
              trackId: request.trackId,
              startBarIndex: request.barIndex,
              endBarIndex: request.barIndex,
            },
      );
    },
    [barTransform, transform],
  );

  /**
   * A handle dragged onto a bar.
   *
   * The edge moves to that bar and stops there; it never crosses the other
   * edge, so the range cannot turn inside out mid-drag. Re-selecting rather
   * than editing the range in place is what keeps chain expansion honest: a
   * dragged edge that lands mid-chain is widened by the same code that widens
   * a fresh press.
   */
  const extendBars = useCallback(
    (edge: BarSelectEdge, barIndex: number) => {
      const current = barTransform.selection;
      if (!current) return;
      const bounds =
        edge === "start"
          ? {
              startBarIndex: Math.min(barIndex, current.endBarIndex),
              endBarIndex: current.endBarIndex,
            }
          : {
              startBarIndex: current.startBarIndex,
              endBarIndex: Math.max(barIndex, current.startBarIndex),
            };
      const next: BarSelection =
        current.scope === "track"
          ? { ...current, ...bounds }
          : { ...current, ...bounds };
      if (sameBarSelection(next, current)) return;
      barTransform.select(next);
    },
    [barTransform],
  );

  /**
   * The same gesture from the tab: a press on a bar's header.
   *
   * Track scope, always. The tab draws one track, and a press made on one
   * staff must not reach into the seven the reader cannot see — a whole-bar
   * selection is offered where whole bars are visible, which is the
   * arrangement.
   */
  const selectBarsFromTab = useCallback(
    (barKey: string) => {
      if (!track) return;
      const [sectionId, indexText] = barKey.split(":");
      const barIndex = Number(indexText);
      if (!sectionId || !Number.isInteger(barIndex)) return;
      selectBars({ barIndex, sectionId, trackId: track.id });
    },
    [selectBars, track],
  );

  /**
   * The one place a bar command becomes a write.
   *
   * A structural operation pauses first, because the scheduler is holding
   * positions in a bar array that is about to be re-indexed. A preview does
   * not: nothing has changed yet, and stopping the music to *look* at an
   * outcome would make the ghost more disruptive than the edit.
   */
  const applyBars = useCallback(
    (options: { readonly replace?: boolean } = {}) => {
      const command = barTransform.pending;
      const selection = barTransform.selection;
      if (!command || !selection) return;

      const structural = isStructuralBarCommand(selection.scope, command);
      if (structural) controller.pause();

      if (!barTransform.apply(options)) return;

      setBarSheet(null);
      /*
       * The time selection is measured in ticks against a layout that has just
       * moved, and a queued tab scroll names a bar key that may now mean a
       * different bar. Both go rather than being adjusted: there is no honest
       * adjustment for "the bar you asked for was deleted".
       */
      transform.clear();
      setSheet(null);
      setPasteAt({ kind: "idle" });
      setPendingTabBar(null);
      /*
       * The transport's own position is carried across the song change by
       * `usePlayback`, which asks the new plan for the nearest bar it still
       * has. What cannot be carried is this: the highlighted bar is a bar
       * *key*, and after bars shift the same key is a different bar. It is
       * dropped rather than guessed, and the next frame reads the real one.
       */
      if (structural) setActiveBarKey(null);
    },
    [barTransform, controller, transform],
  );

  /* ------------------------------------------------------- undo and redo */

  /**
   * Put every editing surface down before the song moves under it.
   *
   * A selection is a range of ticks or bars in the song as it stands, a ghost
   * is a command staged against it, and a Copilot candidate was measured
   * against the song as it was when it was asked for. After an undo none of
   * those describe anything, and leaving one on screen would leave the reader
   * holding a handle attached to music that is no longer there.
   *
   * The clipboards stay. A clipboard is not song state: someone who copied a
   * bar, undid an unrelated edit and came back would rightly expect it to
   * still be there.
   */
  const resetEditSurfaces = useCallback(() => {
    transform.clear();
    barTransform.clear();
    setSheet(null);
    setBarSheet(null);
    setPasteAt({ kind: "idle" });
    clearSelection();
    setCell(null);
    setEditError(null);
    // Disposes the preview engine as well as closing the sheet, so no second
    // graph is left playing a candidate that is no longer on the table.
    closeCopilot();
  }, [barTransform, clearSelection, closeCopilot, transform]);

  /**
   * Step the history, once.
   *
   * Playback stops first and does not start again on its own: the music under
   * the playhead is about to become different music, and resuming into it
   * would be the app deciding to play something the reader did not ask for.
   * No engine is built here — the song change replaces the controller through
   * the path every other edit already uses.
   */
  const undoEdit = useCallback(() => {
    if (!canUndo) return;
    controller.pause();
    resetEditSurfaces();
    undo();
  }, [canUndo, controller, resetEditSurfaces, undo]);

  const redoEdit = useCallback(() => {
    if (!canRedo) return;
    controller.pause();
    resetEditSurfaces();
    redo();
  }, [canRedo, controller, redo, resetEditSurfaces]);

  useEditShortcuts({ canUndo, canRedo, onUndo: undoEdit, onRedo: redoEdit });

  /* ------------------------------------------------------- project file */

  const [projectSheetOpen, setProjectSheetOpen] = useState(false);

  /**
   * The ground a project lands on (spec 13.15).
   *
   * Opening a project replaces the whole song, so everything measured against
   * the old one goes first: playback pauses, the loop is dropped *before* the
   * rewind (a rewind with a loop on seeks to the loop, not the top), and the
   * playhead goes to the start. Unlike an undo, the clipboards go too — a
   * clipboard cut from a song that has been wholly replaced would paste
   * another song's music. The view returns to the arrangement, which is where
   * a song nobody has seen yet is best met.
   */
  const prepareForProjectApply = useCallback(() => {
    controller.pause();
    controller.setLoopSection(null);
    controller.rewind();
    resetEditSurfaces();
    transform.clearClipboard();
    barTransform.clearClipboard();
    setEditing(false);
    setActiveBarKey(null);
    setPendingTabBar(null);
    setSelectedTrackId("");
    setView("arrange");
  }, [barTransform, controller, resetEditSurfaces, transform]);

  const project = useProjectFile({
    song,
    canPersist,
    commit,
    onBeforeApply: prepareForProjectApply,
    onApplied: () => setProjectSheetOpen(false),
  });

  const stageBarCommand = useCallback(
    (command: BarCommand) => {
      setBarSheet(null);
      barTransform.stage(command);
    },
    [barTransform],
  );

  const toggleLoop = useCallback(() => {
    const current = activeBarKey?.split(":")[0] ?? runs[0]?.sectionId ?? null;
    controller.setLoopSection(state.loopSectionId ? null : current);
  }, [activeBarKey, controller, runs, state.loopSectionId]);

  /*
   * Editing and a candidate never share the screen: a candidate is measured
   * against the song as it was when it was asked for.
   *
   * `canPersist` is the other gate, and it is a harder one (spec 13.14). When
   * a file from a newer version is in the way, an edit could not be saved and
   * committing it would mean writing over data this version cannot read. The
   * controls are disabled rather than left to fail at the end — a button that
   * always refuses is worse than one that is visibly unavailable.
   */
  const canEdit =
    track !== undefined && isEditableTrack(track) && !previewOpen && canPersist;
  const editDisabledReason =
    track === undefined || canEdit
      ? null
      : !canPersist
        ? // One sentence for every reason writing is closed — the banner above
          // carries the specific one, and repeating it here would be two
          // voices saying slightly different things about the same fact.
          "Değişiklikler kaydedilemeyeceği için düzenleme kapalı."
        : `"${track.name}" bu ekrandan düzenlenemiyor. Şimdilik yalnız akordu olan telli track'ler düzenlenebiliyor.`;

  const toggleEdit = useCallback(() => {
    setEditError(null);
    setCell(null);
    clearSelection();
    setEditing((was) => {
      // Editing and playback do not share the screen (spec 13.1).
      if (!was) controller.pause();
      return !was;
    });
  }, [clearSelection, controller]);

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

  const pickOnset = useCallback(
    (sectionId: string, ref: OnsetRef, mode: SelectMode) => {
      setMoveError(null);
      setSelection((current) => chooseOnset(current, sectionId, ref, mode));
    },
    [],
  );

  const moveSelection = useCallback(
    (movement: OnsetMovement) => {
      if (!selection || !track) return;
      // Moving music while it is playing would leave the ear behind the eye.
      controller.pause();

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
    [commit, controller, selection, song, timeline, track],
  );

  const activeSectionId = activeBarKey?.split(":")[0] ?? null;
  const firstBar = song.sections[0]?.bars[0];
  const meter = firstBar ? formatTimeSignature(firstBar.timeSignature) : "";
  const fretboard = track?.fretboard;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <WorkspaceHeader
        title={song.title}
        songKey={song.key}
        bpm={song.bpm}
        meter={meter}
        activeBpm={state.activeBpm}
        hasTempoChanges={state.hasTempoChanges}
        onInfo={() => setInfoOpen(true)}
      />

      {/*
        One strip, and the recovery state owns it.

        The two ad-hoc notices this replaces could both be on screen at once,
        stacked, saying overlapping things — and one of them carried whatever
        sentence the loader had built, which is how a diagnostic reaches a
        musician. Now there are four states and four sentences.
      */}
      {recovery && recoveryMessage ? (
        <RecoveryBanner
          state={recovery}
          message={recoveryMessage}
          onDismiss={dismissRecovery}
        />
      ) : null}

      <ViewSwitch
        view={view}
        onChange={(next) => (next === "arrange" ? enterArrange() : setView("tab"))}
      />

      {/*
        Only on the tab.
        
        The arrangement already draws every section with its own header, its
        bar count and its tempo, so a strip listing the same names above it
        would be telling the reader about something they are looking at — and
        charging them eighty-nine pixels of a seven hundred pixel screen for it.
      */}
      {view === "tab" ? (
        <SectionNavigator
          runs={runs}
          activeSectionId={activeSectionId}
          loopSectionId={state.loopSectionId}
          onJump={jumpToSection}
          onOpenList={() => setSectionSheetOpen(true)}
        />
      ) : null}

      <main className="min-h-0 flex-1">
        {/*
          One surface at a time, and the other is unmounted rather than hidden.
          Hiding would leave a second horizontal scroller alive behind the one
          on screen and a second animation frame running against it — two
          things this checkpoint promises there is exactly one of. The playback
          controller is not here; it lives above both, so switching surfaces
          rebuilds no engine, schedules nothing, and stops nothing.
        */}
        {view === "arrange" ? (
          <ArrangementCanvas
            model={ghostArrangement ?? arrangement}
            ghost={ghostArrangement !== null}
            scrollRef={arrangeScrollRef}
            activeBarKey={activeBarKey}
            selectedTrackId={track?.id ?? ""}
            getPosition={getPosition}
            running={state.status === "playing"}
            onActiveBarChange={setActiveBarKey}
            onOpenBar={openBarInTab}
            onSeekBar={seekToBar}
            onSelectTrack={setSelectedTrackId}
            /*
             * No outline over the ghost. The selection is a range of bar
             * *indices* in the song as it stands, and in the song a command
             * would produce those indices are different bars — an outline
             * drawn from them would be pointing at the wrong music while
             * claiming to show what is about to change.
             */
            barSelection={ghostArrangement ? null : barTransform.selection}
            onSelectBars={canPersist ? selectBars : undefined}
            onExtendBars={canPersist ? extendBars : undefined}
          />
        ) : (
          <TabCanvas
            timeline={timeline}
            plan={plan}
            getPosition={getPosition}
            running={state.status === "playing"}
            activeBarKey={activeBarKey}
            onActiveBarChange={setActiveBarKey}
            onSeekBar={seekToBar}
            onBarLongPress={
              /*
               * Not while the Copilot owns the screen, and not while a
               * candidate is on it: a bar selection is an edit gesture, and
               * a candidate is measured against the song as it was asked for.
               */
              previewOpen || arrangeOpen || !canPersist
                ? undefined
                : selectBarsFromTab
            }
            scrollRef={scrollRef}
            onSlotLongPress={selectionEnabled ? onSlotLongPress : undefined}
            onHandleMove={onHandleMove}
            onHandleUp={onHandleUp}
            selectionBand={
              transform.selection && selectedSection && band ? (
                <TimeSelectionBand
                  section={selectedSection}
                  selection={transform.selection}
                  height={bandHeight}
                  label={transform.summary?.text ?? "Seçim"}
                  left={band.left + GUTTER_WIDTH}
                  width={band.width}
                  onHandleDown={onHandleDown}
                />
              ) : null
            }
            editing={editing}
            selectedCell={cell}
            onCellSelect={(next) => {
              setEditError(null);
              setCell(next);
            }}
            onsetsForBar={(bar) => {
              const onsetSlots =
                onsetsOfSection.get(`${bar.sectionId}:${bar.barIndex}`) ??
                EMPTY_SLOTS;
              const selectedSlots =
                (selectionView?.sectionId === bar.sectionId
                  ? selectionView.selected.get(bar.barIndex)
                  : undefined) ?? EMPTY_SLOTS;
              return {
                onsetSlots,
                selectedSlots,
                active: selection !== null,
                onToggle: (slotIndex) =>
                  pickOnset(
                    bar.sectionId,
                    { barIndex: bar.barIndex, slotIndex },
                    "toggle",
                  ),
                onLongPress: (slotIndex) =>
                  pickOnset(
                    bar.sectionId,
                    { barIndex: bar.barIndex, slotIndex },
                    selection?.sectionId === bar.sectionId ? "toggle" : "replace",
                  ),
              };
            }}
          />
        )}
      </main>

      {/*
        The refusal, outside the action bar on purpose.

        Some refusals take the selection with them — a chain that leaves the
        section is turned down at the selection itself, so there is no
        selection left for an action bar to be attached to. Putting the message
        inside that action bar would mean the one refusal the reader most needs
        explained is the one they never see.
      */}
      {barTransform.error ? (
        <p
          data-bar-error
          role="alert"
          className="border-reject/50 bg-raised text-reject border-t px-3 py-2 text-sm"
        >
          {barTransform.error}
        </p>
      ) : null}

      {barTransform.selection ? (
        <BarActionBar
          selection={barTransform.selection}
          summary={barTransform.summary ?? "Ölçü seçimi"}
          notice={barTransform.notice}
          preview={barTransform.preview}
          hasClipboard={barTransform.hasClipboard}
          clipboardScope={barTransform.clipboardScope}
          moreOpen={barSheet === "more"}
          moveOpen={barSheet === "move"}
          repeatOpen={barSheet === "repeat"}
          onAction={(action) => {
            switch (action) {
              case "copy":
                // Reading only: no commit, no write, no undo step.
                barTransform.copy();
                return;
              case "cut":
                stageBarCommand({ kind: "cut_bars" });
                return;
              case "duplicate":
                stageBarCommand({ kind: "duplicate_bars" });
                return;
              case "delete":
                stageBarCommand({ kind: "delete_bars" });
                return;
              case "repeat":
                setBarSheet("repeat");
                return;
              case "move":
                setBarSheet("move");
                return;
              case "more":
                setBarSheet("more");
                return;
            }
          }}
          onRepeat={(choice: BarRepeatChoice) =>
            stageBarCommand({ kind: "repeat_bars", mode: choice })
          }
          onMore={(action) => {
            switch (action) {
              case "paste":
                setBarSheet(null);
                barTransform.stagePaste();
                return;
              case "blank_before":
                stageBarCommand({ kind: "insert_blank_bar_before" });
                return;
              case "blank_after":
                stageBarCommand({ kind: "insert_blank_bar_after" });
                return;
              case "insert_before":
                setBarSheet(null);
                barTransform.stageInsertCopied("before");
                return;
              case "insert_after":
                setBarSheet(null);
                barTransform.stageInsertCopied("after");
                return;
            }
          }}
          onCloseMore={() => setBarSheet(null)}
          onMoveLeft={() => stageBarCommand({ kind: "move_bars_left" })}
          onMoveRight={() => stageBarCommand({ kind: "move_bars_right" })}
          onApply={() => applyBars()}
          onReplace={() => applyBars({ replace: true })}
          onCancel={barTransform.cancel}
          onClear={() => {
            barTransform.clear();
            setBarSheet(null);
          }}
        />
      ) : null}

      {transform.selection ? (
        <SelectionActionBar
          summary={
            pasteAt.kind === "choosing"
              ? "Yapıştırılacak yere uzun bas."
              : (transform.summary?.text ?? "Seçim")
          }
          notice={transform.notice}
          error={transform.error}
          onCancel={() => {
            transform.clear();
            setSheet(null);
            setPasteAt({ kind: "idle" });
          }}
          onAction={(action) => {
            if (action === "copy") {
              // Reading only: no commit, no write, no undo step.
              transform.copy();
              return;
            }
            if (action === "cut") {
              transform.apply({ kind: "cut_selection" });
              return;
            }
            if (action === "duplicate") {
              transform.apply({ kind: "duplicate_selection" });
              return;
            }
            if (action === "delete") {
              transform.apply({ kind: "delete_selection" });
              return;
            }
            setSheet(action === "repeat" ? "repeat" : action === "move" ? "move" : "more");
          }}
        />
      ) : null}

      <TransformSheet
        kind={sheet}
        stepTicks={selectionStepTicks}
        beatTicks={selectionBeatTicks}
        barTicks={selectionBarTicks}
        pending={pasteCommand ?? transform.pending}
        preview={pastePreview ?? transform.preview}
        previewText={previewText}
        canPaste={transform.hasClipboard}
        onStartPaste={() => {
          setSheet(null);
          setPasteAt({ kind: "choosing" });
        }}
        onStage={transform.stage}
        onApply={() => {
          const command = pasteCommand ?? transform.pending;
          if (command && transform.apply(command)) {
            setSheet(null);
            setPasteAt({ kind: "idle" });
          }
        }}
        onClose={() => {
          setSheet(null);
          setPasteAt({ kind: "idle" });
        }}
      />

      {/*
        One line where a four-by-two grid of track buttons used to be.

        The grid answered "which track?" permanently, and that question gets
        asked a handful of times a session. At 320x700 it cost fifty-seven
        pixels of a tab surface that had forty left. The list is not gone —
        it moved into the sheet this control opens, with the same `onSelect`
        behind it, so track changing still goes through one state path.
      */}
      {track && view === "tab" ? (
        <button
          type="button"
          data-track-control
          onClick={() => setTrackSheetOpen(true)}
          aria-label={`Aktif track: ${trackLine(track)}. Track değiştir`}
          className="border-line flex items-center justify-between gap-2 border-t px-3 text-left"
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        >
          <span className="text-bronze truncate text-sm">{trackLine(track)}</span>
          <span className="text-muted shrink-0 text-xs" aria-hidden>
            &#9662;
          </span>
        </button>
      ) : null}

      {editing ? (
        <SelectionBar
          count={selection?.refs.length ?? 0}
          error={moveError}
          onMove={moveSelection}
          onClear={clearSelection}
        />
      ) : null}

      <EditToolbar
        editing={editing}
        canEdit={canEdit}
        editDisabledReason={editDisabledReason}
        onToggleEdit={toggleEdit}
        onArrange={() => {
          controller.pause();
          setEditing(false);
          setCell(null);
          clearSelection();
          copilot.open();
        }}
        arrangeDisabled={skills.length === 0 || previewOpen || !canPersist}
        canUndo={canUndo}
        canRedo={canRedo}
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        onUndo={undoEdit}
        onRedo={redoEdit}
        canToggleEdit={view === "tab"}
      />

      <TransportBar
        state={state}
        runs={runs}
        onPlayPause={() => controller.toggle()}
        onRewind={() => controller.rewind()}
        onToggleLoop={toggleLoop}
        onToggleMetronome={() => controller.setMetronome(!state.metronome)}
        onOpenPracticeRate={() => setPracticeSheetOpen(true)}
      />

      {/*
        The practice-rate controls, on demand.
        
        Same control, same state path — it moved out of the permanent footer
        and behind the pill that shows its value. Practice rate is a thing you
        set and then work at, not a thing you adjust continuously.
      */}
      <Sheet
        open={practiceSheetOpen}
        title="Çalışma hızı"
        onClose={() => setPracticeSheetOpen(false)}
        labelledBy="practice-sheet-title"
      >
        <PracticeRateControl
          songBpm={state.songBpm}
          percent={state.practicePercent}
          onChange={setPracticeRatePercent}
        />
        <p className="text-muted mt-3 text-xs">
          Şarkının kendi temposu değişmez; yalnız çalma hızı değişir.
        </p>
      </Sheet>

      {track ? (
        <TrackSheet
          tracks={song.tracks}
          selectedTrackId={track.id}
          onSelect={(id) => {
            setEditing(false);
            setCell(null);
            clearSelection();
            // A selection belongs to one track and one section (2I-A V1), so
            // it cannot survive a change of either.
            transform.clear();
            setSheet(null);
            setPasteAt({ kind: "idle" });
            setSelectedTrackId(id);
          }}
          open={trackSheetOpen}
          onClose={() => setTrackSheetOpen(false)}
        />
      ) : null}

      {editing && fretboard && track ? (
        <FretSheet
          key={`${cell?.barKey}:${cell?.slotIndex}:${cell?.stringIndex}:${currentFret}:${currentArticulation}`}
          open={cell !== null && !previewOpen}
          fretboard={fretboard}
          target={fretTarget}
          error={editError}
          onClose={() => {
            setCell(null);
            setEditError(null);
          }}
          onNudge={nudge}
          onArticulation={(articulation) =>
            runCommand((target) => ({
              kind: "set_articulation",
              target,
              stringIndex: cell?.stringIndex ?? 0,
              articulation,
            }))
          }
          onCommit={(fret) =>
            runCommand((target) => ({
              kind: "set_note",
              target,
              stringIndex: cell?.stringIndex ?? 0,
              fret,
            }))
          }
          onClearString={() =>
            runCommand((target) => ({
              kind: "clear_string",
              target,
              stringIndex: cell?.stringIndex ?? 0,
            }))
          }
          onRest={() => runCommand((target) => ({ kind: "set_rest", target }))}
          onTie={() => runCommand((target) => ({ kind: "set_tie", target }))}
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
        activeSectionId={activeSectionId}
        open={sectionSheetOpen}
        onJump={jumpToSection}
        onClose={() => setSectionSheetOpen(false)}
      />

      <ProjectFileSheet
        open={projectSheetOpen}
        onClose={() => setProjectSheetOpen(false)}
        handle={project}
        canPersist={canPersist}
      />

      <InfoSheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        onProjectBackup={project.downloadBackup}
        projectBackupError={project.exportError}
        onOpenProjectFile={() => {
          setInfoOpen(false);
          setProjectSheetOpen(true);
        }}
      />
    </div>
  );
}
