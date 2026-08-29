/**
 * The song the founder editor acceptance is done on (2U-A handoff §3).
 *
 * A **fixture, not a composition**. Its only job is to make every editor
 * operation in the seven steps possible without the reader having to write
 * anything first — the handoff explicitly refuses to open an empty project and
 * ask a guitarist to fill it in before the test can begin.
 *
 * So every shape a step needs is already here, and each is here for a reason:
 *
 * - **A chord and three single notes in bar 1**, which is the motif to select,
 *   extend, copy, and move. A chord because "one onset, several notes" is the
 *   distinction the descriptor makes and the toolbar acts on.
 * - **Notes on three different strings**, so moving to a neighbouring string
 *   has somewhere to go in both directions without leaving the fretboard.
 * - **An empty bar 2**, which is the paste target. A paste into occupied space
 *   is a refusal, and the step is about the paste working.
 * - **A written bar 3 and an empty bar 4**, so a measure can be moved right
 *   into free space and duplicated without colliding, and so a multi-measure
 *   selection has two adjacent bars with content in them.
 * - **Two tracks.** This is not decoration. "The operation reaches every
 *   track" cannot be falsified on a one-track song — taking the first track
 *   and taking all of them give the same answer — so the bass is what makes
 *   step 5 and step 6 able to fail.
 *
 * Every pitch is computed from the fretboard rather than typed, so the fixture
 * cannot quietly disagree with the tuning it claims.
 */
import { TUNING_PRESETS, soundingMidi } from "@/lib/music/fretboard";
import { midiToPitch } from "@/lib/music/pitch";
import type { Bar, MelodicSlot, Song, Track } from "@/lib/song/schema";
import { SONG_VERSION } from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;
const BASS_STANDARD = TUNING_PRESETS.bass_standard!.tuning;

const GUITAR_BOARD = { tuning: [...E_STANDARD], capo: 0 };
const BASS_BOARD = { tuning: [...BASS_STANDARD], capo: 0 };

export const EDITOR_GUITAR_ID = "gtr";
export const EDITOR_BASS_ID = "bass";

/**
 * Where the guided steps point.
 *
 * Named rather than typed into each step, so a fixture edit that moves the
 * motif moves the instructions with it instead of leaving a step pointing at
 * silence.
 */
export const EDITOR_LANDMARKS = {
  /** The chord that opens the motif — where a selection starts. */
  motifStart: { barIndex: 0, slotIndex: 0 },
  /** The last note of the motif — where "Devam" reaches to. */
  motifEnd: { barIndex: 0, slotIndex: 12 },
  /** The empty bar a copy is pasted into. */
  emptyTarget: { barIndex: 1, slotIndex: 0 },
  /**
   * The motif the string moves are made on (2U-B §5).
   *
   * Not the one in bar 1. That opens on an open low E, and E2 is below the A
   * string's open pitch, so no thinner string can sound it — and there is no
   * thicker string than the sixth. Bar 3 sits mid-neck, where a note has a
   * neighbour in both directions, so "move to the next string" is a movement
   * that exists rather than one the guide only asks for.
   */
  restringBar: 2,
  /**
   * A selection that genuinely cannot be restrung, kept on purpose.
   *
   * The chord in bar 1 is the negative case: the refusal it produces is a
   * feature, and a package that only exercised the movements that work would
   * say nothing about whether the guard is there at all.
   */
  unplayableRestring: { barIndex: 0, slotIndex: 0 },
  /** A written bar with free space on its right, for the measure moves. */
  movableBar: 2,
  /** The empty bar that free space is. */
  freeBar: 3,
  /** The two adjacent written bars a multi-measure selection covers. */
  multiBars: { start: 0, end: 1 },
  sectionId: "s1",
} as const;

function guitarAt(stringIndex: number, fret: number): MelodicSlot {
  const midi = soundingMidi(GUITAR_BOARD, { string: stringIndex, fret });
  if (midi === null) throw new Error(`unplayable: string ${stringIndex} fret ${fret}`);
  return { notes: [{ pitch: midiToPitch(midi), position: { string: stringIndex, fret } }] };
}

