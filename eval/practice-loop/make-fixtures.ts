/**
 * The songs the practice loop and the dense drum grid are measured against
 * (2R-A §5.1).
 *
 * Generated rather than typed out. Every pitch comes from the track's own
 * tuning through the production helper, every slot count comes from the
 * production timing module, and every song is put through the strict schema
 * and the central validator chain before it is written. A fixture that
 * disagrees with the app measures the fixture.
 *
 * Two songs, because two different claims have to be measurable:
 *
 * - `denseKit` — the contract's ceiling in both directions: eight tracks and
 *   thirty-two bars, with one section of eight 4/4 bars at 1/32 carrying the
 *   whole core kit plus the extra pieces the song actually uses. This is the
 *   surface 2Q-B measured at 103,6 ms and 2Q-C left open at ~100 ms.
 * - `practiceSong` — four sections whose meters are 4/4, 3/4, 6/8 and 7/8, so
 *   the count-in has a real bar of each to count, plus a tie that runs across
 *   a bar line and one that runs across a section boundary, so the practice
 *   range's tie preflight has something true to find.
 *
 *   npx tsx eval/practice-loop/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { CORE_DRUM_PIECES, DRUM_PIECES } from "@/lib/instruments/registry";
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

const OUT = "eval/practice-loop";
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

const bass = (id = "bass", name = "Bas"): Track => ({
  id,
  name,
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
function at(fretboard: Fretboard, string: number, fret: number): NoteEvent {
  const midi = soundingMidi(fretboard, { string, fret });
  if (midi === null) throw new Error(`no pitch at ${string}/${fret}`);
  return { pitch: midiToPitch(midi), velocity: 100, position: { string, fret } };
}

const pitched = (pitch: string): NoteEvent => ({ pitch, velocity: 100 });

const rests = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => null);

/* ------------------------------------------------------------------ parts */

/** A busy fretted part: an onset every other slot, so the lane is not sparse. */
function busyFretted(fb: Fretboard, count: number, barIndex: number): MelodicSlot[] {
  const slots = rests(count);
  const frets = [0, 3, 5, 7, 10];
  for (let i = 0; i < count; i += 2) {
    const fret = frets[(i / 2 + barIndex) % frets.length]!;
    slots[i] = { notes: [at(fb, 0, fret), at(fb, 1, fret + 2)] };
  }
  return slots;
}

function busyBass(fb: Fretboard, count: number, barIndex: number): MelodicSlot[] {
  const slots = rests(count);
  const fret = [0, 3, 5, 10][barIndex % 4]!;
  for (let i = 0; i < count; i += 2) slots[i] = { notes: [at(fb, 0, fret)] };
  return slots;
}

function busyKeys(count: number): MelodicSlot[] {
  const slots = rests(count);
  slots[0] = { notes: [pitched("E3"), pitched("G3"), pitched("B3")] };
  if (count > 4) slots[Math.floor(count / 4)] = { notes: [pitched("D4")] };
  if (count > 2) slots[Math.floor(count / 2)] = { notes: [pitched("C4"), pitched("E4")] };
  return slots;
}

/**
 * The kit at its densest, and honestly mixed.
 *
 * Every core piece is present, three pieces beyond the core are *used* by the
 * song (so the step grid draws rows for them too), the three hit strengths all
 * appear, velocities differ, and roughly half the cells stay empty — a wall of
 * filled cells would measure a different surface than a real one.
 */
function denseKitBar(count: number, barIndex: number): DrumSlot[] {
  const slots: DrumSlot[] = Array.from({ length: count }, (): DrumSlot => []);
  const push = (
    index: number,
    piece: (typeof DRUM_PIECES)[number],
    velocity: number,
    articulation?: "normal" | "ghost" | "accent",
  ) => {
    const target = index % count;
    const existing = slots[target] ?? [];
    if (existing.some((hit) => hit.piece === piece)) return;
    slots[target] = [
      ...existing,
      { piece, velocity, ...(articulation ? { articulation } : {}) },
    ];
  };

  // A sixteenth-note hat pattern on a thirty-second grid: every other cell.
  for (let i = 0; i < count; i += 2) {
    const ghost = i % 8 !== 0;
    push(i, "closed_hat", ghost ? 62 : 96, ghost ? "ghost" : "normal");
  }
  // Kick and snare on the backbeat, accented.
  push(0, "kick", 118, "accent");
  push(Math.floor(count / 2), "snare", 112, "accent");
  push(Math.floor(count / 4), "kick", 88);
  push(Math.floor((3 * count) / 4), "snare", 70, "ghost");
  // The rest of the core kit, moved around so it is not the same cell twice.
  for (const [index, piece] of CORE_DRUM_PIECES.entries()) {
    push(index * 5 + barIndex * 3, piece, 90 + index * 4);
  }
  // Three pieces beyond the core, so the grid has rows the core does not give.
  push(barIndex * 2 + 1, "tom_high", 84);
  push(barIndex * 2 + 9, "tom_floor", 92, "accent");
  push(barIndex * 2 + 17, "open_hat", 78, "ghost");
  return slots;
}

