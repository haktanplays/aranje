"use client";

import { useState } from "react";

import { DurationControl } from "@/components/workspace/DurationControl";
import type { DurationGestureProps } from "@/components/workspace/FrettedBarBlock";
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import {
  ShapeSection,
  type ShapeCommandInput,
  type ShapePreviewResult,
} from "@/components/workspace/ShapeSection";
import { maxCapoRelativeFret } from "@/lib/music/fretboard";
import { pitchAt } from "@/lib/song/edit";
import { articulationLabel } from "@/lib/validators";
import type { Articulation, Fretboard } from "@/lib/song/schema";

/**
 * What the sheet offers, in playing order rather than alphabetical: the plain
 * note first, then the two that change the level, then the four that change
 * the pitch, then the two that join to the note before (spec 13.9).
 *
 * `null` is "normal" and removes the field. The reader never sees an
 * identifier like `bend_half`; the labels come from the one place they are
 * written down.
 */
const CHOICES: readonly (Articulation | null)[] = [
  null,
  "accent",
  "palm_mute",
  "vibrato",
  "bend_half",
  "bend_full",
  "slide",
  "hammer_on",
  "pull_off",
];

export type FretSheetTarget = {
  barNumber: number;
  slotIndex: number;
  stringIndex: number;
  /** What is written on this string in this slot now, if anything. */
  currentFret: number | null;
  /** How this string of this slot is played now (spec 8.5). */
  currentArticulation: Articulation | null;
  /** What the validators say about that choice, if anything. */
  articulationWarning: string | null;
  /**
   * Which voice of the onset this is, and how long it is written for. Null
   * when the cell holds no note — there is no length to set on nothing.
   */
  noteIndex: number | null;
  writtenTicks: number | null;
};

/**
 * Where a fret number is entered (spec 13.1).
 *
 * The note name beside the field is read-only on purpose: a pitch is derived
 * from the tuning, the capo and the fret (spec 9.1), so offering it as a
 * second input would let the tab and the sound disagree. The reader sees what
 * the fret means; they do not get to overrule it.
 *
 * The tab grid is dense — a cell is one slot wide and one string tall — so the
 * arrows here are the accessible way to land on a cell exactly. They are full
 * size even though the cells they move between are not.
 */
