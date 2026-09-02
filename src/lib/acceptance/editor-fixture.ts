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
import type { Bar, MelodicSlot, NoteEvent, Song, Track } from "@/lib/song/schema";
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
  /**
   * Where each technique the round has to hear actually is (2V-B.1 §10).
   *
   * Named, because §12 forbids a task that names a passage the Song does not
   * have. A step asking for "the 5→7 slide on the D string" reads the bar,
   * the slot and the string from here, so a fixture edit that moves the
   * passage moves the instruction with it — and a fixture edit that *removes*
   * it makes `editor-fixture.test.ts` red rather than making the founder
   * hunt for something that is not there.
   */
  heldPowerChord: { barIndex: 0, slotIndex: 0, stringIndexes: [0, 1, 2] },
  slide: { barIndex: 4, sourceSlot: 0, targetSlot: 4, stringIndex: 2, fromFret: 5, toFret: 7 },
  vibrato: { barIndex: 4, slotIndex: 8, stringIndex: 3 },
  hammerOn: { barIndex: 5, sourceSlot: 0, targetSlot: 4, stringIndex: 3 },
  pullOff: { barIndex: 5, sourceSlot: 4, targetSlot: 8, stringIndex: 3 },
  /** The strummed, let-ringing chord a repeat has to carry unchanged. */
  strummedChord: { barIndex: 5, slotIndex: 12 },
  /** Both instruments written in the same bar, so "together" can be false. */
  bothTracksBar: 4,
  sectionId: "s1",
} as const;

/**
 * The string names a task may say out loud, thickest first.
 *
 * A guitarist is told "the D string", never "string index 2". The index is
 * how the model holds it; this is how a person is spoken to, and it lives
 * beside the tuning it describes rather than in the guide that reads it.
 */
export const EDITOR_STRING_NAMES: readonly string[] = [
  "Mi (kalın)",
  "La",
  "Re",
  "Sol",
  "Si",
  "Mi (ince)",
];

function guitarAt(stringIndex: number, fret: number): MelodicSlot {
  const midi = soundingMidi(GUITAR_BOARD, { string: stringIndex, fret });
  if (midi === null) throw new Error(`unplayable: string ${stringIndex} fret ${fret}`);
  return { notes: [{ pitch: midiToPitch(midi), position: { string: stringIndex, fret } }] };
}

function bassAt(stringIndex: number, fret: number): MelodicSlot {
  const midi = soundingMidi(BASS_BOARD, { string: stringIndex, fret });
  if (midi === null) throw new Error(`unplayable bass: ${stringIndex}/${fret}`);
  return { notes: [{ pitch: midiToPitch(midi), position: { string: stringIndex, fret } }] };
}

/** One note that says its own length, and may ring past the next attack. */
function guitarHeld(
  stringIndex: number,
  fret: number,
  options: {
    readonly articulation?: NoteEvent["articulation"];
    readonly durationTicks?: number;
    readonly letRing?: boolean;
  } = {},
): MelodicSlot {
  const midi = soundingMidi(GUITAR_BOARD, { string: stringIndex, fret });
  if (midi === null) throw new Error(`unplayable: string ${stringIndex} fret ${fret}`);
  return {
    notes: [
      {
        pitch: midiToPitch(midi),
        position: { string: stringIndex, fret },
        ...(options.articulation === undefined
          ? {}
          : { articulation: options.articulation }),
        ...(options.durationTicks === undefined
          ? {}
          : { durationTicks: options.durationTicks }),
        ...(options.letRing === undefined ? {} : { letRing: options.letRing }),
      },
    ],
  };
}

/** A chord the picking hand crossed, held, and left ringing. */
function strummedChord(
  positions: readonly { readonly string: number; readonly fret: number }[],
  durationTicks: number,
): MelodicSlot {
  return {
    notes: positions.map((position) => {
      const midi = soundingMidi(GUITAR_BOARD, position);
      if (midi === null) {
        throw new Error(`unplayable: string ${position.string} fret ${position.fret}`);
      }
      return {
        pitch: midiToPitch(midi),
        position: { ...position },
        strum: "down" as const,
        letRing: true,
        durationTicks,
      };
    }),
  };
}

const rest: MelodicSlot = null;
/** The tie marker, spelled once (spec 5.4). */
const tie: MelodicSlot = "-";
/** One sixteenth of a 4/4 bar, in ticks. The grid every bar here is on. */
const SLOT_TICKS = 48;
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
  /*
   * E5: root, fifth, octave. Held for a whole beat and left ringing, so
   * "press and hold the first power chord" is a chord that is actually
   * sounding while the founder holds it (2V-B.1 §10). Written without a
   * duration it stopped at the next onset a beat later, which is a chord a
   * listener has to take on trust.
   */
  0: strummedChord(
    [
      { string: 0, fret: 0 },
      { string: 1, fret: 2 },
      { string: 2, fret: 2 },
    ],
    /* Two beats, so the chord is still ringing when the melody above it is
       struck. Held for one beat it stopped exactly as the next note began,
       which is a chord a listener has to take on trust. */
    SLOT_TICKS * 8,
  ),
  4: guitarAt(3, 2),
  8: guitarAt(2, 4),
  12: guitarAt(3, 5),
});

