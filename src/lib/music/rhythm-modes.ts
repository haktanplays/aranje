/**
 * What a beginner is offered, and what an advanced reader may reach for
 * (2V-D.2 §5).
 *
 * ## Two surfaces, one domain
 *
 * Simple is not a smaller format. It is a short list of *intents* — things a
 * guitarist says out loud — and each one resolves to a metre, a grid and a
 * feel the Song Contract already accepts. Choosing one writes nothing the Pro
 * surface could not have written, and a song written in Pro opens in Simple
 * without being changed: Simple shows what it cannot name rather than
 * normalising it.
 *
 * The five intents are the five in the brief, and they are on a different axis
 * from `RHYTHM_PROFILES` — which are five *grids* (straight 1/8, 1/16, 1/32,
 * and two triplet grids), not five metres. Both lists stay. Naming an intent
 * `Üçlemeli 4/4` and a profile `Üçleme 1/8T` is not two names for one thing:
 * the intent says what the bar is, the profile says what the pencil writes.
 *
 * ## Why Pro evaluates more than it opens
 *
 * The brief asks Pro to consider numerators 2–15 against denominators 4, 8 and
 * 16 and to open only the ones that land on exact ticks. Two different things
 * can stop a pair: the tick lattice cannot express it, or the Song Contract
 * does not carry it. Both are reported, with the reason, and neither is
 * *hidden* — an option that vanishes teaches a reader nothing, while a closed
 * one with a sentence teaches them where the edge is (§6).
 *
 * Nothing here opens arbitrary tuplets, polymetre or tempo automation. They
 * are out of scope for this round and saying so in the type is cheaper than
 * saying so in a comment nobody reads.
 */
