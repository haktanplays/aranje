/**
 * The songs the continuous reading surface is measured against (2Q-C §1.1).
 *
 * Generated rather than typed out. Every pitch comes from the track's own
 * tuning and capo through the production helper, every bar's slot count comes
 * from the production timing module, and every song is put through the strict
 * schema and the central validator chain before it is written. A fixture that
 * disagrees with the app measures the fixture.
 *
 * These four exist to make four *different* claims measurable, and each one is
 * shaped by the thing it has to expose:
 *
 * - `normal` — the everyday song, with the four things a follow model can get
 *   wrong quietly: a tempo change, a meter change, a grid change, and a tie
 *   that crosses a section boundary.
 * - `denseDrums` — one section at 1/32 with the whole core kit, which is the
 *   surface 2Q-B measured at 103,6 ms and left as an open debt.
 * - `eightTracks` — the contract's ceiling, mixed renderer kinds, a silent
 *   track and mixed grids, so the Çoklu view is measured at its widest.
 * - `shortSections` — sections of one and two bars, where the scroll content
 *   is shorter than the viewport and a section boundary arrives within
 *   seconds. This is where the pre-2Q-C `data-tab-tail` defects lived.
 *
 *   npx tsx eval/continuous-follow/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { CORE_DRUM_PIECES } from "@/lib/instruments/registry";
import { soundingMidi, TUNING_PRESETS, type Fretboard } from "@/lib/music/fretboard";
import { midiToPitch } from "@/lib/music/pitch";
import { slotCount, type Resolution } from "@/lib/music/timing";
import { songLimits } from "@/lib/limits";
import {
  songSchema,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type NoteEvent,
  type Section,
  type Song,
  type TimeSignature,
  type Track,
} from "@/lib/song/schema";
import { errorsOnly, runValidators, warningsOnly } from "@/lib/validators";

const OUT = "eval/continuous-follow";
mkdirSync(OUT, { recursive: true });

const E_STANDARD = [...TUNING_PRESETS.e_standard!.tuning];
const BASS = [...TUNING_PRESETS.bass_standard!.tuning];

const guitar = (id: string, name: string): Track => ({
  id,
  name,
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: [...E_STANDARD], capo: 0 },
});

const acoustic = (id: string, name: string): Track => ({
  id,
  name,
  instrumentId: "steel_acoustic",
  presetId: "finger",
  volumeDb: -8,
  fretboard: { tuning: [...E_STANDARD], capo: 0 },
});

const bass = (): Track => ({
  id: "bass",
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: [...BASS], capo: 0 },
});

const drums = (): Track => ({
  id: "drums",
  name: "Davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -6,
});

const keys = (): Track => ({
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
});

/** A note on a string and fret, with the pitch that combination really makes. */
function at(
  fretboard: Fretboard,
  string: number,
  fret: number,
  articulation?: NoteEvent["articulation"],
): NoteEvent {
  const midi = soundingMidi(fretboard, { string, fret });
  if (midi === null) throw new Error(`no pitch at ${string}/${fret}`);
  return {
    pitch: midiToPitch(midi),
    velocity: 100,
    ...(articulation ? { articulation } : {}),
    position: { string, fret },
  };
}

const pitched = (pitch: string): NoteEvent => ({ pitch, velocity: 100 });

/* ------------------------------------------------------------------ parts */

type Part = (fretboard: Fretboard, count: number, barIndex: number) => MelodicSlot[];

const rests = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => null);

const rhythmPart: Part = (fb, count) => {
  const slots = rests(count);
  slots[0] = { notes: [at(fb, 0, 0), at(fb, 1, 2), at(fb, 2, 2)] };
  if (count > 2) slots[Math.floor(count / 2)] = { notes: [at(fb, 0, 3), at(fb, 1, 5)] };
  return slots;
};

const leadPart: Part = (fb, count) => {
  const slots = rests(count);
  const first = Math.floor(count / 4);
  const second = Math.floor((3 * count) / 4);
  slots[first] = { notes: [at(fb, 5, 7)] };
  for (let i = first + 1; i < Math.min(second, first + 3); i += 1) slots[i] = "-";
  if (second > first) slots[second] = { notes: [at(fb, 5, 10)] };
  return slots;
};

const bassPart: Part = (fb, count, barIndex) => {
  const slots = rests(count);
  const fret = [0, 3, 5, 10][barIndex % 4]!;
  for (let i = 0; i < count; i += 2) slots[i] = { notes: [at(fb, 0, fret)] };
  return slots;
};

const keysPart: Part = (_fb, count) => {
  const slots = rests(count);
  slots[0] = { notes: [pitched("E3"), pitched("G3"), pitched("B3")] };
  if (count > 2) slots[Math.floor(count / 2)] = { notes: [pitched("D4")] };
  return slots;
};

const PARTS: Record<string, Part> = {
  electric_guitar: rhythmPart,
  steel_acoustic: rhythmPart,
  electric_bass: bassPart,
  piano: keysPart,
};

