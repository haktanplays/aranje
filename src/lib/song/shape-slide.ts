/**
 * Two or more strings moving as one hand (2V-C.3 §9, §10).
 *
 * ## Why this is a gesture and not a coincidence
 *
 * A double-stop slide is what a guitarist does when they hold a shape and
 * move it. On the page it is two diagonal strokes; under the fingers it is
 * one movement. The contract can already say "this note is slid into from
 * the one before it" on each note separately, and two notes each saying that
 * is *nearly* the same thing — but only nearly, and the difference is the
 * whole reason this file exists:
 *
 * - Two independent slides may travel different distances, in different
 *   directions, or arrive at different moments. A shape does none of those.
 * - Removing one of two independent slides leaves the other. Removing half a
 *   hand movement is not a thing a reader can mean.
 *
 * ## No new persisted field, and here is the argument
 *
 * The per-note `connection` carries this losslessly, because a shape slide is
 * fully determined by what the two onsets already say: the same source tick,
 * the same target tick, one connection per moving string, all of the same
 * kind, all moving by the same interval in the same direction. Nothing about
 * the gesture is unrecoverable from the notes, so a group id would be a
 * second source of truth for a fact the first source already holds — and the
 * failure mode of two sources is that they disagree.
 *
 * The atomicity §14 asks for is therefore a property of the *command*, not of
 * a stored id: `shapeSlideAt` re-derives the whole shape from any one of its
 * notes, so edit and remove act on all of them by construction, and undo is
 * one history step because the write was one write. `derivesAfterEdit` in the
 * tests is the proof that this holds rather than the hope that it does.
 *
 * ## v1 keeps the shape
 *
 * Every moving voice travels the same number of semitones in the same
 * direction. A hand that changes the shape mid-slide is a real thing a
 * guitarist does and is not this; modelling it as "some interval per string"
 * would let the first version express something it cannot draw and cannot
 * schedule, which is how a contract grows a corner nobody supports.
 */
import { pitchToMidi } from "@/lib/music/pitch";
import { resolveExpression } from "@/lib/music/expression-resolver";
import { findSection, sectionSlotStream } from "@/lib/song/onset-block";
import type {
  MelodicSlot,
  NoteConnection,
  NoteEvent,
  Section,
  Song,
} from "@/lib/song/schema";

/** The most strings one hand can carry as a shape. */
export const MAX_SHAPE_STRINGS = 6;
/** Fewer than this is an ordinary single-note slide, not a shape. */
export const MIN_SHAPE_STRINGS = 2;

export type ShapeSlideRefusal =
  | "not_a_shape"
  | "no_section"
  | "no_track"
  | "not_fretted"
  | "no_source_onset"
  | "no_target_onset"
  | "string_set_differs"
  | "open_string_moving"
  | "shape_not_preserved"
  | "mixed_connection_kinds"
  | "too_many_strings"
  | "unplayable_voice";

export const SHAPE_MESSAGE: Readonly<Record<ShapeSlideRefusal, string>> = {
  not_a_shape: "Burada birlikte kayacak iki tel yok.",
  no_section: "Bu bölüm bulunamadı.",
  no_track: "Bu enstrüman bulunamadı.",
  not_fretted: "Bu enstrümanda tel yok, bu yüzden kaydırma yapılamıyor.",
  no_source_onset: "Kayacak bir önceki nota yok.",
  no_target_onset: "Kayılacak bir hedef nota yok.",
  string_set_differs: "İki taraf aynı teller değil; şekil bozuluyor.",
  open_string_moving: "Açık tel kaymaz. Şekildeki bütün notalar basılı olmalı.",
  shape_not_preserved: "Teller aynı mesafede aynı yöne gitmiyor.",
  mixed_connection_kinds: "Bütün teller aynı türde kaymalı.",
  too_many_strings: "Bir el bu kadar teli birlikte taşıyamaz.",
  unplayable_voice: "Bu notalardan biri bu enstrümanda çalınamıyor.",
};

