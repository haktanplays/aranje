"use client";

/**
 * The chord builder session (spec 13.22 §17, 2O-B).
 *
 * A thin owner, like every other controller here. It holds what only a session
 * can know — which step the reader is on, what they have chosen so far, which
 * shape is selected — and delegates every decision that is about music to the
 * pure cores: the formula table picks the pitches, the voicing search picks
 * the shapes, and `applyChordWrite` decides whether the edit holds.
 *
 * ## Preview and commit are the same calculation
 *
 * The ghost the reader sees is not an approximation of what will happen: it is
 * the result of running the real command against the real song and throwing
 * the answer away. Apply runs it once more and keeps it. There is no second
 * code path that could drift, and no chance of a preview that promises
 * something the commit will not do.
 */
import { useCallback, useMemo, useState } from "react";

import {
  applyChordWrite,
  type ChordArticulation,
  type ChordWriteCommand,
  type ChordWriteResult,
} from "@/lib/chords/chord-command";
import { CHORD_MESSAGES } from "@/lib/chords/chord-errors";
import {
  chordName,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import {
  chordVoicings,
  DEFAULT_KEYBOARD_OCTAVE,
  type ChordVoicing,
} from "@/lib/chords/chord-voicing";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song, Track } from "@/lib/song/schema";

/** Where the builder was opened from, in the terms the command speaks. */
export type ChordTarget = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Ticks from the start of the section. */
  readonly timeTicks: number;
  /** How long one slot of the target bar lasts — the default chord length. */
  readonly slotTicks: number;
  /** True when notes are already struck here. */
  readonly occupied: boolean;
  /** For the sheet title: the bar the reader can see. */
  readonly barNumber: number;
  /** Where on the neck the reader was working, for ordering the shapes. */
  readonly anchorFret?: number;
};

export type ChordBuilderStep = "type" | "root" | "quality" | "voicing";

export type ChordBuilderHandle = {
  readonly isOpen: boolean;
  readonly target: ChordTarget | null;
  readonly step: ChordBuilderStep;
  readonly isPower: boolean;
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
  readonly withOctave: boolean;
  readonly velocity: number;
  readonly articulation: ChordArticulation;
  /** How many slots long the chord will be. */
  readonly slots: number;
  /** The name the reader sees, from the one naming function. */
  readonly name: string;
  readonly voicings: readonly ChordVoicing[];
  readonly selectedId: string | null;
  readonly selected: ChordVoicing | null;
  /** The song as it would be, for the ghost. Null when nothing can be shown. */
  readonly preview: Song | null;
  /** One safe sentence, or null. Never a diagnostic. */
  readonly error: string | null;
  /** False while writing is closed: the reader may still listen. */
  readonly canApply: boolean;
  open(target: ChordTarget): void;
  close(): void;
  goTo(step: ChordBuilderStep): void;
  chooseType(power: boolean): void;
  chooseRoot(pitchClass: number): void;
  chooseQuality(quality: ChordQualityId): void;
  setWithOctave(value: boolean): void;
  select(voicingId: string): void;
  setVelocity(value: number): void;
  setArticulation(value: ChordArticulation): void;
  setSlots(value: number): void;
  apply(): boolean;
};

const DEFAULT_VELOCITY = 90;

