/**
 * Meter, grid resolution and the tick arithmetic that follows from them
 * (spec 5.5, 8.3, K-34).
 *
 * A bar does not store how many slots it has. It stores a meter and a
 * resolution, and everything else — slot count, slot length in ticks, where
 * the beats fall, how wide the bar is drawn — is *derived* here. That was
 * already true while there were two resolutions; with five it is the only
 * thing keeping the eye, the ear and the editor on the same grid.
 *
 * ## The grids
 *
 * Resolution is "divisions of a whole note", which is why the same number
 * works in every meter:
 *
 *   8   eighth grid            4/4 -> 8 slots
 *   12  eighth triplets        4/4 -> 12 slots
 *   16  sixteenth grid         4/4 -> 16 slots
 *   24  sixteenth triplets     4/4 -> 24 slots
 *   32  thirty-second grid     4/4 -> 32 slots
 *
 * 12 and 24 are triplet grids: three slots to the note value rather than two.
 * They are not "slightly denser straight grids" and nothing here or upstream
 * may treat them as such — a bar at 12 has a slot every 64 ticks, not every
 * 48, and the beat falls every three slots.
 *
 * **64 is deliberately not here.** A 4/4 bar at 64 is sixty-four slots; at
 * thirty-two bars and several tracks that is a JSON and token cost the
 * prompt budget has no room for, and at 138 BPM a slot is about 27 ms —
 * shorter than the attack of the samples the pilot plays, so two adjacent
 * slots would not be heard as two notes. The gestures people actually want
 * 64 for (grace notes, flams, sweep gestures) are phrase-level events, not
 * dense grid steps, and modelling them as slots would be the wrong shape.
 * The need is real and is recorded as an open product gap (spec 5.5), not
 * quietly pretended away.
 *
 * ## Representable grids
 *
 * A grid has to be able to write the note value its meter is counted in, so
 * `resolution` must divide the meter's denominator evenly. That single rule
 * covers both things that could go wrong:
 *
 *   7/8 at 12 -> 10.5 slots, which is not a bar
 *   6/8 at 12 ->  9 slots, but an eighth would be 1.5 slots, so the meter's
 *                 own note value cannot be written
 *
 * Both are rejected by the schema and by `slotCount` (spec 5.5).
 */

/** Tone's pulses per quarter note, and the unit all musical time is in. */
export const PPQ = 192;

/** Ticks in a whole note. Every grid divides this. */
export const TICKS_PER_WHOLE = PPQ * 4;

export const TIME_SIGNATURES = [
  [4, 4],
  [3, 4],
  [6, 8],
  [7, 8],
] as const;

export type TimeSignature = (typeof TIME_SIGNATURES)[number];

export const RESOLUTIONS = [8, 12, 16, 24, 32] as const;

export type Resolution = (typeof RESOLUTIONS)[number];

/** The grids whose slot is a third of a note value rather than a half. */
export const TRIPLET_RESOLUTIONS: readonly Resolution[] = [12, 24];

export const DEFAULT_TIME_SIGNATURE: TimeSignature = [4, 4];
export const DEFAULT_RESOLUTION: Resolution = 8;

/** Meters enabled in the core scope (spec 2.6). */
export const CORE_TIME_SIGNATURES: readonly TimeSignature[] = [
  [4, 4],
  [6, 8],
];

export function isTripletGrid(resolution: number): boolean {
  return TRIPLET_RESOLUTIONS.includes(resolution as Resolution);
}

/**
 * How long one slot lasts, in ticks.
 *
 * 8 -> 96, 12 -> 64, 16 -> 48, 24 -> 32, 32 -> 24. Every supported grid
 * divides `TICKS_PER_WHOLE` exactly, so slot time is always a whole number
 * of ticks and no timing anywhere needs a rounding step.
 */
export function ticksPerSlot(resolution: number): number {
  return TICKS_PER_WHOLE / resolution;
}

/**
 * Whether this meter can be written on this grid at all.
 *
 * See the header: the rule is that the grid must divide the meter's own note
 * value. It is checked here, in the bar schema and in `slotCount`, rather
 * than assumed anywhere.
 */
export function isRepresentableGrid(
  timeSignature: readonly [number, number],
  resolution: number,
): boolean {
  const [numerator, denominator] = timeSignature;
  if (!Number.isInteger(resolution) || resolution <= 0) return false;
  if (denominator <= 0 || numerator <= 0) return false;
  if (resolution % denominator !== 0) return false;
  return Number.isInteger((numerator * resolution) / denominator);
}