/** One string's part of the movement. */
export type ShapeVoice = {
  readonly stringIndex: number;
  readonly noteIndex: number;
  readonly fromFret: number;
  readonly toFret: number;
  readonly fromMidi: number;
  readonly toMidi: number;
};

export type ShapeSlidePlan = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Where the hand starts, in section ticks. */
  readonly sourceTicks: number;
  /** Where it arrives, and where the target onset is written. */
  readonly targetTicks: number;
  /** Same kind on every string; that is checked, not assumed. */
  readonly kind: NoteConnection["kind"];
  /** Ordered by string, so two derivations of one shape compare equal. */
  readonly voices: readonly ShapeVoice[];
  /** Semitones every voice moves. Signed: negative goes down in pitch. */
  readonly intervalSemitones: number;
  /** True when the sounding pitch rises, whatever the fret numbers do. */
  readonly rising: boolean;
};

export type ShapeSlideResult =
  | { readonly ok: true; readonly plan: ShapeSlidePlan }
  | { readonly ok: false; readonly reason: ShapeSlideRefusal; readonly message: string };

const refuse = (reason: ShapeSlideRefusal): ShapeSlideResult => ({
  ok: false,
  reason,
  message: SHAPE_MESSAGE[reason],
});

/** Does this connection travel along the string rather than land on it? */
function travels(kind: NoteConnection["kind"]): boolean {
  return kind === "legato_slide" || kind === "shift_slide";
}

type Voice = { readonly note: NoteEvent; readonly noteIndex: number };

/** The fretted voices of one onset, by string. */
function voicesOf(slot: MelodicSlot | undefined | null): Map<number, Voice> {
  const out = new Map<number, Voice>();
  if (slot === undefined || slot === null || slot === "-") return out;
  slot.notes.forEach((note, noteIndex) => {
    if (note.position === undefined) return;
    out.set(note.position.string, { note, noteIndex });
  });
  return out;
}

/** The onset written at this moment, and the one immediately before it. */
function onsetPair(
  section: Section,
  trackId: string,
  targetTicks: number,
): { source: MelodicSlot; target: MelodicSlot; sourceTicks: number } | null {
  const stream = sectionSlotStream(section, trackId);
  const index = stream.findIndex((entry) => entry.startTicks === targetTicks);
  if (index < 0) return null;
  const target = stream[index];
  if (!target || !target.writable) return null;
  const targetSlot = target.slot;
  if (targetSlot === undefined || targetSlot === null || targetSlot === "-") return null;

  /*
   * Walk back to the previous written onset, stopping at real silence. A
   * hand cannot slide across a rest, and skipping over one would let the
   * shape claim a source it never touched.
   */
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = stream[cursor];
    if (!entry || !entry.writable) return null;
    const slot = entry.slot;
    if (slot === undefined || slot === null) return null;
    if (slot === "-") continue;
    return { source: slot, target: targetSlot, sourceTicks: entry.startTicks };
  }
  return null;
}

/**
 * The shape slide written at this onset, or why there is not one.
 *
 * Derived from the notes every time it is asked for. Two calls on the same
 * Song give the same plan, and a call after an edit gives the edited plan —
 * which is what makes "edit the whole shape together" a consequence of the
 * model rather than a thing the UI has to remember to do.
 */
