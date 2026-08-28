/**
 * The arrow beside a strummed chord (2T-C §9).
 *
 * A strum is one written onset played by a hand crossing the strings, so it
 * is drawn the way tablature draws it: a single arrow beside the chord,
 * pointing the way the hand went — never one mark per note, which would read
 * as six separate instructions instead of one gesture.
 *
 * The mark spans only the strings the chord actually uses. A three-string
 * chord gets a three-string arrow, because an arrow drawn across all six
 * would be telling the reader to hit strings that are not in the chord.
 */
import type { TabSpan } from "@/lib/tab/timeline";

export type StrumMark = {
  /** The onset the chord is written on. */
  readonly slotIndex: number;
  readonly direction: "down" | "up";
  /** The thickest string the arrow reaches (the lowest index). */
  readonly fromString: number;
  /** The thinnest string it reaches. */
  readonly toString: number;
  readonly voices: number;
  /** Read aloud, as a guitarist would say it. */
  readonly label: string;
};

/**
 * Every strummed onset of one bar, in playing order.
 *
 * A single voice is not a strum and never gets an arrow: there is nothing to
 * cross. That is the same rule the chord-shape core enforces when the mark is
 * written ("Tek ses strum olamaz"), said here for the drawing.
 */
export function strumMarks(spans: readonly TabSpan[]): readonly StrumMark[] {
  const bySlot = new Map<number, TabSpan[]>();
  for (const span of spans) {
    if (span.openStart || span.strum === undefined) continue;
    bySlot.set(span.startSlot, [...(bySlot.get(span.startSlot) ?? []), span]);
  }

  const marks: StrumMark[] = [];
  for (const [slotIndex, group] of [...bySlot.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length < 2) continue;
    const strings = group.map((span) => span.stringIndex);
    const direction = group[0]!.strum!;
    marks.push({
      slotIndex,
      direction,
      fromString: Math.min(...strings),
      toString: Math.max(...strings),
      voices: group.length,
      label:
        direction === "down"
          ? `${group.length} telde aşağı vuruş`
          : `${group.length} telde yukarı vuruş`,
    });
  }
  return marks;
}
