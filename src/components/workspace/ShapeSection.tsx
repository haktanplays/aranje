"use client";

import { useState } from "react";

import { SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/**
 * Turning the chord under the selection into something else (2T-B §7).
 *
 * ## Behind a door, on purpose
 *
 * Four transforms with three settings between them is more than a sheet
 * should open with. The reader who wants a fret wants a fret; the reader who
 * wants an arpeggio has decided to go looking. So this is shut until asked
 * for, and the sheet's first screen stays the one thing most readers came
 * for.
 *
 * ## The preview writes nothing, and cannot disagree with the apply
 *
 * It runs the same pure core the apply runs, on the same song, and throws
 * the result away. A preview computed a second way is a preview that will
 * eventually be wrong about something — usually about a refusal, which is
 * exactly when a reader needs it to be right. Conflicts and bar overflow
 * come back as the core's own words, not as a guess made here.
 */

type Direction = "down_to_up" | "up_to_down";
type Step = 96 | 48 | 24;

export type ShapeCommandInput =
  | { kind: "to_arpeggio"; direction: Direction; stepTicks: Step; ring: boolean }
  | { kind: "to_chord"; spanSlots: number }
  | { kind: "set_strum"; direction: "down" | "up" | null };

export type ShapePreviewResult =
  | {
      kind: "ready";
      onsets: readonly { readonly slotIndex: number; readonly pitch: string }[];
      summary: string;
    }
  | { kind: "refused"; reason: string };

const STEPS: readonly { value: Step; label: string }[] = [
  { value: 96, label: "Sekizlik" },
  { value: 48, label: "On altılık" },
  { value: 24, label: "Otuz ikilik" },
];

/** How far ahead "gather back into a chord" looks, in grid steps. */
const GATHER_SLOTS = 8;

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 py-1">{children}</div>;
}

function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`border-line rounded-lg border px-3 text-sm ${
        on ? "border-accent/60 bg-accent/15" : ""
      }`}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
    >
      {children}
    </button>
  );
}

export function ShapeSection({
  preview,
  apply,
}: {
  preview: (command: ShapeCommandInput) => ShapePreviewResult;
  apply: (command: ShapeCommandInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("down_to_up");
  const [stepTicks, setStepTicks] = useState<Step>(48);
  const [ring, setRing] = useState(true);

  const arpeggio: ShapeCommandInput = { kind: "to_arpeggio", direction, stepTicks, ring };

  if (!open) {
    return (
      <div className="border-line border-t pt-3">
        <SheetButton data-shape-open onClick={() => setOpen(true)}>
          Daha fazla
        </SheetButton>
      </div>
    );
  }

  const shown = preview(arpeggio);

  return (
    <div className="border-line border-t pt-3" data-shape-section>
      <div className="flex items-center justify-between pb-1">
        <span className="text-muted text-sm">Akor biçimi</span>
        <SheetButton onClick={() => setOpen(false)}>Gizle</SheetButton>
      </div>

      <Row>
        <span className="text-muted w-16 shrink-0 text-xs">Yön</span>
        <Choice on={direction === "down_to_up"} onClick={() => setDirection("down_to_up")}>
          Kalından inceye
        </Choice>
        <Choice on={direction === "up_to_down"} onClick={() => setDirection("up_to_down")}>
          İnceden kalına
        </Choice>
      </Row>

      <Row>
        <span className="text-muted w-16 shrink-0 text-xs">Aralık</span>
        {STEPS.map((step) => (
          <Choice
            key={step.value}
            on={stepTicks === step.value}
            onClick={() => setStepTicks(step.value)}
          >
            {step.label}
          </Choice>
        ))}
      </Row>

      <Row>
        <span className="text-muted w-16 shrink-0 text-xs">Çınlama</span>
        <Choice on={ring} onClick={() => setRing(true)}>
          Çınlasın
        </Choice>
        <Choice on={!ring} onClick={() => setRing(false)}>
          Ayrık
        </Choice>
      </Row>

      {/* What would happen, in the core's own words. Nothing is written to
          find this out, and a refusal is shown as a refusal. */}
      {/* The strings the arpeggio would actually land on, in the order the
          hand crosses them. Drawn, never written, and no pointer target. */}
      {shown.kind === "ready" ? (
        <ul
          data-shape-targets
          aria-label="Arpejin geçeceği teller"
          className="text-muted/80 pointer-events-none flex flex-wrap gap-x-3 gap-y-1 pb-1 text-[11px]"
        >
          {shown.onsets.map((onset, index) => (
            <li key={`${onset.slotIndex}-${onset.pitch}`} data-shape-target>
              {index + 1}. {onset.pitch}
            </li>
          ))}
        </ul>
      ) : null}

      <p
        data-shape-preview
        data-refused={shown.kind === "refused" ? "true" : "false"}
        className={`py-2 text-xs ${shown.kind === "refused" ? "text-danger" : "text-muted"}`}
      >
        {shown.kind === "refused" ? shown.reason : shown.summary}
      </p>

      {/* Two different things, said once so nobody has to guess (2T-C §6). */}
      <p className="text-muted/80 pb-2 text-xs">
        Arpej ayrı vuruşlar yazar; strum tek akoru elin geçiş yönüyle çalar.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <SheetButton
          tone="primary"
          data-shape-arpeggio
          disabled={shown.kind === "refused"}
          onClick={() => apply(arpeggio)}
        >
          Arpej yap
        </SheetButton>
        <SheetButton
          data-shape-gather
          onClick={() => apply({ kind: "to_chord", spanSlots: GATHER_SLOTS })}
        >
          Akora topla
        </SheetButton>
        <SheetButton
          data-shape-strum-down
          onClick={() => apply({ kind: "set_strum", direction: "down" })}
        >
          Aşağı vuruş
        </SheetButton>
        <SheetButton
          data-shape-strum-up
          onClick={() => apply({ kind: "set_strum", direction: "up" })}
        >
          Yukarı vuruş
        </SheetButton>
      </div>
    </div>
  );
}
