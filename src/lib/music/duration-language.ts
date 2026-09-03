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


/**
 * How long the note itself is, said twice (2V-B.4 Completion §17).
 *
 * ## The ambiguity this removes
 *
 * "Slide · 1/4" put two unrelated facts in one string and invited the worst
 * possible reading. "1/4" is a **quarter note**: one beat in 4/4, not four
 * beats, and never the time the hand spends sliding. A slide begins in the
 * tail of the note before it and arrives at this note's own onset; how long
 * that travel takes is worked out by the production engine from the interval
 * and the room available, and it is not a number anyone types.
 *
 * So a length is reported as two things a reader can tell apart: what they
 * count, and what it is called. The connection is a separate line entirely,
 * and the travel is a third.
 */
export type LengthReading = {
  /** What a reader counts: "1 vuruş". Never a fraction. */
  readonly plain: string;
  /** What it is called: "dörtlük · 1/4". Never shown alone. */
  readonly technical: string;
};

const VALUE_NAME: Readonly<Record<number, string>> = {
  1: "birlik",
  2: "ikilik",
  4: "dörtlük",
  8: "sekizlik",
  16: "16'lık",
  32: "32'lik",
};

/** "1 vuruş", "½ vuruş", "1½ vuruş" — beats, the way they are counted. */
function beatsPlain(beats: number): string {
  if (beats === 0.5) return "½ vuruş";
  if (Number.isInteger(beats)) return `${beats} vuruş`;
  const whole = Math.floor(beats);
  if (beats - whole === 0.5) return `${whole === 0 ? "" : whole}½ vuruş`;
  return `${beats.toFixed(2)} vuruş`;
}

export function noteLengthReading(ticks: number, beatTicks: number): LengthReading {
  const beats = beatTicks > 0 ? ticks / beatTicks : 0;
  const divisions = ticks > 0 ? PPQ * 4 / ticks : 0;
  const name = VALUE_NAME[divisions];
  return {
    plain: beatsPlain(beats),
    technical:
      name === undefined
        ? `${beats.toFixed(2)} vuruş`
        : `${name} · 1/${divisions}`,
  };
}

/**
 * What joins this note to the one before it, in a sentence (§17).
 *
 * A verb, not a technique name in a foreign alphabet: a reader who has never
 * met "slide" can act on "önceki notadan buraya kay". The technique's own name
 * still appears on the control that sets it, so nothing is hidden.
 */
export const CONNECTION_SENTENCE: Readonly<Record<string, string>> = {
  hammer_on: "Önceki notadan buraya bağla",
  pull_off: "Önceki notadan buraya kopar",
  slide: "Önceki notadan buraya kay",
};

/**
 * How long the slide's travel takes.
 *
 * Never a number on the Simple surface, and never a control: the engine
 * derives it from the interval and the time available, which is the only way
 * it can be right at both 1/8 · 132 and 1/32 · 260 (K-59).
 */
export const SLIDE_TRAVEL = "Otomatik";
