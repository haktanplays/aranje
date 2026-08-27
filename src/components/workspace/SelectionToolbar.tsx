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
 * run, so it has to be one tap from a selection. `Taşı` and `Devam` are the
 * other two things a reader does to a run they have just covered. Everything
 * else — copy, cut, duplicate, repeat, delete — lives behind `Daha fazla`,
 * because those are the operations you go looking for rather than reach for.
 *
 * No new command is invented here. Every one of these calls the same handle
 * the tall bar called.
 */
import { useState } from "react";

import { Sheet } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { SelectionActions } from "@/lib/workspace/selection-verbs";

const MORE: readonly {
  readonly key: keyof SelectionActions;
  readonly label: string;
  readonly hint: string;
}[] = [
  { key: "onCopy", label: "Kopyala", hint: "Seçimi panoya alır; şarkı değişmez." },
  { key: "onCut", label: "Kes", hint: "Seçimi panoya alır ve yerinden kaldırır." },
  { key: "onDuplicate", label: "Çoğalt", hint: "Seçimin bir kopyasını hemen ardına koyar." },
  { key: "onRepeat", label: "Tekrarla", hint: "Seçimi kaç kez tekrarlayacağını sorar." },
  { key: "onDelete", label: "Sil", hint: "Seçili notaları kaldırır." },
];

export function SelectionToolbar({ actions }: { actions: SelectionActions }) {
  const [more, setMore] = useState(false);

  const run = (key: keyof SelectionActions) => {
    const action = actions[key];
    if (typeof action === "function") action();
    setMore(false);
  };

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
          { key: "onConnect" as const, label: "Bağla" },
          { key: "onMove" as const, label: "Taşı" },
          { key: "onContinue" as const, label: "Devam" },
        ].map((entry) => (
          <button
            key={entry.key}
            type="button"
            data-selection-verb={entry.label}
            onClick={() => run(entry.key)}
            className="border-line text-muted min-w-0 flex-1 rounded-lg border px-1.5 text-sm whitespace-nowrap"
            style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: 48 }}
          >
            {entry.label}
          </button>
        ))}
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
          {MORE.map((entry) => (
            <button
              key={entry.key}
              type="button"
              data-selection-action={entry.label}
              onClick={() => run(entry.key)}
              className="border-line rounded-lg border px-3 py-2 text-left"
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              <span className="text-text block text-sm">{entry.label}</span>
              <span className="text-muted block text-[11px]">{entry.hint}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