export function FretSheet({
  open,
  fretboard,
  target,
  onClose,
  onCommit,
  onClearString,
  onRest,
  onTie,
  onNudge,
  onArticulation,
  onChord,
  duration = null,
  shape = null,
  error,
}: {
  open: boolean;
  fretboard: Fretboard;
  target: FretSheetTarget | null;
  onClose: () => void;
  onCommit: (fret: number) => void;
  onClearString: () => void;
  onRest: () => void;
  onTie: () => void;
  onNudge: (delta: { slot?: number; string?: number }) => void;
  onArticulation: (articulation: Articulation | null) => void;
  /**
   * Open the chord builder on this cell.
   *
   * Two doors rather than one button, because the reader is choosing between
   * two different things to write, not confirming a mode.
   */
  onChord: (power: boolean) => void;
  /**
   * The finger on this note's length (2T-B §6), or null off a fretted track.
   *
   * Here rather than on the staff because this is where the selected note is:
   * choosing a cell opens this sheet, so a grip drawn on the staff would sit
   * behind it and never be reachable.
   */
  duration?: DurationGestureProps | null;
  /**
   * The chord transforms behind "Daha fazla" (2T-B §7), or null where the
   * selection is not on a track that can hold a chord.
   */
  shape?: {
    readonly available: boolean;
    preview(command: ShapeCommandInput): ShapePreviewResult;
    apply(command: ShapeCommandInput): void;
  } | null;
  /** Set when the last command was refused, in words the reader can act on. */
  error: string | null;
}) {
  /*
   * The field starts at whatever is written on the selected cell. Moving to
   * another cell remounts this sheet (the caller keys it by cell), so the
   * field always describes what is under the selection without an effect
   * chasing the props.
   */
  const [text, setText] = useState(
    target === null || target.currentFret === null ? "" : String(target.currentFret),
  );

  if (!target) return null;

  const maxFret = maxCapoRelativeFret(fretboard.capo);
  const parsed = text.trim() === "" ? null : Number(text);
  const valid =
    parsed !== null && Number.isInteger(parsed) && parsed >= 0 && parsed <= maxFret;
  const pitch = valid ? pitchAt(fretboard, target.stringIndex, parsed) : null;

  return (
    <Sheet
      open={open}
      title={`Bar ${target.barNumber} · slot ${target.slotIndex + 1} · tel ${target.stringIndex + 1}`}
      onClose={onClose}
      labelledBy="fret-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton onClick={onClose}>Kapat</SheetButton>
          <SheetButton
            tone="primary"
            onClick={() => {
              if (parsed !== null) onCommit(parsed);
            }}
            disabled={parsed === null}
          >
            {target.currentFret === null ? "Ekle" : "Güncelle"}
          </SheetButton>
        </div>
      }
    >
      <div className="flex items-center gap-3 pb-3">
        <label className="text-muted text-sm" htmlFor="fret-input">
          Perde
        </label>
        <input
          id="fret-input"
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="bg-raised min-h-11 w-20 rounded-lg border border-line px-3 text-center text-base tabular-nums"
        />
        <p className="text-muted min-w-0 flex-1 text-sm" aria-live="polite">
          {pitch ? (
            <>
              Nota <span className="text-text font-medium">{pitch}</span>
            </>
          ) : (
            <span className="text-muted/70">0 – {maxFret} arası</span>
          )}
        </p>
      </div>

      {fretboard.capo > 0 ? (
        <p className="text-muted pb-2 text-xs">
          Capo {fretboard.capo}: perde 0, capo&apos;nun bastığı sestir.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-reject pb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="border-line grid grid-cols-4 gap-2 border-t py-3">
        <SheetButton onClick={() => onNudge({ slot: -1 })} aria-label="Bir slot geri">
          ←
        </SheetButton>
        <SheetButton onClick={() => onNudge({ slot: 1 })} aria-label="Bir slot ileri">
          →
        </SheetButton>
        <SheetButton
          onClick={() => onNudge({ string: 1 })}
          aria-label="Bir ince tele"
        >
          ↑
        </SheetButton>
        <SheetButton
          onClick={() => onNudge({ string: -1 })}
          aria-label="Bir kalın tele"
        >
          ↓
        </SheetButton>
      </div>

      <div className="border-line border-t py-3">
        <p className="text-muted pb-2 text-xs" id="articulation-label">
          Bu telin çalınışı
        </p>
        <div
          role="group"
          aria-labelledby="articulation-label"
          className="flex flex-wrap gap-2"
        >
          {CHOICES.map((choice) => {
            const selected = (target.currentArticulation ?? null) === choice;
            return (
              <button
                key={choice ?? "normal"}
                type="button"
                aria-pressed={selected}
                onClick={() => onArticulation(choice)}
                className={`min-h-11 rounded-lg border px-3 text-sm ${
                  selected
                    ? "border-bronze text-bronze bg-raised font-semibold"
                    : "border-line text-muted"
                }`}
              >
                {choice === null ? "Normal" : articulationLabel(choice)}
              </button>
            );
          })}
        </div>

        {duration && target.noteIndex !== null && target.writtenTicks !== null ? (
          <DurationControl
            writtenTicks={target.writtenTicks}
            noteIndex={target.noteIndex}
            previewTicks={duration.previewTicks}
            label={duration.label}
            active={duration.active}
            onGrab={duration.grab}
            onMove={duration.moveBy}
            onRelease={duration.release}
            onCancel={duration.cancel}
          />
        ) : null}

        {shape?.available ? (
          <ShapeSection preview={shape.preview} apply={shape.apply} />
        ) : null}

        {target.articulationWarning ? (
          <p role="status" className="text-bronze pt-2 text-xs">
            {target.articulationWarning}
          </p>
        ) : null}
      </div>

      <div className="border-line flex flex-wrap gap-2 border-t py-3">
        {/*
          Beside the single note, not instead of it: writing one fret is still
          the ordinary thing to do here, and the chord builder is a second
          way in rather than a replacement for it.
        */}
        <SheetButton data-fret-power onClick={() => onChord(true)}>
          Power chord
        </SheetButton>
        <SheetButton data-fret-chord onClick={() => onChord(false)}>
          Akor
        </SheetButton>
        <SheetButton tone="danger" onClick={onClearString}>
          Bu telde sil
        </SheetButton>
        <SheetButton onClick={onRest}>Sus</SheetButton>
        <SheetButton onClick={onTie}>Uzat</SheetButton>
      </div>
    </Sheet>
  );
}
