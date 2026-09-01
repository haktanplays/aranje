/**
 * What the Song on screen can actually be asked about (2V-B.1 §12).
 *
 * The last two rounds asked the founder to do things the fixture could not
 * do. A step said "move the motif to a thinner string" on a run that opened
 * on the open low E; a step said "listen to the slide" on a passage the
 * planner had quietly fallen back on. Both are the same defect: an
 * instruction written once, against a Song someone remembered rather than a
 * Song something read.
 *
 * So the questions are generated from the music. Everything here is derived
 * from `buildExpressionPlan` — the same plan the engine plays from — because
 * that is the only thing that knows the difference between a slide that is
 * drawn and a slide that will be *heard*. A technique the planner refused is
 * not support; it is a glyph.
 *
 * Nothing here is bound to the canonical fixture. If the founder opens
 * another Song, the passages move or disappear, and §12's rule follows
 * directly: what is not here is not asked.
 */
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { songFingerprint } from "@/lib/song/workspace-events";
import type { Song } from "@/lib/song/schema";

/** How a string is spoken about, thickest first, for a six-string guitar. */
const GUITAR_STRING_NAMES: readonly string[] = [
  "Mi (kalın)",
  "La",
  "Re",
  "Sol",
  "Si",
  "Mi (ince)",
];

/** Where something is, in the words a task may use out loud. */
export type Passage = {
  readonly barKey: string;
  /** One-based, inside its own section — the number the tab draws. */
  readonly barNumber: number;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly trackId: string;
  readonly trackName: string;
  readonly slotIndex: number;
};

/** A passage with a string and a pair of frets, for a slide or a slur. */
export type FrettedPassage = Passage & {
  readonly stringIndex: number;
  readonly stringName: string;
  readonly fromFret: number;
  readonly toFret: number;
};

/** A bar in which more than one instrument is really struck. */
export type SharedBar = {
  readonly barKey: string;
  readonly barNumber: number;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly trackNames: readonly string[];
  readonly trackIds: readonly string[];
};

export type SongSupport = {
  readonly title: string;
  readonly fingerprint: string;
  /** The first bar with anything struck in it, for the ordinary edit steps. */
  readonly firstWrittenBar: Passage | null;
  /** A chord of three or more notes that is still sounding at the next onset. */
  readonly heldPowerChord: Passage | null;
  readonly slide: FrettedPassage | null;
  readonly vibrato: Passage | null;
  /** A hammer-on or a pull-off the planner really joined into a chain. */
  readonly legato: FrettedPassage | null;
  readonly sharedBar: SharedBar | null;
};

function barNumberOf(barKey: string): number {
  const index = Number(barKey.split(":")[1] ?? "0");
  return Number.isFinite(index) ? index + 1 : 1;
}

function stringNameOf(index: number | undefined): string {
  if (index === undefined) return "";
  return GUITAR_STRING_NAMES[index] ?? `${index + 1}. tel`;
}

/**
 * Read the Song the way the engine will play it.
 *
 * One pass over one plan. Every passage below is a note the planner marked as
 * really carrying its technique — no fallback reason, and for the slurs a
 * chain to belong to.
 */
