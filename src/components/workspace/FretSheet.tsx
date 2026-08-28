"use client";

import { useState } from "react";

import { DurationControl } from "@/components/workspace/DurationControl";
import type { DurationGestureProps } from "@/components/workspace/FrettedBarBlock";
import { RetuneSection } from "@/components/workspace/RetuneSection";
import { RhythmRow } from "@/components/workspace/RhythmRow";
import { LEVEL_LABELS } from "@/lib/song/playability";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import {
  ShapeSection,
  type ShapeCommandInput,
  type ShapePreviewResult,
} from "@/components/workspace/ShapeSection";
import { maxCapoRelativeFret } from "@/lib/music/fretboard";
import { pitchAt } from "@/lib/song/edit";
import { articulationLabel } from "@/lib/validators";
import { FAMILY_LABELS, familyRows } from "@/lib/song/technique-matrix";
import type { Articulation, Fretboard } from "@/lib/song/schema";

/**
 * What the sheet offers, grouped the way a player thinks (2T-C §9).
 *
 * Sixteen techniques in one wrapping row would be a wall. They come from the
 * technique matrix instead, in its four families — what joins a note to the
 * one before it, what moves the pitch, how the string is struck, and what
 * happens to the sound afterwards — so the sheet and the matrix cannot drift
 * apart: adding a technique to the contract without a row here would leave it
 * unreachable, and `technique-matrix.test.ts` fails when it does.
 *
 * `null` is "normal" and removes the field. The reader never sees an
 * identifier like `bend_half`; the labels come from the one place they are
 * written down.
 */
const FAMILY_ORDER = ["bağlantı", "perde", "vuruş", "tını"] as const;

/** The families with the articulations they offer, empty ones dropped. */
const CHOICE_GROUPS = FAMILY_ORDER.map((family) => ({
  family,
  label: FAMILY_LABELS[family],
  choices: familyRows(family)
    .filter((row) => row.field === "articulation")
    .map((row) => row.id as Articulation),
})).filter((group) => group.choices.length > 0);

/** Every articulation the sheet can write, for the boundary test to read. */
export const FRET_SHEET_ARTICULATIONS: readonly Articulation[] =
  CHOICE_GROUPS.flatMap((group) => group.choices);

/** One technique chip. A 44px target, and never an identifier as its name. */
function ArticulationChip({
  choice,
  selected,
  onArticulation,
}: {
  choice: Articulation | null;
  selected: boolean;
  onArticulation: (articulation: Articulation | null) => void;
}) {
  return (
    <button
      type="button"
      data-articulation={choice ?? "normal"}
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
}

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
  /** Whether this note is marked to ring on (2T-C §9). */
  letRing: boolean;
};

/**
 * Where a fret number is entered (spec 13.1).
 *
 * ## The order of the sheet is the order of use
 *
 * Fret, then rhythm, then length: those three are touched on every note. The
 * articulations, the way it is played, the chord transforms and the destructive
 * actions come after, because they are occasional. At 320px the sheet scrolls,
 * so what is above the fold is a decision about what a reader reaches for most
 * — and it was measured: burying the length control put it out of reach of a
 * thumb on the smallest screen this app supports.
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
  onLetRing,
  onChord,
  duration = null,
  rhythm = null,
  shape = null,
  retune = null,
  playability = [],
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
   * Ring on, or damp with the rest (2T-C §9).
   *
   * Beside the articulations rather than among them: those are eleven ways of
   * striking a string and this is an instruction to the hand that is not
   * striking it. Putting it in the same list would teach the wrong thing.
   */
  onLetRing: (letRing: boolean) => void;
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
   * What the next note will be written at, and the three counting questions
   * around it (2T-C §2, §4).
   */
  rhythm?: Pick<
    React.ComponentProps<typeof RhythmRow>,
    "counting" | "choices" | "ticks"
  > & { choose(ticks: number): void } | null;
  /**
   * The chord transforms behind "Daha fazla" (2T-B §7), or null where the
   * selection is not on a track that can hold a chord.
   */
  shape?: {
    readonly available: boolean;
    preview(command: ShapeCommandInput): ShapePreviewResult;
    apply(command: ShapeCommandInput): void;
  } | null;
  /** "Ritmi koru, akoru değiştir", on the bar this note is in (2T-C §7). */
  retune?:
    | ({ readonly available: boolean } & Omit<
        React.ComponentProps<typeof RetuneSection>,
        "onFrom" | "onTo" | "onApply"
      > & {
          chooseFrom: React.ComponentProps<typeof RetuneSection>["onFrom"];
          chooseTo: React.ComponentProps<typeof RetuneSection>["onTo"];
          apply: () => void;
        })
    | null;
  /** What a real guitar would have trouble with, in this bar (2T-C §8). */
  playability?: readonly {
    readonly level: "conflict" | "warning" | "info";
    readonly kind: string;
    readonly message: string;
  }[];
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

      {rhythm ? (
        <RhythmRow
            counting={rhythm.counting}
            choices={rhythm.choices}
            ticks={rhythm.ticks}
            onChoose={rhythm.choose}
          />
      ) : null}

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
        <div role="group" aria-labelledby="articulation-label">
          <div className="flex flex-wrap gap-2">
            <ArticulationChip
              choice={null}
              selected={target.currentArticulation === null}
              onArticulation={onArticulation}
            />
          </div>
          {CHOICE_GROUPS.map((group) => (
            <div key={group.family} className="pt-2">
              <p className="text-muted pb-1 text-[11px]">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.choices.map((choice) => (
                  <ArticulationChip
                    key={choice}
                    choice={choice}
                    selected={target.currentArticulation === choice}
                    onArticulation={onArticulation}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {target.currentFret === null ? null : (
          <div className="border-line flex items-center gap-2 border-t pt-3">
            <span className="text-muted shrink-0 text-sm">Çalınış</span>
            <button
              type="button"
              data-let-ring
              aria-pressed={target.letRing}
              onClick={() => onLetRing(!target.letRing)}
              className={`border-line rounded-lg border px-3 text-sm ${
                target.letRing ? "border-accent/60 bg-accent/15" : ""
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              Çınlat
            </button>
            <span className="text-muted text-xs">
              {target.letRing
                ? "Kendi teli tekrar çalınana kadar sürer."
                : "Sonraki notayla birlikte susar."}
            </span>
          </div>
        )}

        {shape?.available ? (
          <ShapeSection preview={shape.preview} apply={shape.apply} />
        ) : null}

        {retune?.available ? (
          <RetuneSection
            from={retune.from}
            to={retune.to}
            preview={retune.preview}
            onFrom={retune.chooseFrom}
            onTo={retune.chooseTo}
            onApply={retune.apply}
          />
        ) : null}

        {playability.length > 0 ? (
          <ul
            data-playability
            aria-label="Bu ölçüde çalınabilirlik notları"
            className="border-line border-t pt-3 text-xs"
          >
            {playability.map((note) => (
              <li
                key={`${note.kind}-${note.message}`}
                data-playability-level={note.level}
                className={
                  note.level === "conflict"
                    ? "text-danger"
                    : note.level === "warning"
                      ? "text-bronze"
                      : "text-muted"
                }
              >
                <span className="font-medium">{LEVEL_LABELS[note.level]}:</span>{" "}
                {note.message}
              </li>
            ))}
          </ul>
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
