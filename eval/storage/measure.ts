/**
 * What the envelope costs, measured rather than estimated (spec 13.14).
 *
 * The worst case is not a guess: it is the largest song the *current* limits
 * allow — eight tracks, thirty-two bars, and every bar written at the finest
 * grid with something in every slot. A number derived from anything else
 * would be a product opinion about how big songs get, which is not this
 * checkpoint's to have.
 *
 * `npx tsx eval/storage/measure.ts`
 */
import { writeFileSync } from "node:fs";

import { songLimits } from "@/lib/limits";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { slotCount } from "@/lib/music/timing";
import {
  nextEnvelope,
  decideLoad,
  type SongStorageEnvelopeV1,
} from "@/lib/song/storage-envelope";
import {
  songSchema,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Section,
  type Song,
  type Track,
} from "@/lib/song/schema";

/**
 * Both sizes, because they answer different questions.
 *
 * UTF-8 bytes is what a network or a file would carry. localStorage stores
 * JavaScript strings, which are UTF-16 code units — so the number a browser
 * quota actually meters is closer to `codeUnits * 2`. Reporting only one of
 * them lets the other be silently assumed.
 */
const sizes = (value: unknown) => {
  const text = JSON.stringify(value);
  return {
    utf8Bytes: Buffer.byteLength(text, "utf8"),
    codeUnits: text.length,
    utf16ApproxBytes: text.length * 2,
  };
};

function heaviestDrumSlots(count: number): DrumSlot[] {
  return Array.from({ length: count }, () => [
    { piece: "kick" as const },
    { piece: "snare" as const },
    { piece: "closed_hat" as const },
  ]);
}

function worstCaseSong(): Song {
  const resolution = 32 as const;
  const count = slotCount([4, 4], resolution);

  const melodic = (): MelodicSlot[] =>
    Array.from({ length: count }, (_, index) => ({
      notes: [
        {
          pitch: index % 2 === 0 ? "E2" : "G2",
          position: { string: index % 6, fret: index % 12 },
          velocity: 100,
          articulation: "palm_mute" as const,
        },
      ],
    }));

  const guitarIds = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"] as const;

  const tracks: Track[] = [
    ...guitarIds.map((id) => ({
      id,
      name: `Gitar ${id}`,
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: -5,
      fretboard: {
        tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])],
        capo: 0,
      },
    })),
    {
      id: "drums",
      name: "Davul",
      instrumentId: "drum_kit",
      presetId: "metal",
      volumeDb: -3,
    },
  ];

  const bar = (): Bar => ({
    timeSignature: [4, 4],
    resolution,
    slots: {
      ...Object.fromEntries(guitarIds.map((id) => [id, melodic()])),
      drums: heaviestDrumSlots(count),
    },
  });

  const perSection = songLimits.barsPerSection;
  const sectionCount = songLimits.totalBars / perSection;
  const sections: Section[] = Array.from({ length: sectionCount }, (_, index) => ({
    id: `s${index + 1}`,
    name: `Bölüm ${index + 1}`,
    status: "fixed" as const,
    bars: Array.from({ length: perSection }, bar),
  }));

  return {
    version: 2,
    title: "En ağır şarkı",
    bpm: 138,
    key: "E minor",
    tracks,
    sections,
  };
}

const song = songSchema.parse(worstCaseSong());

const raw = sizes(song);
const firstWrite: SongStorageEnvelopeV1 = nextEnvelope(song, { kind: "empty" });
const currentOnly = sizes(firstWrite);
const fullEnvelope = nextEnvelope(song, decideLoad(JSON.stringify(firstWrite)));
const both = sizes(fullEnvelope);

const report = {
  limits: {
    tracks: song.tracks.length,
    bars: song.sections.reduce((sum, section) => sum + section.bars.length, 0),
    resolution: 32,
  },
  rawSong: raw,
  envelopeCurrentOnly: currentOnly,
  envelopeCurrentAndPrevious: both,
  growthOverLegacy: {
    currentOnly: Number((currentOnly.utf8Bytes / raw.utf8Bytes).toFixed(3)),
    withPrevious: Number((both.utf8Bytes / raw.utf8Bytes).toFixed(3)),
  },
  /*
   * Not a limit anyone invented: the ceiling this checkpoint has to live
   * inside is the worst case doubled, because that is what the format itself
   * costs. Whether a given browser has that much is a runtime question, and
   * the only honest answer to it is a real `setItem` that either works or
   * throws — which is why the write path fails closed rather than predicting.
   * `quota-check.mjs` performs that real attempt in production Chromium; it
   * is not an iOS Safari acceptance, which stays open.
   */
  worstCaseFile: both,
  worstCaseFileMiB: Number((both.utf8Bytes / (1024 * 1024)).toFixed(3)),
};

writeFileSync(
  "eval/storage/BYTES.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

/*
 * The payload, on request, for the real-browser write attempt. Behind an env
 * flag so the checked-in artifact stays a report, not a 1.5 MiB fixture.
 */
const payloadOut = process.env.WORST_OUT;
if (payloadOut) {
  writeFileSync(payloadOut, JSON.stringify(fullEnvelope), "utf8");
}

console.log(JSON.stringify(report, null, 2));
