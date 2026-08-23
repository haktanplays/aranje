"use client";

/**
 * The action strips under the work area: the bar-operation bar, the
 * time-selection bar, and the transform sheet behind both (2L-R).
 *
 * View only — every piece of state it shows belongs to the selection session,
 * and every button delegates back into it. The refusal paragraph sits
 * *outside* the action bar on purpose: some refusals take the selection with
 * them, and a message inside the bar would vanish with the thing it explains.
 */
import {
  BarActionBar,
  type BarRepeatChoice,
} from "@/components/workspace/BarActionBar";
import { ChainDecisionSheet } from "@/components/workspace/ChainDecisionSheet";
import { SelectionActionBar } from "@/components/workspace/SelectionActionBar";
import { TransformSheet } from "@/components/workspace/TransformSheet";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { TimingTarget } from "@/lib/workspace/use-timing-change";

export function SelectionActionArea({
  session,
  onOpenTiming,
}: {
  session: SelectionSession;
  /** Opens the meter-and-rhythm sheet; owned by the timing controller. */
  onOpenTiming: (target: TimingTarget) => void;
}) {
  const { time, bars } = session;

  return (
    <>
      {bars.handle.error ? (
        <p
          data-bar-error
          role="alert"
          className="border-reject/50 bg-raised text-reject border-t px-3 py-2 text-sm"
        >
          {bars.handle.error}
        </p>
      ) : null}

      {bars.handle.selection ? (
        <BarActionBar
          selection={bars.handle.selection}
          summary={bars.handle.summary ?? "Ölçü seçimi"}
          notice={bars.handle.notice}
          preview={bars.handle.preview}
          hasClipboard={bars.handle.hasClipboard}
          clipboardScope={bars.handle.clipboardScope}
          moreOpen={bars.sheet === "more"}
          moveOpen={bars.sheet === "move"}
          repeatOpen={bars.sheet === "repeat"}
          onAction={(action) => {
            switch (action) {
              case "copy":
                // Reading only: no commit, no write, no undo step.
                bars.handle.copy();
                return;
              case "cut":
                bars.stage({ kind: "cut_bars" });
                return;
              case "duplicate":
                bars.stage({ kind: "duplicate_bars" });
                return;
              case "delete":
                bars.stage({ kind: "delete_bars" });
                return;
              case "repeat":
                bars.setSheet("repeat");
                return;
              case "move":
                bars.setSheet("move");
                return;
              case "more":
                bars.setSheet("more");
                return;
            }
          }}
          onRepeat={(choice: BarRepeatChoice) =>
            bars.stage({ kind: "repeat_bars", mode: choice })
          }
          onMore={(action) => {
            switch (action) {
              case "timing": {
                // The bar the reader is holding, named by its own selection.
                const selection = bars.handle.selection;
                bars.setSheet(null);
                if (selection) {
                  onOpenTiming({
                    sectionId: selection.sectionId,
                    scope: { kind: "bar", barIndex: selection.startBarIndex },
                    title: `${selection.startBarIndex + 1}. ölçü · ölçü ve ritim`,
                  });
                }
                return;
              }
              case "paste":
                bars.setSheet(null);
                bars.handle.stagePaste();
                return;
              case "blank_before":
                bars.stage({ kind: "insert_blank_bar_before" });
                return;
              case "blank_after":
                bars.stage({ kind: "insert_blank_bar_after" });
                return;
              case "insert_before":
                bars.setSheet(null);
                bars.handle.stageInsertCopied("before");
                return;
              case "insert_after":
                bars.setSheet(null);
                bars.handle.stageInsertCopied("after");
                return;
            }
          }}
          onCloseMore={() => bars.setSheet(null)}
          onMoveLeft={() => bars.stage({ kind: "move_bars_left" })}
          onMoveRight={() => bars.stage({ kind: "move_bars_right" })}
          onApply={() => bars.apply()}
          onReplace={() => bars.apply({ replace: true })}
          onCancel={bars.handle.cancel}
          onClear={bars.clear}
        />
      ) : null}

      {time.handle.selection ? (
        <SelectionActionBar
          summary={
            time.pasteAt.kind === "choosing"
              ? "Yapıştırılacak yere uzun bas."
              : (time.handle.summary?.text ?? "Seçim")
          }
          notice={time.handle.notice}
          error={time.handle.error}
          onCancel={time.clear}
          onAction={(action) => {
            if (action === "copy") {
              // Reading only: no commit, no write, no undo step.
              time.handle.copy();
              return;
            }
            if (action === "cut") {
              time.handle.apply({ kind: "cut_selection" });
              return;
            }
            if (action === "duplicate") {
              time.handle.apply({ kind: "duplicate_selection" });
              return;
            }
            if (action === "delete") {
              time.handle.apply({ kind: "delete_selection" });
              return;
            }
            time.openSheet(
              action === "repeat" ? "repeat" : action === "move" ? "move" : "more",
            );
          }}
        />
      ) : null}

      <TransformSheet
        kind={time.sheet}
        stepTicks={time.stepTicks}
        beatTicks={time.beatTicks}
        barTicks={time.barTicks}
        pending={time.pasteCommand ?? time.handle.pending}
        preview={time.pastePreview ?? time.handle.preview}
        previewText={time.previewText}
        canPaste={time.handle.hasClipboard}
        onStartPaste={time.startPasteFlow}
        onStage={time.handle.stage}
        onApply={time.applyStaged}
        onClose={time.closeSheet}
      />

      {/*
        The chain decision sits in front of everything, because nothing has
        happened yet and nothing may until it is answered (spec 13.20 §2).
      */}
      <ChainDecisionSheet
        decision={time.handle.chainDecision}
        scopeText={time.chainScopeText}
        isChord={(time.handle.summary?.chordCount ?? 0) > 0}
        onChoose={time.handle.chooseChainPolicy}
        onCancel={time.cancelChainDecision}
      />
    </>
  );
}
