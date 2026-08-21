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
 * - Bar 2 is a 1/16 bar next to a 1/8 one, so a move crosses a grid change.
 * - Bar 3 is a 1/8 triplet, so an inexpressible destination can be reached.
 * - One guitar is in Drop D, one is capoed.
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
            gtr: pad([power, rest, rest, rest, single("G3", 3, 0), rest, rest, rest], 8),
            "gtr-drop": pad([single("D2", 0, 0), rest, rest, rest], 8),
            "gtr-capo": pad([single("A3", 1, 10), rest, rest, rest], 8),
          },
        },
        // A finer grid immediately after, so a move crosses a grid change.
        {
          timeSignature: [4, 4],
          resolution: 16,
          slots: {
            gtr: pad([single("A3", 1, 12), rest, rest, rest], 16),
            "gtr-drop": pad([], 16),
            "gtr-capo": pad([], 16),
          },
        },
        // A triplet grid, where a straight moment cannot be expressed.
        {
          timeSignature: [4, 4],
          resolution: 12,
          slots: {
            gtr: pad([single("B3", 2, 9), rest, rest], 12),
            "gtr-drop": pad([], 12),
            "gtr-capo": pad([], 12),
          },
        },
        { timeSignature: [4, 4], resolution: 8, slots: { gtr: pad([], 8), "gtr-drop": pad([], 8), "gtr-capo": pad([], 8) } },
      ],
    },
  ],
});

writeFileSync("eval/selection-ui/fixture-song.json", `${JSON.stringify(song)}\n`);
console.log(
  `fixture: ${song.tracks.length} tracks, ${song.sections[0]?.bars.length} bars, ` +
    `grids ${song.sections[0]?.bars.map((bar) => bar.resolution).join("/")}`,
);
