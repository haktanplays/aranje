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
import { SelectionMoreSheet } from "@/components/workspace/SelectionMoreSheet";
import { TransformSheet } from "@/components/workspace/TransformSheet";
import { PRACTICE_FROM_SELECTION_LABEL } from "@/lib/practice/messages";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { onSurface } from "@/lib/song/selection-action-canon";
import {
  measureActions,
  selectionActions,
  selectionRunner,
} from "@/lib/workspace/selection-verbs";
import type { Song } from "@/lib/song/schema";
import type { PracticeSession } from "@/lib/workspace/use-practice-session";
import type { SelectionListening } from "@/lib/workspace/use-selection-listening";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { TimingTarget } from "@/lib/workspace/use-timing-change";

export function SelectionActionArea({
  session,
  song,
  listening,
  practice,
  compact,
  onOpenTiming,
}: {
  session: SelectionSession;
  /**
   * Read to ask what the selection offers, never written through.
   *
   * The bar below draws whatever the capability model says, the way the
   * focused row does — one answer, two surfaces (2V-A.1 §2).
   */
  song: Song;
  /**
   * The two listening intents, bound to the transport (2V-A §3, 2V-B §1).
   *
   * Here, and not only in edit mode. A reader who is reading may want to hear
   * what they are holding at least as much as one who is writing, and the
   * founder was told to — the guide's step 2 asks for "Seçimi dinle" and the
   * reading surface's sheet had no such thing in it.
   */
  listening: SelectionListening;
  /**
   * True while the reader is writing (K-59 §3).
   *
   * The tall selection bar belongs to the reading surface. In focused edit the
   * compact selection toolbar carries the same verbs in one 44px row, and two
   * layers of the same thing is what clipped three strings at 320x700.
   *
   * The practice door stands down with it: practising a range is a reading
   * errand, and it is one tap away again the moment "Bitti" is pressed.
   */
  compact: boolean;
  /** The practice loop, so a whole-bar time selection can become one (§V.B). */
  practice: PracticeSession;
  /** Opens the meter-and-rhythm sheet; owned by the timing controller. */
  onOpenTiming: (target: TimingTarget) => void;
}) {
  const { time, bars } = session;
  /*
   * Offered only when the selection really is whole bars, and offered through
   * the *same* function that would convert it. A looser predicate here would
   * be an action that appears and then refuses.
   */
  const selection = time.handle.selection;
  /*
   * One answer, asked once, for the grid and the sheet behind it. Two
   * derivations here would be two lists again, which is the defect (§2).
   */
  const read = selectionActions({
    song,
    time,
    mode: "read",
    looping: listening.looping,
  });
  const runRead = selectionRunner({
    time,
    listening,
    openMore: () => time.openSheet("more"),
  });
  const offersPractice =
    !compact && selection !== null && practice.offersFromSelection(selection);

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
          actions={measureActions({ song, bars, looping: listening.looping })}
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
              /*
               * Ephemeral, both: they schedule sound and produce no command.
               * The plan is built from the bar selection's own descriptor, so
               * "Bu enstrüman" plays one track and "Tüm enstrümanlar" plays
               * every one (2V-B §6).
               */
              case "listen_once":
                listening.audition();
                return;
              case "listen_loop":
                listening.toggleLoop();
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
              default:
                /* The canon draws nothing else on this row. */
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
          onScope={bars.setScope}
          onApply={() => bars.apply()}
          onReplace={() => bars.apply({ replace: true })}
          onCancel={bars.handle.cancel}
          onClear={bars.clear}
        />
      ) : null}

      {/*
        The third door (§V.B). A strip of its own rather than a new entry in
        the selection bar's action set: this does not edit anything, and
        putting it among cut/copy/delete would say that it might.
      */}
      {offersPractice && selection ? (
        <div className="border-line border-t px-3 py-2">
          <button
            type="button"
            data-practice-from-selection
            onClick={() => practice.setFromTimeSelection(selection)}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            className="border-bronze text-bronze w-full rounded-lg border px-3 text-sm"
          >
            {PRACTICE_FROM_SELECTION_LABEL}
          </button>
        </div>
      ) : null}

      {time.handle.selection && !compact ? (
        <SelectionActionBar
          actions={onSurface(read, "read_primary")}
          extendArmed={time.extendArmed}
          summary={
            time.pasteAt.kind === "choosing"
              ? "Yapıştırılacak yere uzun bas."
              : (time.handle.summary?.text ?? "Seçim")
          }
          notice={time.handle.notice}
          error={time.handle.error}
          onCancel={time.clear}
          onAction={runRead}
        />
      ) : null}

      {/*
        What did not fit on the grid (2V-B §1). The same sheet the compact row
        opens, drawing the same canon — which is the whole of the fix: this
        door used to lead to a hard-coded pair with "Seçimi sil" in it, and
        "Sil" is already on the grid the reader pressed it from.
      */}
      <SelectionMoreSheet
        open={time.sheet === "more"}
        actions={onSurface(read, "more_sheet")}
        onRun={runRead}
        onClose={() => time.closeSheet()}
      />

      <TransformSheet
        kind={time.sheet}
        stepTicks={time.stepTicks}
        beatTicks={time.beatTicks}
        barTicks={time.barTicks}
        pending={time.pasteCommand ?? time.handle.pending}
        preview={time.pastePreview ?? time.handle.preview}
        previewText={time.previewText}
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