import { defaultGrouping, groupingPresets, type BeatGrouping } from "@/lib/music/rhythm-profile";
import {
  RESOLUTIONS,
  TIME_SIGNATURES,
  isRepresentableGrid,
  type OfferedResolution,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

export const SIMPLE_INTENT_IDS = [
  "straight_four",
  "triplet_four",
  "mixed_four",
  "waltz_three",
  "compound_six",
] as const;

export type SimpleIntentId = (typeof SIMPLE_INTENT_IDS)[number];

export type SimpleIntent = {
  readonly id: SimpleIntentId;
  /** What the button says. A feel, not a fraction. */
  readonly label: string;
  /** One line under it, in the same voice. */
  readonly hint: string;
  readonly meter: TimeSignature;
  readonly resolution: OfferedResolution;
  /** Absent where the metre's ordinary feel is the right one. */
  readonly grouping?: BeatGrouping;
};

/**
 * The five, in the order a beginner meets them.
 *
 * `mixed_four` is the only one that is not a grid choice at all: it is a 4/4
 * bar that expects both straight and triplet notes in it, which the lattice
 * holds exactly and no single offered grid can. It resolves to the same 1/16
 * bar as `straight_four`; what differs is that the availability gate will
 * raise this one bar when a triplet arrives, rather than refusing.
 */
export const SIMPLE_INTENTS: readonly SimpleIntent[] = [
  {
    id: "straight_four",
    label: "Düz 4/4",
    hint: "En yaygın his. Dört ana vuruş, eşit.",
    meter: [4, 4],
    resolution: 16,
  },
  {
    id: "triplet_four",
    label: "Üçlemeli 4/4",
    hint: "Her vuruş üçe bölünür; shuffle ve blues böyle sayılır.",
    meter: [4, 4],
    resolution: 12,
  },
  {
    id: "mixed_four",
    label: "Karışık 4/4",
    hint: "Aynı ölçüde hem düz hem üçlemeli notalar.",
    meter: [4, 4],
    resolution: 16,
  },
  {
    id: "waltz_three",
    label: "3/4",
    hint: "Üç ana vuruş. Vals hissi.",
    meter: [3, 4],
    resolution: 16,
  },
  {
    id: "compound_six",
    label: "6/8",
    hint: "İki ana vuruş, her biri üç sekizlik.",
    meter: [6, 8],
    resolution: 16,
  },
];

export function simpleIntent(id: SimpleIntentId): SimpleIntent {
  const found = SIMPLE_INTENTS.find((intent) => intent.id === id);
  /* Exhaustive by the type; the throw is what makes a later added id fail
     loudly here rather than silently resolve to 4/4 somewhere downstream. */
  if (!found) throw new Error(`unknown simple intent: ${id}`);
  return found;
}

/** The numerators Pro considers. */
export const PRO_NUMERATORS: readonly number[] = Array.from(
  { length: 14 },
  (_, index) => index + 2,
);

/** The denominators Pro considers. */
export const PRO_DENOMINATORS: readonly number[] = [4, 8, 16];

export type ProMeterState =
  /** In the contract, and writable on at least one grid. */
  | "open"
  /** Lands on exact ticks, but the Song Contract does not carry it yet. */
  | "not_in_contract"
  /** No grid the format has can write this metre exactly. */
  | "not_exact";

export type ProMeterOption = {
  readonly meter: readonly [number, number];
  readonly state: ProMeterState;
  /** The grids it can be written on. Empty unless `open`. */
  readonly grids: readonly OfferedResolution[];
  /** The feels it is normally played in. Empty unless `open`. */
  readonly groupings: readonly BeatGrouping[];
  /** Why it is closed, in a musician's words. Null when it is open. */
  readonly reason: string | null;
};

const inContract = (numerator: number, denominator: number): boolean =>
  TIME_SIGNATURES.some(
    (meter) => meter[0] === numerator && meter[1] === denominator,
  );

/** Every grid this metre can be written on exactly, offered ones only. */
function gridsFor(meter: readonly [number, number]): OfferedResolution[] {
  return (RESOLUTIONS as readonly Resolution[]).filter((resolution) =>
    isRepresentableGrid(meter as TimeSignature, resolution),
  ) as OfferedResolution[];
}

/**
 * The whole Pro option space, evaluated rather than listed.
 *
 * Every pair is answered, including the closed ones, so the surface above can
 * show a disabled row with a reason instead of a shorter list a reader cannot
 * interrogate.
 */
export function proMeterOptions(): readonly ProMeterOption[] {
  const options: ProMeterOption[] = [];
  for (const denominator of PRO_DENOMINATORS) {
    for (const numerator of PRO_NUMERATORS) {
      const meter = [numerator, denominator] as const;
      const grids = gridsFor(meter);
      if (grids.length === 0) {
        options.push({
          meter,
          state: "not_exact",
          grids: [],
          groupings: [],
          reason: "Bu ölçü hiçbir grid ayrıntısında birebir yazılamıyor.",
        });
        continue;
      }
      if (!inContract(numerator, denominator)) {
        options.push({
          meter,
          state: "not_in_contract",
          grids: [],
          groupings: [],
          reason: "Bu ölçü henüz proje biçiminde saklanamıyor.",
        });
        continue;
      }
      options.push({
        meter,
        state: "open",
        grids,
        groupings: groupingPresets(meter as TimeSignature),
        reason: null,
      });
    }
  }
  return options;
}

/** The open ones, for a control that only draws what can be chosen. */
export function openProMeters(): readonly ProMeterOption[] {
  return proMeterOptions().filter((option) => option.state === "open");
}

/**
 * The metre, grid and feel one Simple intent resolves to.
 *
 * Written out rather than left implicit so a caller applying an intent and a
 * caller describing one cannot come apart: both ask this.
 */
export function resolveIntent(id: SimpleIntentId): {
  readonly meter: TimeSignature;
  readonly resolution: OfferedResolution;
  readonly grouping: BeatGrouping;
} {
  const intent = simpleIntent(id);
  return {
    meter: intent.meter,
    resolution: intent.resolution,
    grouping: intent.grouping ?? defaultGrouping(intent.meter),
  };
}