/** A calmer kit for the practice fixture: readable, not a wall. */
function plainKitBar(count: number): DrumSlot[] {
  const slots: DrumSlot[] = Array.from({ length: count }, (): DrumSlot => []);
  const every = count >= 12 ? 2 : 1;
  for (let i = 0; i < count; i += every) {
    slots[i] = [{ piece: "closed_hat", velocity: 88 }];
  }
  slots[0] = [
    { piece: "kick", velocity: 112, articulation: "accent" },
    { piece: "closed_hat", velocity: 88 },
  ];
  if (count > 2) {
    slots[Math.floor(count / 2)] = [
      { piece: "snare", velocity: 106 },
      { piece: "closed_hat", velocity: 88 },
    ];
  }
  return slots;
}

/* ------------------------------------------------------------------ bars */

type BarSpec = {
  readonly timeSignature: TimeSignature;
  readonly resolution: Resolution;
  readonly denseKit?: boolean;
};

function barOf(tracks: readonly Track[], spec: BarSpec, barIndex: number): Bar {
  const count = slotCount(spec.timeSignature, spec.resolution);
  const slots: Bar["slots"] = {};
  for (const track of tracks) {
    if (track.instrumentId === "drum_kit") {
      slots[track.id] = spec.denseKit ? denseKitBar(count, barIndex) : plainKitBar(count);
      continue;
    }
    if (track.instrumentId === "piano") {
      slots[track.id] = busyKeys(count);
      continue;
    }
    const fb = track.fretboard ?? { tuning: [...E_STANDARD], capo: 0 };
    slots[track.id] =
      track.instrumentId === "electric_bass"
        ? busyBass(fb, count, barIndex)
        : busyFretted(fb, count, barIndex);
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
    sections: sections.map(
      (spec): Section => ({
        id: spec.id,
        name: spec.name,
        status: "fixed",
        ...(spec.bpmOverride === undefined ? {} : { bpmOverride: spec.bpmOverride }),
        bars: spec.bars.map((bar, index) => barOf(tracks, bar, index)),
      }),
    ),
  };
}

const four = (resolution: Resolution): BarSpec => ({
  timeSignature: [4, 4],
  resolution,
});

/* --------------------------------------------------------------- fixtures */

/**
 * A. The ceiling, with the densest kit the contract allows.
 *
 * Eight tracks (`maxTracks`) over four sections of eight bars (`totalBars`).
 * The first section is the one this checkpoint is about: eight 4/4 bars at
 * 1/32, which is 256 columns and, with the rows the song's own kit produces,
 * a little over two thousand cells.
 */
const denseTracks: readonly Track[] = [
  guitar("gtr", "Ritim Gitar"),
  guitar("gtr-2", "Ritim Gitar 2"),
  guitar("lead", "Solo Gitar"),
  acoustic("acc", "Akustik"),
  bass(),
  bass("bass-2", "Bas 2"),
  keys(),
  drums(),
];

const perSection = songLimits.barsPerSection;
const denseKit = songOf("Yoğun Kit", denseTracks, [
  {
    id: "dense",
    name: "Yoğun",
    bars: Array.from({ length: perSection }, () => ({
      timeSignature: [4, 4] as TimeSignature,
      resolution: 32 as Resolution,
      denseKit: true,
    })),
  },
  {
    id: "verse",
    name: "Verse",
    bars: Array.from({ length: perSection }, (_, index) => four(index % 2 ? 16 : 8)),
  },
  {
    id: "bridge",
    name: "Köprü",
    bpmOverride: 108,
    bars: Array.from({ length: perSection }, () => ({
      timeSignature: [3, 4] as TimeSignature,
      resolution: 12 as Resolution,
    })),
  },
  {
    id: "outro",
    name: "Final",
    bars: Array.from({ length: perSection }, () => four(8)),
  },
]);

