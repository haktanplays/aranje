"use client";

/**
 * "Ölçü ve ritim" (spec 13.20 §6).
 *
 * The same sheet for one bar and for a whole section — the only difference is
 * its title and what it applies to, so the reader learns one control.
 *
 * It opens showing what the target is written in **now**, in both readings,
 * because the first question anyone opening it has is "what is this at the
 * moment". Underneath, what it would become. Neither line is technical-only:
 * "4 ana vuruş · 16 adım" is what someone who plays by ear can check, and
 * "4/4 · 1/16" is what someone learning the notation needs beside it.
 *
 * The grids offered come from the timing core's own representability rule, so
 * a pair that cannot be written never appears — 1/4 is simply absent in 6/8
 * rather than offered and then refused.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { formatTimeSignature, TIME_SIGNATURES } from "@/lib/music/timing";
import { gridChoices, readGrid } from "@/lib/music/rhythm-language";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { TimingChangeHandle } from "@/lib/workspace/use-timing-change";

const FIELD =
  "border-line bg-app text-text w-full rounded-lg border px-3 py-2 text-sm";

export function TimingSheet({ timing }: { timing: TimingChangeHandle }) {
  const { target, current, draft } = timing;
  if (!target) return null;

  const unchanged =
    current !== null && draft !== null && current.technical === draft.technical;

  return (
    <Sheet
      open
      title={target.title}
      onClose={timing.close}
      labelledBy="timing-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton data-testid="timing-cancel" onClick={timing.close}>
            Vazgeç
          </SheetButton>
          <SheetButton
            data-testid="timing-apply"
            tone="primary"
            disabled={unchanged}
            onClick={() => timing.apply()}
          >
            Uygula
          </SheetButton>
        </div>
      }
    >
      {/* What it is now — the first thing anyone opening this wants to know. */}
      <div className="border-line mb-3 rounded-lg border px-3 py-2">
        <span className="text-muted block text-[11px]">Şu an</span>
        <span data-testid="timing-current-plain" className="text-text block text-sm">
          {current?.plain ?? "—"}
        </span>
        <span
          data-testid="timing-current-technical"
          className="text-muted block text-xs"
        >
          {current?.technical ?? "—"}
        </span>
      </div>

      <div className="flex gap-2">
        <label className="block flex-1">
          <span className="text-muted mb-1 block text-xs">Ölçü işareti</span>
          <select
            data-testid="timing-meter"
            value={formatTimeSignature(timing.meter)}
            onChange={(event) => {
              const picked = TIME_SIGNATURES.find(
                (entry) => `${entry[0]}/${entry[1]}` === event.target.value,
              );
              if (picked) timing.chooseMeter([picked[0], picked[1]] as typeof timing.meter);
            }}
            className={FIELD}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            {TIME_SIGNATURES.map((entry) => (
              <option key={formatTimeSignature(entry)} value={formatTimeSignature(entry)}>
                {formatTimeSignature(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className="block flex-1">
          <span className="text-muted mb-1 block text-xs">Izgara</span>
          <select
            data-testid="timing-grid"
            value={String(timing.resolution)}
            onChange={(event) =>
              timing.chooseResolution(
                Number(event.target.value) as typeof timing.resolution,
              )
            }
            className={FIELD}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            {/*
              Both names on every option (2T §3.1). "1/16" alone is the
              private vocabulary of people who already read notation; the
              plain name alone leaves a reader unable to look anything up.
            */}
            {gridChoices(timing.meter, timing.grids).map((choice) => (
              <option key={choice.resolution} value={String(choice.resolution)}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* What it would become. */}
      <p className="mt-3">
        <span data-testid="timing-draft-plain" className="text-text block text-sm">
          {draft?.plain ?? "—"}
        </span>
        {/*
          What the grid control itself changes, said separately from the bar
          (2T §3.1). The meter is the bar's shape, the BPM is how fast the
          beat goes, and this is how finely a beat is divided — three numbers
          that were on one screen with nothing saying they answered different
          questions.
        */}
        <span
          data-testid="timing-draft-grid"
          className="text-muted block text-xs"
          title={readGrid(timing.meter, timing.resolution).plain}
          aria-label={readGrid(timing.meter, timing.resolution).plain}
        >
          {readGrid(timing.meter, timing.resolution).short}
        </span>
        <span data-testid="timing-draft-technical" className="text-muted block text-xs">
          {draft?.technical ?? "—"}
        </span>
      </p>

      {/*
        A refusal is a sentence about the music, never a code. Nothing was
        written when it appeared: the song, the storage and the history are
        exactly as they were before Uygula was pressed.
      */}
      {timing.error ? (
        <p
          data-testid="timing-error"
          role="alert"
          className="border-reject/50 text-reject mt-3 rounded-lg border px-3 py-2 text-sm"
        >
          {timing.error}
        </p>
      ) : null}
    </Sheet>
  );
}
