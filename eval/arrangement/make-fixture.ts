/**
 * A song big enough to tell the truth about the arrangement view.
 *
 * The demo song cannot test this checkpoint: it is short, single-metered, and
 * has neither a repeated bar nor a note held over a bar line, so the three
 * things the overview exists to show would all be absent. Every property below
 * is here because a scenario needs it, and each one is written where a test can
 * name it:
 *
 * - **32 bars, 8 tracks** — 256 cells, the size the performance claim is about.
 * - **Four sections**, two of them at their own tempo, so a tempo step has a
 *   boundary to be drawn at and the "tempo is not width" rule has something to
 *   be wrong about.
 * - **Section 3 is in 6/8**, so a narrower bar sits next to a wider one and the
 *   meter-to-width rule is visible rather than merely asserted.
 * - **Mixed resolutions** inside one section: 1/8 next to 1/16 next to a 1/12
 *   triplet, all the same width, which is the rule that is easiest to break.
 * - **A whole silent track** and silent bars inside sounding tracks.
 * - **An exact repeat** — bar 3 of the riff returns unchanged as bar 7.
 * - **A tie across a bar line** and **a tie across a section boundary**.
 * - **A hammer-on** whose source note is in the bar before it.
 *
 * `npx tsx eval/arrangement/make-fixture.ts`
 */
import { writeFileSync } from "node:fs";

import {
  songSchema,
  type Articulation,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Section,
  type Song,
  type Track,
} from "@/lib/song/schema";
import { TUNING_PRESETS } from "@/lib/music/fretboard";

const rest: MelodicSlot = null;
const tie: MelodicSlot = "-";

const note = (
  pitch: string,
  string: number,
  fret: number,
  extra: Partial<{ articulation: Articulation; velocity: number }> = {},
): MelodicSlot => ({
  notes: [
    {
      pitch,
      position: { string, fret },
      velocity: extra.velocity ?? 100,
      ...(extra.articulation ? { articulation: extra.articulation } : {}),
    },
  ],
});

const chord = (
  entries: readonly (readonly [string, number, number])[],
): MelodicSlot => ({
  notes: entries.map(([pitch, string, fret]) => ({
    pitch,
    position: { string, fret },
    velocity: 104,
  })),
});

/** Fill a slot map so only the named indices sound. */
const at = (
  count: number,
  written: Readonly<Record<number, MelodicSlot>>,
): MelodicSlot[] => Array.from({ length: count }, (_, i) => written[i] ?? rest);

const silence = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => rest);

const drums = (
  count: number,
  written: Readonly<Record<number, DrumSlot>>,
): DrumSlot[] => Array.from({ length: count }, (_, i) => written[i] ?? []);

const TRACK_IDS = [
  "rhythm",
  "lead",
  "harmony",
  "clean",
  "acoustic",
  "nylon",
  "bass",
  "drums",
] as const;

const tracks: Track[] = [
  {
    id: "rhythm",
    name: "Ritim Gitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    volumeDb: -4,
    fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 0 },
  },
  {
    id: "lead",
    name: "Solo Gitar",
    instrumentId: "electric_guitar",
    presetId: "crunch",
    volumeDb: -6,
    pan: 0.25,
    fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 0 },
  },
  {
    id: "harmony",
    name: "Armoni",
    instrumentId: "electric_guitar",
    presetId: "clean",
    volumeDb: -8,
    pan: -0.25,
    fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 0 },
  },
  {
    id: "clean",
    name: "Temiz Gitar",
    instrumentId: "electric_guitar",
    presetId: "clean",
    volumeDb: -9,
    fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 0 },
  },
  {
    id: "acoustic",
    name: "Akustik",
    instrumentId: "steel_acoustic",
    presetId: "finger",
    volumeDb: -7,
    fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 2 },
  },
  {
    id: "nylon",
    name: "Klasik Gitar",
    instrumentId: "nylon_guitar",
    presetId: "warm",
    volumeDb: -8,
    fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 0 },
  },
  {
    id: "bass",
    name: "Bas",
    instrumentId: "electric_bass",
    presetId: "finger",
    volumeDb: -5,
    fretboard: { tuning: [...(TUNING_PRESETS.bass_standard?.tuning ?? [])], capo: 0 },
  },
  {
    id: "drums",
    name: "Davul",
    instrumentId: "drum_kit",
    presetId: "metal",
    volumeDb: -3,
  },
];

/** A bar carrying only the tracks named; anything absent is silence. */
function bar(
  timeSignature: [4, 4] | [6, 8],
  resolution: 8 | 12 | 16,
  slots: Record<string, MelodicSlot[] | DrumSlot[]>,
): Bar {
  return { timeSignature, resolution, slots };
}

const RIFF_A = (count: number) =>
  at(count, {
    0: chord([
      ["E2", 0, 0],
      ["B2", 1, 2],
    ]),
    2: note("E2", 0, 0),
    3: note("G2", 0, 3),
    4: chord([
      ["E2", 0, 0],
      ["B2", 1, 2],
    ]),
    6: note("D3", 2, 0),
  });

const RIFF_B = (count: number) =>
  at(count, {
    0: note("A2", 1, 0),
    2: note("C3", 1, 3),
    4: note("E3", 2, 2),
    6: note("G3", 3, 0),
  });

