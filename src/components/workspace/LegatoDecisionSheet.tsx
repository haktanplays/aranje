"use client";

/**
 * The one question the legato brush asks (2S-A §8).
 *
 * The reader has covered a run; nothing has changed in the song yet. Four
 * answers, and the choice is visible twice — as the chip that names it and as
 * the arcs drawn over the run — so what is about to be written can be seen
 * before it is.
 *
 * A refusal is a sentence about music, not a code. The brush's own message
 * table is the one place those sentences live.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { brushMessage, type BrushPlan, type LegatoChoice } from "@/lib/song/legato-brush";
import { legatoLabel } from "@/lib/tab/glyph-model";

const CHOICES: readonly { id: LegatoChoice; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Otomatik bağla",
    hint: "Yükselen notaları çekiçle, alçalanları koparmayla bağlar.",
  },
  {
    id: "hammer_on",
    label: "Çekiç",
    hint: "Sağ elinle tekrar vurmadan daha yüksek notaya geç.",
  },
  {
    id: "pull_off",
    label: "Koparma",
    hint: "Parmağını çekerek daha alçak notaya geç.",
  },
];

export function LegatoDecisionSheet({
  open,
  plan,
  refusal,
  onChoose,
  onCancel,
}: {
  open: boolean;
  plan: BrushPlan | null;
  /** Set when the last attempt was refused, in the brush's own words. */
  refusal: string | null;
  onChoose: (choice: LegatoChoice) => void;
  onCancel: () => void;
}) {
  const ready = plan?.kind === "ready" ? plan : null;

  return (
    <Sheet
      open={open}
      title="Bu notaları bağla"
      onClose={onCancel}
      labelledBy="legato-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton data-legato-cancel onClick={onCancel}>
            Vazgeç
          </SheetButton>
        </div>
      }
    >
      {ready ? (
        <p data-legato-count className="text-muted pb-2 text-xs">
          {ready.onsets.length} nota seçildi.
        </p>
      ) : null}

      {plan?.kind === "refused" ? (
        <p data-legato-refusal role="alert" className="text-reject pb-3 text-sm">
          {brushMessage(plan.reason)}
        </p>
      ) : null}
      {refusal ? (
        <p data-legato-error role="alert" className="text-reject pb-3 text-sm">
          {refusal}
        </p>
      ) : null}

      {ready ? (
        <ul data-legato-preview className="text-muted pb-3 text-xs">
          {ready.links.map((link) => (
            <li key={link.onset.startTicks}>
              {legatoLabel(link.from.fret, link.onset.fret, link.kind)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2 pb-3">
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            data-legato-choice={choice.id}
            disabled={ready === null}
            onClick={() => onChoose(choice.id)}
            className="border-line text-text w-full rounded-lg border px-3 py-2 text-left disabled:opacity-40"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            <span className="block text-sm font-medium">{choice.label}</span>
            <span className="text-muted block pt-0.5 text-xs">{choice.hint}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