/*
 * Bar 5 — the slide and the vibrato (2V-B.1 §10).
 *
 * Both are written as a source that is still ringing when the hand does
 * something to it, because that is what the two articulations are: a slide
 * needs the previous note to travel out of, and a vibrato needs a note long
 * enough for the hand to shake it. Written short, the planner would refuse
 * both and fall back to ordinary onsets — a fixture that draws a technique
 * the engine then declines to play is exactly the kind of thing this round
 * exists to stop.
 *
 * The slide is 5 → 7 on the D string, which is the passage §12's example task
 * names out loud. The interval is two semitones and the source rings for four
 * sixteenths before it, so the hand has room to be heard travelling.
 */
const SLIDE_GUITAR = fill({
  0: guitarAt(2, 5),
  1: tie,
  2: tie,
  3: tie,
  4: guitarHeld(2, 7, { articulation: "slide" }),
  5: tie,
  6: tie,
  7: tie,
  8: guitarHeld(3, 7, { articulation: "vibrato", durationTicks: SLOT_TICKS * 8 }),
  9: tie,
  10: tie,
  11: tie,
  12: tie,
  13: tie,
  14: tie,
  15: tie,
});

/* The bass plays under the same bar, so "did you hear them together" has two
   things to be true about rather than one. */
const SLIDE_BASS = fill({
  0: bassAt(0, 5),
  1: tie,
  2: tie,
  3: tie,
  8: bassAt(1, 5),
  9: tie,
  10: tie,
  11: tie,
});

/*
 * Bar 6 — the legato passage, and everything a repeat has to carry.
 *
 * A hammer-on up and a pull-off back down on the G string, then a strummed
 * power chord that is let to ring, then rests. In one bar: rests, ties,
 * articulation, let-ring, strum, polyphony and an explicit duration — the
 * whole list §10 asks a repeat to preserve, in a place a repeat can reach.
 */
const LEGATO_GUITAR = fill({
  0: guitarAt(3, 5),
  1: tie,
  2: tie,
  3: tie,
  4: guitarHeld(3, 7, { articulation: "hammer_on" }),
  5: tie,
  6: tie,
  7: tie,
  8: guitarHeld(3, 5, { articulation: "pull_off" }),
  9: tie,
  10: tie,
  11: tie,
  12: strummedChord(
    [
      { string: 0, fret: 3 },
      { string: 1, fret: 5 },
      { string: 2, fret: 5 },
    ],
    SLOT_TICKS * 4,
  ),
  /* 13, 14 and 15 stay rests on purpose: a repeat that silently filled them
     would be a repeat that changed the rhythm. */
});

const LEGATO_BASS = fill({ 0: bassAt(1, 3), 4: rest, 8: bassAt(0, 3) });

/* Bar 3 — something to move and duplicate, on a different pair of strings. */
const SECOND_GUITAR = fill({
  0: guitarAt(2, 7),
  6: guitarAt(3, 7),
  10: guitarAt(2, 9),
});

/*
 * The bass of the shared bar — written to be *heard*, not just to exist
 * (2V-B.2 §5).
 *
 * The founder ran 11B on a physical phone and could not tell the second
 * instrument was there at all: possibly audible in headphones, not on the
 * bare speaker. The old part sat on G1 and C2 — fundamentals near 49 Hz and
 * 65 Hz, which a phone speaker cannot reproduce and does not try to. The
 * question was therefore unanswerable rather than failed.
 *
 * Two honest musical changes, and no dishonest ones. First the register: the
 * same walking shape moved onto the D and G strings, so the fundamentals land
 * near 98-131 Hz and — far more importantly on a small speaker — the second
 * and third harmonics land in the band a phone actually radiates. Second the
 * rhythm: the guitar states this bar on the beat, so the bass answers off it.
 * A reader who cannot separate two instruments by timbre on a tinny speaker
 * can still separate them by *when they move*.
 *
 * The downbeat is deliberately kept together with the guitar's power chord.
 * Take that away and the two parts merely alternate, which is a duet nobody
 * has to hear as two things; keeping it means 11B is still asking whether two
 * instruments sound at once.
 *
 * What is not done here: no gain trick, no added click, no octave-doubling to
 * fake presence, and nothing changed outside this fixture. A bass that needed
 * the engine bent to be audible would be telling us about the engine, and
 * this file has no business answering that.
 */
const MOTIF_BASS = fill({
  0: bassAt(2, 5),
  3: bassAt(2, 7),
  6: bassAt(3, 5),
  10: bassAt(2, 7),
  13: bassAt(2, 5),
});
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
          bar(SLIDE_GUITAR, SLIDE_BASS),
          bar(LEGATO_GUITAR, LEGATO_BASS),
        ],
      },
    ],
  };
}
