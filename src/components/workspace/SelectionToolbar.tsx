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
 * else — copy, cut, paste, duplicate, repeat, delete, and the two listening
 * intents — lives behind `Daha fazla`, because those are the operations you go
 * looking for rather than reach for.
 *
 * No new command is invented here. Every one of these calls the same handle
 * the tall bar called — the *same* handle, through the same runner, since
 * 2V-B.
 *
 * ## Neither list is in this file (2V-B §2)
 *
 * Which verbs apply is a musical question — is this one onset or several, is
 * there a bar to the left, is there anything on the clipboard — and it is
 * answered in `selection-capability.ts`. *Where* each answer is drawn is
 * answered in `selection-action-canon.ts`. This file draws one 44px row and a
 * sheet, and knows what is in neither.
 *
 * The row is still frozen at four — UI Contract v1 — so a verb that does not
 * apply cannot be dropped to make space; it is greyed instead, with the reason
 * the model gave, on the control rather than after the press. The sheet may
 * drop an entry, because a sheet has room to be shorter.
 */
import { useState } from "react";

import { SelectionMoreSheet } from "@/components/workspace/SelectionMoreSheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { onSurface, type SelectionActionId } from "@/lib/song/selection-action-canon";
import type { SelectionActions } from "@/lib/workspace/selection-verbs";

export function SelectionToolbar({ actions }: { actions: SelectionActions }) {
  const [more, setMore] = useState(false);

  const run = (id: SelectionActionId) => {
    if (id === "more") {
      setMore(true);
      return;
    }
    actions.run(id);
    setMore(false);
  };

  const row = onSurface(actions.actions, "edit_primary");
  const drawer = onSurface(actions.actions, "more_sheet");

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
        {row
          .filter((entry) => entry.id !== "more")
          .map((entry) => {
            const off = entry.availability === "disabled";
            const armed = entry.id === "extend" && actions.extendArmed;
            return (
              <button
                key={entry.id}
                type="button"
                data-selection-verb={entry.label}
                data-selection-action-id={entry.id}
                onClick={() => run(entry.id)}
                disabled={off}
                /*
                 * The reason travels with the control rather than waiting for
                 * a press. A reader learns "Bağlamak için en az iki nota
                 * gerekiyor." from a grey button; they learn nothing from one
                 * that looks live and then says no.
                 */
                title={off ? entry.reason : undefined}
                aria-label={off ? `${entry.label} — ${entry.reason}` : undefined}
                /* "Devam" is armed or not; the other two are not toggles. */
                aria-pressed={entry.id === "extend" ? actions.extendArmed : undefined}
                className={`min-w-0 flex-1 rounded-lg border px-1.5 text-sm whitespace-nowrap ${
                  off
                    ? "border-line/50 text-muted/40"
                    : armed
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

      <SelectionMoreSheet
        open={more}
        actions={drawer}
        onRun={run}
        onClose={() => setMore(false)}
      />
    </>
  );
}
