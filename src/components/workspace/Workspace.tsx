"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrangeSheet, type ArrangeForm } from "@/components/workspace/ArrangeSheet";
import { EditToolbar } from "@/components/workspace/EditToolbar";
import { FretSheet, type FretSheetTarget } from "@/components/workspace/FretSheet";
import { InfoSheet } from "@/components/workspace/InfoSheet";
import { PreviewSheet } from "@/components/workspace/PreviewSheet";
import { SectionChips } from "@/components/workspace/SectionChips";
import { SelectionBar } from "@/components/workspace/SelectionBar";
import { BAR_KEY_ATTRIBUTE, TabCanvas } from "@/components/workspace/TabCanvas";
import { GUTTER_WIDTH } from "@/components/workspace/geometry";
import { TrackSelector, trackSummary } from "@/components/workspace/TrackSelector";
import { TrackSheet } from "@/components/workspace/TrackSheet";
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
import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import { sectionBarStartTicks } from "@/lib/song/onset-block";
import { ticksPerBar, ticksPerSlot, slotsPerNotatedBeat } from "@/lib/music/timing";
import { formatBpm } from "@/lib/audio/practice-rate";
import { BRAND_NAME } from "@/lib/brand";
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
import { buildTrackTimeline, sectionRuns } from "@/lib/tab/timeline";
import { validateArticulationContext } from "@/lib/validators";

type Cell = { barKey: string; slotIndex: number; stringIndex: number };

/** One frozen empty set, so a bar with nothing in it does not allocate. */
const EMPTY_SLOTS: ReadonlySet<number> = new Set<number>();

export function Workspace() {
  const { song, message, canUndo, persisted, commit, undo } = useSong();
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
  const [infoOpen, setInfoOpen] = useState(false);

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
    onApply: commit,
    onBeforePreviewPlay: () => controller.pause(),
    practicePercent: state.practicePercent,
  });
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
  const selectionEnabled = !previewOpen && !arrangeOpen && track !== undefined;

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

      const x = event.clientX - content.getBoundingClientRect().left;
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

      transform.select({
        sectionId: section.id,
        trackId: track.id,
        startTicks,
        endTicks: startTicks + step,
      });
    },
    [controller, pasteAt.kind, song.sections, timeline, track, transform],
  );

  const getPosition = useCallback(() => controller.getPosition(), [controller]);

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

  const toggleLoop = useCallback(() => {
    const current = activeBarKey?.split(":")[0] ?? runs[0]?.sectionId ?? null;
    controller.setLoopSection(state.loopSectionId ? null : current);
  }, [activeBarKey, controller, runs, state.loopSectionId]);

  // Editing and a candidate never share the screen: a candidate is measured
  // against the song as it was when it was asked for.
  const canEdit = track !== undefined && isEditableTrack(track) && !previewOpen;
  const editDisabledReason =
    track === undefined
      ? null
      : canEdit
        ? null
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

  const runCommand = useCallback(
    (build: (target: { sectionId: string; barIndex: number }) => EditCommand) => {
      if (!cell || !track) return;
      const [sectionId, barIndexText] = cell.barKey.split(":");
      const barIndex = Number(barIndexText);
      if (!sectionId || !Number.isInteger(barIndex)) return;

      const result = applyEdit(song, build({ sectionId, barIndex }));
      if (!result.ok) {
        setEditError(result.error.message);
        return;
      }
      setEditError(null);
      commit(result.song);
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
      commit(result.song);
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
      <header className="flex items-center gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-bronze text-[10px] font-semibold tracking-[0.18em] uppercase">
            {BRAND_NAME}
          </p>
          <h1 className="font-display truncate text-base leading-tight">
            {song.title}
          </h1>
        </div>
        <p className="text-muted shrink-0 text-right text-[11px] tabular-nums">
          {song.key}
          <br />
          {/*
            The tempo sounding now, not the song's top-level number. On a song
            that changes tempo the two differ for most of its length, and a
            header that is wrong most of the time is worse than no header
            (spec 13.8, K-25). The bullet says the reading is one of several.
          */}
          {state.hasTempoChanges
            ? `${formatBpm(state.activeBpm)} BPM •`
            : `${song.bpm} BPM`}{" "}
          · {meter}
        </p>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          aria-label="Ses kaynakları ve lisans"
          className="text-muted min-h-11 min-w-11 shrink-0 rounded-lg border border-line text-sm"
        >
          <span aria-hidden>&#9432;</span>
        </button>
      </header>

      {message ? (
        <p
          role="status"
          className="border-reject/50 bg-raised border-b px-3 py-2 text-xs"
        >
          {message}
        </p>
      ) : null}

      {!persisted ? (
        <p
          role="status"
          className="border-reject/50 bg-raised border-b px-3 py-2 text-xs"
        >
          Değişiklikler kaydedilemiyor; bu oturumda bellekte tutuluyor.
        </p>
      ) : null}

      <SectionChips
        runs={runs}
        activeSectionId={activeSectionId}
        loopSectionId={state.loopSectionId}
        onJump={jumpToSection}
      />

      <main className="min-h-0 flex-1">
        <TabCanvas
          timeline={timeline}
          plan={plan}
          getPosition={getPosition}
          running={state.status === "playing"}
          activeBarKey={activeBarKey}
          onActiveBarChange={setActiveBarKey}
          onSeekBar={seekToBar}
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
                left={band.left}
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
      </main>

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

      {track ? (
        <p className="text-muted truncate border-t border-line px-3 py-1.5 text-[11px]">
          {trackSummary(track)}
        </p>
      ) : null}

      {editing ? (
        <SelectionBar
          count={selection?.refs.length ?? 0}
          error={moveError}
          onMove={moveSelection}
          onClear={clearSelection}
          onUndo={undo}
          canUndo={canUndo}
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
        arrangeDisabled={skills.length === 0 || previewOpen}
        canUndo={canUndo}
        onUndo={undo}
        showUndo={selection === null}
      />

      <TrackSelector
        tracks={song.tracks}
        selectedTrackId={track?.id ?? ""}
        onSelect={(id) => {
          setEditing(false);
          setCell(null);
          clearSelection();
          // A selection belongs to one track and one section (2I-A V1), so it
          // cannot survive a change of either.
          transform.clear();
          setSheet(null);
          setPasteAt({ kind: "idle" });
          setSelectedTrackId(id);
        }}
        onOpenDetails={() => setTrackSheetOpen(true)}
      />

      <TransportBar
        state={state}
        runs={runs}
        onPlayPause={() => controller.toggle()}
        onRewind={() => controller.rewind()}
        onToggleLoop={toggleLoop}
        onToggleMetronome={() => controller.setMetronome(!state.metronome)}
        onPracticePercentChange={setPracticeRatePercent}
      />

      {track ? (
        <TrackSheet
          track={track}
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
            runCommand(({ sectionId, barIndex }) => ({
              kind: "set_articulation",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
              stringIndex: cell?.stringIndex ?? 0,
              articulation,
            }))
          }
          onCommit={(fret) =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "set_note",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
              stringIndex: cell?.stringIndex ?? 0,
              fret,
            }))
          }
          onClearString={() =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "clear_string",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
              stringIndex: cell?.stringIndex ?? 0,
            }))
          }
          onRest={() =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "set_rest",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
            }))
          }
          onTie={() =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "set_tie",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
            }))
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

      <InfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
