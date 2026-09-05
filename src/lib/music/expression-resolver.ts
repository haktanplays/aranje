/**
 * What a note is actually doing, asked once (2V-C.1 §4).
 *
 * ## The problem this replaces
 *
 * `articulation` is one enum holding answers to three different questions —
 * how the string was struck, what the pitch does while it rings, and how the
 * note is joined to the one before it — and it can hold exactly one of them.
 * So a note could say `bend_full` or `accent`, never both, and could not say
 * "bend up and stay there" at all, because the enum had one word for bending
 * and it meant "bend and come back".
 *
 * Two optional fields fixed the writing side. This fixes the reading side:
 * playback, tab, the editor, the validators, transposition, selection resume
 * and export all need the same answer, and each of them working it out from
 * `articulation` separately is how six surfaces come to disagree about one
 * note.
 *
 * ## Three axes, and nothing decided twice
 *
 * - **attack** — how the string was struck. Still the legacy enum's job.
 * - **pitch** — what the pitch does. Legacy `vibrato`/`bend_half`/`bend_full`
 *   or an explicit `pitchGesture`.
 * - **connection** — the bond to the previous note. Legacy `hammer_on` /
 *   `pull_off` / `slide` or an explicit `connection`.
 *
 * A note may carry one of each, and that is not a conflict — an accented note
 * with a bend on it is ordinary music. Two answers on the *same* axis is a
 * conflict, and it is refused by name rather than resolved by precedence: a
 * silent winner means the file says one thing and the speakers do another.
 *
 * ## Legacy keeps its own audio
 *
 * A `source: "legacy"` pitch reading is a marker, not a translation. A song
 * written with `bend_full` resolves to `{ source: "legacy", articulation }`
 * and the planner routes it to the automation it has always used — the one
 * that ships, not the phase 2F comparison curve. It is *not*
 * silently re-read as `bend_release`, even though that is the closest new
 * shape, because "closest" is not "identical" and a reader's old song must
 * not change what it sounds like on the day a field is added.
 *
 * Pure. A note goes in; a reading comes out. No song, no clock, no engine.
 */
import { spanCovers } from "@/lib/music/technique-span";
import type {
  Articulation,
  NoteAttack,
  NoteConnection,
  NoteEvent,
  PickingDirection,
  PitchGesture,
  TechniqueSpan,
} from "@/lib/song/schema";

/**
 * Legacy enum members that answer "how was the string struck".
 *
 * `palm_mute` is not among them and `sustain`/`staccato` are not either. The
 * first became a span in 2V-D.1 and has its own axis below; the other two say
 * how long the note is held, which `articulationHold` has always answered and
 * still does.
 */
const LEGACY_ATTACK: readonly Articulation[] = [
  "accent",
  "ghost",
  "dead",
  "tapping",
  "natural_harmonic",
  "pinch_harmonic",
];

/** Legacy enum members that answer the "what does the pitch do" question. */
const LEGACY_PITCH: readonly Articulation[] = ["vibrato", "bend_half", "bend_full"];

/** Legacy enum members that answer the "how is it joined" question. */
const LEGACY_CONNECTION: readonly Articulation[] = ["slide", "hammer_on", "pull_off"];

export type ResolvedPitch =
  /** An explicit gesture, played by `pitch-gesture`. */
  | { readonly source: "gesture"; readonly gesture: PitchGesture }
  /** A song written before the gesture field. Played the way it always was. */
  | { readonly source: "legacy"; readonly articulation: Articulation };

export type ResolvedConnection =
  | { readonly source: "explicit"; readonly connection: NoteConnection }
  | { readonly source: "legacy"; readonly articulation: Articulation };

export type ResolvedAttack =
  /** An explicit `attack` field. */
  | { readonly source: "attack"; readonly attack: NoteAttack }
  /** A song written before the field. Played the way it always was. */
  | { readonly source: "legacy"; readonly articulation: Articulation };

/**
 * A technique holding over this onset, and where it was written.
 *
 * `legacy` is a `palm_mute` articulation or a `letRing` flag on the note
 * itself. It is reported on the same axis as a span so that a caller sees one
 * answer to "is this note muted" however the song said it — and so that a
 * song saying it twice is a refusal rather than a coin toss.
 */
export type ActiveTechnique = {
  readonly kind: TechniqueSpan["kind"];
  readonly source: "span" | "legacy";
  /** The span's id, when a span is what said so. */
  readonly spanId?: string;
};

/**
 * Whether this axis reaches the speakers on the shipped sample bank.
 *
 * Not a quality judgement and not a promise about a future pack: it is what
 * the audio layer does today. Picking direction is `notation_only` because
 * the bank has one recording per pitch, and the app says that in those words
 * rather than offering a preview of two identical sounds.
 */
