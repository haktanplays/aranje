"use client";

/**
 * The note-editing session (2L-R): edit mode, the selected cell, and the
 * onset-group selection that moves music around (spec 13.1).
 *
 * This is the command bridge for single-note edits and group moves: it
 * prepares the target the pure cores need, delegates the result to the one
 * unified commit with its typed action, and routes refusals into the error
 * strings the sheets show. The algorithms themselves live in
 * `@/lib/song/edit` and `@/lib/song/move`; nothing here re-implements them,
 * touches storage, or builds an engine.
 */
import { useCallback, useMemo, useState } from "react";

import {
  applySpanRemove,
} from "@/lib/song/technique-write";
import {
  NOTHING_CHOSEN,
  previewTechnique,
  regionsInScope,
  runTechnique,
  techniqueScope,
  noteInScope,
  type TechniqueGroupId,
  type TechniqueSurface,
} from "@/lib/song/technique-surface";
import type { FretSheetTarget } from "@/components/workspace/FretSheet";
import {
  beginDurationDrag,
  commitDurationDrag,
  dragChanged,
  durationDragLabel,
  moveDurationDrag,
  type DurationDrag,
} from "@/lib/song/duration-drag";
import {
  arpeggioToChord,
  chordToArpeggio,
  setChordStrum,
  type ArpeggioDirection,
  type ArpeggioStep,
  type TransformFailure,
} from "@/lib/song/chord-shape";
import { readingResolution, slotCount } from "@/lib/music/timing";
import { applyEdit, type EditCommand } from "@/lib/song/edit";
import {
  guessHarmony,
  harmonyOf,
  type HarmonyChoice,
} from "@/lib/song/harmony-guess";
import { notesForBar, playabilityNotes, type PlayabilityNote } from "@/lib/song/playability";
import { retuneHarmony, type RetuneWarning } from "@/lib/song/retune-harmony";
import {
  defaultRhythmTicks,
  rhythmChoices,
  type RhythmChoice,
} from "@/lib/song/rhythm-choice";
import {
  gridLine,
  meterLine,
  tempoLine,
  type CountingLine,
} from "@/lib/music/counting-language";
import { applyMoveOnsetGroup, type OnsetMovement } from "@/lib/song/move";
import {
  blockContaining,
  findSection,
  sectionOnsetBlocks,
  type OnsetRef,
} from "@/lib/song/onset-block";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song, Track } from "@/lib/song/schema";
import {
  chooseOnset,
  type SelectMode,
  type Selection,
} from "@/lib/song/selection";
import type { TrackTimeline } from "@/lib/tab/timeline";
import { validateArticulationContext } from "@/lib/validators";

/** What a refused retune is called, in the reader's words. */
const RETUNE_REFUSALS: Readonly<Record<string, string>> = {
  target_not_found: "Bu ölçü artık burada değil.",
  not_a_melodic_track: "Bu track'te akor değiştirilemez.",
  empty_selection: "Bu ölçüde taşınacak nota yok.",
  unknown_root: "Bu kök ses tanınmadı.",
  unreachable_pitch: "Sonuç enstrümanın dışına düşüyor.",
};

/** What a refused transform is called, in the reader's words. */
const SHAPE_REFUSALS: Readonly<Record<TransformFailure, string>> = {
  target_not_found: "Bu vuruş artık burada değil.",
  not_a_melodic_track: "Bu track'te akor dönüşümü yapılamaz.",
  not_a_chord: "Burada dönüştürülecek bir akor yok.",
  would_not_fit: "Bu dönüşüm bu ölçüye sığmıyor.",
  validation_failed: "Bu dönüşüm yazılamadı.",
};

/** One line saying what would happen, for a preview that writes nothing. */
function shapeSummary(command: ShapeCommand, voices: number): string {
  if (command.kind === "to_arpeggio") {
    const ring = command.ring ? "çınlayarak" : "ayrık";
    return `${voices} ses ${ring} arpeje yayılır.`;
  }
  if (command.kind === "to_chord") return `${voices} ses tek vuruşta toplanır.`;
  return command.direction === null
    ? "Vuruş yönü kaldırılır."
    : `${voices} ses ${command.direction === "down" ? "aşağı" : "yukarı"} vuruşla çalınır.`;
}

