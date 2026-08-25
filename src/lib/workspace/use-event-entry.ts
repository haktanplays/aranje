"use client";

/**
 * The bridge between a tap on a lane and one written event (2Q-B §3, §5, §7).
 *
 * It owns nothing musical. The commands are in `@/lib/song/event-entry`, the
 * sentences are in `@/lib/song/event-entry-messages`, and the write is the
 * app's one commit — this only prepares a target, delegates, and turns a
 * typed refusal into a sentence the sheet can show.
 *
 * ## Why both surfaces share it
 *
 * The Tab and the Çoklu view are two ways of looking at the same music, so a
 * hit written from one has to be the same hit written from the other: same
 * command, same candidate, same single step of history. Two controllers would
 * be two chances for them to disagree about what a tap means.
 */
import { useCallback, useState } from "react";

import { EVENT_ENTRY_MESSAGES } from "@/lib/song/event-entry-messages";
import {
  insertDrumHit,
  insertPitchedNote,
  removeDrumHit,
  removePitchedNote,
  type EventEntryResult,
  type EventEntryTarget,
} from "@/lib/song/event-entry";
import type { DrumPiece } from "@/lib/instruments/registry";
import type { DrumHit, Song } from "@/lib/song/schema";
import type { HistoryAction } from "@/lib/song/edit-history";

/** How hard a hit is struck, in the three words a drummer would use. */
export type HitLevel = "ghost" | "normal" | "accent";

/**
 * The velocities behind those three words, in one place.
 *
 * They sit inside the contract's own range and around its default, so a hit
 * written here sounds like a hit written anywhere else. Nothing is clamped:
 * a level is a choice from three, not a number the reader can push past.
 */
export const HIT_VELOCITIES: Readonly<Record<HitLevel, number>> = {
  ghost: 48,
  normal: 100,
  accent: 120,
};

export const HIT_LEVEL_LABELS: Readonly<Record<HitLevel, string>> = {
  ghost: "Hafif",
  normal: "Normal",
  accent: "Vurgulu",
};

export type EventEntry = {
  /** The last refusal, in the reader's words, or null. */
  readonly entryError: string | null;
  clearEntryError(): void;
  /** Write a hit, or take it away when that piece is already on this beat. */
  toggleDrumHit(target: EventEntryTarget, piece: DrumPiece, level?: HitLevel): void;
  writeDrumHit(target: EventEntryTarget, piece: DrumPiece, level?: HitLevel): void;
  eraseDrumHit(target: EventEntryTarget, piece: DrumPiece): void;
  /** Write a pitched note. `replace` is the reader's explicit second answer. */
  writePitchedNote(
    target: EventEntryTarget,
    note: { pitch: string; slots?: number },
    options?: { replace?: boolean },
  ): void;
  erasePitchedNote(target: EventEntryTarget): void;
};

export function useEventEntry(options: {
  readonly song: Song;
  /** Whether this beat already carries this piece, asked of the model. */
  hasHit(target: EventEntryTarget, piece: DrumPiece): boolean;
  commit(next: Song, action: HistoryAction): boolean;
  /** Editing and playback do not share the screen (spec 13.1). */
  pause(): void;
}): EventEntry {
  const { song, hasHit, commit, pause } = options;
  const [entryError, setEntryError] = useState<string | null>(null);

  /**
   * A refusal, in the reader's words. Returns false so a caller can read as
   * "settled or not" in one line.
   *
   * The commit itself is deliberately *not* wrapped: every write below names
   * its own action literally, because a step of history whose name arrives
   * through a variable is a step nobody can find later — and the boundary
   * test that enforces this is reading the syntax tree, not the intent.
   */
  const settled = useCallback((result: EventEntryResult): result is Extract<
    EventEntryResult,
    { ok: true }
  > => {
    if (result.ok) {
      setEntryError(null);
      return true;
    }
    setEntryError(EVENT_ENTRY_MESSAGES[result.code]);
    return false;
  }, []);

  const writeDrumHit = useCallback(
    (target: EventEntryTarget, piece: DrumPiece, level: HitLevel = "normal") => {
      const hit: { velocity: number; articulation?: DrumHit["articulation"] } = {
        velocity: HIT_VELOCITIES[level],
        ...(level === "normal" ? {} : { articulation: level }),
      };
      const result = insertDrumHit(song, target, { piece, ...hit });
      if (settled(result)) commit(result.song, { kind: "drum_entry", command: "insert" });
    },
    [commit, settled, song],
  );

  const eraseDrumHit = useCallback(
    (target: EventEntryTarget, piece: DrumPiece) => {
      const result = removeDrumHit(song, target, piece);
      if (settled(result)) commit(result.song, { kind: "drum_entry", command: "remove" });
    },
    [commit, settled, song],
  );

  const toggleDrumHit = useCallback(
    (target: EventEntryTarget, piece: DrumPiece, level: HitLevel = "normal") => {
      /*
       * One physical tap, one command. Which one it is comes from what is
       * already there, asked of the model the cell was drawn from rather
       * than guessed from the last render.
       */
      if (hasHit(target, piece)) eraseDrumHit(target, piece);
      else writeDrumHit(target, piece, level);
    },
    [eraseDrumHit, hasHit, writeDrumHit],
  );

  const writePitchedNote = useCallback(
    (
      target: EventEntryTarget,
      note: { pitch: string; slots?: number },
      { replace = false }: { replace?: boolean } = {},
    ) => {
      pause();
      const result = insertPitchedNote(
        song,
        target,
        { pitch: note.pitch, ...(note.slots === undefined ? {} : { slots: note.slots }) },
        { replace },
      );
      if (!settled(result)) return;
      if (replace) commit(result.song, { kind: "pitched_entry", command: "replace" });
      else commit(result.song, { kind: "pitched_entry", command: "insert" });
    },
    [commit, pause, settled, song],
  );

  const erasePitchedNote = useCallback(
    (target: EventEntryTarget) => {
      const result = removePitchedNote(song, target);
      if (settled(result)) commit(result.song, { kind: "pitched_entry", command: "remove" });
    },
    [commit, settled, song],
  );

  const clearEntryError = useCallback(() => setEntryError(null), []);

  return {
    entryError,
    clearEntryError,
    toggleDrumHit,
    writeDrumHit,
    eraseDrumHit,
    writePitchedNote,
    erasePitchedNote,
  };
}