export function useChordBuilder(options: {
  song: Song;
  track: Track | undefined;
  canPersist: boolean;
  commit(next: Song, action: HistoryAction): boolean;
  /** Editing and playback do not share the screen (spec 13.1). */
  pause(): void;
}): ChordBuilderHandle {
  const { song, track, canPersist, commit, pause } = options;

  const [target, setTarget] = useState<ChordTarget | null>(null);
  const [step, setStep] = useState<ChordBuilderStep>("type");
  const [isPower, setPower] = useState(false);
  const [rootPitchClass, setRoot] = useState(0);
  const [quality, setQuality] = useState<ChordQualityId>("major");
  const [withOctave, setWithOctave] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [velocity, setVelocity] = useState(DEFAULT_VELOCITY);
  const [articulation, setArticulation] = useState<ChordArticulation>("normal");
  const [slots, setSlots] = useState(1);
  const [failure, setFailure] = useState<string | null>(null);

  const effectiveQuality: ChordQualityId = isPower ? "power" : quality;

  /** The shapes on offer, from the reader's own track. */
  const search = useMemo(() => {
    if (!track || !target) return null;
    return chordVoicings({
      track,
      rootPitchClass,
      quality: effectiveQuality,
      ...(target.anchorFret === undefined ? {} : { anchorFret: target.anchorFret }),
      octave: DEFAULT_KEYBOARD_OCTAVE,
      withOctave,
    });
  }, [effectiveQuality, rootPitchClass, target, track, withOctave]);

  const voicings = search?.ok ? search.voicings : [];
  const selected =
    voicings.find((voicing) => voicing.id === selectedId) ?? voicings[0] ?? null;

  /** The command that both the ghost and the apply run. One description. */
  const command = useMemo((): ChordWriteCommand | null => {
    if (!target || !selected) return null;
    return {
      sectionId: target.sectionId,
      trackId: target.trackId,
      timeTicks: target.timeTicks,
      durationTicks: target.slotTicks * slots,
      voicing: selected,
      velocity,
      articulation,
      mode: target.occupied ? "replace_onset" : "insert",
    };
  }, [articulation, selected, slots, target, velocity]);

  const outcome: ChordWriteResult | null = useMemo(
    () => (command ? applyChordWrite(song, command) : null),
    [command, song],
  );

  const searchError = search && !search.ok ? search.error.message : null;
  const previewError = outcome && !outcome.ok ? outcome.error.message : null;
  const error = failure ?? searchError ?? previewError;

  const reset = useCallback(() => {
    setStep("type");
    setPower(false);
    setQuality("major");
    setWithOctave(false);
    setSelectedId(null);
    setVelocity(DEFAULT_VELOCITY);
    setArticulation("normal");
    setSlots(1);
    setFailure(null);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    reset();
  }, [reset]);

  return {
    isOpen: target !== null,
    target,
    step,
    isPower,
    rootPitchClass,
    quality: effectiveQuality,
    withOctave,
    velocity,
    articulation,
    slots,
    name: chordName(rootPitchClass, effectiveQuality),
    voicings,
    selectedId: selected?.id ?? null,
    selected,
    preview: outcome?.ok ? outcome.song : null,
    error,
    canApply: canPersist,

    open: (next) => {
      // Building a chord is editing; the ear should not be somewhere else.
      pause();
      reset();
      setTarget(next);
    },
    close,
    goTo: (next) => {
      setFailure(null);
      setStep(next);
    },
    chooseType: (power) => {
      setPower(power);
      setSelectedId(null);
      setStep("root");
    },
    chooseRoot: (pitchClass) => {
      setRoot(pitchClass);
      setSelectedId(null);
      setStep("quality");
    },
    chooseQuality: (next) => {
      setQuality(next);
      setPower(next === "power");
      setSelectedId(null);
      setStep("voicing");
    },
    setWithOctave: (value) => {
      setWithOctave(value);
      setSelectedId(null);
    },
    select: (voicingId) => {
      setFailure(null);
      setSelectedId(voicingId);
    },
    setVelocity,
    setArticulation,
    setSlots,

    apply: () => {
      if (!canPersist) {
        setFailure(CHORD_MESSAGES.storage_unavailable);
        return false;
      }
      if (!outcome) {
        setFailure(CHORD_MESSAGES.preview_unavailable);
        return false;
      }
      if (!outcome.ok) {
        setFailure(outcome.error.message);
        return false;
      }
      if (
        !commit(outcome.song, {
          kind: "chord",
          mode: target?.occupied ? "chord_replace" : "chord_insert",
        })
      ) {
        setFailure(CHORD_MESSAGES.project_changed_elsewhere);
        return false;
      }
      close();
      return true;
    },
  };
}
