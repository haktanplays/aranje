/**
 * The songs the 2Q-A work is measured against (§0, §16, §17).
 *
 * Generated rather than typed out. Every pitch is derived from the track's own
 * tuning and capo through the production helper, every bar's slot count comes
 * from the production timing module, and every song is put through the strict
 * schema and the central validator chain before it is written. A fixture that
 * disagrees with the app measures the fixture.
 *
 * The result is JSON so the browser harness can seed a device with it without
 * a second copy of these rules living in a `.mjs` file.
 *
 *   npx tsx eval/multitrack/make-seeds.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { soundingMidi, TUNING_PRESETS, type Fretboard } from "@/lib/music/fretboard";
import { midiToPitch } from "@/lib/music/pitch";
import { slotCount, type Resolution } from "@/lib/music/timing";
import { songLimits } from "@/lib/limits";
import { songSchema, type Bar, type DrumSlot, type MelodicSlot, type NoteEvent, type Song, type TimeSignature, type Track } from "@/lib/song/schema";
import { errorsOnly, runValidators } from "@/lib/validators";

const OUT = "eval/multitrack";
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

/** A pitched instrument with no fretboard: the third lane kind, and real. */
const keys = (): Track => ({
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
});

/**
 * A note on a string and fret, with the pitch that combination really makes.
 *
 * Through `soundingMidi`, so a capo or a different tuning changes the pitch
 * here exactly as it does in the app — and `fretboardIntegrity` has nothing
 * to complain about.
 */
function at(fretboard: Fretboard, string: number, fret: number, articulation?: NoteEvent["articulation"]): NoteEvent {
  const midi = soundingMidi(fretboard, { string, fret });
  if (midi === null) throw new Error(`no pitch at ${string}/${fret}`);
  const pitch = midiToPitch(midi);
  return {
    pitch,
    velocity: 100,
    ...(articulation ? { articulation } : {}),
    position: { string, fret },
  };
}

const pitched = (pitch: string, articulation?: NoteEvent["articulation"]): NoteEvent => ({
  pitch,
  velocity: 100,
  ...(articulation ? { articulation } : {}),
});

/* ------------------------------------------------------------------ parts */

/**
 * The parts deliberately differ in rhythm.
 *
 * Four lanes all playing on the beat cannot show whether the bar lines really
 * line up; these do not, so the alignment claim is checkable.
 *
 * All of it sits in E minor, so `tonalMajority` has nothing to say either.
 */
type Part = (fretboard: Fretboard, count: number, barIndex: number) => MelodicSlot[];

const rhythmPart: Part = (fb, count) => {
  const slots: MelodicSlot[] = Array.from({ length: count }, () => null);
  // Em: open low E, B on the A string, E on the D string.
  slots[0] = { notes: [at(fb, 0, 0), at(fb, 1, 2), at(fb, 2, 2)] };
  if (count > 2) slots[Math.floor(count / 2)] = { notes: [at(fb, 0, 3), at(fb, 1, 5)] };
  return slots;
};

const leadPart: Part = (fb, count) => {
  const slots: MelodicSlot[] = Array.from({ length: count }, () => null);
  const first = Math.floor(count / 4);
  const second = Math.floor((3 * count) / 4);
  // B on the high E string, bent; then a slide up to D.
  slots[first] = { notes: [at(fb, 5, 7, "bend_full")] };
  for (let i = first + 1; i < Math.min(second, first + 3); i += 1) slots[i] = "-";
  if (second > first) slots[second] = { notes: [at(fb, 5, 10, "slide")] };
  return slots;
};

const bassPart: Part = (fb, count, barIndex) => {
  const slots: MelodicSlot[] = Array.from({ length: count }, () => null);
  // E, G, A, D — the roots of the progression, one per bar, in eighths.
  const fret = [0, 3, 5, 10][barIndex % 4]!;
  for (let i = 0; i < count; i += 2) slots[i] = { notes: [at(fb, 0, fret)] };
  return slots;
};

const keysPart: Part = (_fb, count) => {
  const slots: MelodicSlot[] = Array.from({ length: count }, () => null);
  slots[0] = { notes: [pitched("E3"), pitched("G3"), pitched("B3")] };
  if (count > 2) slots[Math.floor(count / 2)] = { notes: [pitched("D4")] };
  return slots;
};

