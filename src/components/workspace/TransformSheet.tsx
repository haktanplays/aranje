"use client";

/**
 * The transform sheets (spec 13.1, K-37).
 *
 * The move sheet keeps four musical ideas apart, because they *are* four
 * different things and a single "up/down" control would make a player guess
 * which one they were getting: move in time, change the note, keep the note
 * and change the string, or move the shape.
 *
 * They are chosen from a 2x2 of cards rather than a row of tabs. Four tabs on
 * one line cramp at 320px and start eliding their own labels, which is the
 * worst outcome here: the whole point of separating these is that a player can
 * read which one they are about to use. Only the chosen mode's controls are
 * shown, so the sheet never needs to scroll sideways.
 *
 * Nudges stage rather than commit. Five taps of the right arrow is one musical
 * thought, so it becomes one pending command, one write and one undo step when
 * "Uygula" is pressed. The ghost the reader sees between taps is the real
 * command run against the real song with its result discarded, so a preview
 * cannot write and cannot show something the commit would not do.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { ticksPerSlot } from "@/lib/music/timing";
import type { Preview } from "@/lib/song/use-transform";
import type { TransformCommand } from "@/lib/song/transform";
import type { Bar } from "@/lib/song/schema";

export type TransformSheetKind = "move" | "repeat" | "more" | "paste" | null;

/** One step of the grid the selection actually starts on. */
export function stepTicksFor(bar: Bar | undefined): number {
  return bar ? ticksPerSlot(bar.resolution) : ticksPerSlot(16);
}

type Nudge = { readonly label: string; readonly ticks: number };

function TimeNudges({
  step,
  beat,
  barTicks,
  onNudge,
}: {
  step: number;
  beat: number;
  barTicks: number;
  onNudge: (ticks: number) => void;
}) {
  const options: readonly Nudge[] = [
    { label: "grid", ticks: step },
    { label: "vuruş", ticks: beat },
    { label: "ölçü", ticks: barTicks },
  ];

  return (
    <div className="space-y-2">
      {options.map((option) => (
        <div key={option.label} className="flex items-center gap-2">
          <span className="text-muted w-16 shrink-0 text-sm">Bir {option.label}</span>
          <button
            type="button"
            data-testid={`nudge-left-${option.label}`}
            aria-label={`Bir ${option.label} sola taşı`}
            onClick={() => onNudge(-option.ticks)}
            className="border-app flex-1 rounded-md border"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            ←
          </button>
          <button
            type="button"
            data-testid={`nudge-right-${option.label}`}
            aria-label={`Bir ${option.label} sağa taşı`}
            onClick={() => onNudge(option.ticks)}
            className="border-app flex-1 rounded-md border"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            →
          </button>
        </div>
      ))}
    </div>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint ? <p className="text-muted text-xs">{hint}</p> : null}
      {children}
    </section>
  );
}

