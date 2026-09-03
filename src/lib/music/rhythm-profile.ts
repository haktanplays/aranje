/**
 * The axes a rhythm actually has (2V-B.3 §15, §16).
 *
 * ## Six things that were one thing
 *
 * "Ritim" had been standing for several unrelated decisions at once, and the
 * confusion is not academic — it is exactly why "hızlandır" and "yakınlaş"
 * kept being answered by the same control. They are separated here, named, and
 * given one home:
 *
 * - **Meter** — how many of what, per measure. 4/4, 3/4, 6/8.
 * - **Beat grouping** — how those beats are felt. 6/8 as `3+3`, 7/8 as `2+2+3`.
 * - **Subdivision** — the grid notes may be written on: binary or triplet.
 * - **Tuplet capability** — whether a division other than the grid's own is
 *   expressible at all.
 * - **Phrase interval** — a musical region, which may span several measures.
 * - **View zoom** — how much of it is on the screen, and nothing else.
 *
 * The last one is not in this file at all, and that is the point: it lives in
 * `view-zoom.ts` and cannot reach a note.
 *
 * ## Simple is a projection, not a second format
 *
 * The profiles below are the five a beginner is offered. They are named after
 * what a musician says out loud, and each one is a resolution the Song schema
 * already accepts — so choosing one writes nothing new, and a song written in
 * a rhythm no profile names is still a valid song that plays, serialises and
 * round-trips exactly as it did. A projection that damaged what it could not
 * show would be a second, lossy song format wearing a friendly label.
 */
import {
  RESOLUTIONS,
  TRIPLET_RESOLUTIONS,
  slotCount,
  ticksPerBar,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

export const RHYTHM_PROFILE_IDS = [
  "straight_8",
  "straight_16",
  "straight_32",
  "triplet_8",
  "triplet_16",
] as const;

export type RhythmProfileId = (typeof RHYTHM_PROFILE_IDS)[number];

export type RhythmProfile = {
  readonly id: RhythmProfileId;
  /** What the control says. Never "resolution", never a tick count. */
  readonly label: string;
  readonly resolution: Resolution;
  readonly family: "straight" | "triplet";
};

export const RHYTHM_PROFILES: readonly RhythmProfile[] = [
  { id: "straight_8", label: "Düz 1/8", resolution: 8, family: "straight" },
  { id: "straight_16", label: "Düz 1/16", resolution: 16, family: "straight" },
  { id: "straight_32", label: "Düz 1/32", resolution: 32, family: "straight" },
  { id: "triplet_8", label: "Üçleme 1/8T", resolution: 12, family: "triplet" },
  { id: "triplet_16", label: "Üçleme 1/16T", resolution: 24, family: "triplet" },
];

/**
 * Which profile a bar is written in, or null.
 *
 * Null is a real answer and not a gap: 1/4 is a resolution the schema accepts
 * and no Simple profile names, and a bar written on it must keep playing and
 * keep its notes. What Simple does with a null is show the bar without
 * claiming a profile for it — never quantise it into one.
 */
export function profileForResolution(resolution: number): RhythmProfile | null {
  return RHYTHM_PROFILES.find((profile) => profile.resolution === resolution) ?? null;
}

/** Every resolution the schema accepts, profiled or not. */
export const ALL_RESOLUTIONS: readonly Resolution[] = RESOLUTIONS;

export function isTripletResolution(resolution: number): boolean {
  return (TRIPLET_RESOLUTIONS as readonly number[]).includes(resolution);
}

/**
 * How the beats of a measure are grouped, as a list of beats per group.
 *
 * Explicit and optional, in that order. A 7/8 that is felt `2+2+3` and one
 * felt `3+2+2` are different music with identical notes, and nothing else in
 * the format can say which — so it is said here or not at all, rather than
 * guessed from the note pattern.
 */
export type BeatGrouping = readonly number[];

export function defaultGrouping(meter: TimeSignature): BeatGrouping {
  const [count, unit] = meter;
  /* Compound metres are felt in threes: 6/8 is two dotted beats, not six. */
  if (unit === 8 && count % 3 === 0) {
    return Array.from({ length: count / 3 }, () => 3);
  }
  return Array.from({ length: count }, () => 1);
}

export function groupingFitsMeter(grouping: BeatGrouping, meter: TimeSignature): boolean {
  if (grouping.length === 0) return false;
  if (grouping.some((group) => !Number.isInteger(group) || group < 1)) return false;
  return grouping.reduce((total, group) => total + group, 0) === meter[0];
}

/**
 * The full rhythm state of one measure, on every axis at once.
 *
 * A value, so that "what rhythm is this bar in" has one answer that a UI, a
 * validator and a Copilot command can all be handed — rather than three
 * readings of the same three fields.
 */
export type RhythmAxes = {
  readonly meter: TimeSignature;
  readonly grouping: BeatGrouping;
  readonly resolution: Resolution;
  readonly profile: RhythmProfile | null;
  readonly barTicks: number;
  readonly slotTicks: number;
  readonly slots: number;
};

export function rhythmAxes(input: {
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping?: BeatGrouping;
}): RhythmAxes {
  const { meter, resolution } = input;
  const grouping =
    input.grouping && groupingFitsMeter(input.grouping, meter)
      ? input.grouping
      : defaultGrouping(meter);
  const slots = slotCount(meter, resolution);
  const barTicks = ticksPerBar(meter, resolution);
  return {
    meter,
    grouping,
    resolution,
    profile: profileForResolution(resolution),
    barTicks,
    slotTicks: barTicks / slots,
    slots,
  };
}
