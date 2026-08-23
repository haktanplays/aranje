/**
 * The songs the 2N-A acceptance suite reads (spec 13.20 §9).
 *
 * Each one exists to make a specific claim checkable on a real screen, and
 * they are deliberately separate: a single "everything" song would make every
 * scenario depend on parts of it that have nothing to do with what it is
 * measuring, and one broken fixture would take the whole run with it.
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

const drums = () => ({
  id: "drums",
  name: "Davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -4,
});

/** Low-string pitches that agree with their frets, so validators are quiet. */
const LOW = { 0: "E2", 3: "G2", 5: "A2", 7: "B2" };

export const note = (fret) => ({
  notes: [{ pitch: LOW[fret], position: { string: 0, fret } }],
});

export const rest = (count) => Array.from({ length: count }, () => null);

const bar = (resolution, slots, timeSignature = [4, 4]) => ({
  timeSignature,
  resolution,
  slots: { [TRACK_ID]: slots },
});

const section = (id, name, bars) => ({ id, name, status: "fixed", bars });

const base = (sections, tracks = [guitar()]) => ({
  version: 2,
  title: "2N-A kabul",
  bpm: 100,
  key: "E minor",
  tracks,
  sections,
});

/* ------------------------------------------------------------ selection */

const POWER = {
  0: ["E2", "B2"],
  3: ["G2", "D3"],
  5: ["A2", "E3"],
};

/** A power-chord shape; `articulation` lands on the low note, as a hand would. */
export const power = (rootFret, articulation) => ({
  notes: [
    {
      pitch: POWER[rootFret][0],
      position: { string: 0, fret: rootFret },
      ...(articulation === undefined ? {} : { articulation }),
    },
    { pitch: POWER[rootFret][1], position: { string: 1, fret: rootFret + 2 } },
  ],
});

/**
 * Three two-note shapes hammered into a chain, plus a plain single note and a
 * plain chord that are connected to nothing.
 *
 * Slot 0 is the unconnected note, slot 2 the unconnected chord, and slots 4-6
 * the chain — so a scenario can press any of the three cases by name.
 */
export const selectionSong = () =>
  base([
    section("intro", "Intro Riff", [
      bar(8, [
        note(0),
        null,
        power(3),
        null,
        power(0),
        power(3, "hammer_on"),
        power(5, "hammer_on"),
        null,
      ]),
      bar(8, rest(8)),
    ]),
    section("main", "Ana Riff", [bar(8, [note(5), ...rest(7)])]),
  ]);

/* -------------------------------------------------------------- sections */

/** Four bars each, so a jump is a real scroll. */
export const twoSections = () =>
  base([
    section(
      "intro",
      "Intro Riff",
      Array.from({ length: 4 }, () => bar(8, [note(0), null, note(3), null, note(5), null, note(3), null])),
    ),
    section(
      "main",
      "Ana Riff",
      Array.from({ length: 4 }, () => bar(8, [note(7), null, note(5), null, note(3), null, note(0), null])),
    ),
  ]);

/** One bar each: the scroll cannot reach the second section without the tail. */
export const shortTwoSections = () =>
  base([
    section("intro", "Intro Riff", [bar(8, [note(0), ...rest(7)])]),
    section("main", "Ana Riff", [bar(8, [note(7), ...rest(7)])]),
  ]);

/* ---------------------------------------------------------------- rhythm */

/**
 * One bar of each grid worth drawing, plus 6/8 and 7/8 sections.
 *
 * Bar 0 is 1/4 (four cells), bar 1 sixteenths with a rest in the middle, bar 2
 * eighth triplets, bar 3 thirty-seconds.
 */
export const rhythmSong = () =>
  base([
    section("grids", "Gridler", [
      bar(4, [note(0), note(3), note(5), note(3)]),
      bar(16, [
        note(0),
        note(3),
        note(5),
        note(3),
        null,
        note(0),
        note(3),
        note(5),
        ...rest(8),
      ]),
      bar(12, Array.from({ length: 12 }, (_, index) => note([0, 3, 5][index % 3]))),
      bar(32, [...Array.from({ length: 8 }, (_, index) => note(index % 2 === 0 ? 0 : 3)), ...rest(24)]),
    ]),
    section("compound", "Altı Sekiz", [bar(16, [...Array.from({ length: 12 }, () => null)], [6, 8])]),
    section("odd", "Yedi Sekiz", [bar(16, [...Array.from({ length: 14 }, () => null)], [7, 8])]),
  ]);

/** A 1/16 bar whose notes are held by ties: one onset, one beam group. */
export const tiedSong = () =>
  base([
    section("s1", "Tie", [
      bar(16, [note(0), "-", note(3), "-", note(5), "-", note(3), "-", ...rest(8)]),
    ]),
  ]);

/* ---------------------------------------------------------------- timing */

/**
 * Four bars that each make one refusal or one success checkable.
 *
 * - `s1:0` quarters at 1/16 on the first three beats, so it can become 1/8 and
 *   can become 3/4: the two successes.
 * - `s1:1` eighths with a note on the fourth beat, so it cannot become a
 *   triplet grid (the moment falls between slots) and cannot become 3/4 (the
 *   note has nowhere to go): the two refusals, one of each kind.
 * - `s1:2` fills its 3/4 and is tied into `s1:3`, so lengthening it would
 *   leave that tie continuing nothing: the chain refusal.
 *
 * `s2` is three plain bars with nothing across their lines, so a section-wide
 * change has somewhere it really succeeds. The drum track is there so a
 * section change has two tracks to agree about.
 */
export const timingSong = () =>
  base(
    [
      section("s1", "Ölçüler", [
        {
          timeSignature: [4, 4],
          resolution: 16,
          slots: {
            [TRACK_ID]: [
              note(0), "-", "-", "-",
              note(3), "-", "-", "-",
              note(5), "-", "-", "-",
              null, null, null, null,
            ],
            drums: [
              [{ piece: "kick" }], [], [], [],
              [{ piece: "snare" }], [], [], [],
              [{ piece: "kick" }], [], [], [],
              [], [], [], [],
            ],
          },
        },
        bar(8, [note(0), null, note(3), null, note(5), null, note(3), null]),
        {
          timeSignature: [3, 4],
          resolution: 8,
          slots: { [TRACK_ID]: [null, null, null, null, note(0), "-"] },
        },
        {
          timeSignature: [3, 4],
          resolution: 8,
          slots: { [TRACK_ID]: ["-", null, null, null, null, null] },
        },
      ]),
      section("s2", "Dönüşen", [
        bar(8, [note(0), null, note(3), null, note(5), null, note(3), null]),
        bar(8, [note(5), null, note(3), null, note(0), null, note(3), null]),
        bar(8, [note(0), null, note(0), null, note(3), null, note(3), null]),
      ]),
    ],
    [guitar(), drums()],
  );