/** A backbeat that thins out as the grid gets finer, so 1/32 is not a wall. */
function drumPart(count: number): DrumSlot[] {
  const slots: DrumSlot[] = Array.from({ length: count }, (): DrumSlot => []);
  const hatEvery = count >= 24 ? 4 : 2;
  for (let i = 0; i < count; i += hatEvery) {
    slots[i] = [{ piece: "closed_hat", velocity: 90 }];
  }
  slots[0] = [
    { piece: "kick", velocity: 110 },
    { piece: "closed_hat", velocity: 90 },
  ];
  if (count > 2) {
    slots[Math.floor(count / 2)] = [
      { piece: "snare", velocity: 105 },
      { piece: "closed_hat", velocity: 90 },
    ];
  }
  return slots;
}

/**
 * The whole core kit on one bar, so the dense fixture really does draw every
 * row the step grid can offer rather than three of them.
 */
function fullKitPart(count: number, barIndex: number): DrumSlot[] {
  const slots = drumPart(count);
  for (const [index, piece] of CORE_DRUM_PIECES.entries()) {
    const at = (index * 3 + barIndex) % count;
    const existing = slots[at] ?? [];
    if (!existing.some((hit) => hit.piece === piece)) {
      slots[at] = [...existing, { piece, velocity: 96 }];
    }
  }
  return slots;
}

/* ------------------------------------------------------------------ bars */

type BarSpec = {
  readonly timeSignature: TimeSignature;
  readonly resolution: Resolution;
  readonly fullKit?: boolean;
  /** Track ids that carry no key at all in this bar: real spec-5.5 silence. */
  readonly silent?: readonly string[];
};

function barOf(tracks: readonly Track[], spec: BarSpec, barIndex: number): Bar {
  const count = slotCount(spec.timeSignature, spec.resolution);
  const silent = new Set(spec.silent ?? []);
  const slots: Bar["slots"] = {};
  for (const track of tracks) {
    if (silent.has(track.id)) continue;
    if (track.instrumentId === "drum_kit") {
      slots[track.id] = spec.fullKit ? fullKitPart(count, barIndex) : drumPart(count);
      continue;
    }
    const part = track.id.startsWith("lead") ? leadPart : PARTS[track.instrumentId];
    if (!part) throw new Error(`no part for ${track.instrumentId}`);
    slots[track.id] = part(
      track.fretboard ?? { tuning: [...E_STANDARD], capo: 0 },
      count,
      barIndex,
    );
  }
  return {
    timeSignature: [...spec.timeSignature] as TimeSignature,
    resolution: spec.resolution,
    slots,
  };
}

type SectionSpec = {
  readonly id: string;
  readonly name: string;
  readonly bars: readonly BarSpec[];
  readonly bpmOverride?: number;
};

function sectionOf(tracks: readonly Track[], spec: SectionSpec): Section {
  return {
    id: spec.id,
    name: spec.name,
    status: "fixed",
    ...(spec.bpmOverride === undefined ? {} : { bpmOverride: spec.bpmOverride }),
    bars: spec.bars.map((bar, index) => barOf(tracks, bar, index)),
  };
}

function songOf(
  title: string,
  tracks: readonly Track[],
  sections: readonly SectionSpec[],
): Song {
  return {
    version: 2,
    title,
    bpm: 132,
    key: "E minor",
    tracks: tracks.map((track) => ({ ...track })),
    sections: sections.map((section) => sectionOf(tracks, section)),
  };
}

const four = (resolution: Resolution): BarSpec => ({
  timeSignature: [4, 4],
  resolution,
});

/* --------------------------------------------------------------- fixtures */

/**
 * A. The everyday song.
 *
 * Four sections, five tracks, 1/8 and 1/16, a 3/4 section, a tempo change, and
 * a tie that runs off the end of section two into section three.
 */
const normalTracks = [
  guitar("gtr", "Ritim Gitar"),
  guitar("lead", "Solo Gitar"),
  acoustic("acc", "Akustik"),
  bass(),
  drums(),
];

const normal = songOf("Normal Şarkı", normalTracks, [
  { id: "intro", name: "Giriş", bars: [four(8), four(8), four(8), four(8)] },
  { id: "verse", name: "Verse", bars: [four(8), four(16), four(8), four(16)] },
  {
    id: "bridge",
    name: "Köprü",
    bpmOverride: 96,
    bars: [
      { timeSignature: [3, 4], resolution: 12 },
      { timeSignature: [3, 4], resolution: 12 },
      { timeSignature: [3, 4], resolution: 12 },
    ],
  },
  { id: "outro", name: "Final", bars: [four(8), four(8), four(8), four(8)] },
]);

/*
 * The section-crossing tie. Written after the sections exist because it is a
 * fact about two of them: the last slot of "verse" is an onset and the first
 * slot of "bridge" continues it.
 */
{
  const verse = normal.sections[1]!;
  const lastBar = verse.bars[verse.bars.length - 1]!;
  const lane = lastBar.slots["gtr"] as MelodicSlot[];
  lane[lane.length - 1] = { notes: [at(normalTracks[0]!.fretboard!, 0, 0)] };
  const bridge = normal.sections[2]!;
  const firstLane = bridge.bars[0]!.slots["gtr"] as MelodicSlot[];
  firstLane[0] = "-";
}

