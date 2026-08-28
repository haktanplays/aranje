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
 */
export type PointerOwner = "duration" | "pen" | "selection" | "none";

export function pointerOwner(input: {
  /** True when the pointer went down on a duration handle. */
  readonly onDurationHandle?: boolean;
  /** True when a touch on the staff would write notes. */
  readonly penArmed: boolean;
  /** True when this surface has a selection gesture to offer at all. */
  readonly selectionAvailable: boolean;
}): PointerOwner {
  if (input.onDurationHandle === true) return "duration";
  if (input.penArmed) return "pen";
  return input.selectionAvailable ? "selection" : "none";
}

/**
 * Whether this element should refuse to let the browser scroll the page.
 *
 * `touch-action: none` is applied to the handle and to nothing else — a page
 * that cannot be scrolled is a worse product than a handle that occasionally
 * loses a drag, so the smaller hammer is the right one.
 */
export function stopsPageScroll(owner: PointerOwner): boolean {
  return owner === "duration";
}