export type PlaybackCapability = "played" | "notation_only";

export type ExpressionConflict =
  /** `pitchGesture` and a legacy pitch articulation on one note. */
  | "pitch_axis_conflict"
  /** `connection` and a legacy connection articulation on one note. */
  | "connection_axis_conflict"
  /** `attack` and a legacy attack articulation on one note. */
  | "attack_axis_conflict"
  /** A span and a legacy palm mute or let ring over the same onset. */
  | "technique_axis_conflict";

export const CONFLICT_MESSAGE: Readonly<Record<ExpressionConflict, string>> = {
  pitch_axis_conflict:
    "Bu notaya iki ayrı perde hareketi yazılmış. Bir nota aynı anda iki " +
    "şekilde bükülemez; birini kaldır.",
  connection_axis_conflict:
    "Bu nota önceki notaya iki ayrı şekilde bağlanmış. Bir bağlantı seç.",
  attack_axis_conflict:
    "Bu notaya iki ayrı vuruş yazılmış. Bir nota bir kez vurulur; birini kaldır.",
  technique_axis_conflict:
    "Bu nota hem kendi üzerinde hem de bir aralık boyunca aynı tekniği " +
    "taşıyor. Birini kaldır.",
};

export type ResolvedExpression = {
  /**
   * How the string was struck, when the note says something about it.
   *
   * The bare `Articulation` this used to be, kept so every caller written
   * before the axis split goes on compiling and behaving. `attackAxis` below
   * is the same answer with its source attached.
   */
  readonly attack: Articulation | undefined;
  readonly attackAxis: ResolvedAttack | null;
  /** Which way the pick crossed. Drawn and spoken; not played (§9). */
  readonly picking: PickingDirection | null;
  readonly pitch: ResolvedPitch | null;
  readonly connection: ResolvedConnection | null;
  /** Techniques holding over this onset, from spans or from legacy fields. */
  readonly techniques: readonly ActiveTechnique[];
  /** Present when two sources answered one axis. Nothing is chosen. */
  readonly conflict: ExpressionConflict | null;
};

/**
 * Where the note sits, so span membership can be asked (2V-D.1 §5).
 *
 * Optional, and its absence is not "no spans": it is a caller that has not
 * been given any to consider — a pure notation test, say. The playback path
 * passes it, and the boundary test requires that it does.
 */
export type SpanContext = {
  readonly trackId: string;
  readonly timeTicks: number;
  readonly stringIndex: number | null;
  readonly spans: readonly TechniqueSpan[];
};

const NO_TECHNIQUES: readonly ActiveTechnique[] = [];

/** What the audio layer can actually do with each axis today (§9). */
export const AXIS_CAPABILITY = {
  attack: "played",
  picking: "notation_only",
  pitch: "played",
  connection: "played",
  technique: "played",
} as const satisfies Readonly<Record<string, PlaybackCapability>>;

/**
 * Read one note.
 *
 * Never throws and never guesses. A note with a conflict comes back with both
 * sides of the offending axis dropped and the conflict named, so a caller
 * that forgets to check cannot accidentally play the wrong one.
 */
