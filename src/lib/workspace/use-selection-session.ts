"use client";

/**
 * The edit-session state: what the reader is holding, and what they have
 * staged against it (2L-R).
 *
 * One owner for both selection models — the time selection of 2I-B and the
 * bar selection of 2J.1 — their clipboards, their staged commands and their
 * sheets. Owning both in one place is what enforces the one-at-a-time rule:
 * every path that arms one model disarms the other here, not in whichever
 * component happened to remember.
 *
 * The command algorithms live in `@/lib/song/transform` and
 * `@/lib/song/bar-transform`, behind their own hooks; this session prepares
 * targets, delegates through the unified commit, and routes refusals into the
 * strings the action bars show. Nothing here touches storage or the engine —
 * playback is reached only through the injected `pause`.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { BarSelectEdge, BarSelectRequest } from "@/components/workspace/ArrangementCanvas";
import type { TransformSheetKind } from "@/components/workspace/TransformSheet";
import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  GUTTER_WIDTH,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import {
  bandInTimeline,
  slotAtX,
} from "@/components/workspace/selection-geometry";
import {
  isStructuralBarCommand,
  type BarCommand,
} from "@/lib/song/bar-transform";
import { sameBarSelection, type BarSelection } from "@/lib/song/bar-selection";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { TransformCommand } from "@/lib/song/transform";
import { sectionBarStartTicks } from "@/lib/song/onset-block";
import { pickOnsetAt } from "@/lib/song/onset-selection";
import type { Section, Song, Track } from "@/lib/song/schema";
import { useBarTransform, type BarTransformHandle } from "@/lib/song/use-bar-transform";
import { useTransform, type TransformHandle } from "@/lib/song/use-transform";
import type { TrackTimeline } from "@/lib/tab/timeline";
import {
  ticksPerBar,
  ticksPerSlot,
  slotsPerNotatedBeat,
} from "@/lib/music/timing";

export type PasteFlow =
  | { kind: "idle" }
  | { kind: "choosing" }
  | { kind: "at"; ticks: number };

export type TimeSelectionSession = {
  readonly handle: TransformHandle;
  readonly sheet: TransformSheetKind;
  readonly pasteAt: PasteFlow;
  readonly pasteCommand: TransformCommand | null;
  readonly pastePreview: ReturnType<TransformHandle["previewOf"]> | null;
  readonly previewText: string | null;
  readonly selectedSection: Section | null;
  readonly band: { left: number; width: number } | null;
  readonly bandHeight: number;
  readonly stepTicks: number;
  readonly beatTicks: number;
  readonly barTicks: number;
  openSheet(kind: TransformSheetKind): void;
  startPasteFlow(): void;
  applyStaged(): void;
  closeSheet(): void;
  onSlotLongPress(x: number): void;
  onHandleDown(edge: "start" | "end", event: ReactPointerEvent): void;
  onHandleMove(event: ReactPointerEvent): void;
  onHandleUp(): void;
  /** Selection, staged command, sheet and paste flow down. Clipboard stays. */
  clear(): void;
};

export type BarSelectionSession = {
  readonly handle: BarTransformHandle;
  readonly sheet: "more" | "move" | "repeat" | null;
  setSheet(sheet: "more" | "move" | "repeat" | null): void;
  select(request: BarSelectRequest): void;
  extend(edge: BarSelectEdge, barIndex: number): void;
  selectFromTab(barKey: string): void;
  stage(command: BarCommand): void;
  apply(options?: { readonly replace?: boolean }): void;
  clear(): void;
};

export type SelectionSession = {
  readonly time: TimeSelectionSession;
  readonly bars: BarSelectionSession;
  /** Every selection surface down — the undo/redo and project ground. */
  resetAll(): void;
  /** Both clipboards forgotten. Only a whole-song replacement asks. */
  clearClipboards(): void;
};