/**
 * B. The dense kit.
 *
 * One section of eight bars at 1/32 — `barsPerSection` — which is the widest
 * single section the contract allows and the exact surface 2Q-B measured.
 */
const denseDrums = songOf(
  "Yoğun Davul",
  [guitar("gtr", "Ritim Gitar"), drums()],
  [
    {
      id: "dense",
      name: "Yoğun",
      bars: Array.from({ length: songLimits.barsPerSection }, () => ({
        timeSignature: [4, 4] as TimeSignature,
        resolution: 32 as Resolution,
        fullKit: true,
      })),
    },
  ],
);

/**
 * C. The ceiling.
 *
 * Eight tracks — the contract's `maxTracks` — over four sections of eight
 * bars, which is the biggest song this build can hold. Mixed renderer kinds
 * (fretted, drums, pitched), mixed grids and mixed meters, and one track that
 * is written nowhere.
 */
const ceilingTracks = [
  guitar("gtr", "Ritim Gitar"),
  guitar("lead", "Solo Gitar"),
  guitar("gtr-3", "Gitar 3"),
  acoustic("acc", "Akustik"),
  bass(),
  drums(),
  keys(),
  guitar("lead-2", "Solo 2"),
];
if (ceilingTracks.length !== songLimits.maxTracks) {
  throw new Error(
    `the ceiling moved: songLimits.maxTracks is ${songLimits.maxTracks}, fixture has ${ceilingTracks.length}`,
  );
}

const silentEverywhere = ["gtr-3"] as const;
const ceilingBar = (resolution: Resolution, timeSignature: TimeSignature): BarSpec => ({
  timeSignature,
  resolution,
  silent: silentEverywhere,
});

const eightTracks = songOf("Sekiz Track", ceilingTracks, [
  {
    id: "s1",
    name: "Giriş",
    bars: Array.from({ length: 8 }, (_, index) =>
      ceilingBar(index % 2 === 0 ? 8 : 16, [4, 4]),
    ),
  },
  {
    id: "s2",
    name: "Nakarat",
    bars: Array.from({ length: 8 }, () => ceilingBar(16, [4, 4])),
  },
  {
    id: "s3",
    name: "Köprü",
    bpmOverride: 150,
    bars: Array.from({ length: 8 }, () => ceilingBar(8, [7, 8])),
  },
  {
    id: "s4",
    name: "Final",
    bars: Array.from({ length: 8 }, (_, index) =>
      ceilingBar(index % 3 === 0 ? 12 : 8, [3, 4]),
    ),
  },
]);

/**
 * D. Short sections.
 *
 * Sections of one and two bars: the scroll content is shorter than a phone
 * viewport, and playback crosses a boundary every couple of seconds.
 */
const shortSections = songOf(
  "Kısa Bölümler",
  [guitar("gtr", "Ritim Gitar"), bass(), drums()],
  [
    { id: "a", name: "A", bars: [four(8)] },
    { id: "b", name: "B", bars: [four(8), four(8)] },
    { id: "c", name: "C", bars: [four(16)] },
    { id: "d", name: "D", bars: [four(8), four(8)] },
    { id: "e", name: "E", bpmOverride: 180, bars: [four(8)] },
  ],
);

/* ----------------------------------------------------------------- the gate */

const SONGS: Record<string, Song> = { normal, denseDrums, eightTracks, shortSections };

const report: Record<string, unknown> = {};
let failed = 0;
for (const [name, song] of Object.entries(SONGS)) {
  const parsed = songSchema.safeParse(song);
  if (!parsed.success) {
    failed += 1;
    console.log(`FAIL ${name}: schema — ${parsed.error.issues[0]?.message}`);
    continue;
  }
  const issues = runValidators(parsed.data);
  const errors = errorsOnly(issues);
  if (errors.length > 0) {
    failed += 1;
    console.log(`FAIL ${name}: ${errors.map((issue) => issue.code).join(", ")}`);
    continue;
  }
  const warnings = warningsOnly(issues);
  report[name] = {
    tracks: song.tracks.length,
    sections: song.sections.length,
    bars: song.sections.reduce((total, section) => total + section.bars.length, 0),
    slots: song.sections.reduce(
      (total, section) =>
        total +
        section.bars.reduce(
          (bars, bar) => bars + slotCount(bar.timeSignature, bar.resolution),
          0,
        ),
      0,
    ),
    // Reported, never suppressed: a warning is a fact about the music, and a
    // fixture patched to silence one would measure the patch.
    warnings: warnings.map((issue) => issue.code),
  };
  console.log(
    `ok   ${name}${warnings.length > 0 ? `  (uyarı: ${warnings.map((w) => w.code).join(", ")})` : ""}`,
  );
}

writeFileSync(`${OUT}/fixtures.json`, `${JSON.stringify(SONGS, null, 2)}\n`);
writeFileSync(`${OUT}/fixtures-report.json`, `${JSON.stringify(report, null, 2)}\n`);
if (failed > 0) process.exit(1);
