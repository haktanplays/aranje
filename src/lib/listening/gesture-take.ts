/**
 * The music L11–L16 ask about (2V-C.1 §19).
 *
 * Six questions, ten takes, and every one of them written by the same command
 * the editor's "Uygula" calls. A hand-built demo that happened to sound right
 * would answer a question nobody is asking; what the founder has to judge is
 * what the production path actually produces.
 *
 * ## Why each take gets its own bar
 *
 * The A and B sides of a card have to differ in exactly one thing, so they
 * cannot share a bar and they cannot borrow one another's context. Each take
 * appends a measure of its own to a copy of the fixture that only that take
 * ever sees, with every other track resting — so what is heard is the guitar
 * movement and nothing competing with it.
 *
 * ## What the automated side may claim
 *
 * Nothing about how it sounds. The render check asserts the clip is audible,
 * unclipped, finite, the right length and built from the expected plan. That
 * one of two takes stays bent and the other comes back down is a fact the
 * *plan* states and the tests assert; whether it sounds like a guitarist is
 * the question only the founder can answer.
 */
import { barTimeline } from "@/lib/audio/schedule";
import { songSupport } from "@/lib/acceptance/song-support";
import { applyGestureWrite } from "@/lib/song/gesture-write";
import { pitchAt, settle } from "@/lib/song/edit";
import {
  isDrumSlotArray,
  type DrumSlot,
  type MelodicSlot,
  type NoteConnection,
  type PitchGesture,
  type Song,
} from "@/lib/song/schema";

/** 4/4 at 1/8: the grid a beginner's bar is on. */
const RESOLUTION = 8;
const SLOT_TICKS = 96;
const STRING = 1;

/** The takes, in the order the pack offers them. */
export const GESTURE_TAKE_IDS = [
  "L17a",
  "L17b",
  "L18a",
  "L18b",
  "L19a",
  "L19b",
  "L20a",
  "L20b",
] as const;

export type GestureTakeId = (typeof GESTURE_TAKE_IDS)[number];

export type GestureTake = {
  readonly song: Song;
  /** Which bar it went into, 1-based. The clip windows on it. */
  readonly barNumber: number;
  /** Which track carries it, for the clip's `expects`. */
  readonly trackId: string;
};

export type GestureTakes = Readonly<Record<GestureTakeId, GestureTake>>;

/** What each take writes, and onto which of the bar's notes. */
type Recipe = {
  /** Frets in the bar, in slot order. Two for a slide, one otherwise. */
  readonly frets: readonly number[];
  /** Which slot the gesture goes on, and what it is. */
  readonly onSlot: number;
  readonly pitchGesture?: PitchGesture;
  readonly connection?: NoteConnection;
  /** Ties after the gesture's slot, so a held note has something to hold. */
  readonly holdSlots?: number;
};

const HOLD: Pick<Recipe, "frets" | "onSlot" | "holdSlots"> = {
  frets: [7],
  onSlot: 0,
  holdSlots: 3,
};

/**
 * The four cards, and what makes each pair a fair question (2V-C.2 §14).
 *
 * Every pair shares its base note, its velocity and its written length; the
 * one thing that differs is the gesture the card is about. A pair that
 * differed in two ways would be unanswerable however good it sounded.
 */
const RECIPES: Readonly<Record<GestureTakeId, Recipe>> = {
  /* L17 · the same note, the same amount, and only the ending differs. */
  L17a: { ...HOLD, pitchGesture: { kind: "bend", targetCents: 200 } },
  L17b: { ...HOLD, pitchGesture: { kind: "bend_release", targetCents: 200 } },
  /*
   * L18 · a rise to listen for, and its absence.
   *
   * The previous round compared two prebends with each other, which asks a
   * listener to hear the difference between two things that both start bent.
   * Comparing a prebend with an ordinary bend puts the rise itself on one
   * side of the question, which is what the card is actually about.
   */
  L18a: { ...HOLD, pitchGesture: { kind: "bend", targetCents: 200 } },
  L18b: { ...HOLD, pitchGesture: { kind: "prebend", targetCents: 200 } },
  /* L19 · the same travel arriving at the same moment; only the attack. */
  L19a: { frets: [5, 7], onSlot: 2, connection: { kind: "legato_slide" }, holdSlots: 3 },
  L19b: { frets: [5, 7], onSlot: 2, connection: { kind: "shift_slide" }, holdSlots: 3 },
  /* L20 · one note entered by sliding, one note left by sliding. */
  L20a: {
    ...HOLD,
    pitchGesture: { kind: "slide_in", from: "below", approxSemitones: 2 },
  },
  L20b: {
    ...HOLD,
    pitchGesture: { kind: "slide_out", to: "down", approxSemitones: 3 },
  },
};

