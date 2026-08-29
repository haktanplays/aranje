/**
 * Turning a press on a bar into a run of bars (2U-A §9, §11).
 *
 * ## Why a gesture needs its own function
 *
 * A measure selection has two moves — take hold of a bar, and reach from it
 * to another — and both were being done by whichever surface happened to own
 * the press. The arrangement grew handles; the tab grew a long press; each
 * decided for itself what a second press meant. That is how one surface ends
 * up replacing the selection where the other extends it, and neither is
 * wrong, because nothing ever said which it should be.
 *
 * So the decision is made once, here, from what is held and what was pressed.
 * Every surface asks the same question and draws the same answer.
 *
 * ## Contiguous, and not by convention
 *
 * §11 asks for contiguous multi-measure selection and rules out the
 * non-contiguous kind this round. That is not enforced by a check, because
 * `BarSelection` cannot express a gap: it is a start index and an end index,
 * and every bar between them is in. A selection with a hole in it is
 * unrepresentable rather than rejected, which is the stronger guarantee — a
 * later gesture cannot smuggle one in by forgetting to call the validator.
 *
 * What *can* go wrong is an extension that means nothing: reaching from a
 * guitar's bar into the drums, or across a section boundary, or from a
 * one-instrument selection into a whole-bar one. Those are refused by name.
 *
 * ## Nothing here writes
 *
 * A gesture produces a selection and only a selection. No Song, no history
 * step, no storage. The commands in `bar-transform.ts` do the writing, and
 * they are reached from the selection this returns.
 */
import {
  barSelectionLength,
  type BarSelection,
} from "@/lib/song/bar-selection";
import type { PointerOwner } from "@/lib/tab/pointer-ownership";

/** What a surface says happened, in the reader's terms rather than the DOM's. */
export type MeasureGesture =
  /** A press on a bar. Takes hold of it, letting go of whatever was held. */
  | {
      readonly kind: "press";
      readonly sectionId: string;
      readonly barIndex: number;
      /**
       * Present when the press was on one instrument's bar, absent when it
       * was on the bar itself. The two are never merged: one empties a
       * lane, the other can remove a bar from the song.
       */
      readonly trackId?: string;
    }
  /** A reach from what is already held out to another bar. */
  | {
      readonly kind: "extend";
      readonly sectionId: string;
      readonly barIndex: number;
      /**
       * Which end moves. `"auto"` lets the nearer edge move, which is what a
       * second press means when there is no handle to say otherwise.
       */
      readonly edge: "start" | "end" | "auto";
      /**
       * The instrument the reach was made on, when the surface draws lanes.
       *
       * Checked rather than assumed: the tab can change which track is active
       * between the first press and the second, and reaching from the
       * guitar's third bar into the drums' fifth is not a wider selection —
       * it is two selections the reader would have to be told apart.
       */
      readonly trackId?: string;
    };

export type MeasureGestureErrorCode =
  /** An extend arrived with nothing held. */
  | "nothing_held"
  /** An extend reached into a different section. */
  | "crosses_section"
  /** An extend reached into a different instrument's lane. */
  | "crosses_track"
  /** The bar pressed is not in the section. */
  | "bar_out_of_bounds";

export type MeasureGestureFailure = {
  readonly code: MeasureGestureErrorCode;
  readonly message: string;
};

export type MeasureGestureResult =
  | {
      readonly ok: true;
      readonly selection: BarSelection;
      /** How many bars the run holds now. Never less than one. */
      readonly barCount: number;
      /**
       * True when this changed nothing — the same bar pressed again, or an
       * edge dragged back onto where it already was.
       *
       * A surface uses it to avoid re-announcing a selection the reader can
       * already see, and to avoid a state write that would re-render the
       * staff for no reason.
       */
      readonly unchanged: boolean;
    }
  | { readonly ok: false; readonly error: MeasureGestureFailure };

const fail = (
  code: MeasureGestureErrorCode,
  message: string,
): MeasureGestureResult => ({ ok: false, error: { code, message } });

/** The bars a section has, so a gesture cannot point past the end of it. */
export type MeasureBounds = {
  readonly sectionId: string;
  readonly barCount: number;
};

const sameSelection = (a: BarSelection, b: BarSelection): boolean =>
  a.scope === b.scope &&
  a.sectionId === b.sectionId &&
  a.startBarIndex === b.startBarIndex &&
  a.endBarIndex === b.endBarIndex &&
  (a.scope !== "track" || b.scope !== "track" || a.trackId === b.trackId);

