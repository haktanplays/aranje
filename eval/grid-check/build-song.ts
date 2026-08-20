/**
 * A song that exercises every grid, written by hand rather than by a model.
 *
 * This is not a rehearsal and not a quality sample: it is the fixture the
 * phase's timing, playback and layout claims are measured against, so it is
 * deliberately built to be awkward — five grids, a grid change inside a
 * section, a tie across a grid change, a legato pair across a bar line, a
 * slide arriving on a triplet bar, and two section tempos.
 *
 * `npx tsx eval/grid-check/build-song.ts`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { songSchema, type Bar, type MelodicSlot, type Song } from "@/lib/song/schema";
import { slotCount, type Resolution } from "@/lib/music/timing";

const HERE = new URL(".", import.meta.url).pathname;
const REST = null as unknown as MelodicSlot;
const TIE = "-" as MelodicSlot;

type Written = { at: number; pitch: string; articulation?: string; velocity?: number };

function melodic(
  resolution: Resolution,
  written: readonly Written[],
  holds: readonly number[] = [],
): MelodicSlot[] {
  const count = slotCount([4, 4], resolution);
  const slots: MelodicSlot[] = Array.from({ length: count }, () => REST);
  for (const entry of written) {
    slots[entry.at] = {
      notes: [
        {
          pitch: entry.pitch,
          ...(entry.articulation === undefined
            ? {}
            : { articulation: entry.articulation }),
          ...(entry.velocity === undefined ? {} : { velocity: entry.velocity }),
        },
      ],
    } as unknown as MelodicSlot;
  }
  for (const index of holds) slots[index] = TIE;
  return slots;
}

function drums(resolution: Resolution, pattern: Record<number, string[]>) {
  const count = slotCount([4, 4], resolution);
  return Array.from({ length: count }, (_, index) =>
    (pattern[index] ?? []).map((piece) => ({ piece })),
  );
}

const bar = (
  resolution: Resolution,
  slots: Record<string, unknown>,
): Bar => ({ timeSignature: [4, 4], resolution, slots }) as Bar;

/** D minor, drop D, so the open sixth string is the tonic. */
const GUITAR = {
  id: "gtr",
  name: "Ritim gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -4,
  pan: -0.3,
  fretboard: { tuning: ["D2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
};
const LEAD = {
  id: "lead",
  name: "Solo gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -5,
  pan: 0.25,
  fretboard: { tuning: ["D2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
};
const DRUMS = {
  id: "drums",
  name: "Davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -6,
};

const raw = {
  version: 2,
  title: "Grid Check",
  bpm: 138,
  key: "D minor",
  tracks: [GUITAR, LEAD, DRUMS],
  sections: [
    {
      // 1/16 riff with one 1/16-triplet turnaround inside it.
      id: "sec-1",
      name: "Riff",
      status: "fixed",
      bars: [
        bar(16, {
          gtr: melodic(16, [
            { at: 0, pitch: "D2", articulation: "accent" },
            { at: 3, pitch: "D2", articulation: "palm_mute" },
            { at: 6, pitch: "F2", articulation: "palm_mute" },
            { at: 10, pitch: "D2", articulation: "accent" },
            { at: 12, pitch: "G2" },
          ]),
          drums: drums(16, {
            0: ["kick", "closed_hat"],
            4: ["closed_hat"],
            8: ["snare", "closed_hat"],
            12: ["closed_hat"],
          }),
        }),
        bar(16, {
          gtr: melodic(16, [
            { at: 0, pitch: "D2", articulation: "accent" },
            { at: 3, pitch: "D2", articulation: "palm_mute" },
            { at: 6, pitch: "F2", articulation: "palm_mute" },
            { at: 10, pitch: "A2" },
          ]),
          drums: drums(16, {
            0: ["kick", "closed_hat"],
            4: ["closed_hat"],
            8: ["snare", "closed_hat"],
            12: ["closed_hat"],
          }),
        }),
        // The turnaround: eighth triplets, three to the beat.
        bar(12, {
          gtr: melodic(12, [
            { at: 0, pitch: "D2", articulation: "accent" },
            { at: 1, pitch: "E2" },
            { at: 2, pitch: "F2" },
            { at: 3, pitch: "G2", articulation: "accent" },
            { at: 4, pitch: "A2" },
            { at: 5, pitch: "Bb2" },
            { at: 6, pitch: "C3", articulation: "accent" },
            { at: 9, pitch: "A2" },
          ]),
          drums: drums(12, {
            0: ["kick", "closed_hat"],
            3: ["snare"],
            6: ["kick", "closed_hat"],
            9: ["snare"],
          }),
        }),
        // Held over into the next section, on a grid it does not share.
        bar(16, {
          gtr: melodic(
            16,
            [{ at: 0, pitch: "D2", articulation: "sustain" }],
            Array.from({ length: 15 }, (_, index) => index + 1),
          ),
          drums: drums(16, { 0: ["kick", "crash"], 8: ["snare"] }),
        }),
      ],
    },
    {
      // A 1/32 scalar run, and a legato burst that joins across the bar line.
      id: "sec-2",
      name: "Run",
      status: "fixed",
      bars: [
        bar(32, {
          gtr: melodic(32, [], Array.from({ length: 32 }, (_, index) => index)),
          lead: melodic(32, [
            { at: 8, pitch: "D4" },
            { at: 9, pitch: "E4" },
            { at: 10, pitch: "F4" },
            { at: 11, pitch: "G4" },
            { at: 12, pitch: "A4" },
            { at: 13, pitch: "Bb4" },
            { at: 14, pitch: "C5" },
            { at: 15, pitch: "D5", articulation: "accent" },
            { at: 24, pitch: "A4" },
            { at: 25, pitch: "Bb4" },
            { at: 26, pitch: "C5" },
            { at: 27, pitch: "D5" },
            { at: 28, pitch: "E5" },
            { at: 29, pitch: "F5" },
            { at: 30, pitch: "G5" },
            { at: 31, pitch: "A5", articulation: "accent" },
          ]),
          drums: drums(32, {
            0: ["kick", "crash"],
            8: ["snare"],
            16: ["kick"],
            24: ["snare"],
          }),
        }),
        // A legato burst on 1/16 triplets, joined to the run before it.
        bar(24, {
          gtr: melodic(24, [{ at: 0, pitch: "D2", articulation: "accent" }],
            Array.from({ length: 23 }, (_, index) => index + 1)),
          lead: melodic(24, [
            { at: 0, pitch: "G5", articulation: "pull_off" },
            { at: 1, pitch: "F5", articulation: "pull_off" },
            { at: 2, pitch: "E5", articulation: "pull_off" },
            { at: 3, pitch: "D5" },
            { at: 6, pitch: "D5" },
            { at: 7, pitch: "E5", articulation: "hammer_on" },
            { at: 8, pitch: "F5", articulation: "hammer_on" },
            { at: 12, pitch: "A5", articulation: "slide" },
          ], [9, 10, 11, 13, 14, 15]),
          drums: drums(24, {
            0: ["kick", "closed_hat"],
            6: ["snare"],
            12: ["kick"],
            18: ["snare", "crash"],
          }),
        }),
      ],
    },
    {
      // Half the tempo, back on a plain 1/8 grid: a grid change and a tempo
      // change that are deliberately not the same event.
      id: "sec-3",
      name: "Half Time",
      status: "fixed",
      bpmOverride: 69,
      bars: [
        bar(8, {
          gtr: melodic(8, [
            { at: 0, pitch: "D2", articulation: "sustain" },
            { at: 4, pitch: "Bb2", articulation: "sustain" },
          ], [1, 2, 3, 5, 6, 7]),
          drums: drums(8, { 0: ["kick", "crash"], 4: ["snare"] }),
        }),
        bar(8, {
          gtr: melodic(8, [
            { at: 0, pitch: "F2", articulation: "sustain" },
            { at: 4, pitch: "C3", articulation: "sustain" },
          ], [1, 2, 3, 5, 6, 7]),
          drums: drums(8, { 0: ["kick"], 4: ["snare"] }),
        }),
      ],
    },
  ],
};

const parsed = songSchema.safeParse(raw);
if (!parsed.success) {
  console.error(parsed.error.message);
  process.exit(1);
}
const song: Song = parsed.data;

mkdirSync(join(HERE, "artifacts"), { recursive: true });
writeFileSync(
  join(HERE, "artifacts", "song.json"),
  JSON.stringify(song, null, 2),
);
console.log(
  `wrote ${song.sections.length} sections, ` +
    `${song.sections.reduce((n, s) => n + s.bars.length, 0)} bars, grids ` +
    `${[...new Set(song.sections.flatMap((s) => s.bars.map((b) => b.resolution)))].join(", ")}`,
);