const BEAT = (count: number) =>
  drums(count, {
    0: [{ piece: "kick" }, { piece: "closed_hat" }],
    2: [{ piece: "closed_hat" }],
    4: [{ piece: "snare" }, { piece: "closed_hat" }],
    6: [{ piece: "closed_hat" }],
  });

const BASS_A = (count: number) =>
  at(count, { 0: note("E1", 0, 0), 4: note("E1", 0, 0) });

/*
 * Section 1 — Giriş. Eight 4/4 bars at the song's own tempo.
 *
 * Bar 3 and bar 7 are the same bar, written by the same call: that is the
 * exact repeat the overview has to notice. Bar 8 holds a note into section 2,
 * so a carry has a section seam to survive.
 */
const intro: Bar[] = [
  bar([4, 4], 8, { rhythm: RIFF_A(8), drums: BEAT(8), bass: BASS_A(8) }),
  bar([4, 4], 8, { rhythm: RIFF_B(8), drums: BEAT(8), bass: BASS_A(8) }),
  bar([4, 4], 8, { rhythm: RIFF_A(8), drums: BEAT(8), bass: BASS_A(8) }),
  // A bar nobody plays but the drums.
  bar([4, 4], 8, { drums: BEAT(8) }),
  bar([4, 4], 16, { rhythm: RIFF_A(16), drums: BEAT(16), bass: BASS_A(16) }),
  // A triplet bar, the same width as its straight neighbours.
  bar([4, 4], 12, { rhythm: RIFF_B(12), drums: BEAT(12), bass: BASS_A(12) }),
  bar([4, 4], 8, { rhythm: RIFF_A(8), drums: BEAT(8), bass: BASS_A(8) }),
  bar([4, 4], 8, {
    // Struck once and held to the end, over the section boundary.
    rhythm: [chord([["E2", 0, 0], ["B2", 1, 2]]), tie, tie, tie, tie, tie, tie, tie],
    drums: BEAT(8),
    bass: BASS_A(8),
  }),
];

/* Section 2 — Nakarat, at its own faster tempo. Opens on the carried tie. */
const chorus: Bar[] = [
  bar([4, 4], 8, {
    rhythm: [tie, tie, rest, rest, ...silence(4)],
    lead: at(8, { 4: note("E4", 5, 0) }),
    drums: BEAT(8),
    bass: BASS_A(8),
  }),
  ...Array.from({ length: 6 }, (_, index) =>
    bar([4, 4], 8, {
      rhythm: RIFF_B(8),
      lead: at(8, { 0: note("G4", 5, 3), 4: note("B4", 5, 7) }),
      harmony: index % 2 === 0 ? at(8, { 0: note("B3", 4, 0) }) : silence(8),
      drums: BEAT(8),
      bass: BASS_A(8),
    }),
  ),
  bar([4, 4], 8, {
    // The last bar sets up a hammer-on that lands in the next section.
    lead: at(8, { 7: note("G4", 3, 12) }),
    rhythm: RIFF_B(8),
    drums: BEAT(8),
    bass: BASS_A(8),
  }),
];

/* Section 3 — Köprü, in 6/8 and slow. Narrower bars, by the meter alone. */
const bridge: Bar[] = [
  bar([6, 8], 8, {
    // Arrives on a hammer-on from the bar before, across the section seam.
    lead: at(6, { 0: note("A4", 3, 14, { articulation: "hammer_on" }) }),
    acoustic: at(6, { 0: note("A3", 1, 10), 3: note("D4", 2, 10) }),
  }),
  ...Array.from({ length: 7 }, () =>
    bar([6, 8], 8, {
      acoustic: at(6, { 0: note("A3", 1, 10), 3: note("D4", 2, 10) }),
      nylon: at(6, { 0: note("E3", 2, 2) }),
    }),
  ),
];

/* Section 4 — Final. Back to the song's own tempo, everything playing. */
const outro: Bar[] = Array.from({ length: 8 }, (_, index) =>
  bar([4, 4], 8, {
    rhythm: RIFF_A(8),
    lead: at(8, { 0: note("E4", 5, 0), 4: note("G4", 5, 3) }),
    harmony: at(8, { 0: note("B3", 4, 0) }),
    acoustic: index < 4 ? silence(8) : at(8, { 0: note("A3", 1, 10) }),
    drums: BEAT(8),
    bass: BASS_A(8),
  }),
);

const sections: Section[] = [
  { id: "intro", name: "Giriş", status: "fixed", bars: intro },
  { id: "chorus", name: "Nakarat", status: "fixed", bpmOverride: 168, bars: chorus },
  { id: "bridge", name: "Köprü", status: "fixed", bpmOverride: 84, bars: bridge },
  { id: "outro", name: "Final", status: "fixed", bars: outro },
];

const song: Song = songSchema.parse({
  version: 2,
  title: "Düzen Fixture",
  bpm: 138,
  key: "E minor",
  tracks,
  sections,
});

writeFileSync("eval/arrangement/fixture-song.json", `${JSON.stringify(song)}\n`);

const barCount = song.sections.reduce((sum, s) => sum + s.bars.length, 0);
console.log(
  `fixture: ${song.tracks.length} tracks, ${barCount} bars, ` +
    `${song.tracks.length * barCount} cells, ` +
    `sections ${song.sections.map((s) => `${s.name}@${s.bpmOverride ?? song.bpm}`).join(" ")}`,
);
/* The "clean" track is written nowhere on purpose: a track silent throughout. */
void TRACK_IDS;
