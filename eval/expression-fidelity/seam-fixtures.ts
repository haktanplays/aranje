/**
 * What to render, and where its seam is (2V-C.4 §4, §12).
 *
 * Every fixture is built by the production gesture commands on a copy of the
 * canonical editor fixture, then windowed the way the Listening Pack windows
 * a clip. Nothing here writes a Song by hand into a shape the editor could
 * not produce: a seam measured on music the product cannot make would prove
 * nothing about the product.
 *
 * The set has three jobs. The **matrix** covers the connections, distances,
 * tempos, durations, practice rates and registers §12 names. The **positive
 * controls** are places continuity is expected, so a gate that fires
 * everywhere is caught. The **negative controls** are places a hole really
 * exists — a written rest, above all — so a gate that fires nowhere is caught
 * too.
 */
import { applyGestureWrite } from "@/lib/song/gesture-write";
import { applyShapeSlide } from "@/lib/song/shape-slide-write";
import { barTimeline } from "@/lib/audio/schedule";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { pitchAt, settle } from "@/lib/song/edit";
import type { ClipTake } from "@/lib/listening/clip-plan";
import type { SeamClass } from "./seam-pcm";
import { expectsContinuity } from "./seam-pcm";
import type {
  DrumSlot,
  MelodicSlot,
  NoteConnection,
  Song,
} from "@/lib/song/schema";

const RESOLUTION = 8;
const SLOT_TICKS = 96;

export type SeamFixture = {
  readonly song: Song;
  readonly take: ClipTake;
  /** Where in the rendered clip the two notes meet, in seconds. */
  readonly seamSeconds: number;
  /** What kind of seam it is, which decides the limits it is held to. */
  readonly seamClass: SeamClass;
  /** Whether the energy is expected to be continuous across it. */
  readonly expectContinuous: boolean;
  /** One line for the report. */
  readonly what: string;
};

export type SeamFixtureName = string;

type Recipe = {
  readonly what: string;
  /** Frets in slot order. Two for a connected pair, one for a single note. */
  readonly frets: readonly number[];
  /** Which string, or two for a shape. */
  readonly strings: readonly number[];
  readonly connection?: NoteConnection;
  /** A real rest between the two notes: the negative control. */
  readonly restBetween?: boolean;
  readonly tempoBpm?: number;
  readonly practicePercent?: number;
  /** Slots between the two onsets. Two is an eighth-note pair at 1/8. */
  readonly spacingSlots?: number;
  readonly seamClass: SeamClass;
};

