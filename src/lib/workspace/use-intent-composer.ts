"use client";

/**
 * The intent layer, wired to the surface (2S-A §6, §7, §8, §9).
 *
 * A thin controller and nothing else. Every decision it needs is made by a
 * pure module — `composer-tool` holds what the reader is holding,
 * `power-chord-pen` decides what a touch on a fret means, `legato-brush`
 * decides what a covered run means, `continue-pattern` decides what "again"
 * means — and what is left here is: read the current song, call the right
 * one, and hand the single result to the single commit.
 *
 * Nothing here computes music. Nothing here touches storage, history
 * internals or a serialiser; `commit` is the one door, exactly as it is for
 * every other command since 2L-R.
 *
 * ## Preview is the command
 *
 * The ghost a reader sees is the Song the command really produced. There is
 * no separate "what it would look like" path, because a second path is a
 * second answer — and the one thing a preview must never do is show a result
 * the commit will not give.
 */
import { useCallback, useMemo, useState } from "react";

import {
  NO_TOOL,
  activate,
  releasedOn,
  type ComposerTool,
} from "@/lib/workspace/composer-tool";
import {
  writePowerChord,
  type PowerChordVoices,
} from "@/lib/chords/power-chord-pen";
import {
  applyBrush,
  brushMessage,
  planBrush,
  type BrushPlan,
  type LegatoChoice,
} from "@/lib/song/legato-brush";
import {
  continuePattern,
  type ContinuePlanMode,
} from "@/lib/song/continue-pattern";
import { sectionSlotStream } from "@/lib/song/onset-block";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { EditedCell, NoteEditing } from "@/lib/workspace/use-note-editing";
import type { Song, Track } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

/** Where a finger landed, in the terms the tab already speaks. */
export type ComposerTarget = {
  readonly barKey: string;
  readonly slotIndex: number;
  readonly stringIndex: number;
};

/** A run the brush is covering, before any decision has been made. */
export type BrushGesture = {
  readonly sectionId: string;
  readonly fromTicks: number;
  readonly toTicks: number;
};

export type IntentComposer = {
  readonly tool: ComposerTool;
  /** Pick a tool up, or put the held one down by choosing it again. */
  pick(next: ComposerTool): void;
  /** Let go, for a reason that is not the reader choosing to. */
  release(): void;
  /** Set when the last command was refused, in words the reader can act on. */
  readonly refusal: string | null;
  clearRefusal(): void;

  /* ------------------------------------------------------------ the pen */
  /** True when a touch on the staff would write a power chord. */
  readonly penArmed: boolean;
  /** What the pen would write here, without writing it. */
  previewPen(target: ComposerTarget): Song | null;
  /** True when the beat already carries an onset, so a decision is owed. */
  occupiedAt(target: ComposerTarget): boolean;
  /** Write it. `replace` is the reader having said so out loud. */
  applyPen(target: ComposerTarget, mode: "insert" | "replace"): boolean;

  /* ---------------------------------------------------------- the brush */
  readonly gesture: BrushGesture | null;
  readonly brushPlan: BrushPlan | null;
  beginGesture(gesture: BrushGesture): void;
  cancelGesture(): void;
  applyBrushChoice(choice: LegatoChoice, overrideExisting?: boolean): boolean;

  /* -------------------------------------------------- continue a pattern */
  continueSelection(
    selection: TimeSelection,
    mode: ContinuePlanMode,
    repeats: number,
    onOverrun?: "refuse" | "fit",
  ): boolean;
};

