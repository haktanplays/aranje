/**
 * Where the beats of a bar actually fall (2V-D.2 §12).
 *
 * ## The scalar could not say it
 *
 * `slotsPerFeltBeat` returns one number — a single beat length for the whole
 * bar — and every metre whose beats are equal is served by that. 7/8 is not.
 * A 7/8 felt `2+2+3` has three beats of two, two and three eighths, and no
 * single number produces them. So the metronome clicked seven identical
 * eighths with only the first accented, the beat lines drew seven identical
 * ticks, and the count-in counted to seven. None of that is how anybody plays
 * a 7/8.
 *
 * This module answers the same question with a **list**, derived from the
 * grouping the bar carries. For 4/4, 3/4 and 6/8 it produces exactly what the
 * scalar produced, which is why replacing the scalar changes nothing that was
 * already right — `timing-authority.test.ts` holds that equivalence.
 *
 * ## Two strengths of beat, not one
 *
 * A bar has one downbeat and several secondary beats, and a metronome that
 * accents only the bar line makes 7/8 sound like 7/8 played badly. Each beat
 * therefore carries its own `strength`, and the click and the beat line both
 * read it instead of each deciding for themselves.
 *
 * Everything here is in **slots** of the bar's own grid, because that is what
 * the caller has: the tab draws in slots, the metronome walks slots, and a
 * tick answer would make every caller convert back.
 */
import {
  slotCount,
  slotsPerNotatedBeat,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";
import { defaultGrouping, groupingFitsMeter, type BeatGrouping } from "@/lib/music/rhythm-profile";

export type BeatStrength = "downbeat" | "secondary";

export type MeterBeat = {
  /** Slot index within the bar. */
  readonly slot: number;
  /** How many slots this beat lasts, up to the next one or the bar line. */
  readonly slots: number;
  readonly strength: BeatStrength;
  /** How many of the metre's own note values this beat is worth. */
  readonly units: number;
};

/**
 * The grouping a bar is felt in.
 *
 * The bar's own if it has one and it adds up, the metre's ordinary feel
 * otherwise. A stored grouping that does not sum to the numerator is ignored
 * rather than trusted — the schema refuses to store one, so reaching this
 * branch means the data came from somewhere that did not go through it.
 */
export function groupingOf(input: {
  readonly meter: TimeSignature;
  readonly grouping?: BeatGrouping;
}): BeatGrouping {
  const { meter, grouping } = input;
  if (grouping && groupingFitsMeter(grouping, meter)) return grouping;
  return defaultGrouping(meter);
}

/**
 * Every beat of one bar, in order, with the first marked as the downbeat.
 *
 * The list always covers the whole bar: the last beat runs to the bar line,
 * so summing `slots` gives `slotCount` exactly and nothing can fall between
 * two beats.
 */
export function meterBeats(input: {
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping?: BeatGrouping;
}): readonly MeterBeat[] {
  const { meter, resolution } = input;
  const grouping = groupingOf(input);
  /* Slots per one of the metre's own note values — an eighth in x/8, a
     quarter in x/4 — which is what a grouping entry counts. */
  const perUnit = slotsPerNotatedBeat(meter, resolution);
  const total = slotCount(meter, resolution);

  const beats: MeterBeat[] = [];
  let slot = 0;
  for (const [index, units] of grouping.entries()) {
    if (slot >= total) break;
    const span = Math.min(units * perUnit, total - slot);
    beats.push({
      slot,
      slots: span,
      strength: index === 0 ? "downbeat" : "secondary",
      units,
    });
    slot += span;
  }
  return beats;
}

/**
 * How the grouping reads out loud: `2+2+3`.
 *
 * The one place this string is built, so the picker, the summary and the
 * screen reader cannot spell the same feel three ways.
 */
export function groupingLabel(grouping: BeatGrouping): string {
  return grouping.join("+");
}

/**
 * Whether this grouping is a real feel for this metre.
 *
 * Sum first, because that is the failure a reader can actually make; the rest
 * is shape. Kept beside `meterBeats` so the check and the use are one module.
 */
export function groupingRefusal(
  grouping: BeatGrouping,
  meter: TimeSignature,
): string | null {
  if (grouping.length === 0) return "Bir ölçü en az bir vuruş grubu ister.";
  if (grouping.some((group) => !Number.isInteger(group) || group < 1)) {
    return "Her grup en az bir birim olmalı.";
  }
  const total = grouping.reduce((sum, group) => sum + group, 0);
  if (total !== meter[0]) {
    return `Gruplar ${total} ediyor; bu ölçü ${meter[0]} bekliyor.`;
  }
  return null;
}

/**
 * The groupings a metre is normally felt in, best-known first.
 *
 * Re-exported from `rhythm-profile`, where `defaultGrouping` reads the same
 * table: the ordinary feel of a metre and the list a reader picks from must
 * be one fact, or the app's default is not among the options it offers.
 */
export { GROUPING_PRESETS, groupingPresets } from "@/lib/music/rhythm-profile";
