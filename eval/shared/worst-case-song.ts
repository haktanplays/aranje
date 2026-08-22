/**
 * The heaviest song the current limits allow, shared by every eval that has
 * to measure a worst case (2K-B, 2L-A). One builder, so "worst case" means
 * the same song in every report.
 */
import { songLimits } from "@/lib/limits";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";
import { slotCount } from "@/lib/music/timing";
import type {
  Bar,
  DrumSlot,
  MelodicSlot,
  Section,
  Song,
  Track,
} from "@/lib/song/schema";

/**
 * Both sizes, because they answer different questions.
 *
 * UTF-8 bytes is what a network or a file would carry. localStorage stores
 * JavaScript strings, which are UTF-16 code units — so the number a browser
 * quota actually meters is closer to `codeUnits * 2`. Reporting only one of
 * them lets the other be silently assumed.
 */
export const sizes = (value: unknown) => {
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

export function worstCaseSong(): Song {
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



/**
 * The same density, but *playable*: every position sounds the pitch it
 * claims, and every pitch sits in E minor, so the whole validator chain —
 * including fretboard integrity and tonal majority — passes with warnings at
 * most. `worstCaseSong` above only ever had to be schema-valid, because it
 * measures bytes; anything that measures the real export/import path needs a
 * song the gate would actually let through (2L-A).
 */

/* Diatonic frets per E-standard string, all inside E natural minor. */
const E_MINOR_FRETS: readonly (readonly number[])[] = [
  [0, 2, 3, 5, 7, 8, 10], // E2
  [0, 2, 3, 5, 7, 9, 10], // A2
  [0, 2, 4, 5, 7, 9, 10], // D3
  [0, 2, 4, 5, 7, 9, 11], // G3
  [0, 1, 3, 5, 7, 8, 10], // B3
  [0, 2, 3, 5, 7, 8, 10], // E4
];

export function worstCasePlayableSong(): Song {
  const tuning = TUNING_PRESETS.e_standard?.tuning ?? [];
  const base = worstCaseSong();

  const fix = (slot: MelodicSlot, index: number): MelodicSlot => {
    if (slot === null || slot === "-" || slot.notes[0] === undefined) return slot;
    const string = index % tuning.length;
    const fret = E_MINOR_FRETS[string]?.[index % 7] ?? 0;
    const open = pitchToMidi(tuning[string] ?? "E2") ?? 40;
    return {
      notes: [
        {
          ...slot.notes[0],
          pitch: midiToPitch(open + fret),
          position: { string, fret },
        },
      ],
    };
  };

  return {
    ...base,
    sections: base.sections.map((section) => ({
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: Object.fromEntries(
          Object.entries(bar.slots).map(([trackId, slots]) => [
            trackId,
            trackId === "drums"
              ? slots
              : (slots as MelodicSlot[]).map((slot, index) => fix(slot, index)),
          ]),
        ),
      })),
    })),
  };
}
