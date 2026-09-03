/**
 * How long, said the way a musician says it (2V-B.4 §6).
 *
 * ## The measurement this file answers
 *
 * At `c11a758`, tapping a cell opened a sheet headed **"Bar 1 · slot 1 · tel 1"**
 * with nine note-value names — birlik, noktalı ikilik, ikilik, noktalı dörtlük,
 * dörtlük, noktalı sekizlik, sekizlik, on altılık, otuz ikilik — and a
 * "Süre − ikilik +" stepper beside them. That is a notation lesson standing
 * between a beginner and a note, and every one of those words is a fact about
 * *writing* music rather than about the music.
 *
 * What a beginner actually wants to say is shorter and is always a verb:
 * make it longer, make it shorter, put three in this space, make it reach the
 * next note. Those are the nine actions below, and they are the whole of the
 * first surface. The note values still exist and are still exact — they are
 * behind "Ayrıntılar", where somebody who wants them can find them.
 *
 * ## Ticks in, ticks out, no opinions about the screen
 *
 * Pure. Every action resolves to a tick length or to a refusal with a reason
 * a reader can act on. Nothing here writes to a Song, and nothing here knows
 * what a button looks like.
 */
import { PPQ } from "@/lib/music/timing";

export const DURATION_ACTION_IDS = [
  "extend",
  "shorten",
  "split_2",
  "split_3",
  "split_4",
  "to_next_note",
  "half_beat",
  "beat",
  "densify",
] as const;

export type DurationActionId = (typeof DURATION_ACTION_IDS)[number];

/**
 * What each action is called. One word for one job, everywhere it appears.
 *
 * "Bu bölümü sıklaştır" is the local-override consent from §8, and it lives in
 * this list rather than in a rhythm panel of its own because the reader
 * reaches it while asking for a denser run — which is a question about how
 * long notes are, not about grids.
 */
export const DURATION_ACTION_LABEL: Readonly<Record<DurationActionId, string>> = {
  extend: "Uzat",
  shorten: "Kısalt",
  split_2: "İkiye böl",
  split_3: "Üçe böl",
  split_4: "Dörde böl",
  to_next_note: "Sonraki notaya kadar",
  half_beat: "Yarım vuruşa sığdır",
  beat: "Bir vuruşa sığdır",
  densify: "Bu bölümü sıklaştır",
};

/** What an action does, once it is more than its name. */
export type DurationActionKind =
  /** Changes how long one note sounds. */
  | "length"
  /** Divides the held span into that many notes. */
  | "divide"
  /** Asks for a finer grid in this measure only. */
  | "densify";

export const DURATION_ACTION_KIND: Readonly<Record<DurationActionId, DurationActionKind>> =
  {
    extend: "length",
    shorten: "length",
    split_2: "divide",
    split_3: "divide",
    split_4: "divide",
    to_next_note: "length",
    half_beat: "length",
    beat: "length",
    densify: "densify",
  };

/** How many notes a divide action asks for. */
export const DIVIDE_COUNT: Readonly<Partial<Record<DurationActionId, 2 | 3 | 4>>> = {
  split_2: 2,
  split_3: 3,
  split_4: 4,
};

/** What the note being edited sits in, in ticks. */
export type DurationContext = {
  /** How long it sounds now. */
  readonly currentTicks: number;
  /** One step of the grid this measure is written on. */
  readonly slotTicks: number;
  /** One beat of this measure's meter. */
  readonly beatTicks: number;
  /** The longest it may be without running past the music. */
  readonly maxTicks: number;
  /** How far it is to the next onset, or null when nothing follows. */
  readonly toNextOnsetTicks: number | null;
};

export type DurationOffer = {
  readonly id: DurationActionId;
  readonly label: string;
  readonly kind: DurationActionKind;
  /**
   * The length this action would produce, in ticks.
   *
   * Null for a divide (which is about how many notes, not how long one is)
   * and for a densify (which is about the grid).
   */
  readonly ticks: number | null;
  readonly state: "available" | "disabled";
  /** Present exactly when disabled. Musician's words, never a tick count. */
  readonly reason?: string;
};

const NO_ROOM = "Burada daha uzun olamaz: sonraki nota hemen arkasında.";
const ALREADY_SHORTEST = "Bu, bu ölçüde yazılabilecek en kısa süre.";
const NO_NEXT = "Bundan sonra nota yok.";
const NO_ODD_BEAT = "Bu ölçüde vuruş ikiye tam bölünmüyor.";

/**
 * Every length action, with its answer already worked out.
 *
 * The list is always the same length and always in the same order: a control
 * that appears and disappears teaches a reader that the app is unpredictable,
 * and a greyed control that says why teaches them the music. That is the same
 * rule the dock already follows for selection verbs.
 */
export function durationOffers(context: DurationContext): DurationOffer[] {
  const { beatTicks, currentTicks, maxTicks, slotTicks, toNextOnsetTicks } = context;

  const offer = (
    id: DurationActionId,
    ticks: number | null,
    reason?: string,
  ): DurationOffer => ({
    id,
    label: DURATION_ACTION_LABEL[id],
    kind: DURATION_ACTION_KIND[id],
    ticks,
    state: reason === undefined ? "available" : "disabled",
    ...(reason === undefined ? {} : { reason }),
  });

  const longer = currentTicks + slotTicks;
  const shorter = currentTicks - slotTicks;
  const half = beatTicks % 2 === 0 ? beatTicks / 2 : null;

  return [
    offer("extend", Math.min(longer, maxTicks), longer > maxTicks ? NO_ROOM : undefined),
    offer("shorten", Math.max(shorter, slotTicks), shorter < slotTicks ? ALREADY_SHORTEST : undefined),
    offer("split_2", null),
    offer("split_3", null),
    offer("split_4", null),
    offer(
      "to_next_note",
      toNextOnsetTicks,
      toNextOnsetTicks === null || toNextOnsetTicks <= 0 ? NO_NEXT : undefined,
    ),
    offer("half_beat", half, half === null ? NO_ODD_BEAT : undefined),
    offer("beat", beatTicks, beatTicks > maxTicks ? NO_ROOM : undefined),
    offer("densify", null),
  ];
}

/**
 * The one line shown while a fast run is being made.
 *
 * It is the rule the whole feature rests on, in a sentence rather than in two
 * technical panels: the time does not grow, the notes get closer together.
 */
export function densityExplanationFor(count: number): string {
  return `Aynı süreye ${count} nota sığar; ölçünün uzunluğu değişmez.`;
}

/**
 * The exact note value, for "Ayrıntılar" and for nowhere else.
 *
 * Deliberately a separate function from everything above: a caller has to ask
 * for the technical reading on purpose, so it cannot leak onto the first
 * surface by being conveniently already there.
 */
export function detailedLength(ticks: number, slotTicks: number): string {
  const beats = ticks / PPQ;
  const steps = slotTicks > 0 ? ticks / slotTicks : 0;
  const beatText =
    Number.isInteger(beats) ? `${beats} vuruş` : `${beats.toFixed(2)} vuruş`;
  const stepText = Number.isInteger(steps) ? `${steps} adım` : `${steps.toFixed(2)} adım`;
  return `${beatText} · ${stepText} · ${ticks} tick`;
}
