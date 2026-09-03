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
import type {
  Articulation,
  NoteConnection,
  NoteEvent,
  PitchGesture,
} from "@/lib/song/schema";

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

export type ExpressionConflict =
  /** `pitchGesture` and a legacy pitch articulation on one note. */
  | "pitch_axis_conflict"
  /** `connection` and a legacy connection articulation on one note. */
  | "connection_axis_conflict";

export const CONFLICT_MESSAGE: Readonly<Record<ExpressionConflict, string>> = {
  pitch_axis_conflict:
    "Bu notaya iki ayrı perde hareketi yazılmış. Bir nota aynı anda iki " +
    "şekilde bükülemez; birini kaldır.",
  connection_axis_conflict:
    "Bu nota önceki notaya iki ayrı şekilde bağlanmış. Bir bağlantı seç.",
};

export type ResolvedExpression = {
  /** How the string was struck, when the note says something about it. */
  readonly attack: Articulation | undefined;
  readonly pitch: ResolvedPitch | null;
  readonly connection: ResolvedConnection | null;
  /** Present when two sources answered one axis. Nothing is chosen. */
  readonly conflict: ExpressionConflict | null;
};

/**
 * Read one note.
 *
 * Never throws and never guesses. A note with a conflict comes back with both
 * sides of the offending axis dropped and the conflict named, so a caller
 * that forgets to check cannot accidentally play the wrong one.
 */
export function resolveExpression(note: {
  readonly articulation?: Articulation;
  readonly pitchGesture?: PitchGesture;
  readonly connection?: NoteConnection;
}): ResolvedExpression {
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
    return {
      attack: undefined,
      pitch: null,
      connection: null,
      conflict: "pitch_axis_conflict",
    };
  }
  if (note.connection !== undefined && legacyConnection !== undefined) {
    return {
      attack: undefined,
      pitch: null,
      connection: null,
      conflict: "connection_axis_conflict",
    };
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

  return { attack, pitch, connection, conflict: null };
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