/** What a refused length is called, in the reader's words. */
const DURATION_REFUSALS: Readonly<Record<string, string>> = {
  target_not_found: "Bu nota artık burada değil.",
  not_a_melodic_track: "Bu track'te nota süresi yazılamaz.",
  not_an_onset: "Bu adımda başlayan bir nota yok.",
  note_not_found: "Bu nota artık burada değil.",
  duration_out_of_range: "Bu uzunluk bu bölüme sığmıyor.",
  validation_failed: "Bu uzunluk yazılamadı.",
};

export type EditedCell = {
  barKey: string;
  slotIndex: number;
  stringIndex: number;
};

export type GroupSelection = {
  readonly selection: Selection | null;
  readonly moveError: string | null;
  /** Slots to draw as selected, tie tails included — it is the same sound. */
  readonly selectionView: {
    sectionId: string;
    onsets: Map<number, Set<number>>;
    selected: Map<number, Set<number>>;
  } | null;
  /** Every onset of every section, keyed `sectionId:barIndex`. */
  readonly onsetsOfSection: Map<string, Set<number>>;
  pick(sectionId: string, ref: OnsetRef, mode: SelectMode): void;
  move(movement: OnsetMovement): void;
  clear(): void;
};

/**
 * A finger on the selected note's length (2T-B §6).
 *
 * Nothing is written while `drag` is live. The handle draws the preview from
 * `previewTicks`, the reader is told `label`, and the only call that touches
 * the song is `release`. Cancelling leaves the song byte-identical because it
 * was never anything but a number in an object.
 */
export type DurationGesture = {
  readonly drag: DurationDrag | null;
  /** What the note would be, or null when no drag is running. */
  readonly previewTicks: number | null;
  /** The value and how far it moved, for the reader to see mid-gesture. */
  readonly label: string | null;
  /** True while the gesture owns the pointer and the page must not scroll. */
  readonly active: boolean;
  grab(noteIndex: number): void;
  moveBy(deltaPx: number, slotWidthPx: number): void;
  /** Apply, atomically, as one command and one step of history. */
  release(): void;
  cancel(): void;
  /** One whole step from the buttons, without going through a drag. */
  step(noteIndex: number, steps: number): void;
};

/** What the reader can ask of the chord under the selection (2T-B §7). */
export type ShapeCommand =
  | {
      readonly kind: "to_arpeggio";
      readonly direction: ArpeggioDirection;
      readonly stepTicks: ArpeggioStep;
      readonly ring: boolean;
    }
  | { readonly kind: "to_chord"; readonly spanSlots: number }
  | { readonly kind: "set_strum"; readonly direction: "down" | "up" | null };

/**
 * What one of those would do, worked out without writing anything.
 *
 * The preview runs the same pure core the apply runs, on the same song, and
 * throws the result away. That is the only kind of preview worth having: it
 * cannot disagree with what applying would do, because it *is* what applying
 * would do.
 */
export type ShapePreview =
  | {
      readonly kind: "ready";
      readonly onsets: readonly { readonly slotIndex: number; readonly pitch: string }[];
      readonly summary: string;
    }
  | { readonly kind: "refused"; readonly reason: string };

export type ShapeGesture = {
  /** True when there is a chord here at all to ask anything of. */
  readonly available: boolean;
  preview(command: ShapeCommand): ShapePreview;
  apply(command: ShapeCommand): void;
};

/**
 * The rhythm the next note will be written at, and the three counting
 * questions that surround it (2T-C §2, §4).
 *
 * `ticks` is what a new note's `durationTicks` becomes, so a note written
 * through the real UI says how long it is rather than inheriting a tie run.
 * It follows the bar's grid until the reader chooses otherwise, because a
 * length nobody picked should be the one the grid is already counting in.
 */