export function songSupport(song: Song): SongSupport {
  const plan = buildExpressionPlan(song);
  const trackName = (id: string) =>
    song.tracks.find((track) => track.id === id)?.name ?? id;
  const sectionOf = (barKey: string) => {
    const sectionId = barKey.split(":")[0] ?? "";
    const section = song.sections.find((entry) => entry.id === sectionId);
    return { sectionId, sectionName: section?.name ?? sectionId };
  };
  const place = (note: (typeof plan.notes)[number]): Passage => ({
    barKey: note.barKey,
    barNumber: barNumberOf(note.barKey),
    ...sectionOf(note.barKey),
    trackId: note.trackId,
    trackName: trackName(note.trackId),
    slotIndex: note.slotIndex,
  });

  const ordered = [...plan.notes].sort(
    (left, right) => left.startSeconds - right.startSeconds,
  );

  /*
   * The bar the ordinary edit steps point at.
   *
   * The Song's **own track order**, not the plan's traversal order. Both
   * instruments are struck on tick zero, so "the earliest note" is whichever
   * the planner happened to walk first — and it was the bass, while the
   * instruction the descriptor generated said "Gitar". A task that names one
   * track and binds to another rejects every event the founder produces, with
   * `wrong_track`, and looks from the outside like the editor not working.
   */
  const firstWritten =
    song.tracks
      .map((track) => ordered.find((note) => note.trackId === track.id))
      .find((note) => note !== undefined) ?? null;

  /*
   * A held chord: three or more notes struck together that are still
   * sounding when the next onset on the same track arrives. "Three notes in
   * one slot" alone is not enough — a power chord that stops at the next
   * note is a chord a listener has to take on trust, and the task says
   * "press and hold".
   */
  let heldPowerChord: Passage | null = null;
  for (const note of ordered) {
    const together = ordered.filter(
      (other) =>
        other.trackId === note.trackId &&
        other.barKey === note.barKey &&
        other.slotIndex === note.slotIndex,
    );
    if (together.length < 3) continue;
    const next = ordered.find(
      (other) =>
        other.trackId === note.trackId && other.startSeconds > note.startSeconds,
    );
    const ends = note.startSeconds + note.durationSeconds;
    if (next && ends <= next.startSeconds) continue;
    heldPowerChord = place(note);
    break;
  }

  const chainOf = (id: string | undefined) =>
    plan.chains.find((chain) => chain.chainId === id) ?? null;

  const slideNote =
    ordered.find(
      (note) =>
        note.articulation === "slide" &&
        note.fallbackReason === undefined &&
        chainOf(note.chainId) !== null,
    ) ?? null;
  const slideSource = slideNote
    ? (ordered.find(
        (note) =>
          note.chainId === slideNote.chainId && note.chainRole === "source",
      ) ?? null)
    : null;

  const legatoNote =
    ordered.find(
      (note) =>
        (note.articulation === "hammer_on" || note.articulation === "pull_off") &&
        note.fallbackReason === undefined &&
        chainOf(note.chainId) !== null,
    ) ?? null;
  const legatoSource = legatoNote
    ? (ordered.find(
        (note) =>
          note.chainId === legatoNote.chainId && note.chainRole === "source",
      ) ?? null)
    : null;

  const vibratoNote =
    ordered.find(
      (note) =>
        note.articulation === "vibrato" &&
        note.fallbackReason === undefined &&
        /* Really moving: a vibrato planned flat is a sustain with a glyph. */
        new Set(note.pitchAutomation.map((point) => point.cents)).size > 2,
    ) ?? null;

  /* A bar two instruments are both struck in. Not "written in": a track
     whose notes are all swallowed by a tie run is drawn and silent. */
  let sharedBar: SharedBar | null = null;
  const byBar = new Map<string, Set<string>>();
  for (const note of ordered) {
    const seen = byBar.get(note.barKey) ?? new Set<string>();
    seen.add(note.trackId);
    byBar.set(note.barKey, seen);
  }
  for (const [barKey, trackIds] of byBar) {
    if (trackIds.size < 2) continue;
    sharedBar = {
      barKey,
      barNumber: barNumberOf(barKey),
      ...sectionOf(barKey),
      trackIds: [...trackIds],
      trackNames: [...trackIds].map(trackName),
    };
    break;
  }

  const fretted = (
    target: (typeof plan.notes)[number] | null,
    source: (typeof plan.notes)[number] | null,
  ): FrettedPassage | null => {
    if (!target || !source) return null;
    const stringIndex = source.position?.stringIndex;
    if (stringIndex === undefined) return null;
    return {
      ...place(target),
      stringIndex,
      stringName: stringNameOf(stringIndex),
      fromFret: source.position?.fret ?? 0,
      toFret: target.position?.fret ?? 0,
    };
  };

  return {
    title: song.title,
    fingerprint: songFingerprint(song),
    firstWrittenBar: firstWritten ? place(firstWritten) : null,
    heldPowerChord,
    slide: fretted(slideNote, slideSource),
    vibrato: vibratoNote ? place(vibratoNote) : null,
    legato: fretted(legatoNote, legatoSource),
    sharedBar,
  };
}