export function resolveExpression(
  note: {
    readonly articulation?: Articulation;
    readonly attack?: NoteAttack;
    readonly picking?: PickingDirection;
    readonly letRing?: boolean;
    readonly pitchGesture?: PitchGesture;
    readonly connection?: NoteConnection;
  },
  context?: SpanContext,
): ResolvedExpression {
  const articulation = note.articulation;
  const legacyPitch =
    articulation !== undefined && LEGACY_PITCH.includes(articulation)
      ? articulation
      : undefined;
  const legacyConnection =
    articulation !== undefined && LEGACY_CONNECTION.includes(articulation)
      ? articulation
      : undefined;

  if (note.pitchGesture !== undefined && legacyPitch !== undefined) {
    return refusal("pitch_axis_conflict");
  }
  if (note.connection !== undefined && legacyConnection !== undefined) {
    return refusal("connection_axis_conflict");
  }

  /*
   * The attack axis is whatever is left. A legacy value that answered one of
   * the other two questions is not also an attack — `slide` is not a way of
   * striking a string — so it is not reported here twice.
   */
  const attack =
    articulation === undefined ||
    legacyPitch !== undefined ||
    legacyConnection !== undefined
      ? undefined
      : articulation;

  const legacyAttack =
    attack !== undefined && LEGACY_ATTACK.includes(attack) ? attack : undefined;
  if (note.attack !== undefined && legacyAttack !== undefined) {
    return refusal("attack_axis_conflict");
  }
  const attackAxis: ResolvedAttack | null =
    note.attack !== undefined
      ? { source: "attack", attack: note.attack }
      : legacyAttack !== undefined
        ? { source: "legacy", articulation: legacyAttack }
        : null;

  /*
   * The technique axis: spans covering this onset, plus whatever the note
   * itself said before spans existed.
   *
   * Both at once is a refusal rather than a merge. A note carrying
   * `palm_mute` *and* sitting inside a palm-mute span is a song that says
   * the same thing twice, and the two could be edited apart later — at which
   * point a merge would have silently decided which one the reader meant.
   */
  const techniques: ActiveTechnique[] = [];
  if (attack === "palm_mute") techniques.push({ kind: "palm_mute", source: "legacy" });
  if (note.letRing === true) techniques.push({ kind: "let_ring", source: "legacy" });
  if (context) {
    for (const span of context.spans) {
      if (!spanCovers(span, context)) continue;
      if (techniques.some((held) => held.kind === span.kind)) {
        return refusal("technique_axis_conflict");
      }
      techniques.push({ kind: span.kind, source: "span", spanId: span.id });
    }
  }
  if (
    techniques.some((held) => held.kind === "palm_mute") &&
    techniques.some((held) => held.kind === "let_ring")
  ) {
    return refusal("technique_axis_conflict");
  }

  const pitch: ResolvedPitch | null =
    note.pitchGesture !== undefined
      ? { source: "gesture", gesture: note.pitchGesture }
      : legacyPitch !== undefined
        ? { source: "legacy", articulation: legacyPitch }
        : null;

  const connection: ResolvedConnection | null =
    note.connection !== undefined
      ? { source: "explicit", connection: note.connection }
      : legacyConnection !== undefined
        ? { source: "legacy", articulation: legacyConnection }
        : null;

  return {
    attack,
    attackAxis,
    picking: note.picking ?? null,
    pitch,
    connection,
    techniques: techniques.length === 0 ? NO_TECHNIQUES : techniques,
    conflict: null,
  };
}

/**
 * A note that said two things on one axis.
 *
 * Every axis is dropped, not only the offending one. A caller that forgets to
 * check the conflict then gets a plain note rather than half a reading — and
 * half a reading is how the file comes to say one thing and the speakers
 * another, which is the failure this whole module exists to prevent.
 */
function refusal(conflict: ExpressionConflict): ResolvedExpression {
  return {
    attack: undefined,
    attackAxis: null,
    picking: null,
    pitch: null,
    connection: null,
    techniques: NO_TECHNIQUES,
    conflict,
  };
}

/**
 * Which of the three legato transitions this connection behaves like.
 *
 * The chain builder already knows how to travel between two notes on one
 * string; it asks in the legacy enum's words. Both slide connections travel
 * the same way — the difference between them is whether the target is
 * *struck*, not how the hand gets there — so both answer `"slide"` here and
 * the attack question is asked separately by `restrikesTarget`.
 */
export function transitionOf(
  connection: ResolvedConnection | null,
): Articulation | null {
  if (!connection) return null;
  if (connection.source === "legacy") return connection.articulation;
  switch (connection.connection.kind) {
    case "hammer_on":
      return "hammer_on";
    case "pull_off":
      return "pull_off";
    default:
      return "slide";
  }
}

/**
 * Is the target of this connection struck again?
 *
 * The one thing that separates a shift slide from a legato slide. Legacy
 * `slide` answers false, which is what it has always rendered — the 2P-A
 * measurement found no attack at the target — so nothing about an existing
 * song changes on the day the shift slide became expressible.
 */
export function restrikesTarget(connection: ResolvedConnection | null): boolean {
  return (
    connection?.source === "explicit" && connection.connection.kind === "shift_slide"
  );
}

/** Does this note's pitch leave the written fret at all? */
export function movesPitchAway(pitch: ResolvedPitch | null): boolean {
  if (!pitch) return false;
  if (pitch.source === "legacy") return pitch.articulation !== "vibrato";
  return pitch.gesture.kind !== "slide_in" && pitch.gesture.kind !== "slide_out";
}

/**
 * Where the pitch of this note ends, in cents from the written fret.
 *
 * What a tie carries. A `bend` ends bent and a `bend_release` ends where it
 * started, and the note tied under either of them has to continue the right
 * one — which is a fact about the gesture and not about the tie.
 */
export function endingCents(pitch: ResolvedPitch | null): number {
  if (!pitch) return 0;
  if (pitch.source === "legacy") return 0;
  const gesture = pitch.gesture;
  if (gesture.kind === "bend" || gesture.kind === "prebend") {
    return gesture.targetCents;
  }
  return 0;
}

/** Every note of a slot, read. Convenience for callers holding a whole slot. */
export function resolveSlot(
  notes: readonly NoteEvent[],
): readonly ResolvedExpression[] {
  return notes.map((note) => resolveExpression(note));
}