export function useIntentComposer(options: {
  song: Song;
  track: Track | undefined;
  /** Which section the reader is looking at, for a gesture with no bar key. */
  sectionId: string | null;
  commit(next: Song, action: HistoryAction): boolean;
}): IntentComposer {
  const { song, track, sectionId, commit } = options;

  /*
   * A tool belongs to the track and the section it was picked up on.
   *
   * Held as a pair rather than reset by an effect: changing track is the
   * reader going somewhere else, and a pen that followed them would write
   * into music they were not looking at when they armed it. Keeping the owner
   * beside the tool makes that a fact about the value rather than a race
   * between a render and a cleanup.
   */
  const owner = `${track?.id ?? ""}/${sectionId ?? ""}`;
  const [held, setHeld] = useState<{ owner: string; tool: ComposerTool }>({
    owner,
    tool: NO_TOOL,
  });
  const tool = held.owner === owner ? held.tool : releasedOn("track_changed");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [gesture, setGesture] = useState<BrushGesture | null>(null);

  const pick = useCallback(
    (next: ComposerTool) => {
      setRefusal(null);
      setHeld((current) => ({
        owner,
        tool: activate(current.owner === owner ? current.tool : NO_TOOL, next),
      }));
    },
    [owner],
  );

  const release = useCallback(() => {
    setHeld({ owner, tool: releasedOn("editing_ended") });
    setGesture(null);
    setRefusal(null);
  }, [owner]);

  const pen = useMemo(
    (): { voices: PowerChordVoices; fret: number } | null =>
      tool.kind === "power_chord" ? { voices: tool.voices, fret: tool.fret } : null,
    [tool],
  );

  /** The moment a cell sits at, in ticks from the start of its section. */
  const momentOf = useCallback(
    (target: ComposerTarget) => {
      const [section, barText] = target.barKey.split(":");
      const barIndex = Number(barText);
      if (!section || !Number.isInteger(barIndex) || !track) return null;
      const found = song.sections.find((entry) => entry.id === section);
      if (!found) return null;
      const stream = sectionSlotStream(found, track.id);
      const slot = stream.find(
        (entry) => entry.barIndex === barIndex && entry.slotIndex === target.slotIndex,
      );
      if (!slot) return null;
      return { sectionId: section, slot };
    },
    [song, track],
  );

  const runPen = useCallback(
    (target: ComposerTarget, mode: "insert" | "replace_onset") => {
      if (!track || !pen) return null;
      const at = momentOf(target);
      if (!at) return null;
      return writePowerChord({
        song,
        track,
        sectionId: at.sectionId,
        timeTicks: at.slot.startTicks,
        durationTicks: at.slot.durationTicks,
        stringIndex: target.stringIndex,
        fret: pen.fret,
        voices: pen.voices,
        mode,
      });
    },
    [momentOf, pen, song, track],
  );

  const previewPen = useCallback(
    (target: ComposerTarget) => {
      const result = runPen(target, "insert") ?? runPen(target, "replace_onset");
      return result && result.ok ? result.song : null;
    },
    [runPen],
  );

  const occupiedAt = useCallback(
    (target: ComposerTarget) => {
      const at = momentOf(target);
      if (!at) return false;
      const slot = at.slot.slot;
      return slot !== undefined && slot !== null && slot !== "-" && !Array.isArray(slot);
    },
    [momentOf],
  );

  const applyPen = useCallback(
    (target: ComposerTarget, mode: "insert" | "replace") => {
      const result = runPen(target, mode === "replace" ? "replace_onset" : "insert");
      if (!result) return false;
      if (!result.ok) {
        setRefusal(result.error.message);
        return false;
      }
      setRefusal(null);
      return commit(result.song, { kind: "power_chord", mode });
    },
    [commit, runPen],
  );

  /* ---------------------------------------------------------- the brush */

  const brushPlan = useMemo(() => {
    if (!gesture || !track) return null;
    return planBrush({
      song,
      trackId: track.id,
      sectionId: gesture.sectionId,
      fromTicks: gesture.fromTicks,
      toTicks: gesture.toTicks,
      choice: tool.kind === "connect" ? tool.connection : "auto",
    });
  }, [gesture, song, tool, track]);

  const applyBrushChoice = useCallback(
    (choice: LegatoChoice, overrideExisting?: boolean) => {
      if (!gesture || !track) return false;
      const result = applyBrush({
        song,
        trackId: track.id,
        sectionId: gesture.sectionId,
        fromTicks: gesture.fromTicks,
        toTicks: gesture.toTicks,
        choice,
        ...(overrideExisting === undefined ? {} : { overrideExisting }),
      });
      if (!result.ok) {
        setRefusal(brushMessage(result.reason));
        return false;
      }
      setRefusal(null);
      const written = commit(result.song, { kind: "legato_brush" });
      if (written) setGesture(null);
      return written;
    },
    [commit, gesture, song, track],
  );

  /* -------------------------------------------------- continue a pattern */

  const continueSelection = useCallback(
    (
      selection: TimeSelection,
      mode: ContinuePlanMode,
      repeats: number,
      onOverrun?: "refuse" | "fit",
    ) => {
      const result = continuePattern({
        song,
        selection,
        mode,
        repeats,
        ...(onOverrun === undefined ? {} : { onOverrun }),
      });
      if (!result.ok) {
        setRefusal(result.error.message);
        return false;
      }
      setRefusal(null);
      return commit(result.song, { kind: "continue_pattern" });
    },
    [commit, song],
  );

  return {
    tool,
    pick,
    release,
    refusal,
    clearRefusal: useCallback(() => setRefusal(null), []),
    penArmed: pen !== null,
    previewPen,
    occupiedAt,
    applyPen,
    gesture,
    brushPlan,
    beginGesture: useCallback((next: BrushGesture) => {
      setRefusal(null);
      setGesture(next);
    }, []),
    cancelGesture: useCallback(() => setGesture(null), []),
    applyBrushChoice,
    continueSelection,
  };
}

/**
 * The editing surface a touch lands on while a pen is held (2S-A §7).
 *
 * One place decides what a touch means; two would be two answers to one
 * finger. With the pen armed a cell tap writes a power chord — replacing what
 * is there only when the reader is replacing something, which the surface
 * knows because it asked — and with nothing held it is the ordinary tap it
 * has always been.
 */
export function withPen(
  noteEditing: NoteEditing,
  composer: IntentComposer,
): NoteEditing {
  if (!composer.penArmed) return noteEditing;
  return {
    ...noteEditing,
    selectCell: (next: EditedCell | null) => {
      if (!next) return;
      composer.applyPen(next, composer.occupiedAt(next) ? "replace" : "insert");
    },
  };
}