export function useSelectionSession(options: {
  song: Song;
  track: Track | undefined;
  timeline: TrackTimeline;
  commit(next: Song, action: HistoryAction): boolean;
  pause(): void;
  /** The tab's scroller, for turning a pointer into a slot. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * A bar command landed. A queued tab scroll always dies with it; on a
   * *structural* command the highlighted bar key goes too, because after
   * bars shift the same key is a different bar.
   */
  onApplied(structural: boolean): void;
}): SelectionSession {
  const { song, track, timeline, commit, pause, scrollRef, onApplied } =
    options;

  /*
   * The store adapter is memoised on the song so `apply` always reads the
   * latest one — a stale snapshot here would commit an edit onto a song that
   * has already moved on.
   */
  const store = useMemo(
    () => ({ getSnapshot: () => ({ song }), commit }),
    [song, commit],
  );
  const transform = useTransform(store, song);

  const trackNameOf = useCallback(
    (trackId: string) =>
      song.tracks.find((entry) => entry.id === trackId)?.name ?? trackId,
    [song.tracks],
  );
  const barTransform = useBarTransform(store, song, trackNameOf);

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
  const [pasteAt, setPasteAt] = useState<PasteFlow>({ kind: "idle" });

  /** The section a time selection lives in, resolved once. */
  const selectedSection = useMemo(
    () =>
      transform.selection
        ? (song.sections.find(
            (entry) => entry.id === transform.selection?.sectionId,
          ) ?? null)
        : null,
    [song.sections, transform.selection],
  );

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
   * or the nudge would move a triplet by a sixteenth and the reader would
   * have no way to see why it refused.
   */
  const steps = useMemo(() => {
    const fallback = {
      step: ticksPerSlot(16),
      beat: ticksPerSlot(16) * 4,
      bar: ticksPerSlot(16) * 16,
    };
    if (!selectedSection || !transform.selection) return fallback;
    const starts = sectionBarStartTicks(selectedSection);
    const index = starts.findIndex((start, position) => {
      const next = starts[position + 1] ?? Number.POSITIVE_INFINITY;
      return (
        transform.selection!.startTicks >= start &&
        transform.selection!.startTicks < next
      );
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
    (edge: "start" | "end", event: ReactPointerEvent) => {
      dragEdge.current = edge;
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      event.stopPropagation();
    },
    [],
  );

  const onHandleMove = useCallback(
    (event: ReactPointerEvent) => {
      const edge = dragEdge.current;
      const selection = transform.selection;
      if (!edge || !selection || !selectedSection || timeline.kind === "unsupported")
        return;
      const content = scrollRef.current?.querySelector("[data-tab-content]");
      if (!content) return;

      const x =
        event.clientX - content.getBoundingClientRect().left - GUTTER_WIDTH;
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
    [scrollRef, selectedSection, timeline, transform],
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
   * thrown away, so this describes what would actually happen rather than
   * what we hope would.
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

  const clearTime = useCallback(() => {
    transform.clear();
    setSheet(null);
    setPasteAt({ kind: "idle" });
  }, [transform]);

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
      pause();

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

      /*
       * One onset group, and only that (spec 13.20 §1).
       *
       * The press names a moment; `pickOnsetAt` turns it into the chord struck
       * there and the ties that keep it sounding. It deliberately does not
       * reach along the legato chain — what a chain would cost is a question
       * the preflight answers when an action is chosen, not something a finger
       * decides on the reader's behalf.
       */
      const picked = pickOnsetAt(section, track.id, startTicks);
      transform.select(
        picked?.selection ?? {
          sectionId: section.id,
          trackId: track.id,
          startTicks,
          endTicks: startTicks + step,
        },
      );
    },
    [barTransform, pasteAt.kind, pause, song.sections, timeline, track, transform],
  );

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
      clearTime();
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
    [barTransform, clearTime],
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
      const next: BarSelection = { ...current, ...bounds };
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
      if (structural) pause();

      if (!barTransform.apply(options)) return;

      setBarSheet(null);
      /*
       * The time selection is measured in ticks against a layout that has
       * just moved, and a queued tab scroll names a bar key that may now mean
       * a different bar. Both go rather than being adjusted: there is no
       * honest adjustment for "the bar you asked for was deleted".
       */
      clearTime();
      onApplied(structural);
    },
    [barTransform, clearTime, onApplied, pause],
  );

  const stageBarCommand = useCallback(
    (command: BarCommand) => {
      setBarSheet(null);
      barTransform.stage(command);
    },
    [barTransform],
  );

  const clearBars = useCallback(() => {
    barTransform.clear();
    setBarSheet(null);
  }, [barTransform]);

  const resetAll = useCallback(() => {
    transform.clear();
    barTransform.clear();
    setSheet(null);
    setBarSheet(null);
    setPasteAt({ kind: "idle" });
  }, [barTransform, transform]);

  const clearClipboards = useCallback(() => {
    transform.clearClipboard();
    barTransform.clearClipboard();
  }, [barTransform, transform]);

  const applyStaged = useCallback(() => {
    const command = pasteCommand ?? transform.pending;
    if (command && transform.apply(command)) {
      setSheet(null);
      setPasteAt({ kind: "idle" });
    }
  }, [pasteCommand, transform]);

  const closeSheet = useCallback(() => {
    setSheet(null);
    setPasteAt({ kind: "idle" });
  }, []);

  const startPasteFlow = useCallback(() => {
    setSheet(null);
    setPasteAt({ kind: "choosing" });
  }, []);

  return {
    time: {
      handle: transform,
      sheet,
      pasteAt,
      pasteCommand,
      pastePreview,
      previewText,
      selectedSection,
      band,
      bandHeight,
      stepTicks: steps.step,
      beatTicks: steps.beat,
      barTicks: steps.bar,
      openSheet: setSheet,
      startPasteFlow,
      applyStaged,
      closeSheet,
      onSlotLongPress,
      onHandleDown,
      onHandleMove,
      onHandleUp,
      clear: clearTime,
    },
    bars: {
      handle: barTransform,
      sheet: barSheet,
      setSheet: setBarSheet,
      select: selectBars,
      extend: extendBars,
      selectFromTab: selectBarsFromTab,
      stage: stageBarCommand,
      apply: applyBars,
      clear: clearBars,
    },
    resetAll,
    clearClipboards,
  };
}
