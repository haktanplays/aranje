/**
 * Who owns a press on the staff (K-59.1 §5).
 *
 * Two gestures start the same way — a finger goes down on a cell and stays
 * there. One of them writes a chord; the other opens a time selection. Until
 * this file they both ran, because the pen listened on the cell and the
 * selection's long press listened on the content behind it, and a press
 * bubbles. The reader picked up the power-chord pen, held a beat, and got
 * "Boş seçim · 1 ölçü" instead of three ghost numbers.
 *
 * The fix is not a shorter timer or a taller one. A race decided by
 * milliseconds is a race the reader loses on a slow phone and wins on a fast
 * one, which is worse than losing it consistently. Ownership is decided
 * before the press, from what the reader is holding:
 *
 * - A writing pen is armed → the pen owns every press on the staff.
 * - No pen → the selection's long press owns it, as it always has.
 *
 * The brush is deliberately not here. It works *on* a selection, so it needs
 * the selection gesture to keep working — taking the pointer away from it
 * would break the tool it exists to serve.
 *
 * ## The duration handle (2T §7)
 *
 * A handle is a different kind of thing from a tool: the reader is not
 * holding it, they have put their finger *on* it. So it does not join the
 * queue — it wins outright, from the moment the pointer goes down and for as
 * long as the drag lasts. The founder's finding was the page scrolling out
 * from under a duration drag, which is what happens when a gesture is decided
 * after the fact by whoever moved first.
 *
 * Nothing global is switched off to achieve that. The handle stops the page
 * scrolling under *itself*; a finger anywhere else on the staff still scrolls
 * the page, because taking that away would be fixing one gesture by breaking
 * the one every reader uses most.
 *
 * ## The measure header (2U-A §2)
 *
 * A bar header is not a staff cell, and holding one means "this whole bar" —
 * which is a different question from "write a note here". It is a *place*
 * rather than a surface, so like the handle it wins outright: an armed pen
 * does not write into a header, because there is no string under it to write
 * on. Without this rule the pen would own every press on the block, and
 * holding a header with the power-chord pen up would write three notes into
 * the first slot instead of selecting the bar.
 */
export type PointerOwner =
  /**
   * A bar-range drag that has already been recognised (2U-B §8).
   *
   * The only owner in this list that is not decided at pointerdown. Every
   * other entry answers "what is the reader holding", which is known before
   * the finger lands; this one answers "what did this gesture turn out to be",
   * and it cannot be known until the long-press threshold has elapsed. Until
   * then the press is an ordinary `measure` press and the page still scrolls,
   * which is the point — a bar number that could not be scrolled past would be
   * a worse product than one that occasionally loses a drag.
   *
   * It outranks the rest because by the time it is true the reader has held
   * still for half a second on a bar header, which is not something anyone
   * does by accident.
   */
  | "bar_range"
  | "duration"
  | "measure"
  | "pen"
  | "selection"
  | "none";

export function pointerOwner(input: {
  /** True once a bar-range long press has been recognised on this sequence. */
  readonly barRangeOwning?: boolean;
  /** True when the pointer went down on a duration handle. */
  readonly onDurationHandle?: boolean;
  /** True when the pointer went down on a bar's header or gutter. */
  readonly onMeasureHeader?: boolean;
  /** True when a touch on the staff would write notes. */
  readonly penArmed: boolean;
  /** True when this surface has a selection gesture to offer at all. */
  readonly selectionAvailable: boolean;
}): PointerOwner {
  if (input.barRangeOwning === true) return "bar_range";
  if (input.onDurationHandle === true) return "duration";
  if (input.onMeasureHeader === true) return "measure";
  if (input.penArmed) return "pen";
  return input.selectionAvailable ? "selection" : "none";
}

/**
 * Whether this element should refuse to let the browser scroll the page.
 *
 * The reader is holding something and moving it, so a page that moved as well
 * would be moving the thing they are trying to aim at. It is true of a
 * duration handle and of a recognised bar range, and of nothing else: a page
 * that cannot be scrolled is a worse product than a handle that occasionally
 * loses a drag, so the smaller hammer is the right one.
 */
export function stopsPageScroll(owner: PointerOwner): boolean {
  return owner === "duration" || owner === "bar_range";
}

/**
 * What this element declares to the compositor before the gesture starts
 * (2U-C §1).
 *
 * The one thing that has to be got right on Android, and the one thing the
 * per-event suppression in `use-bar-range-drag.ts` cannot do on its own.
 *
 * `touch-action` is latched when a gesture *begins*. It is a promise made to
 * the compositor about which pans it may run without waiting to hear from the
 * page — so a value it names is a pan that happens whether or not the page
 * later calls `preventDefault`. The bar header used to declare `pan-x`, which
 * handed away precisely the axis this gesture exists to own: a finger that
 * started moving sideways on a bar number was the scroller's before the long
 * press had finished, and the drag then spent its life asking for a sequence
 * that had already been given to someone else. Measured on a 412x915 Android
 * Chrome emulation, a sideways swipe from a bar header scrolled the tab 205px
 * under a gesture that was supposed to be selecting bars.
 *
 * So the permission is withdrawn rather than fought. `pan-y` keeps the header
 * from being a dead strip — the page still scrolls vertically from it — and
 * reserves only the horizontal axis, and only on the 22px band that exists to
 * start this gesture. The staff below declares nothing, so it scrolls both
 * ways exactly as it always did; nothing is switched off globally, and
 * `touch-action: none` still belongs to the duration handle alone.
 *
 * Here rather than in the two bar blocks that spell it out, because a
 * declaration duplicated in two components is a declaration that will disagree
 * with itself the day one of them is tuned — which is how it came to be
 * `pan-x` in the first place.
 */
export function declaredTouchAction(
  owner: PointerOwner,
): "auto" | "none" | "pan-y" {
  if (owner === "duration") return "none";
  return owner === "measure" || owner === "bar_range" ? "pan-y" : "auto";
}