/** A bar with only this recipe's notes in it, appended to a copy of the song. */
function withBar(
  song: Song,
  trackId: string,
  lane: MelodicSlot[],
  bpm: number | undefined,
): { readonly song: Song; readonly sectionId: string; readonly barIndex: number } | null {
  const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};
  for (const entry of song.tracks) {
    const existing = song.sections[0]?.bars[0]?.slots[entry.id];
    slots[entry.id] =
      existing && Array.isArray(existing) && Array.isArray(existing[0])
        ? Array.from({ length: RESOLUTION }, () => [] as DrumSlot)
        : Array.from({ length: RESOLUTION }, () => null as MelodicSlot);
  }
  slots[trackId] = lane;

  const sectionIndex = song.sections.length - 1;
  const section = song.sections[sectionIndex];
  if (!section) return null;
  const barIndex = section.bars.length;

  const staged = settle({
    ...song,
    ...(bpm === undefined ? {} : { bpm }),
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

function build(song: Song, recipe: Recipe): SeamFixture | null {
  const track = song.tracks.find((entry) => entry.fretboard);
  const fretboard = track?.fretboard;
  if (!track || !fretboard) return null;

  const spacing = recipe.spacingSlots ?? 2;
  const lane: MelodicSlot[] = Array.from({ length: RESOLUTION }, () => null);

  recipe.frets.forEach((fret, index) => {
    const slot = index === 0 ? 0 : spacing;
    const notes = recipe.strings
      .map((stringIndex) => {
        const pitch = pitchAt(fretboard, stringIndex, fret);
        return pitch === null ? null : { pitch, position: { string: stringIndex, fret } };
      })
      .filter((note): note is NonNullable<typeof note> => note !== null);
    if (notes.length === 0) return;
    lane[slot] = { notes };
  });

  /*
   * Everything after an onset rings until the next one. A recipe with a
   * single note therefore holds it across the whole bar, which is what makes
   * the sustain control a sustain rather than a short note followed by
   * nothing — the first run of this harness caught exactly that, measuring a
   * silent window and calling it a broken seam.
   *
   * The rest is the one exception, and the one negative control that has to
   * survive every later refactor: if the analyzer stops finding *that* gap,
   * it is finding nothing.
   */
  const lastOnset = recipe.frets.length > 1 ? spacing : 0;
  for (let tie = 1; tie < RESOLUTION; tie += 1) {
    if (lane[tie] !== null) continue;
    if (recipe.restBetween === true && tie < lastOnset) continue;
    lane[tie] = "-";
  }

  const staged = withBar(song, track.id, lane, recipe.tempoBpm);
  if (!staged) return null;

  const barTicks = SLOT_TICKS * RESOLUTION;
  const targetTicks = staged.barIndex * barTicks + spacing * SLOT_TICKS;

  let written: { ok: true; song: Song } | { ok: false } = { ok: true, song: staged.song };
  if (recipe.connection) {
    const result =
      recipe.strings.length > 1
        ? applyShapeSlide(staged.song, {
            sectionId: staged.sectionId,
            trackId: track.id,
            targetTicks,
            connection: recipe.connection as Extract<
              NoteConnection,
              { kind: "legato_slide" } | { kind: "shift_slide" }
            >,
          })
        : applyGestureWrite(staged.song, {
            sectionId: staged.sectionId,
            trackId: track.id,
            timeTicks: targetTicks,
            connection: recipe.connection,
          });
    written = result.ok ? { ok: true, song: result.song } : { ok: false };
  }
  if (!written.ok) return null;

  const barNumber =
    barTimeline(written.song).findIndex(
      (marker) => marker.barKey === `${staged.sectionId}:${staged.barIndex}`,
    ) + 1;
  if (barNumber === 0) return null;

  const timeline = barTimeline(written.song);
  const first = timeline[barNumber - 1];
  const startTicks = first?.time ?? 0;
  const endTicks = startTicks + barTicks;

  /*
   * Where the seam is, in *clip* seconds. The window starts at the bar, so
   * the seam is the target's offset from the bar's start under this tempo and
   * practice rate — asked of the tempo map rather than multiplied out, so a
   * fixture at 60 BPM and one at 220 both land in the right place.
   */
  const percent = recipe.practicePercent ?? 100;
  const tempo = buildTempoMap(written.song, percent);
  const seamSeconds =
    secondsAtTicks(tempo, startTicks + spacing * SLOT_TICKS) -
    secondsAtTicks(tempo, startTicks);

  return {
    song: written.song,
    take: {
      id: recipe.what,
      name: recipe.what,
      segments: [
        {
          window: { startTicks, endTicks, trackIds: [track.id] },
          continueSustained: false,
          tailSeconds: 1.5,
        },
      ],
    },
    seamSeconds,
    seamClass: recipe.seamClass,
    expectContinuous: expectsContinuity(recipe.seamClass),
    what: recipe.what,
  };
}

const LEGATO: NoteConnection = { kind: "legato_slide" };
const SHIFT: NoteConnection = { kind: "shift_slide" };
const HAMMER: NoteConnection = { kind: "hammer_on" };
const PULL: NoteConnection = { kind: "pull_off" };

/**
 * The set, by name.
 *
 * Pairwise rather than a full Cartesian product (§12 allows this and asks it
 * to be said): every connection is seen at more than one distance, every
 * tempo with more than one connection, every register with a real gesture.
 * A full cross would be several hundred renders for coverage the pairs
 * already give.
 */
const RECIPES: Readonly<Record<string, Recipe>> = {
  /* ---------------------------------------------- positive controls */
  "control-sustain": {
    what: "one held note, nothing to cross",
    frets: [7],
    strings: [2],
    seamClass: "joined",
  },
  "control-restruck": {
    what: "the same note picked twice",
    frets: [7, 7],
    strings: [2],
    seamClass: "restrike",
  },

  /* ---------------------------------------------- negative control */
  "control-rest": {
    what: "a written rest between two notes",
    frets: [5, 7],
    strings: [2],
    restBetween: true,
    seamClass: "broken",
  },

  /* ---------------------------------------------- the matrix */
  "legato-2st": { what: "legato slide, 2 frets", frets: [5, 7], strings: [2], connection: LEGATO, seamClass: "joined" },
  "legato-4st": { what: "legato slide, 4 frets", frets: [5, 9], strings: [2], connection: LEGATO, seamClass: "joined" },
  "shift-1st": { what: "shift slide, 1 fret", frets: [7, 8], strings: [2], connection: SHIFT, seamClass: "connected" },
  "shift-2st": { what: "shift slide, 2 frets", frets: [5, 7], strings: [2], connection: SHIFT, seamClass: "connected" },
  "shift-4st": { what: "shift slide, 4 frets", frets: [5, 9], strings: [2], connection: SHIFT, seamClass: "connected" },
  "shift-7st": { what: "shift slide, a wide 7 frets", frets: [5, 12], strings: [2], connection: SHIFT, seamClass: "connected" },
  "shift-low": { what: "shift slide, low register", frets: [3, 5], strings: [5], connection: SHIFT, seamClass: "connected" },
  "shift-high": { what: "shift slide, high register", frets: [12, 14], strings: [0], connection: SHIFT, seamClass: "connected" },
  "shift-60bpm": { what: "shift slide at 60 BPM", frets: [5, 7], strings: [2], connection: SHIFT, tempoBpm: 60, seamClass: "connected" },
  "shift-220bpm": { what: "shift slide at 220 BPM", frets: [5, 7], strings: [2], connection: SHIFT, tempoBpm: 220, seamClass: "connected" },
  "shift-16th": { what: "shift slide, a sixteenth apart", frets: [5, 7], strings: [2], connection: SHIFT, spacingSlots: 1, seamClass: "connected" },
  "shift-half-speed": { what: "shift slide at 50% practice", frets: [5, 7], strings: [2], connection: SHIFT, practicePercent: 50, seamClass: "connected" },
  "shift-fast-practice": { what: "shift slide at 150% practice", frets: [5, 7], strings: [2], connection: SHIFT, practicePercent: 150, seamClass: "connected" },
  "shape2-shift": { what: "two strings, shift shape", frets: [5, 7], strings: [2, 3], connection: SHIFT, seamClass: "connected" },
  "shape3-shift": { what: "three strings, shift shape", frets: [5, 7], strings: [1, 2, 3], connection: SHIFT, seamClass: "connected" },
  "shape2-legato": { what: "two strings, legato shape", frets: [5, 7], strings: [2, 3], connection: LEGATO, seamClass: "joined" },
  "hammer-on": { what: "hammer-on", frets: [5, 7], strings: [2], connection: HAMMER, seamClass: "joined" },
  "pull-off": { what: "pull-off", frets: [7, 5], strings: [2], connection: PULL, seamClass: "joined" },
};

export function seamFixtures(song: Song): Readonly<Record<string, SeamFixture>> {
  const out: Record<string, SeamFixture> = {};
  for (const [name, recipe] of Object.entries(RECIPES)) {
    const fixture = build(song, recipe);
    if (fixture) out[name] = fixture;
  }
  return out;
}

/** Which fixtures were asked for, so a silently-missing one is visible. */
export const SEAM_FIXTURE_NAMES = Object.keys(RECIPES);
