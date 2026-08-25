"use client";

/**
 * Continuing the selected pattern (2S-A §9).
 *
 * Three options, and none of them is called better. The reader says which,
 * how many times and how far; the cards under them are the real result of the
 * real command on the real song, so what is on the card is what would be
 * written. Nothing is written until one is chosen.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  continueLabel,
  previewContinuations,
  type ContinuePlanMode,
} from "@/lib/song/continue-pattern";
import type { Song } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

type Shape = "repeat" | "shape" | "pitch";

const SHAPE_LABELS: Readonly<Record<Shape, string>> = {
  repeat: "Aynen tekrar et",
  shape: "Aynı şekli taşı",
  pitch: "Aynı ezgiyi taşı",
};

const SHAPE_HINTS: Readonly<Record<Shape, string>> = {
  repeat: "Seçtiğin bölümü olduğu gibi tekrarlar.",
  shape: "Aynı parmak şeklini başka perdeye taşır.",
  pitch: "Aynı ezgiyi seçtiğin kadar ses yukarı ya da aşağı taşır.",
};

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  testId: string;
}) {
  return (
    <div className="border-line flex items-center gap-2 rounded-lg border px-3 py-2">
      <span className="text-muted flex-1 text-xs">{label}</span>
      <button
        type="button"
        data-continue-step={`${testId}:down`}
        aria-label={`${label}: azalt`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="border-line text-text rounded-lg border disabled:opacity-40"
        style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
      >
        −
      </button>
      <span
        data-continue-value={testId}
        className="text-text w-10 text-center tabular-nums"
      >
        {value}
      </span>
      <button
        type="button"
        data-continue-step={`${testId}:up`}
        aria-label={`${label}: artır`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="border-line text-text rounded-lg border disabled:opacity-40"
        style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
      >
        +
      </button>
    </div>
  );
}

export function ContinuePatternSheet({
  open,
  song,
  selection,
  refusal,
  onApply,
  onClose,
}: {
  open: boolean;
  song: Song;
  selection: TimeSelection | null;
  refusal: string | null;
  onApply: (mode: ContinuePlanMode, repeats: number, onOverrun: "refuse" | "fit") => void;
  onClose: () => void;
}) {
  const [shape, setShape] = useState<Shape>("repeat");
  const [repeats, setRepeats] = useState(1);
  const [fretDelta, setFretDelta] = useState(2);
  const [stringDelta, setStringDelta] = useState(0);
  const [semitones, setSemitones] = useState(2);

  const mode: ContinuePlanMode =
    shape === "repeat"
      ? { kind: "repeat" }
      : shape === "shape"
        ? { kind: "shape", stringDelta, fretDelta }
        : { kind: "pitch", semitones };

  const cards = selection ? previewContinuations(song, selection, [mode], repeats) : [];
  const card = cards[0];
  const blocked = card ? !card.result.ok : true;

  return (
    <Sheet
      open={open}
      title="Bu deseni devam ettir"
      onClose={onClose}
      labelledBy="continue-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton data-continue-cancel onClick={onClose}>
            Vazgeç
          </SheetButton>
          <SheetButton
            data-continue-apply
            tone="primary"
            disabled={blocked}
            onClick={() => onApply(mode, repeats, "refuse")}
          >
            Uygula
          </SheetButton>
        </div>
      }
    >
      <div className="flex flex-col gap-2 pb-3">
        {(Object.keys(SHAPE_LABELS) as Shape[]).map((entry) => (
          <button
            key={entry}
            type="button"
            data-continue-shape={entry}
            aria-pressed={shape === entry}
            onClick={() => setShape(entry)}
            className={`w-full rounded-lg border px-3 py-2 text-left ${
              shape === entry
                ? "border-bronze bg-bronze/10 text-bronze"
                : "border-line text-text"
            }`}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            <span className="block text-sm font-medium">{SHAPE_LABELS[entry]}</span>
            <span className="text-muted block pt-0.5 text-xs">{SHAPE_HINTS[entry]}</span>
          </button>
        ))}

        <Stepper
          label="Kaç kez"
          value={repeats}
          min={1}
          max={8}
          onChange={setRepeats}
          testId="repeats"
        />
        {shape === "shape" ? (
          <>
            <Stepper
              label="Kaç perde"
              value={fretDelta}
              min={-12}
              max={12}
              onChange={setFretDelta}
              testId="fret"
            />
            <Stepper
              label="Kaç tel"
              value={stringDelta}
              min={-3}
              max={3}
              onChange={setStringDelta}
              testId="string"
            />
          </>
        ) : null}
        {shape === "pitch" ? (
          <Stepper
            label="Kaç ses"
            value={semitones}
            min={-12}
            max={12}
            onChange={setSemitones}
            testId="semitones"
          />
        ) : null}
      </div>

      {card ? (
        <div data-continue-card className="border-line rounded-lg border px-3 py-2">
          <p className="text-text text-sm">{continueLabel(card.mode)}</p>
          {card.result.ok ? (
            <p className="text-muted pt-1 text-xs">
              {card.result.written} kopya yazılacak
              {card.result.trimmed ? " (bölüme sığdığı kadar)" : ""}.
            </p>
          ) : (
            <p data-continue-refusal role="alert" className="text-reject pt-1 text-xs">
              {card.result.error.message}
            </p>
          )}
        </div>
      ) : null}

      {card && !card.result.ok ? (
        <div className="pt-2">
          <SheetButton data-continue-fit onClick={() => onApply(mode, repeats, "fit")}>
            Sığdığı kadar yaz
          </SheetButton>
        </div>
      ) : null}

      {refusal ? (
        <p data-continue-error role="alert" className="text-reject pt-2 text-sm">
          {refusal}
        </p>
      ) : null}
    </Sheet>
  );
}