function Stepper({
  label,
  values,
  onPick,
  testPrefix,
}: {
  label: string;
  values: readonly { readonly label: string; readonly value: number }[];
  onPick: (value: number) => void;
  testPrefix: string;
}) {
  return (
    <div className="flex gap-2" aria-label={label}>
      {values.map((entry) => (
        <button
          key={entry.label}
          type="button"
          data-testid={`${testPrefix}-${entry.value}`}
          aria-label={`${label}: ${entry.label}`}
          onClick={() => onPick(entry.value)}
          className="border-app flex-1 rounded-md border text-sm"
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

export type TransformSheetProps = {
  readonly kind: TransformSheetKind;
  readonly stepTicks: number;
  readonly beatTicks: number;
  readonly barTicks: number;
  readonly pending: TransformCommand | null;
  readonly preview: Preview | null;
  readonly previewText: string | null;
  readonly onStage: (command: TransformCommand | null) => void;
  /** Offered only when there is something on the clipboard. */
  readonly onStartPaste?: () => void;
  readonly canPaste?: boolean;
  readonly onApply: () => void;
  readonly onClose: () => void;
};

/** The four things "move" can mean, in the reader's words. */
const MODES = [
  { id: "time", label: "Zaman", hint: "Seçimi ritim üzerinde sağa veya sola taşır." },
  { id: "pitch", label: "Ses", hint: "Notaları daha tiz veya daha pes yapar." },
  { id: "string", label: "Tel", hint: "Ses değişmeden çalındığı teli değiştirir." },
  { id: "shape", label: "Şekil", hint: "Akorun parmak şeklini taşır; ses değişebilir." },
] as const;

type MoveMode = (typeof MODES)[number]["id"];

export function TransformSheet({
  kind,
  stepTicks,
  beatTicks,
  barTicks,
  pending,
  preview,
  previewText,
  onStage,
  onStartPaste,
  canPaste = false,
  onApply,
  onClose,
}: TransformSheetProps) {
  const [customCount, setCustomCount] = useState("2");
  const [mode, setMode] = useState<MoveMode>("time");

  if (kind === null) return null;

  /* Nudges accumulate into the one pending command rather than replacing it,
   * so five taps move five steps and still land as one commit. */
  const nudge = (ticks: number) => {
    const already =
      pending?.kind === "move_selection_time" ? pending.deltaTicks : 0;
    onStage({ kind: "move_selection_time", deltaTicks: already + ticks });
  };

  const title =
    kind === "move"
      ? "Taşı"
      : kind === "repeat"
        ? "Tekrarla"
        : kind === "paste"
          ? "Yapıştır"
          : "Daha fazla";

  return (
    <Sheet
      open
      title={title}
      onClose={() => {
        // Closing abandons the staged command. Nothing was written, so there
        // is nothing to undo.
        onStage(null);
        onClose();
      }}
      footer={
        <div className="flex gap-2">
          <SheetButton onClick={onClose}>Vazgeç</SheetButton>
          <SheetButton
            tone="primary"
            onClick={onApply}
            disabled={!pending || preview?.ok !== true}
          >
            Uygula
          </SheetButton>
        </div>
      }
    >
      <div className="space-y-5">
        {previewText ? (
          <p
            data-testid="transform-preview"
            role="status"
            className={
              preview?.ok === false
                ? "rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700"
                : "text-muted text-sm"
            }
          >
            {previewText}
          </p>
        ) : null}

        {kind === "move" ? (
          <>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Taşıma türü">
              {MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === entry.id}
                  data-testid={`move-mode-${entry.id}`}
                  onClick={() => setMode(entry.id)}
                  className={
                    mode === entry.id
                      ? "border-accent bg-accent/10 rounded-md border-2 px-2 text-sm font-medium"
                      : "border-app rounded-md border px-2 text-sm"
                  }
                  style={{ minHeight: MIN_TOUCH_TARGET_PX }}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <p data-testid="move-mode-hint" className="text-muted text-xs">
              {MODES.find((entry) => entry.id === mode)?.hint}
            </p>

            {mode === "time" ? (
              <TimeNudges
                step={stepTicks}
                beat={beatTicks}
                barTicks={barTicks}
                onNudge={nudge}
              />
            ) : null}

            {mode === "pitch" ? (
              <Stepper
                label="Sesi transpoze et"
                testPrefix="transpose"
                values={[
                  { label: "−1 oktav", value: -12 },
                  { label: "−1 yarım", value: -1 },
                  { label: "+1 yarım", value: 1 },
                  { label: "+1 oktav", value: 12 },
                ]}
                onPick={(semitones) => onStage({ kind: "transpose_pitch", semitones })}
              />
            ) : null}

            {mode === "string" ? (
              <Stepper
                label="Aynı sesi başka tele taşı"
                testPrefix="restring"
                values={[
                  { label: "İnce tele", value: 1 },
                  { label: "Kalın tele", value: -1 },
                ]}
                onPick={(stringDelta) =>
                  onStage({ kind: "restring_same_pitch", stringDelta })
                }
              />
            ) : null}

            {mode === "shape" ? (
              <div className="space-y-2">
                <Stepper
                  label="Şekli tel yönünde taşı"
                  testPrefix="shape-string"
                  values={[
                    { label: "Tel ince", value: 1 },
                    { label: "Tel kalın", value: -1 },
                  ]}
                  onPick={(stringDelta) =>
                    onStage({ kind: "translate_fret_shape", stringDelta, fretDelta: 0 })
                  }
                />
                <Stepper
                  label="Şekli perde yönünde taşı"
                  testPrefix="shape-fret"
                  values={[
                    { label: "Perde geri", value: -1 },
                    { label: "Perde ileri", value: 1 },
                  ]}
                  onPick={(fretDelta) =>
                    onStage({ kind: "translate_fret_shape", stringDelta: 0, fretDelta })
                  }
                />
              </div>
            ) : null}
          </>
        ) : null}

        {kind === "repeat" ? (
          <Row
            title="Tekrarla"
            hint="Seçimin içindeki sessizlikler de kalıbın parçasıdır."
          >
            <Stepper
              label="Tekrar sayısı"
              testPrefix="repeat-count"
              values={[
                { label: "2×", value: 1 },
                { label: "3×", value: 2 },
                { label: "4×", value: 3 },
              ]}
              onPick={(count) =>
                onStage({ kind: "repeat_selection", mode: { kind: "count", count } })
              }
            />
            <div className="flex items-center gap-2">
              <label className="text-muted text-sm" htmlFor="repeat-custom">
                Özel
              </label>
              <input
                id="repeat-custom"
                data-testid="repeat-custom"
                inputMode="numeric"
                value={customCount}
                onChange={(event) => setCustomCount(event.target.value.replace(/\D/g, ""))}
                className="border-app w-20 rounded-md border px-2"
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              />
              <button
                type="button"
                data-testid="repeat-custom-apply"
                aria-label="Özel tekrar sayısını kullan"
                onClick={() => {
                  const count = Number(customCount);
                  if (Number.isFinite(count) && count > 0) {
                    onStage({ kind: "repeat_selection", mode: { kind: "count", count } });
                  }
                }}
                className="border-app flex-1 rounded-md border text-sm"
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              >
                Kullan
              </button>
            </div>
            <button
              type="button"
              data-testid="repeat-fill"
              aria-label="Bölüm sonuna kadar tekrarla"
              onClick={() =>
                onStage({ kind: "repeat_selection", mode: { kind: "fill_to_section_end" } })
              }
              className="border-app w-full rounded-md border text-sm"
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              Bölüm sonuna kadar
            </button>
          </Row>
        ) : null}

        {kind === "more" ? (
          <Row title="Daha fazla">
            <SheetButton onClick={() => onStage({ kind: "delete_selection" })}>
              Seçimi sil
            </SheetButton>
            {canPaste ? (
              <SheetButton onClick={() => onStartPaste?.()}>Yapıştır</SheetButton>
            ) : null}
          </Row>
        ) : null}

        {kind === "paste" ? (
          <Row
            title="Buraya yapıştır"
            hint="Onaylamadan önce hiçbir şey değişmez."
          >
            <p className="text-muted text-sm">
              Panodaki içerik seçtiğin yere kopyalanacak.
            </p>
          </Row>
        ) : null}
      </div>
    </Sheet>
  );
}
