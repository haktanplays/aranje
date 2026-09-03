/**
 * How long a chord lasts, chosen the way a musician chooses it (2V-B.4 §14).
 *
 * ## No raw duration field
 *
 * A chord is a harmonic intention with a span, and a beginner writing one
 * knows exactly what they mean — "this beat", "to the end of the measure",
 * "until the next chord", "across what I selected" — and does not know how
 * many ticks any of those is. So the control offers the four intentions and
 * this file turns whichever they chose into a length.
 *
 * ## One span for every voice
 *
 * All the chord's notes get the same span. A strum or an arpeggio may move
 * the individual attacks around inside it — that is the picking hand — but the
 * harmony's start and end, and therefore the chord's identity, is one thing.
 * That is why this returns a single number and not one per string.
 */

export const CHORD_SPAN_IDS = [
  "this_beat",
  "to_measure_end",
  "to_next_chord",
  "selection",
] as const;

export type ChordSpanId = (typeof CHORD_SPAN_IDS)[number];

export const CHORD_SPAN_LABEL: Readonly<Record<ChordSpanId, string>> = {
  this_beat: "Bu vuruş",
  to_measure_end: "Ölçü sonuna kadar",
  to_next_chord: "Sonraki akora kadar",
  selection: "Seçili alan boyunca",
};

/** Where the chord is going, in the terms each option needs. */
export type ChordSpanContext = {
  /** Where the chord starts, in ticks from the start of its section. */
  readonly startTicks: number;
  /** One beat of the measure it lands in. */
  readonly beatTicks: number;
  /** Where that measure ends, in section ticks. */
  readonly measureEndTicks: number;
  /** The next onset on this track after the chord, or null. */
  readonly nextOnsetTicks: number | null;
  /** The held range, when there is one. */
  readonly selectionEndTicks: number | null;
};

export type ChordSpanOffer = {
  readonly id: ChordSpanId;
  readonly label: string;
  /** How long the chord would sound. Null when the option cannot apply. */
  readonly ticks: number | null;
  readonly state: "available" | "disabled";
  readonly reason?: string;
};

const NO_NEXT_CHORD = "Bundan sonra başka bir olay yok.";
const NO_SELECTION = "Şu an seçili bir alan yok.";
const NO_ROOM = "Ölçünün sonuna varmış durumda.";

export function chordSpanOffers(context: ChordSpanContext): ChordSpanOffer[] {
  const {
    beatTicks,
    measureEndTicks,
    nextOnsetTicks,
    selectionEndTicks,
    startTicks,
  } = context;

  const room = measureEndTicks - startTicks;
  const offer = (
    id: ChordSpanId,
    ticks: number | null,
    reason?: string,
  ): ChordSpanOffer => ({
    id,
    label: CHORD_SPAN_LABEL[id],
    ticks,
    /* One rule: an option with a reason is the one that cannot be taken. */
    state: reason === undefined ? "available" : "disabled",
    ...(reason === undefined ? {} : { reason }),
  });

  const toNext = nextOnsetTicks === null ? null : nextOnsetTicks - startTicks;

  return [
    offer("this_beat", Math.min(beatTicks, room), room <= 0 ? NO_ROOM : undefined),
    offer("to_measure_end", room, room <= 0 ? NO_ROOM : undefined),
    offer(
      "to_next_chord",
      toNext,
      toNext === null || toNext <= 0 ? NO_NEXT_CHORD : undefined,
    ),
    offer(
      "selection",
      selectionEndTicks === null ? null : selectionEndTicks - startTicks,
      selectionEndTicks === null || selectionEndTicks <= startTicks
        ? NO_SELECTION
        : undefined,
    ),
  ];
}

/**
 * The span a control should start on.
 *
 * The reader's own selection when they have one — they already said how much
 * music they meant — and one beat otherwise, which is the shortest thing that
 * still sounds like a chord rather than like a click.
 */
export function defaultChordSpan(context: ChordSpanContext): ChordSpanId {
  if (context.selectionEndTicks !== null && context.selectionEndTicks > context.startTicks) {
    return "selection";
  }
  return "this_beat";
}