/**
 * Number of grid slots in a bar.
 *
 * slotCount = numerator * resolution / denominator
 *
 * 4/4 at 8 -> 8, 4/4 at 12 -> 12, 4/4 at 16 -> 16, 4/4 at 24 -> 24,
 * 4/4 at 32 -> 32, 6/8 at 8 -> 6, 6/8 at 16 -> 12, 3/4 at 12 -> 9,
 * 7/8 at 8 -> 7.
 *
 * Throws on a grid the meter cannot be written on, because a caller that got
 * `10.5` back would go on to build a bar with half a slot in it.
 */
export function slotCount(
  timeSignature: TimeSignature,
  resolution: Resolution,
): number {
  if (!isRepresentableGrid(timeSignature, resolution)) {
    throw new RangeError(
      `${formatTimeSignature(timeSignature)} cannot be written at 1/${resolution}`,
    );
  }
  const [numerator, denominator] = timeSignature;
  return (numerator * resolution) / denominator;
}

/** How long a whole bar lasts, in ticks. */
export function ticksPerBar(
  timeSignature: TimeSignature,
  resolution: Resolution,
): number {
  return slotCount(timeSignature, resolution) * ticksPerSlot(resolution);
}

/**
 * Slots per *notated* beat — the note value in the meter's denominator.
 *
 * 4/4 at 16 is four; 4/4 at 12 is three, because the beat is three triplets.
 * Used for the light beat ticks under the staff.
 */
export function slotsPerNotatedBeat(
  timeSignature: readonly [number, number],
  resolution: number,
): number {
  return Math.max(1, resolution / timeSignature[1]);
}

/**
 * Slots per *felt* beat. In x/4 the beat is the quarter note. In compound
 * time, where the numerator divides by three, the beat is the dotted note,
 * so 6/8 counts two beats rather than six.
 *
 * This is what the metronome clicks on, which is why it is a different
 * question from `slotsPerNotatedBeat` and not a variant of it.
 */
export function slotsPerFeltBeat(
  timeSignature: readonly [number, number],
  resolution: number,
): number {
  const [numerator, denominator] = timeSignature;
  const base = slotsPerNotatedBeat(timeSignature, resolution);
  if (denominator === 8 && numerator % 3 === 0) return base * 3;
  return base;
}

export function isCoreTimeSignature(timeSignature: TimeSignature): boolean {
  return CORE_TIME_SIGNATURES.some(
    (core) => core[0] === timeSignature[0] && core[1] === timeSignature[1],
  );
}

export function formatTimeSignature(timeSignature: TimeSignature): string {
  return `${timeSignature[0]}/${timeSignature[1]}`;
}

/**
 * What the grid is called, to a musician (spec 13.x).
 *
 * A triplet grid is never shown as a bare number: "1/12" is not a note value
 * anyone counts, and a reader shown it next to "1/16" would reasonably read
 * the two as the same kind of thing.
 */
export function resolutionLabel(resolution: Resolution): string {
  switch (resolution) {
    case 12:
      return "1/8 \u00FC\u00E7leme";
    case 24:
      return "1/16 \u00FC\u00E7leme";
    default:
      return `1/${resolution}`;
  }
}

/**
 * The same label without diacritics, for the prompt blocks.
 *
 * The cacheable prefix is byte-stable ASCII (spec 11.5) and the rest of the
 * prompt is written the same way, so a triplet grid says "ucleme" there and
 * "\u00FC\u00E7leme" on screen. What it may never say in either place is a bare
 * "1/12".
 */
export function resolutionPromptLabel(resolution: Resolution): string {
  switch (resolution) {
    case 12:
      return "1/8 ucleme";
    case 24:
      return "1/16 ucleme";
    default:
      return `1/${resolution}`;
  }
}

/**
 * The most slots any bar in the contract can have: 4/4 at 1/32.
 *
 * Derived rather than written down, so widening `RESOLUTIONS` or the meter
 * list moves it without anyone remembering to.
 */
export const MAX_SLOTS_PER_BAR: number = Math.max(
  ...TIME_SIGNATURES.flatMap((timeSignature) =>
    RESOLUTIONS.filter((resolution) =>
      isRepresentableGrid(timeSignature, resolution),
    ).map((resolution) => slotCount(timeSignature, resolution)),
  ),
);