export type RhythmSession = {
  readonly ticks: number;
  readonly choices: readonly RhythmChoice[];
  /** Ölçü, tempo and ızgara — three questions, three sentences. */
  readonly counting: readonly CountingLine[];
  choose(ticks: number): void;
};

/**
 * "Keep the rhythm, change the chord", as a reader uses it (2T-C §7).
 *
 * The source chord is proposed from the notes already there and stays
 * editable — a guess that is usually right and always correctable beats a
 * blank field. The preview runs the same transform the apply runs and throws
 * the result away, so it cannot disagree about what would happen, including
 * about a refusal.
 */
export type RetuneSession = {
  readonly available: boolean;
  readonly from: HarmonyChoice | null;
  readonly to: HarmonyChoice | null;
  chooseFrom(choice: HarmonyChoice): void;
  chooseTo(choice: HarmonyChoice): void;
  readonly preview:
    | { readonly kind: "idle" }
    | {
        readonly kind: "ready";
        readonly moves: readonly { readonly from: string; readonly to: string }[];
        readonly warnings: readonly RetuneWarning[];
      }
    | { readonly kind: "refused"; readonly reason: string };
  apply(): void;
};

export type NoteEditing = {
  readonly editing: boolean;
  readonly cell: EditedCell | null;
  /**
   * Whether the full technique sheet is open (2V-B.4 §4).
   *
   * A tap used to open it by itself, over the grid. It is a deliberate second
   * step now — "Tüm teknikler" in the note panel — so the ordinary edit stays
   * beside the music and the sixteen techniques stay reachable.
   */
  readonly detailsOpen: boolean;
  readonly editError: string | null;
  readonly currentFret: number | null;
  readonly currentArticulation: string | null;
  readonly fretTarget: FretSheetTarget | null;
  readonly group: GroupSelection;
  readonly duration: DurationGesture;
  readonly shape: ShapeGesture;
  /**
   * The three Çalım questions, bound to the selected note (2V-D.1-C §12).
   *
   * Bound here rather than in a controller of its own because it needs the
   * same cell this one already owns, and a second place deciding what "the
   * selected note" means is how two surfaces start disagreeing about it.
   * Every decision it makes lives in `technique-surface`, which is pure; what
   * is held here is the refusal sentence and nothing else.
   */
  readonly technique: TechniqueSurface;
  readonly rhythm: RhythmSession;
  readonly retune: RetuneSession;
  /** What a real guitar would have trouble with, in this bar (2T-C §8). */
  readonly playability: readonly PlayabilityNote[];
  toggleEdit(): void;
  /** Leave edit mode without touching the cell/selection resets. */
  exitEditMode(): void;
  selectCell(next: EditedCell | null): void;
  closeCell(): void;
  openDetails(): void;
  closeDetails(): void;
  nudge(delta: { slot?: number; string?: number }): void;
  /** The command bridge: target prepared here, algorithm in the pure core. */
  runCommand(
    build: (target: {
      sectionId: string;
      trackId: string;
      barIndex: number;
      slotIndex: number;
    }) => EditCommand,
  ): void;
  /** Cell, error and group selection down. Edit mode itself stays. */
  reset(): void;
  /** What a track change costs: mode off, cell down, group selection down. */
  stopForTrackChange(): void;
};