/**
 * What the reader is holding after this gesture.
 *
 * `current` is what they held before it, or null when they held nothing. The
 * answer is a selection or a named refusal; it is never a partial selection
 * and never silently a different scope from the one that was held.
 */
export function resolveMeasureGesture(
  current: BarSelection | null,
  gesture: MeasureGesture,
  bounds: MeasureBounds,
): MeasureGestureResult {
  if (gesture.sectionId !== bounds.sectionId) {
    return fail(
      "crosses_section",
      "Ölçü seçimi bir bölümün içinde kalır; bölüm sınırını aşamaz.",
    );
  }
  if (
    !Number.isInteger(gesture.barIndex) ||
    gesture.barIndex < 0 ||
    gesture.barIndex >= bounds.barCount
  ) {
    return fail("bar_out_of_bounds", "Bu ölçü bölümde yok.");
  }

  if (gesture.kind === "press") {
    const selection: BarSelection =
      gesture.trackId === undefined
        ? {
            scope: "full",
            sectionId: gesture.sectionId,
            startBarIndex: gesture.barIndex,
            endBarIndex: gesture.barIndex,
          }
        : {
            scope: "track",
            sectionId: gesture.sectionId,
            trackId: gesture.trackId,
            startBarIndex: gesture.barIndex,
            endBarIndex: gesture.barIndex,
          };
    return {
      ok: true,
      selection,
      barCount: 1,
      unchanged: current !== null && sameSelection(current, selection),
    };
  }

  if (!current) {
    return fail("nothing_held", "Genişletmek için önce bir ölçü seçilmeli.");
  }
  if (current.sectionId !== gesture.sectionId) {
    return fail(
      "crosses_section",
      "Ölçü seçimi bir bölümün içinde kalır; bölüm sınırını aşamaz.",
    );
  }
  if (
    current.scope === "track" &&
    gesture.trackId !== undefined &&
    gesture.trackId !== current.trackId
  ) {
    return fail(
      "crosses_track",
      "Seçim tek bir enstrümanın ölçülerinde; başka bir enstrümana genişletilemez.",
    );
  }

  /*
   * Which edge moves. A handle says; a second press does not, so the nearer
   * edge moves — reaching backwards past the start grows the run backwards,
   * and reaching forwards past the end grows it forwards. Landing inside the
   * run shrinks the nearer edge onto the pressed bar, which is how a reader
   * takes bars back out of a selection without starting over.
   */
  const edge =
    gesture.edge !== "auto"
      ? gesture.edge
      : gesture.barIndex - current.startBarIndex <=
          current.endBarIndex - gesture.barIndex
        ? "start"
        : "end";

  /*
   * An edge never crosses the other one. Without this the run turns inside
   * out mid-drag and the reader watches a selection they are still holding
   * jump to the far side of the bar under their finger.
   */
  const next: BarSelection =
    edge === "start"
      ? {
          ...current,
          startBarIndex: Math.min(gesture.barIndex, current.endBarIndex),
        }
      : {
          ...current,
          endBarIndex: Math.max(gesture.barIndex, current.startBarIndex),
        };

  return {
    ok: true,
    selection: next,
    barCount: barSelectionLength(next),
    unchanged: sameSelection(current, next),
  };
}

/**
 * Whether a press on a bar's header belongs to the measure gesture at all.
 *
 * The ranking itself lives in `tab/pointer-ownership.ts` — this is the one
 * sentence a surface needs from it, so a component never re-derives the order
 * from the props it happens to have been given.
 */
export function measureGestureWanted(owner: PointerOwner): boolean {
  /*
   * `bar_range` too, because it *is* this gesture — the same press, half a
   * second later, once it has been recognised (2U-B §8). Leaving it out would
   * make the drag stop wanting its own pointer at the exact moment it took
   * ownership of it.
   */
  return owner === "measure" || owner === "bar_range";
}

/**
 * Bars a run of them covers, for a surface that draws the selection.
 *
 * Returned as indices rather than as a range so a caller can test membership
 * without re-deriving the arithmetic, which is where an off-by-one turns into
 * a bar drawn as selected that no command will touch.
 */
export function barsInSelection(selection: BarSelection): readonly number[] {
  const bars: number[] = [];
  for (
    let index = selection.startBarIndex;
    index <= selection.endBarIndex;
    index += 1
  ) {
    bars.push(index);
  }
  return bars;
}