function drumPart(count: number): DrumSlot[] {
  const slots: DrumSlot[] = Array.from({ length: count }, (): DrumSlot => []);
  for (let i = 0; i < count; i += 2) slots[i] = [{ piece: "closed_hat", velocity: 90 }];
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

const PARTS: Record<string, Part> = {
  electric_guitar: rhythmPart,
  electric_bass: bassPart,
  piano: keysPart,
};

/* ------------------------------------------------------------------ songs */

type Options = {
  bars?: number;
  resolution?: Resolution;
  timeSignature?: TimeSignature;
  /** Track ids that carry no key at all: real spec-5.5 silence. */
  silent?: readonly string[];
  sections?: readonly string[];
  title?: string;
  /** Track ids that get the lead part rather than their instrument's default. */
  lead?: readonly string[];
};

function build(tracks: readonly Track[], options: Options = {}): Song {
  const resolution = options.resolution ?? 8;
  const timeSignature = options.timeSignature ?? ([4, 4] as TimeSignature);
  const count = slotCount(timeSignature, resolution);
  const silent = new Set(options.silent ?? []);
  const lead = new Set(options.lead ?? ["lead"]);
  const barCount = options.bars ?? 4;

  const sections = (options.sections ?? ["Bölüm 1"]).map((name, sectionIndex) => ({
    id: `s${sectionIndex + 1}`,
    name,
    status: "fixed" as const,
    bars: Array.from({ length: barCount }, (_, barIndex): Bar => {
      const slots: Bar["slots"] = {};
      for (const track of tracks) {
        if (silent.has(track.id)) continue;
        if (track.instrumentId === "drum_kit") {
          slots[track.id] = drumPart(count);
          continue;
        }
        const part = lead.has(track.id) ? leadPart : PARTS[track.instrumentId];
        if (!part) throw new Error(`no part for ${track.instrumentId}`);
        slots[track.id] = part(
          track.fretboard ?? { tuning: [...E_STANDARD], capo: 0 },
          count,
          barIndex,
        );
      }
      return { timeSignature, resolution, slots };
    }),
  }));

  return {
    version: 2,
    title: options.title ?? "Çoklu Test",
    bpm: 120,
    key: "E minor",
    tracks: [...tracks],
    sections,
  };
}

const fourPartTracks = [
  guitar("gtr", "Ritim Gitar"),
  guitar("lead", "Solo Gitar"),
  bass(),
  drums(),
];

/** Every track the contract allows, which is eight — not ten. */
const maxTrackList = [
  ...fourPartTracks,
  keys(),
  guitar("gtr-3", "Gitar 3"),
  guitar("gtr-4", "Gitar 4"),
  guitar("lead-2", "Solo 2"),
];
if (maxTrackList.length !== songLimits.maxTracks) {
  throw new Error(
    `the ceiling moved: songLimits.maxTracks is ${songLimits.maxTracks}, fixture has ${maxTrackList.length}`,
  );
}

const SONGS: Record<string, Song> = {
  fourPart: build(fourPartTracks),
  fourPartTwoSections: build(fourPartTracks, { sections: ["Bölüm 1", "Bölüm 2"] }),
  silentLead: build(fourPartTracks, { silent: ["lead"] }),
  withKeys: build([guitar("gtr", "Ritim Gitar"), bass(), drums(), keys()], {
    lead: [],
  }),
  sixteenths: build(fourPartTracks, { resolution: 16 }),
  threeFour: build(fourPartTracks, { timeSignature: [3, 4], resolution: 12 }),
  sixEight: build(fourPartTracks, { timeSignature: [6, 8], resolution: 8 }),
  sevenEight: build(fourPartTracks, { timeSignature: [7, 8], resolution: 8 }),
  maxTracks: build(maxTrackList, { lead: ["lead", "lead-2"] }),
  /*
   * The realistic and worst-supported fixtures (§17).
   *
   * Both are shaped by the central limits rather than by a round number:
   * `maxTracks` is 8, `barsPerSection` is 8 and `totalBars` is 32, so the
   * biggest song this build can hold is 8 tracks over 4 sections of 8 bars.
   * The brief asks about ten tracks; ten is not a song that exists here, and
   * a fixture carrying ten would measure something no reader can reach.
   */
  realistic: build(maxTrackList, {
    lead: ["lead", "lead-2"],
    bars: songLimits.barsPerSection,
    sections: ["Giriş", "Nakarat", "Köprü", "Final"],
  }),
  worstCase: build(maxTrackList, {
    lead: ["lead", "lead-2"],
    bars: songLimits.barsPerSection,
    sections: ["Giriş", "Nakarat", "Köprü", "Final"],
    resolution: 32,
  }),
};

/** A mixed-grid song: one section whose bars do not share a resolution. */
const mixed = structuredClone(SONGS.fourPart!);
{
  const section = mixed.sections[0]!;
  const swap = (index: number, resolution: Resolution) => {
    const source = build(fourPartTracks, { resolution, bars: 1 });
    section.bars[index] = source.sections[0]!.bars[0]!;
  };
  swap(1, 16);
  swap(2, 12);
  swap(3, 4);
}
SONGS.mixedGrid = mixed;

/* ----------------------------------------------------------- the gate */

const report: Record<string, unknown> = {};
let failed = 0;
for (const [name, song] of Object.entries(SONGS)) {
  const parsed = songSchema.safeParse(song);
  if (!parsed.success) {
    failed += 1;
    console.log(`FAIL ${name}: schema — ${parsed.error.issues[0]?.message}`);
    continue;
  }
  const errors = errorsOnly(runValidators(parsed.data));
  if (errors.length > 0) {
    failed += 1;
    console.log(`FAIL ${name}: ${errors.map((issue) => issue.code).join(", ")}`);
    continue;
  }
  report[name] = {
    tracks: song.tracks.length,
    sections: song.sections.length,
    bars: song.sections.reduce((total, section) => total + section.bars.length, 0),
  };
  console.log(`ok   ${name}`);
}

writeFileSync(`${OUT}/seeds.json`, `${JSON.stringify(SONGS, null, 2)}\n`);
if (failed > 0) process.exit(1);
console.log(JSON.stringify(report, null, 0).slice(0, 400));
