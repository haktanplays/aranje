"use client";

import { useState } from "react";

import { SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  TECHNIQUE_GROUPS,
  type TechniqueGroupId,
} from "@/lib/song/technique-surface";
import type { TechniqueSurface } from "@/lib/song/technique-surface";

/**
 * "Çalım" — three questions, in the reader's words (2V-D.1-C §12–§14).
 *
 * ## In the sheet, not over the music
 *
 * A section of the note sheet, like the chord shapes beside it. Nothing here
 * is a modal and nothing covers the staff: the reader can see the note they
 * are marking while they mark it, which is the whole reason 2V-B.2's shell
 * work exists. No `fixed inset-0` appears in this file, and the editor-shell
 * boundary test checks that it never does.
 *
 * ## Preview before apply, always
 *
 * Every choice shows what it would do before it does it, and the sentence
 * comes from the same pure command the apply runs — including a refusal,
 * which is when a preview matters most. Choosing writes nothing; only
 * "Uygula" writes, and it writes once.
 *
 * ## Marks already here
 *
 * A region mark that is already over the note is listed with a way to take it
 * off, because a technique you cannot remove is a technique you are afraid to
 * try. Removing one leaves the notes under it exactly as they are.
 */
function Choice({
  on,
  onClick,
  label,
  hint,
  value,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  value: string | null;
}) {
  return (
    <button
      type="button"
      data-technique-choice={value ?? "none"}
      aria-pressed={on}
      title={hint}
      onClick={onClick}
      className={`border-line rounded-lg border px-3 text-sm ${
        on ? "border-accent/60 bg-accent/15" : ""
      }`}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
    >
      {label}
    </button>
  );
}

export function TechniqueSection({ surface }: { surface: TechniqueSurface }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Record<TechniqueGroupId, string | null>>({
    attack: null,
    picking: null,
    region: null,
  });

  if (!open) {
    return (
      <div className="border-line border-t pt-3">
        <SheetButton data-technique-open onClick={() => setOpen(true)}>
          Çalım
        </SheetButton>
      </div>
    );
  }

  return (
    <div className="border-line border-t pt-3" data-technique-section>
      <div className="flex items-center justify-between pb-1">
        <span className="text-muted text-sm">Çalım</span>
        <SheetButton onClick={() => setOpen(false)}>Gizle</SheetButton>
      </div>

      {surface.regions.length > 0 ? (
        <div className="pb-2" data-technique-here>
          <p className="text-muted pb-1 text-xs">Bu notanın üstündekiler</p>
          {surface.regions.map((region) => (
            <div key={region.id} className="flex items-center gap-2 py-1">
              <span className="text-sm">{region.label}</span>
              <SheetButton
                data-technique-remove={region.id}
                onClick={() => surface.removeRegion(region.id)}
              >
                Kaldır
              </SheetButton>
            </div>
          ))}
        </div>
      ) : null}

      {TECHNIQUE_GROUPS.map((group) => {
        const value = chosen[group.id];
        const shown = surface.preview(group.id, value);
        return (
          <div key={group.id} className="border-line/60 border-t py-2" data-technique-group={group.id}>
            <p className="pb-1 text-sm font-semibold">{group.label}</p>
            <p className="text-muted pb-2 text-xs">{group.question}</p>
            <div className="flex flex-wrap items-center gap-2">
              {group.choices.map((choice) => (
                <Choice
                  key={choice.value ?? "none"}
                  on={value === choice.value}
                  onClick={() => setChosen((was) => ({ ...was, [group.id]: choice.value }))}
                  label={choice.label}
                  hint={choice.hint}
                  value={choice.value}
                />
              ))}
            </div>
            {/* What this choice does, before it does it. */}
            <p className="text-muted pt-2 text-xs" data-technique-preview={group.id}>
              {shown}
            </p>
            {group.disclosure ? (
              <p className="text-muted pt-1 text-xs" data-technique-disclosure={group.id}>
                {group.disclosure}
              </p>
            ) : null}
            <div className="pt-2">
              <SheetButton
                data-technique-apply={group.id}
                disabled={!surface.available}
                onClick={() => surface.apply(group.id, value)}
              >
                Uygula
              </SheetButton>
            </div>
          </div>
        );
      })}

      {surface.error ? (
        <p className="text-reject pt-2 text-xs" data-technique-error>
          {surface.error}
        </p>
      ) : null}
    </div>
  );
}