export function useNoteEditing(options: {
  song: Song;
  track: Track | undefined;
  timeline: TrackTimeline;
  commit(next: Song, action: HistoryAction): boolean;
  /** Editing and playback do not share the screen (spec 13.1). */
  pause(): void;
}): NoteEditing {
  const { song, track, timeline, commit, pause } = options;

  const [editing, setEditing] = useState(false);
  const [cell, setCell] = useState<EditedCell | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [drag, setDrag] = useState<DurationDrag | null>(null);
  /* Null until the reader picks one; the grid's own step until then. */
  const [chosenTicks, setChosenTicks] = useState<number | null>(null);
  const [retuneFrom, setRetuneFrom] = useState<HarmonyChoice | null>(null);
  const [retuneTo, setRetuneTo] = useState<HarmonyChoice | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // A group selection belongs to one track and one section at a time, so the
  // section it was made in is part of the state rather than derived (spec 13.1).
  const [selection, setSelection] = useState<Selection | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const clearGroup = useCallback(() => {
    setSelection(null);
    setMoveError(null);
  }, []);

  const toggleEdit = useCallback(() => {
    setEditError(null);
    setCell(null);
    setDetailsOpen(false);
    clearGroup();
    setEditing((was) => {
      if (!was) pause();
      return !was;
    });
  }, [clearGroup, pause]);

  const exitEditMode = useCallback(() => {
    setEditing(false);
  }, []);

  const selectCell = useCallback((next: EditedCell | null) => {
    setEditError(null);
    setDrag(null);
    setCell(next);
    /* A new position is a new question; the sheet from the last one would
       answer it about the wrong note. */
    setDetailsOpen(false);
  }, []);

  const closeCell = useCallback(() => {
    setCell(null);
    setDetailsOpen(false);
    setDrag(null);
    setEditError(null);
  }, []);

  const openDetails = useCallback(() => setDetailsOpen(true), []);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);

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

  /*
   * Let-ring is a performance field rather than an articulation, so it is
   * read from the note itself instead of from the span's articulation.
   */
  const currentLetRing = useMemo(() => {
    if (!cell || !track) return false;
    const [sectionId, barIndexText] = cell.barKey.split(":");
    const bar = song.sections
      .find((entry) => entry.id === sectionId)
      ?.bars[Number(barIndexText)];
    const slots = bar?.slots[track.id];
    if (!slots || !Array.isArray(slots)) return false;
    const slot = slots[cell.slotIndex];
    if (slot === null || slot === undefined || slot === "-" || Array.isArray(slot)) {
      return false;
    }
    return (
      slot.notes.find((note) => note.position?.string === cell.stringIndex)?.letRing ===
      true
    );
  }, [cell, song, track]);

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
      noteIndex: currentSpan?.noteIndex ?? null,
      writtenTicks: currentSpan?.writtenTicks ?? null,
      letRing: currentLetRing,
    };
  }, [
    articulationWarning,
    cell,
    currentArticulation,
    currentFret,
    currentLetRing,
    currentSpan,
    timeline,
  ]);

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

  const pick = useCallback(
    (sectionId: string, ref: OnsetRef, mode: SelectMode) => {
      setMoveError(null);
      setSelection((current) => chooseOnset(current, sectionId, ref, mode));
    },
    [],
  );

  const move = useCallback(
    (movement: OnsetMovement) => {
      if (!selection || !track) return;
      // Moving music while it is playing would leave the ear behind the eye.
      pause();

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
    [commit, pause, selection, song, timeline, track],
  );

  const reset = useCallback(() => {
    clearGroup();
    setCell(null);
    setDrag(null);
    setEditError(null);
  }, [clearGroup]);

  const stopForTrackChange = useCallback(() => {
    setEditing(false);
    setCell(null);
    setDrag(null);
    clearGroup();
  }, [clearGroup]);

  /* --------------------------------------------- the rhythm being written */

  const rhythmTarget = useMemo(() => {
    if (!cell || !track) return null;
    const [sectionId, barIndexText] = cell.barKey.split(":");
    const barIndex = Number(barIndexText);
    if (!sectionId || !Number.isInteger(barIndex)) return null;
    return { sectionId, barIndex, trackId: track.id, slotIndex: cell.slotIndex };
  }, [cell, track]);

  const choices = useMemo(
    () => (rhythmTarget ? rhythmChoices(song, rhythmTarget) : []),
    [rhythmTarget, song],
  );

  const gridTicks = rhythmTarget ? defaultRhythmTicks(song, rhythmTarget) : 0;
  /*
   * A chosen value this grid cannot write is not silently kept: changing the
   * grid under a choice would otherwise write a note whose end nothing can
   * start from.
   */
  const rhythmTicks =
    chosenTicks !== null && choices.some((choice) => choice.ticks === chosenTicks)
      ? chosenTicks
      : gridTicks;

  const counting = useMemo(() => {
    const bar = song.sections
      .find((entry) => entry.id === rhythmTarget?.sectionId)
      ?.bars[rhythmTarget?.barIndex ?? -1];
    if (!bar) return [];
    return [
      meterLine(bar.timeSignature),
      tempoLine(song.bpm),
      /* What the reader is reading, not the lattice under it (§5). */
      gridLine(bar.timeSignature, readingResolution(bar)),
    ];
  }, [rhythmTarget, song]);

  /* ------------------------------------------------ keep rhythm, new chord */

  const retuneRun = useMemo(() => {
    if (!rhythmTarget) return null;
    const bar = song.sections
      .find((entry) => entry.id === rhythmTarget.sectionId)
      ?.bars[rhythmTarget.barIndex];
    if (!bar) return null;
    /*
     * The whole bar the reader is standing in. A bar is a unit a reader
     * already thinks in, and it is what the selection they made covers.
     */
    return {
      sectionId: rhythmTarget.sectionId,
      barIndex: rhythmTarget.barIndex,
      trackId: rhythmTarget.trackId,
      fromSlot: 0,
      toSlot: slotCount(bar.timeSignature, bar.resolution),
    };
  }, [rhythmTarget, song]);

  const guessed = useMemo(
    () => (retuneRun ? guessHarmony(song, retuneRun) : null),
    [retuneRun, song],
  );
  const sourceHarmony = retuneFrom ?? guessed;

  const retunePreview = useMemo((): RetuneSession["preview"] => {
    if (!retuneRun || sourceHarmony === null || retuneTo === null) {
      return { kind: "idle" };
    }
    const result = retuneHarmony(
      song,
      retuneRun,
      harmonyOf(sourceHarmony),
      harmonyOf(retuneTo),
    );
    if (!result.ok) {
      return {
        kind: "refused",
        reason: result.detail ?? RETUNE_REFUSALS[result.reason] ?? "Bu dönüşüm yapılamadı.",
      };
    }
    return {
      kind: "ready",
      moves: result.moves.map((move) => ({ from: move.from, to: move.to })),
      warnings: result.warnings,
    };
  }, [retuneRun, retuneTo, song, sourceHarmony]);

  const applyRetune = useCallback(() => {
    if (!retuneRun || sourceHarmony === null || retuneTo === null) return;
    const result = retuneHarmony(
      song,
      retuneRun,
      harmonyOf(sourceHarmony),
      harmonyOf(retuneTo),
    );
    if (!result.ok) {
      setEditError(
        result.detail ?? RETUNE_REFUSALS[result.reason] ?? "Bu dönüşüm yapılamadı.",
      );
      return;
    }
    setEditError(null);
    commit(result.song, { kind: "retune_harmony" });
  }, [commit, retuneRun, retuneTo, song, sourceHarmony]);

  /* ------------------------------------------- what the instrument can do */

  const playability = useMemo(() => {
    if (!track || !rhythmTarget) return [];
    return notesForBar(playabilityNotes(song, track.id), rhythmTarget.barIndex);
  }, [rhythmTarget, song, track]);

  /* -------------------------------------------- the chord-shape transforms */

  const shapeTarget = useMemo(() => {
    if (!cell || !track) return null;
    const [sectionId, barIndexText] = cell.barKey.split(":");
    const barIndex = Number(barIndexText);
    if (!sectionId || !Number.isInteger(barIndex)) return null;
    return { sectionId, barIndex, trackId: track.id, slotIndex: cell.slotIndex };
  }, [cell, track]);

  const runShape = useCallback(
    (command: ShapeCommand) => {
      if (!shapeTarget) return null;
      switch (command.kind) {
        case "to_arpeggio":
          return chordToArpeggio(song, shapeTarget, {
            direction: command.direction,
            stepTicks: command.stepTicks,
            ring: command.ring,
          });
        case "to_chord":
          return arpeggioToChord(song, shapeTarget, command.spanSlots);
        case "set_strum":
          return setChordStrum(song, shapeTarget, command.direction);
      }
    },
    [shapeTarget, song],
  );

  const previewShape = useCallback(
    (command: ShapeCommand): ShapePreview => {
      const result = runShape(command);
      if (result === null) return { kind: "refused", reason: SHAPE_REFUSALS.target_not_found };
      if (!result.ok) {
        return {
          kind: "refused",
          reason: result.detail ?? SHAPE_REFUSALS[result.reason],
        };
      }
      return {
        kind: "ready",
        onsets: result.onsets,
        summary: shapeSummary(command, result.onsets.length),
      };
    },
    [runShape],
  );

  const applyShape = useCallback(
    (command: ShapeCommand) => {
      const result = runShape(command);
      if (result === null) return;
      if (!result.ok) {
        setEditError(result.detail ?? SHAPE_REFUSALS[result.reason]);
        return;
      }
      setEditError(null);
      commit(result.song, {
        kind: "chord_shape",
        command:
          command.kind === "set_strum"
            ? command.direction === null
              ? "clear_strum"
              : "set_strum"
            : command.kind,
      });
    },
    [commit, runShape],
  );

  /* ------------------------------------------------------- the çalım axes */

  const techniqueTarget = useMemo(() => {
    if (!cell || !track?.fretboard) return null;
    const scope = techniqueScope(song, track.id, cell);
    if (!scope) return null;
    const barIndex = Number(cell.barKey.split(":")[1]);
    return { scope, barIndex };
  }, [cell, song, track]);

  const runTechniqueChoice = useCallback(
    (group: TechniqueGroupId, value: string | null) => {
      if (!techniqueTarget) return null;
      return runTechnique(song, techniqueTarget.scope, group, value);
    },
    [song, techniqueTarget],
  );

  const applyTechnique = useCallback(
    (group: TechniqueGroupId, value: string | null) => {
      const result = runTechniqueChoice(group, value);
      if (result === null) {
        setEditError(NOTHING_CHOSEN);
        return;
      }
      if (!result.ok) {
        setEditError(result.message);
        return;
      }
      setEditError(null);
      commit(result.song, { kind: "technique_write", group, value });
    },
    [commit, runTechniqueChoice],
  );

  const removeRegion = useCallback(
    (id: string) => {
      if (!techniqueTarget) return;
      const result = applySpanRemove(song, {
        sectionId: techniqueTarget.scope.sectionId,
        spanId: id,
      });
      if (!result.ok) {
        setEditError(result.message);
        return;
      }
      setEditError(null);
      commit(result.song, { kind: "technique_write", group: "region", value: null });
    },
    [commit, song, techniqueTarget],
  );

  const technique: TechniqueSurface = useMemo(() => {
    const scope = techniqueTarget?.scope ?? null;
    const note =
      scope && cell ? noteInScope(song, scope, cell.slotIndex, techniqueTarget!.barIndex) : null;
    return {
      available: scope !== null,
      attack: note?.attack ?? null,
      picking: note?.picking ?? null,
      regions: scope ? regionsInScope(song, scope) : [],
      noteCount: scope?.targets.length ?? 0,
      barCount: scope?.barCount ?? 0,
      error: editError,
      preview: (group, value) => previewTechnique(song, scope, group, value),
      apply: applyTechnique,
      removeRegion,
    };
  }, [applyTechnique, cell, editError, removeRegion, song, techniqueTarget]);

  /* ------------------------------------------------ the duration gesture */

  const durationTargetOf = useCallback(
    (noteIndex: number) => {
      if (!cell || !track) return null;
      const [sectionId, barIndexText] = cell.barKey.split(":");
      const barIndex = Number(barIndexText);
      if (!sectionId || !Number.isInteger(barIndex)) return null;
      return {
        sectionId,
        barIndex,
        trackId: track.id,
        slotIndex: cell.slotIndex,
        noteIndex,
      };
    },
    [cell, track],
  );

  const grabDuration = useCallback(
    (noteIndex: number) => {
      const target = durationTargetOf(noteIndex);
      if (!target) return;
      setEditError(null);
      setDrag(beginDurationDrag(song, target));
    },
    [durationTargetOf, song],
  );

  const moveDuration = useCallback(
    (deltaPx: number, slotWidthPx: number) => {
      setDrag((current) =>
        current === null ? current : moveDurationDrag(song, current, deltaPx, slotWidthPx),
      );
    },
    [song],
  );

  const cancelDuration = useCallback(() => setDrag(null), []);

  /**
   * One step longer or shorter, from the buttons beside the grip (2T-C §11).
   *
   * The buttons used to perform the drag: grab, move one step, release, all
   * in one event handler. Two things were wrong with that, and both were
   * measured through the real UI rather than reasoned about — a reader
   * tapping `+` five times got three steps, and the first tap did nothing at
   * all. `release` read the drag from its own closure, which is last
   * render's value: the first tap released a drag that did not exist yet,
   * and every tap after it committed the *previous* tap's length.
   *
   * A tap is not a drag with the mouse held still. It is one command, so it
   * is written as one: read the note as it is now, move it a step, commit.
   * Nothing is stored between the taps, so nothing can be stale.
   */
  const stepDuration = useCallback(
    (noteIndex: number, steps: number) => {
      const target = durationTargetOf(noteIndex);
      if (!target) return;
      setEditError(null);
      const begun = beginDurationDrag(song, target);
      if (begun === null) return;
      /* One pixel to one step: the pure core only reads the ratio. */
      const moved = moveDurationDrag(song, begun, steps, 1);
      if (!dragChanged(moved)) return;
      const result = commitDurationDrag(song, moved);
      if (!result.ok) {
        setEditError(DURATION_REFUSALS[result.reason] ?? "Bu uzunluk yazılamadı.");
        return;
      }
      commit(result.song, {
        kind: "note_duration",
        direction: steps > 0 ? "longer" : "shorter",
      });
    },
    [commit, durationTargetOf, song],
  );

  const releaseDuration = useCallback(() => {
    if (drag === null) return;
    setDrag(null);
    /*
     * A gesture that asked for nothing writes nothing. Committing an
     * unchanged length would put an empty step into the history that undo
     * would then spend itself on.
     */
    if (!dragChanged(drag)) return;
    const result = commitDurationDrag(song, drag);
    if (!result.ok) {
      setEditError(DURATION_REFUSALS[result.reason] ?? "Bu uzunluk yazılamadı.");
      return;
    }
    commit(result.song, {
      kind: "note_duration",
      direction: drag.ticks > drag.startTicks ? "longer" : "shorter",
    });
  }, [commit, drag, song]);

  return {
    editing,
    cell,
    detailsOpen,
    editError,
    currentFret,
    currentArticulation,
    fretTarget,
    rhythm: {
      ticks: rhythmTicks,
      choices,
      counting,
      choose: setChosenTicks,
    },
    retune: {
      available: retuneRun !== null && guessed !== null,
      from: sourceHarmony,
      to: retuneTo,
      chooseFrom: setRetuneFrom,
      chooseTo: setRetuneTo,
      preview: retunePreview,
      apply: applyRetune,
    },
    playability,
    shape: {
      available: shapeTarget !== null,
      preview: previewShape,
      apply: applyShape,
    },
    technique,
    duration: {
      drag,
      previewTicks: drag?.ticks ?? null,
      label: drag === null ? null : durationDragLabel(drag),
      active: drag !== null,
      grab: grabDuration,
      moveBy: moveDuration,
      release: releaseDuration,
      cancel: cancelDuration,
      step: stepDuration,
    },
    group: {
      selection,
      moveError,
      selectionView,
      onsetsOfSection,
      pick,
      move,
      clear: clearGroup,
    },
    toggleEdit,
    exitEditMode,
    selectCell,
    closeCell,
    openDetails,
    closeDetails,
    nudge,
    runCommand,
    reset,
    stopForTrackChange,
  };
}
