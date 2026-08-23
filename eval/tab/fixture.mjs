/**
 * The two songs the 2N-A defect reproduction needs (spec 13.20 §0).
 *
 * Deliberately small and deliberately obvious. Every note here exists to make
 * one of the two defects visible on a real screen, and nothing else:
 *
 * - **A chain of three two-note onsets on one string.** Three power-chord
 *   shapes, each hammered onto the one before it across a bar line, so a press
 *   on the middle one can be compared with what the app then selects.
 * - **Two sections whose tab is visibly different.** Different strings,
 *   different frets, different rhythm — so "the label changed but the music
 *   did not" is a claim about drawn notes rather than about a heading.
 */

const GUITAR = ["E2", "A2", "D3", "G3", "B3", "E4"];

export const TRACK_ID = "gtr";

const guitar = () => ({
  id: TRACK_ID,
  name: "Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: GUITAR, capo: 0 },
});

const rest = (count) => Array.from({ length: count }, () => null);

/**
 * One power-chord shape: root on the low string, fifth on the one above.
 *
 * `articulation` lands on the **low** note only, which is where a hand would
 * really hammer. That is enough for the current chain policy to treat the
 * whole onset as chained, and saying so out loud is part of the finding.
 */
const POWER_SHAPES = {
  /* rootFret: [low-string pitch, fifth-string pitch] on standard tuning. */
  0: ["E2", "B2"],
  3: ["G2", "D3"],
  5: ["A2", "E3"],
};

const power = (rootFret, articulation) => {
  const shape = POWER_SHAPES[rootFret];
  if (!shape) throw new Error(`no power-chord shape at fret ${rootFret}`);
  return {
    notes: [
      {
        pitch: shape[0],
        position: { string: 0, fret: rootFret },
        ...(articulation === undefined ? {} : { articulation }),
      },
      { pitch: shape[1], position: { string: 1, fret: rootFret + 2 } },
    ],
  };
};

/** A plain onset on one string, for content that is only there to be seen. */
const single = (stringIndex, fret, pitch) => ({
  notes: [{ pitch, position: { string: stringIndex, fret } }],
});

/** A bar of plain low-string writing, the way Intro Riff reads. */
const LOW_BAR = () => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: {
    [TRACK_ID]: [
      single(0, 0, "E2"),
      null,
      single(0, 3, "G2"),
      null,
      single(0, 5, "A2"),
      null,
      single(0, 3, "G2"),
      null,
    ],
  },
});

/** A bar of Ana Riff: other strings, other frets, other rhythm. */
const HIGH_BAR = () => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: {
    [TRACK_ID]: [
      single(3, 7, "D4"),
      null,
      single(3, 9, "E4"),
      null,
      single(4, 10, "A4"),
      null,
      single(4, 12, "B4"),
      null,
    ],
  },
});

/**
 * Intro Riff carries the chain; Ana Riff is unmistakably different music.
 *
 * The chain crosses a bar line on purpose: a selection that quietly grows over
 * one is the version of the defect a reader actually meets, and a chain inside
 * a single bar would understate it.
 */
export const defectSong = () => ({
  version: 2,
  title: "Kusur Tekrari",
  bpm: 100,
  key: "E minor",
  tracks: [guitar()],
  sections: [
    {
      id: "intro",
      name: "Intro Riff",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            /* Two of the three chained shapes: slots 6 and 7. */
            [TRACK_ID]: [...rest(6), power(0), power(3, "hammer_on")],
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            /* The third, on the far side of the bar line. */
            [TRACK_ID]: [power(5, "hammer_on"), ...rest(7)],
          },
        },
        /*
         * Two more bars of plain low-string writing.
         *
         * They exist so the section is wider than a phone: with one bar each,
         * the tab cannot scroll far enough for the second section to become
         * the first thing on screen, and "which section is the reader looking
         * at" stops being answerable at all.
         */
        LOW_BAR(),
        LOW_BAR(),
      ],
    },
    {
      id: "main",
      name: "Ana Riff",
      status: "fixed",
      bars: [HIGH_BAR(), HIGH_BAR(), HIGH_BAR(), HIGH_BAR()],
    },
  ],
});

/**
 * The same two sections, one bar each.
 *
 * This is the shape the reported symptom actually needs. A song this short
 * cannot scroll far enough to bring the second section to the left edge — the
 * whole piece is barely wider than the phone — so asking for Ana Riff leaves
 * Intro Riff exactly where it was. With four-bar sections the tab does move,
 * and the defect that remains is a different one; both are worth measuring,
 * and conflating them would hide whichever the fixture happened not to show.
 */
export const shortSong = () => ({
  ...defectSong(),
  sections: [
    {
      id: "intro",
      name: "Intro Riff",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            [TRACK_ID]: [...rest(6), power(0), power(3, "hammer_on")],
          },
        },
      ],
    },
    {
      id: "main",
      name: "Ana Riff",
      status: "fixed",
      bars: [HIGH_BAR()],
    },
  ],
});