/** Several notes struck together — one onset, which is what a chord is. */
function guitarChord(
  positions: readonly { readonly string: number; readonly fret: number }[],
): MelodicSlot {
  return {
    notes: positions.map((position) => {
      const midi = soundingMidi(GUITAR_BOARD, position);
      if (midi === null) {
        throw new Error(`unplayable: string ${position.string} fret ${position.fret}`);
      }
      return { pitch: midiToPitch(midi), position: { ...position } };
    }),
  };
}

function bassAt(stringIndex: number, fret: number): MelodicSlot {
  const midi = soundingMidi(BASS_BOARD, { string: stringIndex, fret });
  if (midi === null) throw new Error(`unplayable bass: ${stringIndex}/${fret}`);
  return { notes: [{ pitch: midiToPitch(midi), position: { string: stringIndex, fret } }] };
}

const rest: MelodicSlot = null;
const empty = (): MelodicSlot[] => Array.from({ length: 16 }, () => rest);

const fill = (
  entries: Readonly<Record<number, MelodicSlot>>,
): MelodicSlot[] => {
  const slots = empty();
  for (const [index, slot] of Object.entries(entries)) slots[Number(index)] = slot;
  return slots;
};

/*
 * Bar 1 — the motif. A chord, then three single notes on three strings, so a
 * string move has room upward and downward and a pitch move has an ornament
 * shape to preserve.
 */
const MOTIF_GUITAR = fill({
  0: guitarChord([
    { string: 0, fret: 0 },
    { string: 1, fret: 2 },
    { string: 2, fret: 2 },
  ]),
  4: guitarAt(3, 2),
  8: guitarAt(2, 4),
  12: guitarAt(3, 5),
});

/* Bar 3 — something to move and duplicate, on a different pair of strings. */
const SECOND_GUITAR = fill({
  0: guitarAt(2, 7),
  6: guitarAt(3, 7),
  10: guitarAt(2, 9),
});

const MOTIF_BASS = fill({ 0: bassAt(0, 3), 8: bassAt(1, 3) });
const SECOND_BASS = fill({ 0: bassAt(1, 5), 8: bassAt(0, 5) });

const bar = (
  guitar: readonly MelodicSlot[],
  bass: readonly MelodicSlot[],
): Bar => ({
  timeSignature: [4, 4],
  resolution: 16,
  slots: { [EDITOR_GUITAR_ID]: [...guitar], [EDITOR_BASS_ID]: [...bass] },
});

export const EDITOR_GUITAR_TRACK: Track = {
  id: EDITOR_GUITAR_ID,
  name: "Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: GUITAR_BOARD,
};

export const EDITOR_BASS_TRACK: Track = {
  id: EDITOR_BASS_ID,
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -8,
  fretboard: BASS_BOARD,
};

/** The whole fixture. A new object every call: nothing here is shared state. */
export function editorFixture(): Song {
  return {
    version: SONG_VERSION,
    title: "Editör kabul parçası",
    bpm: 96,
    key: "E minor",
    tracks: [
      { ...EDITOR_GUITAR_TRACK, fretboard: { ...GUITAR_BOARD, tuning: [...E_STANDARD] } },
      { ...EDITOR_BASS_TRACK, fretboard: { ...BASS_BOARD, tuning: [...BASS_STANDARD] } },
    ],
    sections: [
      {
        id: EDITOR_LANDMARKS.sectionId,
        name: "Kabul",
        status: "fixed",
        bars: [
          bar(MOTIF_GUITAR, MOTIF_BASS),
          /* Deliberately empty on both tracks: this is the paste target. */
          bar(empty(), empty()),
          bar(SECOND_GUITAR, SECOND_BASS),
          /* Free space on the right, so a measure move never overwrites. */
          bar(empty(), empty()),
        ],
      },
    ],
  };
}
