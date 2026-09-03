/**
 * What a bend or a slide is called, and what it is drawn as (2V-C.1 §11, §12).
 *
 * ## One authority for the mark and for the sentence
 *
 * A tab has two readers. One looks at the page and needs a character beside
 * the fret number; the other listens to a screen reader and needs a sentence.
 * They have to be describing the same gesture, so they are produced here,
 * together, from the same reading — not by a glyph table in a component and a
 * label table in a validator that drift apart on the day a gesture is added.
 *
 * ## The mark is a character, not a colour
 *
 * Someone who cannot separate the bronze from the grey still reads `pb1r`.
 * The marks are the ones tab already uses: `b` for a bend, `r` for a release,
 * `pb` for a prebend, `~` for vibrato, and a leaning stroke for a slide. `s`
 * marks the slide whose target is struck, which is the one thing a slide
 * stroke on its own cannot say.
 *
 * ## The sentence says the movement, never the model
 *
 * "17. perdede tam bend, yukarıda tut" — not "bend", not `targetCents: 200`,
 * not a slot index and not an error code. A reader who has never met the word
 * "bend" can still act on "yukarıda tut".
 */
import {
  resolveExpression,
  type ResolvedConnection,
  type ResolvedExpression,
  type ResolvedPitch,
} from "@/lib/music/expression-resolver";
import type { BendKind, NoteEvent } from "@/lib/song/schema";

/** How much, in the words a guitarist uses rather than in cents. */
export function bendAmountLabel(targetCents: number): string {
  if (targetCents === 100) return "yarım";
  if (targetCents === 200) return "tam";
  if (targetCents === 50) return "çeyrek";
  if (targetCents === 300) return "bir buçuk";
  if (targetCents === 400) return "iki tam";
  /* Anything else is still real music; it is said as the fraction of a tone
     it is, and never as a raw cent count. */
  return `${(targetCents / 200).toFixed(2).replace(/\.?0+$/u, "")} tam`;
}

const BEND_MARK: Readonly<Record<BendKind, string>> = {
  bend: "b",
  bend_release: "br",
  prebend: "pb",
  prebend_release: "pbr",
};

const BEND_SENTENCE: Readonly<Record<BendKind, (amount: string) => string>> = {
  bend: (amount) => `${amount} bend, yukarıda tut`,
  bend_release: (amount) => `${amount} bend ve geri indir`,
  prebend: (amount) => `önceden ${amount} bükülmüş`,
  prebend_release: (amount) => `önceden ${amount} bükülmüş, indir`,
};

/** The digit a bend mark carries, so `b1` and `b½` stay readable. */
function bendDigit(targetCents: number): string {
  if (targetCents === 100) return "½";
  if (targetCents === 200) return "1";
  if (targetCents === 50) return "¼";
  if (targetCents === 300) return "1½";
  if (targetCents === 400) return "2";
  return String(Math.round(targetCents / 100) / 1);
}

export type GestureReading = {
  /** Beside the fret number. Empty when this axis says nothing. */
  readonly mark: string;
  /** What a screen reader is told. Empty when this axis says nothing. */
  readonly spoken: string;
};

const NOTHING: GestureReading = { mark: "", spoken: "" };

/** What the pitch does, as a mark and a sentence. */
export function pitchReading(pitch: ResolvedPitch | null): GestureReading {
  if (!pitch) return NOTHING;
  if (pitch.source === "legacy") {
    if (pitch.articulation === "vibrato") return { mark: "~", spoken: "vibrato" };
    const cents = pitch.articulation === "bend_full" ? 200 : 100;
    /* The legacy bend releases, and always has. Its sentence says so rather
       than letting a reader assume the note ends bent. */
    return {
      mark: `b${bendDigit(cents)}`,
      spoken: BEND_SENTENCE.bend_release(bendAmountLabel(cents)),
    };
  }

  const gesture = pitch.gesture;
  if (gesture.kind === "slide_in") {
    return {
      mark: gesture.from === "below" ? "/‑" : "\\‑",
      spoken: gesture.from === "below" ? "aşağıdan kayarak gir" : "yukarıdan kayarak gir",
    };
  }
  if (gesture.kind === "slide_out") {
    return {
      mark: gesture.to === "down" ? "‑\\" : "‑/",
      spoken: gesture.to === "down" ? "aşağı kayarak çık" : "yukarı kayarak çık",
    };
  }

  const amount = bendAmountLabel(gesture.targetCents);
  const shake = gesture.vibrato ? ", tepede vibrato" : "";
  return {
    mark: `${BEND_MARK[gesture.kind]}${bendDigit(gesture.targetCents)}${
      gesture.vibrato ? "~" : ""
    }`,
    spoken: `${BEND_SENTENCE[gesture.kind](amount)}${shake}`,
  };
}

/** How the note is joined to the one before it. */
export function connectionReading(
  connection: ResolvedConnection | null,
  rising?: boolean,
): GestureReading {
  if (!connection) return NOTHING;
  const lean = rising === false ? "\\" : "/";

  if (connection.source === "legacy") {
    switch (connection.articulation) {
      case "hammer_on":
        return { mark: "h", spoken: "önceki notadan bağla" };
      case "pull_off":
        return { mark: "p", spoken: "önceki notadan kopar" };
      default:
        /* Today's `slide` is a legato slide: the target is not struck. */
        return { mark: lean, spoken: "önceki notadan bağlı kaydır" };
    }
  }

  switch (connection.connection.kind) {
    case "hammer_on":
      return { mark: "h", spoken: "önceki notadan bağla" };
    case "pull_off":
      return { mark: "p", spoken: "önceki notadan kopar" };
    case "legato_slide":
      return { mark: lean, spoken: "önceki notadan bağlı kaydır" };
    default:
      /* `s` is the one thing a leaning stroke cannot say on its own: that the
         target is struck again when the hand arrives. */
      return { mark: `s${lean}`, spoken: "önceki notadan kaydır ve yeniden vur" };
  }
}

/**
 * The whole note, in one sentence a screen reader can read aloud.
 *
 * The fret comes first because that is what a guitarist looks for, then what
 * the hand does. Nothing internal appears: no enum id, no cents, no slot.
 */
export function noteGestureSentence(input: {
  readonly fret: number | null;
  readonly reading: ResolvedExpression;
  readonly rising?: boolean;
}): string {
  const where = input.fret === null ? "" : `${input.fret}. perdede `;
  const parts = [
    connectionReading(input.reading.connection, input.rising).spoken,
    pitchReading(input.reading.pitch).spoken,
  ].filter((part) => part.length > 0);
  if (parts.length === 0) return input.fret === null ? "" : `${input.fret}. perde`;
  return `${where}${parts.join(", ")}`;
}

/** Both axes of one written note, without the caller doing the resolving. */
export function readNoteGesture(note: {
  readonly articulation?: NoteEvent["articulation"];
  readonly pitchGesture?: NoteEvent["pitchGesture"];
  readonly connection?: NoteEvent["connection"];
}): { readonly pitch: GestureReading; readonly connection: GestureReading } {
  const reading = resolveExpression(note);
  return {
    pitch: pitchReading(reading.pitch),
    connection: connectionReading(reading.connection),
  };
}