/** A bar with only this take's notes in it, on a copy of the song. */
function withBar(
  song: Song,
  trackId: string,
  lane: MelodicSlot[],
): { readonly song: Song; readonly sectionId: string; readonly barIndex: number } | null {
  const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};
  for (const entry of song.tracks) {
    const existing = song.sections[0]?.bars[0]?.slots[entry.id];
    slots[entry.id] =
      existing && isDrumSlotArray(existing)
        ? Array.from({ length: 8 }, () => [] as DrumSlot)
        : Array.from({ length: 8 }, () => null as MelodicSlot);
  }
  slots[trackId] = lane;

  const sectionIndex = song.sections.length - 1;
  const section = song.sections[sectionIndex];
  if (!section) return null;
  const barIndex = section.bars.length;

  const staged = settle({
    ...song,
    sections: song.sections.map((entry, index) =>
      index === sectionIndex
        ? {
            ...entry,
            bars: [
              ...entry.bars,
              { timeSignature: [4, 4] as const, resolution: RESOLUTION, slots },
            ],
          }
        : entry,
    ),
  });
  if (!staged.ok) return null;
  return { song: staged.song, sectionId: section.id, barIndex };
}

function buildTake(song: Song, recipe: Recipe): GestureTake | null {
  const trackId = songSupport(song).heldPowerChord?.trackId ?? song.tracks[0]?.id;
  const track = song.tracks.find((entry) => entry.id === trackId);
  const fretboard = track?.fretboard;
  if (!track || !fretboard) return null;

  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  recipe.frets.forEach((fret, index) => {
    const pitch = pitchAt(fretboard, STRING, fret);
    if (pitch === null) return;
    /* A two-note recipe puts the source on slot 0 and the target on `onSlot`,
       with the source ringing right up to it: a hand cannot slide across a
       rest, and the write command says so. */
    const slot = index === 0 ? 0 : recipe.onSlot;
    lane[slot] = { notes: [{ pitch, position: { string: STRING, fret } }] };
    if (index === 0 && recipe.frets.length > 1) {
      for (let tie = 1; tie < recipe.onSlot; tie += 1) lane[tie] = "-";
    }
  });
  for (let tie = 1; tie <= (recipe.holdSlots ?? 0); tie += 1) {
    const slot = recipe.onSlot + tie;
    if (slot < lane.length) lane[slot] = "-";
  }

  const staged = withBar(song, track.id, lane);
  if (!staged) return null;

  const barTicks = RESOLUTION === 8 ? SLOT_TICKS * 8 : 768;
  const sectionTicks =
    (staged.barIndex * barTicks) + recipe.onSlot * SLOT_TICKS;

  const written = applyGestureWrite(staged.song, {
    sectionId: staged.sectionId,
    trackId: track.id,
    timeTicks: sectionTicks,
    ...(recipe.pitchGesture ? { pitchGesture: recipe.pitchGesture } : {}),
    ...(recipe.connection ? { connection: recipe.connection } : {}),
  });
  if (!written.ok) return null;

  const barNumber = barTimeline(written.song).findIndex(
    (marker) => marker.barKey === `${staged.sectionId}:${staged.barIndex}`,
  );
  if (barNumber < 0) return null;

  return { song: written.song, barNumber: barNumber + 1, trackId: track.id };
}

/**
 * All ten takes, or null when even one of them could not be written.
 *
 * All or nothing on purpose: a card with one side missing is a comparison the
 * founder cannot make, and offering it would be worse than not offering the
 * card at all.
 */
export function gestureTakes(song: Song): GestureTakes | null {
  const built: Partial<Record<GestureTakeId, GestureTake>> = {};
  for (const id of GESTURE_TAKE_IDS) {
    const take = buildTake(song, RECIPES[id]);
    if (!take) return null;
    built[id] = take;
  }
  return built as GestureTakes;
}