/**
 * B. The practice song.
 *
 * One section per meter the count-in has to be able to count, at a tempo the
 * ear can follow, plus the two ties the range preflight has to notice.
 */
const practiceTracks: readonly Track[] = [
  guitar("gtr", "Ritim Gitar"),
  bass(),
  drums(),
];

const practiceSong = songOf("Pratik Şarkısı", practiceTracks, [
  { id: "four", name: "Dört Dörtlük", bars: [four(8), four(8), four(16), four(8)] },
  {
    id: "three",
    name: "Üç Dörtlük",
    bpmOverride: 96,
    bars: Array.from({ length: 3 }, () => ({
      timeSignature: [3, 4] as TimeSignature,
      resolution: 8 as Resolution,
    })),
  },
  {
    id: "sixeight",
    name: "Altı Sekizlik",
    bars: Array.from({ length: 3 }, () => ({
      timeSignature: [6, 8] as TimeSignature,
      resolution: 8 as Resolution,
    })),
  },
  {
    id: "seveneight",
    name: "Yedi Sekizlik",
    bars: Array.from({ length: 3 }, () => ({
      timeSignature: [7, 8] as TimeSignature,
      resolution: 8 as Resolution,
    })),
  },
]);

/*
 * The two ties, written after the sections exist because each is a fact about
 * two bars rather than about one.
 *
 * - Inside `four`: bar 1's last slot is an onset and bar 2 opens with a tie,
 *   so a practice range starting at bar 2 begins in the middle of a note.
 * - Across the `three` → `sixeight` boundary: the same shape, one section
 *   further out, so a range that starts a section cannot assume it is clean.
 */
{
  const tieInside = (section: Section, fromBar: number, trackId: string) => {
    const lane = section.bars[fromBar]!.slots[trackId] as MelodicSlot[];
    lane[lane.length - 1] = { notes: [at(practiceTracks[0]!.fretboard!, 0, 0)] };
    const next = section.bars[fromBar + 1]!.slots[trackId] as MelodicSlot[];
    next[0] = "-";
  };
  tieInside(practiceSong.sections[0]!, 0, "gtr");

  const three = practiceSong.sections[1]!;
  const lastLane = three.bars[three.bars.length - 1]!.slots["gtr"] as MelodicSlot[];
  lastLane[lastLane.length - 1] = { notes: [at(practiceTracks[0]!.fretboard!, 0, 3)] };
  const sixEight = practiceSong.sections[2]!;
  const firstLane = sixEight.bars[0]!.slots["gtr"] as MelodicSlot[];
  firstLane[0] = "-";
}

/* ------------------------------------------------------------------ gate */

const fixtures: Record<string, Song> = { denseKit, practiceSong };
const report: Record<string, unknown> = {};

for (const [name, song] of Object.entries(fixtures)) {
  const parsed = songSchema.safeParse(song);
  if (!parsed.success) {
    throw new Error(`${name}: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  }
  const issues = runValidators(parsed.data);
  const errors = errorsOnly(issues);
  if (errors.length > 0) {
    throw new Error(`${name}: ${errors.length} validator error`);
  }
  const bars = parsed.data.sections.reduce((total, s) => total + s.bars.length, 0);
  const cells = parsed.data.sections
    .flatMap((s) => s.bars)
    .reduce((total, bar) => {
      const lane = bar.slots["drums"];
      return total + (Array.isArray(lane) ? lane.length : 0);
    }, 0);
  report[name] = {
    tracks: parsed.data.tracks.length,
    sections: parsed.data.sections.length,
    bars,
    drumSlots: cells,
    /* Recorded, never patched: a fixture bent to silence a warning is a
       fixture that no longer measures the app. */
    warnings: warningsOnly(issues).map((issue) => issue.code),
    errors: 0,
  };
  fixtures[name] = parsed.data;
}

writeFileSync(`${OUT}/fixtures.json`, `${JSON.stringify(fixtures, null, 2)}\n`);
writeFileSync(
  `${OUT}/fixtures-report.json`,
  `${JSON.stringify(
    {
      what: "2R-A §5.1 — pratik döngüsü ve yoğun kit fixture'ları",
      limits: {
        maxTracks: songLimits.maxTracks,
        totalBars: songLimits.totalBars,
        barsPerSection: songLimits.barsPerSection,
      },
      fixtures: report,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify(report, null, 2));
