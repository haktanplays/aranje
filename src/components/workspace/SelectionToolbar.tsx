"use client";

/**
 * What a selection offers while the reader is writing (K-59 §3).
 *
 * ## Why this exists
 *
 * Two full-height layers used to be on screen at the same moment: the reading
 * surface's selection action bar — a summary line and seven targets over two
 * rows, `108px` — and the four intent doors under it. Together with the edit
 * toolbar they left `main` at `196px` on a `320×700` screen, and the staff
 * needs `286px` for six strings a finger can hit. Three strings were clipped.
 *
 * They are not two things a reader needs at once. A selection is a context,
 * and a context has its own verbs; the four doors are what you reach for when
 * nothing is selected. So exactly one of them is on screen: the doors while
 * the selection is closed, this row while it is open.
 *
 * ## Four verbs and a drawer
 *
 * `Bağla` opens the legato brush's own door — the brush is *used* on a covered
 * run, so it has to be one tap from a selection. `Taşı` opens the eight
 * movements, and `Devam` reaches from the end of what is held. Everything
 * else — copy, cut, duplicate, repeat, delete — lives behind `Daha fazla`,
 * because those are the operations you go looking for rather than reach for.
 *
 * No new command is invented here. Every one of these calls the same handle
 * the tall bar called.
 *
 * ## What is drawn, and what is greyed (2U-A §3)
 *
 * The row itself is frozen at these four — UI Contract v1 — so a verb that
 * does not apply cannot be dropped to make space; it is greyed instead, with
 * the reason the capability model gave, on the control rather than after the
 * press. The drawer may drop an entry, because a sheet has room to be shorter.
 *
 * Neither list decides anything for itself. Which verbs apply is a musical
 * question — is this one onset or several, is there a bar to the left, is
 * there anything on the clipboard — and it is answered once, in
 * `selection-capability.ts`, so that the three places a selection appears
 * cannot answer it three ways.
 */
import { useState } from "react";

import { Sheet } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { SelectionVerb, VerbState } from "@/lib/song/selection-capability";
import {
  DRAWER_VERBS,
  type SelectionActions,
} from "@/lib/workspace/selection-verbs";

const LABELS: Record<string, { readonly label: string; readonly hint: string }> = {
  copy: { label: "Kopyala", hint: "Seçimi panoya alır; şarkı değişmez." },
  cut: { label: "Kes", hint: "Seçimi panoya alır ve yerinden kaldırır." },
  duplicate: { label: "Çoğalt", hint: "Seçimin bir kopyasını hemen ardına koyar." },
  repeat: { label: "Tekrarla", hint: "Seçimi kaç kez tekrarlayacağını sorar." },
  delete: { label: "Sil", hint: "Seçili notaları kaldırır." },
};

export function SelectionToolbar({ actions }: { actions: SelectionActions }) {
  const [more, setMore] = useState(false);

  const run = (key: keyof SelectionActions) => {
    const action = actions[key];
    if (typeof action === "function") action();
    setMore(false);
  };

  /*
   * What the drawer draws (2U-A §3).
   *
   * Every entry is asked of the capability model rather than decided here: a
   * verb is offered and works, or greyed with the model's own sentence, or
   * absent because it does not belong to this kind of selection at all. What
   * must never happen is the fourth thing — drawn, pressed, and refused.
   */
  const stateOf = (verb: SelectionVerb): VerbState | null =>
    actions.offers.find((offer) => offer.verb === verb)?.state ?? null;
  const drawer = DRAWER_VERBS.map((entry) => ({
    ...entry,
    ...LABELS[entry.verb]!,
    state: stateOf(entry.verb),
  })).filter((entry) => entry.state !== null);

  return (
    <>
      {/*
        Transient, and outside the row. A refusal that lived inside the
        toolbar would move four targets every time one appeared, and on a
        selection that a refusal cancels it would vanish with the thing it
        explains.
      */}
      {actions.error ? (
        <p
          data-selection-error
          role="alert"
          className="border-reject/50 bg-raised text-reject border-t px-3 py-1 text-[11px]"
        >
          {actions.error}
        </p>
      ) : null}
      {!actions.error && actions.notice ? (
        <p
          data-selection-notice
          role="status"
          className="text-muted border-line border-t px-3 py-1 text-[11px]"
        >
          {actions.notice}
        </p>
      ) : null}

      <div
        data-selection-toolbar
        role="toolbar"
        aria-label="Seçim işlemleri"
        className="border-line flex items-center gap-1.5 border-t px-3 py-0.5"
      >
        {[
          { key: "onConnect" as const, label: "Bağla", verb: "connect" as const },
          { key: "onMove" as const, label: "Taşı", verb: "move_time" as const },
          { key: "onContinue" as const, label: "Devam", verb: "extend" as const },
        ].map((entry) => {
          const state = stateOf(entry.verb);
          const off = state?.kind === "disabled";
          return (
            <button
              key={entry.key}
              type="button"
              data-selection-verb={entry.label}
              onClick={() => run(entry.key)}
              disabled={off}
              /*
               * The reason travels with the control rather than waiting for a
               * press. A reader learns "Bağlamak için en az iki nota
               * gerekiyor." from a grey button; they learn nothing from one
               * that looks live and then says no.
               */
              title={off ? state.reason : undefined}
              aria-label={off ? `${entry.label} — ${state.reason}` : undefined}
              /* "Devam" is armed or not; the other two are not toggles. */
              aria-pressed={
                entry.key === "onContinue" ? actions.extendArmed : undefined
              }
              className={`min-w-0 flex-1 rounded-lg border px-1.5 text-sm whitespace-nowrap ${
                off
                  ? "border-line/50 text-muted/40"
                  : entry.key === "onContinue" && actions.extendArmed
                    ? "border-accent bg-accent/10 text-text"
                    : "border-line text-muted"
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: 48 }}
            >
              {entry.label}
            </button>
          );
        })}
        <button
          type="button"
          data-selection-more
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          aria-expanded={more}
          /*
           * Half again as wide as a verb. "Daha fazla" is the longest label on
           * the row and four equal shares of a 320px screen cut it — a control
           * whose name is clipped is a control the reader has to guess at, and
           * the three verbs beside it have letters to spare.
           */
          className="border-line text-muted min-w-0 flex-[1.5] rounded-lg border px-1.5 text-sm whitespace-nowrap"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: 72 }}
        >
          Daha fazla
        </button>
      </div>

      <Sheet
        open={more}
        title="Seçimle ne yapılsın?"
        onClose={() => setMore(false)}
        labelledBy="selection-more-title"
      >
        <h2 id="selection-more-title" className="sr-only">
          Seçimle ne yapılsın?
        </h2>
        <div className="flex flex-col gap-2">
          {drawer.map((entry) => {
            const off = entry.state?.kind === "disabled";
            return (
              <button
                key={entry.key}
                type="button"
                data-selection-action={entry.label}
                onClick={() => run(entry.key)}
                disabled={off}
                className={`rounded-lg border px-3 py-2 text-left ${
                  off ? "border-line/50" : "border-line"
                }`}
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              >
                <span
                  className={`block text-sm ${off ? "text-muted/40" : "text-text"}`}
                >
                  {entry.label}
                </span>
                <span className="text-muted block text-[11px]">
                  {off && entry.state?.kind === "disabled"
                    ? entry.state.reason
                    : entry.hint}
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