export function shapeSlideAt(
  song: Song,
  where: {
    readonly sectionId: string;
    readonly trackId: string;
    /** The *target* onset — the moment the hand arrives. */
    readonly targetTicks: number;
  },
): ShapeSlideResult {
  const section = findSection(song, where.sectionId);
  if (!section) return refuse("no_section");
  const track = song.tracks.find((entry) => entry.id === where.trackId);
  if (!track) return refuse("no_track");
  const board = track.fretboard;
  if (!board) return refuse("not_fretted");

  const pair = onsetPair(section, where.trackId, where.targetTicks);
  if (!pair) return refuse("no_source_onset");

  const sourceVoices = voicesOf(pair.source);
  const targetVoices = voicesOf(pair.target);
  if (targetVoices.size === 0) return refuse("no_target_onset");

  /*
   * Which strings claim to be sliding. Asked of the resolver rather than of
   * the field, so a note answering this axis twice is refused here for the
   * same reason playback refuses it.
   */
  const moving: number[] = [];
  const kinds = new Set<NoteConnection["kind"]>();
  for (const [stringIndex, voice] of targetVoices) {
    const reading = resolveExpression(voice.note);
    if (reading.conflict !== null) continue;
    const joined = reading.connection;
    if (!joined) continue;
    const kind =
      joined.source === "legacy"
        ? joined.articulation === "slide"
          ? ("legato_slide" as const)
          : null
        : joined.connection.kind;
    if (kind === null || !travels(kind)) continue;
    moving.push(stringIndex);
    kinds.add(kind);
  }

  if (moving.length < MIN_SHAPE_STRINGS) return refuse("not_a_shape");
  if (moving.length > MAX_SHAPE_STRINGS) return refuse("too_many_strings");
  if (kinds.size !== 1) return refuse("mixed_connection_kinds");
  const kind = [...kinds][0]!;

  /*
   * The source must offer exactly the strings the target moves, and no more
   * of its own: a shape that gains or loses a string on the way is two
   * gestures, and a hand that drops one is not sliding a shape.
   */
  if (sourceVoices.size !== moving.length) return refuse("string_set_differs");
  for (const stringIndex of moving) {
    if (!sourceVoices.has(stringIndex)) return refuse("string_set_differs");
  }

  const voices: ShapeVoice[] = [];
  let interval: number | null = null;

  for (const stringIndex of [...moving].sort((a, b) => a - b)) {
    const from = sourceVoices.get(stringIndex)!;
    const to = targetVoices.get(stringIndex)!;
    const fromFret = from.note.position?.fret;
    const toFret = to.note.position?.fret;
    if (fromFret === undefined || toFret === undefined) return refuse("not_fretted");
    /* An open string has nothing under it to carry, so it cannot travel. */
    if (fromFret === 0 || toFret === 0) return refuse("open_string_moving");

    const fromMidi = pitchToMidi(from.note.pitch);
    const toMidi = pitchToMidi(to.note.pitch);
    if (fromMidi === null || toMidi === null) return refuse("unplayable_voice");

    /* Asked of the sounding pitch, so a capo or a dropped string cannot make
       the shape look preserved on the fretboard while it is not in the ear. */
    const step = toMidi - fromMidi;
    if (step === 0) return refuse("shape_not_preserved");
    if (interval === null) interval = step;
    else if (step !== interval) return refuse("shape_not_preserved");

    voices.push({
      stringIndex,
      noteIndex: to.noteIndex,
      fromFret,
      toFret,
      fromMidi,
      toMidi,
    });
  }

  if (interval === null) return refuse("not_a_shape");

  return {
    ok: true,
    plan: {
      sectionId: where.sectionId,
      trackId: where.trackId,
      sourceTicks: pair.sourceTicks,
      targetTicks: where.targetTicks,
      kind,
      voices,
      intervalSemitones: interval,
      rising: interval > 0,
    },
  };
}

/** How many strings a shape at this onset *could* carry, before any gesture. */
export function shapeCandidateStrings(
  song: Song,
  where: {
    readonly sectionId: string;
    readonly trackId: string;
    readonly targetTicks: number;
  },
): number {
  const section = findSection(song, where.sectionId);
  if (!section) return 0;
  const pair = onsetPair(section, where.trackId, where.targetTicks);
  if (!pair) return 0;
  const source = voicesOf(pair.source);
  const target = voicesOf(pair.target);
  let shared = 0;
  for (const [stringIndex, from] of source) {
    const to = target.get(stringIndex);
    if (!to) continue;
    if (from.note.position?.fret === 0 || to.note.position?.fret === 0) continue;
    shared += 1;
  }
  return shared;
}

/** The gesture in musician language: "2 tel birlikte yukarı kayacak". */
export function shapeSummary(plan: ShapeSlidePlan): string {
  const way = plan.rising ? "yukarı" : "aşağı";
  return `${plan.voices.length} tel birlikte ${way} kayacak`;
}
