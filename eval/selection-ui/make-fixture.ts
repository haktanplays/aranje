/**
 * A song built for the selection tests, not for listening (spec 13.1, K-37).
 *
 * The demo song cannot exercise this checkpoint. Its bars are fully written, so
 * every time move is refused for a real reason and the "one write per commit"
 * claim has nowhere to land; it has no power chord, so shape translation cannot
 * be tried; and it has no alternate tuning or capo, so the fretboard arithmetic
 * is never stressed.
 *
 * So this fixture is deliberately sparse and deliberately odd:
 *
 * - Bar 1 holds a power chord and then rests, so a shape can move and a chord
 *   can be selected as a group.
 * - Bar 1 also holds a hammer-on pair, so touching one end of a legato chain
 *   has a chain to grow into.
 * - Bar 2 is a 1/8 triplet, so an inexpressible destination can be reached.
 * - Bars 3 and 4 share a 1/16 grid, so "repeat to the end of the section" has
 *   a stretch it can actually be written into. The triplet bar sits *before*
 *   them on purpose: a fill that had to cross it would be refused for a real
 *   reason, and a scenario cannot show a feature working by watching it be
 *   correctly refused.
 * - One guitar is in Drop D, one is capoed, and both hold a two-note shape
 *   rather than a single note, so a shape really has a shape to move.
 *
 * **No two bars put an onset on the same slot index.** That is not tidiness:
 * the tab marks cells `data-cell="slot:string"` without saying which bar they
 * are in, so overlapping slot indices leave a test with no way to name the
 * note it means. Disjoint indices make every onset addressable — bar 1 owns
 * slots 0, 4, 6 and 7, bar 2 owns 3, bar 3 owns 2, and bar 4 is empty.
 *
 * `npx tsx eval/selection-ui/make-fixture.ts`
 */
import { writeFileSync } from "node:fs";

import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { TUNING_PRESETS } from "@/lib/music/fretboard";

const rest: MelodicSlot = null;

/** Root, fifth and octave struck together — a power chord shape, no new type. */
const power: MelodicSlot = {
  notes: [
    { pitch: "E2", position: { string: 0, fret: 0 }, velocity: 112 },
    { pitch: "B2", position: { string: 1, fret: 2 }, velocity: 104 },
    { pitch: "E3", position: { string: 2, fret: 2 }, velocity: 98, articulation: "accent" },
  ],
};

const single = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret }, velocity: 100 }],
});

/** The second half of a hammer-on: it only sounds because of the note before. */
const hammered = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [
    { pitch, position: { string, fret }, velocity: 100, articulation: "hammer_on" },
  ],
});

/** Two notes struck together, so "move the shape" has a shape to move. */
const shape = (
  a: readonly [string, number, number],
  b: readonly [string, number, number],
): MelodicSlot => ({
  notes: [
    { pitch: a[0], position: { string: a[1], fret: a[2] }, velocity: 104 },
    { pitch: b[0], position: { string: b[1], fret: b[2] }, velocity: 98 },
  ],
});

/** A slot map with everything at rest except the given slot indices. */
const at = (count: number, written: Readonly<Record<number, MelodicSlot>>): MelodicSlot[] =>
  Array.from({ length: count }, (_, index) => written[index] ?? rest);

const pad = (written: readonly MelodicSlot[], count: number): MelodicSlot[] => [
  ...written,
  ...Array.from({ length: count - written.length }, () => rest),
];

const song: Song = songSchema.parse({
  version: 2,
  title: "Seçim Fixture",
  bpm: 120,
  key: "E minor",
  tracks: [
    {
      id: "gtr",
      name: "Gitar 1",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: -4,
      fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 0 },
    },
    {
      id: "gtr-drop",
      name: "Drop D",
      instrumentId: "electric_guitar",
      presetId: "crunch",
      volumeDb: -5,
      pan: -0.3,
      fretboard: { tuning: [...(TUNING_PRESETS.drop_d?.tuning ?? [])], capo: 0 },
    },
    {
      id: "gtr-capo",
      name: "Capo 2",
      instrumentId: "steel_acoustic",
      presetId: "finger",
      volumeDb: -5,
      pan: 0.3,
      fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 2 },
    },
  ],
  sections: [
    {
      id: "sec-1",
      name: "Seçim",
      status: "fixed",
      bars: [
        // Sparse on purpose: room to move, duplicate and repeat into.
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: at(8, {
              0: power,
              4: single("G3", 3, 0),
              6: single("D4", 3, 7),
              7: hammered("E4", 3, 9),
            }),
            // Drop D: root and fifth on the two lowest strings, both open.
            "gtr-drop": at(8, { 0: shape(["D2", 0, 0], ["A2", 1, 0]) }),
            // Capo 2: the written fret is above the capo, so 10 sounds an octave.
            "gtr-capo": at(8, { 0: shape(["A3", 1, 10], ["D4", 2, 10]) }),
          },
        },
        // A triplet grid right after a straight one, so a move crosses a grid
        // change and a straight moment has somewhere it cannot be written.
        {
          timeSignature: [4, 4],
          resolution: 12,
          slots: {
            gtr: at(12, { 3: single("B3", 2, 9) }),
            "gtr-drop": pad([], 12),
            "gtr-capo": pad([], 12),
          },
        },
        // Two 1/16 bars: one note, then room to repeat into.
        {
          timeSignature: [4, 4],
          resolution: 16,
          slots: {
            gtr: at(16, { 2: single("A3", 1, 12) }),
            "gtr-drop": pad([], 16),
            "gtr-capo": pad([], 16),
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 16,
          slots: {
            gtr: pad([], 16),
            "gtr-drop": pad([], 16),
            "gtr-capo": pad([], 16),
          },
        },
      ],
    },
  ],
});

writeFileSync("eval/selection-ui/fixture-song.json", `${JSON.stringify(song)}\n`);
console.log(
  `fixture: ${song.tracks.length} tracks, ${song.sections[0]?.bars.length} bars, ` +
    `grids ${song.sections[0]?.bars.map((bar) => bar.resolution).join("/")}`,
);
