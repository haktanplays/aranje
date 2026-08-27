/**
 * The riff the Android acceptance test is done on (K-59.1 §4).
 *
 * Short, repeatable, and metal enough to be worth hearing twice: three muted
 * low-E chugs, a `5-7-8-7-5` legato run, a slide up and back, a half bend, a
 * full bend, a held vibrato, three more chugs and two closing notes.
 *
 * It is a **fixture, not a composition**. Its only job is to make every
 * behaviour under test appear honestly on one screen and in one listen:
 *
 * - a five-note hammer-on/pull-off run, which is also the five notes the
 *   reader is asked to select;
 * - a rising and a falling slide;
 * - a half and a full bend;
 * - a vibrato held long enough to hear;
 * - a three-note palm-muted range;
 * - two sections, so the section loop and a seek have somewhere to go;
 * - an empty beat the power chord pen can be previewed on.
 *
 * Nothing is random. Every pitch is computed from the fretboard rather than
 * typed out, so the fixture cannot quietly disagree with the tuning it claims.
 */
import { ticksPerSlot } from "@/lib/music/timing";
import { soundingMidi } from "@/lib/music/fretboard";
import { midiToPitch } from "@/lib/music/pitch";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import type {
  Articulation,
  Bar,
  MelodicSlot,
  Song,
  Track,
} from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;
const FRETBOARD = { tuning: [...E_STANDARD], capo: 0 };
const TRACK_ID = "gtr";

/** The bar and slot the guided test asks the reader to press and to select. */
export const RIFF_LANDMARKS = {
  /** The first note of the legato run — where the long press starts. */
  runStart: { barKey: "s1:0", slotIndex: 4, stringIndex: 2 },
  /** The last note of the run — where the selection is dragged to. */
  runEnd: { barKey: "s1:0", slotIndex: 8, stringIndex: 2 },
  /** An empty beat, so the power chord ghost has somewhere to be previewed. */
  emptyBeat: { barKey: "s1:1", slotIndex: 6, stringIndex: 1 },
  /** The bar the reader is asked to seek to. */
  secondBar: "s1:1",
  /** The section the reader is asked to loop. */
  loopSection: "s1",
} as const;

/**
 * Where each technique sits, in ticks from the song's start.
 *
 * Computed from the grid rather than typed out, so a fixture edit cannot leave
 * the listening step asking about a moment the music no longer has. The guided
 * test uses these to record whether the playhead really crossed each one — an
 * answer about a passage that never played is not an answer.
 */
const SLOT = ticksPerSlot(16);
const BAR = SLOT * 16;
const window_ = (barIndex: number, from: number, to: number) => ({
  from: barIndex * BAR + from * SLOT,
  to: barIndex * BAR + (to + 1) * SLOT,
});

export const LISTEN_WINDOWS = {
  palmMute: window_(0, 0, 2),
  hopo: window_(0, 4, 8),
  slide: window_(0, 10, 12),
  bendHalf: window_(0, 14, 14),
  bendFull: window_(1, 0, 0),
  vibrato: window_(1, 2, 5),
} as const;

function at(stringIndex: number, fret: number, articulation?: Articulation): MelodicSlot {
  const midi = soundingMidi(FRETBOARD, { string: stringIndex, fret });
  if (midi === null) throw new Error(`unplayable: string ${stringIndex} fret ${fret}`);
  return {
    notes: [
      {
        pitch: midiToPitch(midi),
        position: { string: stringIndex, fret },
        ...(articulation ? { articulation } : {}),
      },
    ],
  };
}

const rest: MelodicSlot = null;
const tie: MelodicSlot = "-";

/** Low E, open, muted with the palm. The riff's pulse. */
const chug = (): MelodicSlot => at(0, 0, "palm_mute");

const bar = (slots: readonly MelodicSlot[]): Bar => ({
  timeSignature: [4, 4],
  resolution: 16,
  slots: { [TRACK_ID]: [...slots] },
});

/* Bar 1: the chugs, the legato run, the two slides, the half bend. */
const OPENING: readonly MelodicSlot[] = [
  chug(),
  chug(),
  chug(),
  rest,
  at(2, 5),
  at(2, 7, "hammer_on"),
  at(2, 8, "hammer_on"),
  at(2, 7, "pull_off"),
  at(2, 5, "pull_off"),
  rest,
  at(2, 5),
  at(2, 7, "slide"),
  at(2, 5, "slide"),
  rest,
  at(2, 7, "bend_half"),
  rest,
];

/* Bar 2: the full bend, the held vibrato, three more chugs, two closing notes. */
const ANSWER: readonly MelodicSlot[] = [
  at(2, 7, "bend_full"),
  rest,
  at(2, 7, "vibrato"),
  tie,
  tie,
  tie,
  rest,
  chug(),
  chug(),
  chug(),
  rest,
  at(1, 3),
  rest,
  at(1, 2),
  rest,
  rest,
];

/* The closing section: the same pulse, resolved. Somewhere to loop and seek. */
const CLOSE_A: readonly MelodicSlot[] = [
  chug(),
  chug(),
  rest,
  chug(),
  rest,
  at(1, 5),
  tie,
  rest,
  chug(),
  chug(),
  rest,
  at(1, 3),
  tie,
  rest,
  rest,
  rest,
];

const CLOSE_B: readonly MelodicSlot[] = [
  at(0, 0),
  tie,
  tie,
  tie,
  tie,
  tie,
  tie,
  tie,
  rest,
  rest,
  rest,
  rest,
  rest,
  rest,
  rest,
  rest,
];

export const ACCEPTANCE_TRACK: Track = {
  id: TRACK_ID,
  name: "Gitar",
  instrumentId: "electric_guitar",
  // The preset that actually has a vendored sample pack (K-54).
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: FRETBOARD,
};

/** The whole fixture. A new object every call: nothing here is shared state. */
export function acceptanceRiff(): Song {
  return {
    version: 2,
    title: "Android kabul riff'i",
    bpm: 100,
    key: "E minor",
    tracks: [{ ...ACCEPTANCE_TRACK, fretboard: { ...FRETBOARD, tuning: [...E_STANDARD] } }],
    sections: [
      {
        id: "s1",
        name: "Ana Riff",
        status: "fixed",
        bars: [bar(OPENING), bar(ANSWER)],
      },
      {
        id: "s2",
        name: "Kapanış",
        status: "fixed",
        bars: [bar(CLOSE_A), bar(CLOSE_B)],
      },
    ],
  };
}
