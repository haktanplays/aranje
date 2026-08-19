/**
 * Core demo song (spec 2.4): electric guitar, steel acoustic, electric bass and
 * drums. The riff material comes from design/prototype.html and stays inside E
 * natural minor.
 *
 * 2 sections x 4 bars = 8 bars, within the 16 bar core limit (spec 6).
 * The acoustic track is absent from the first section, which is how a silent
 * track is expressed (spec 5.5).
 */
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import type {
  DrumPiece,
  DrumSlot,
  MelodicSlot,
  NoteEvent,
  Song,
} from "@/lib/song/schema";

const GUITAR_TUNING = TUNING_PRESETS.e_standard?.tuning ?? [];
const BASS_TUNING = TUNING_PRESETS.bass_standard?.tuning ?? [];

/** Single note. */
function n(
  pitch: string,
  position: NoteEvent["position"],
  extra: Omit<NoteEvent, "pitch" | "position"> = {},
): MelodicSlot {
  return { notes: [{ pitch, position, ...extra }] };
}

/** Chord: several notes in one slot. */
function chord(
  notes: readonly { pitch: string; position: NoteEvent["position"] }[],
  extra: Omit<NoteEvent, "pitch" | "position"> = {},
): MelodicSlot {
  return {
    notes: notes.map((note) => ({
      pitch: note.pitch,
      position: note.position,
      ...extra,
    })),
  };
}

/** Drum slot; several pieces may sound together. */
function d(...pieces: readonly DrumPiece[]): DrumSlot {
  return pieces.map((piece) => ({ piece }));
}

const REST: MelodicSlot = null;
const TIE: MelodicSlot = "-";

const PM = { articulation: "palm_mute", velocity: 92 } as const;
const ACCENT = { articulation: "accent", velocity: 112 } as const;

// Guitar positions in E standard, capo 0.
const gE2 = { string: 0, fret: 0 };
const gG2 = { string: 0, fret: 3 };
const gA2 = { string: 1, fret: 0 };
const gB2 = { string: 1, fret: 2 };
const gC3 = { string: 1, fret: 3 };
const gD3 = { string: 2, fret: 0 };
const gE3 = { string: 2, fret: 2 };
const gFs3 = { string: 2, fret: 4 };
const gG3 = { string: 2, fret: 5 };
const gD3High = { string: 1, fret: 5 };
const gB3 = { string: 4, fret: 0 };
const gE4 = { string: 5, fret: 0 };
const gFs4 = { string: 5, fret: 2 };
const gG4 = { string: 5, fret: 3 };

// Bass positions in bass E standard, capo 0.
const bE1 = { string: 0, fret: 0 };
const bG1 = { string: 0, fret: 3 };
const bA1 = { string: 1, fret: 0 };
const bB1 = { string: 1, fret: 2 };
const bC2 = { string: 1, fret: 3 };
const bD2 = { string: 2, fret: 0 };

const E5 = [
  { pitch: "E2", position: gE2 },
  { pitch: "B2", position: gB2 },
] as const;
const G5 = [
  { pitch: "G2", position: gG2 },
  { pitch: "D3", position: gD3High },
] as const;
const A5 = [
  { pitch: "A2", position: gA2 },
  { pitch: "E3", position: gE3 },
] as const;
const C5 = [
  { pitch: "C3", position: gC3 },
  { pitch: "G3", position: gG3 },
] as const;
const B5 = [
  { pitch: "B2", position: gB2 },
  { pitch: "F#3", position: gFs3 },
] as const;

const GROOVE: readonly DrumSlot[] = [
  d("kick", "closed_hat"),
  d("closed_hat"),
  d("snare", "closed_hat"),
  d("closed_hat"),
  d("kick", "closed_hat"),
  d("closed_hat"),
  d("snare", "closed_hat"),
  d("closed_hat"),
];

const GROOVE_WITH_CRASH: readonly DrumSlot[] = [
  d("kick", "closed_hat", "crash"),
  ...GROOVE.slice(1),
];

export const SAMPLE_SONG: Song = {
  version: 2,
  title: "Metal Demo",
  bpm: 132,
  key: "E minor",
  tracks: [
    {
      id: "gtr",
      name: "Gitar 1",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: -6,
      fretboard: { tuning: [...GUITAR_TUNING], capo: 0 },
    },
    {
      id: "acc",
      name: "Akustik",
      instrumentId: "steel_acoustic",
      presetId: "finger",
      volumeDb: -8,
      fretboard: { tuning: [...GUITAR_TUNING], capo: 0 },
    },
    {
      id: "bass",
      name: "Bas",
      instrumentId: "electric_bass",
      presetId: "finger",
      volumeDb: -5,
      fretboard: { tuning: [...BASS_TUNING], capo: 0 },
    },
    {
      id: "drums",
      name: "Davul",
      instrumentId: "drum_kit",
      presetId: "rock",
      volumeDb: -4,
    },
  ],
  sections: [
    {
      id: "intro-riff",
      name: "Intro Riff",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              n("E2", gE2, PM),
              n("E2", gE2, PM),
              n("E2", gE2, PM),
              n("G2", gG2, ACCENT),
              n("E2", gE2, PM),
              n("E2", gE2, PM),
              n("A2", gA2, ACCENT),
              n("G2", gG2, ACCENT),
            ],
            bass: [
              n("E1", bE1),
              n("E1", bE1),
              n("E1", bE1),
              n("G1", bG1),
              n("E1", bE1),
              n("E1", bE1),
              n("A1", bA1),
              n("G1", bG1),
            ],
            drums: [...GROOVE_WITH_CRASH],
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              n("E2", gE2, PM),
              n("E2", gE2, PM),
              n("G2", gG2, ACCENT),
              n("A2", gA2, ACCENT),
              n("C3", gC3, ACCENT),
              n("B2", gB2, ACCENT),
              n("G2", gG2, ACCENT),
              n("E2", gE2, PM),
            ],
            bass: [
              n("E1", bE1),
              n("E1", bE1),
              n("G1", bG1),
              n("A1", bA1),
              n("C2", bC2),
              n("B1", bB1),
              n("G1", bG1),
              n("E1", bE1),
            ],
            drums: [...GROOVE],
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              n("E2", gE2, PM),
              n("E2", gE2, PM),
              n("E2", gE2, PM),
              n("G2", gG2, ACCENT),
              n("E2", gE2, PM),
              n("D3", gD3, ACCENT),
              n("B2", gB2, ACCENT),
              n("E2", gE2, PM),
            ],
            bass: [
              n("E1", bE1),
              n("E1", bE1),
              n("E1", bE1),
              n("G1", bG1),
              n("E1", bE1),
              n("D2", bD2),
              n("B1", bB1),
              n("E1", bE1),
            ],
            drums: [...GROOVE],
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            // Tie and rest in one bar (spec 5.4).
            gtr: [
              n("E2", gE2, ACCENT),
              TIE,
              n("G2", gG2, ACCENT),
              n("A2", gA2, ACCENT),
              n("C3", gC3, ACCENT),
              TIE,
              n("B2", gB2, ACCENT),
              REST,
            ],
            bass: [
              n("E1", bE1),
              TIE,
              n("G1", bG1),
              n("A1", bA1),
              n("C2", bC2),
              TIE,
              n("B1", bB1),
              REST,
            ],
            drums: [...GROOVE],
          },
        },
      ],
    },
    {
      id: "main-riff",
      name: "Ana Riff",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              chord(E5, ACCENT),
              REST,
              chord(E5, PM),
              chord(G5, ACCENT),
              REST,
              chord(A5, ACCENT),
              REST,
              chord(E5, PM),
            ],
            acc: [
              n("E3", gE3),
              n("B3", gB3),
              n("E4", gE4),
              n("F#4", gFs4),
              n("G4", gG4),
              n("F#4", gFs4),
              n("E4", gE4),
              n("B3", gB3),
            ],
            bass: [
              n("E1", bE1),
              n("E1", bE1),
              n("E1", bE1),
              n("G1", bG1),
              n("G1", bG1),
              n("A1", bA1),
              n("A1", bA1),
              n("E1", bE1),
            ],
            drums: [...GROOVE_WITH_CRASH],
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              chord(C5, ACCENT),
              REST,
              chord(C5, PM),
              chord(B5, ACCENT),
              REST,
              chord(G5, ACCENT),
              REST,
              chord(E5, PM),
            ],
            acc: [
              n("C3", gC3),
              n("G3", gG3),
              n("E4", gE4),
              n("G4", gG4),
              n("F#4", gFs4),
              n("E4", gE4),
              n("B3", gB3),
              n("G3", gG3),
            ],
            bass: [
              n("C2", bC2),
              n("C2", bC2),
              n("C2", bC2),
              n("B1", bB1),
              n("B1", bB1),
              n("G1", bG1),
              n("G1", bG1),
              n("E1", bE1),
            ],
            drums: [...GROOVE],
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              chord(E5, ACCENT),
              REST,
              chord(E5, PM),
              chord(G5, ACCENT),
              REST,
              chord(A5, ACCENT),
              REST,
              chord(B5, ACCENT),
            ],
            acc: [
              n("E3", gE3),
              n("G3", gG3),
              n("B3", gB3),
              n("E4", gE4),
              n("F#4", gFs4),
              n("E4", gE4),
              n("B3", gB3),
              n("F#3", gFs3),
            ],
            bass: [
              n("E1", bE1),
              n("E1", bE1),
              n("E1", bE1),
              n("G1", bG1),
              n("G1", bG1),
              n("A1", bA1),
              n("A1", bA1),
              n("B1", bB1),
            ],
            drums: [...GROOVE],
          },
        },
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              chord(E5, ACCENT),
              TIE,
              TIE,
              TIE,
              REST,
              REST,
              REST,
              REST,
            ],
            acc: [
              n("E3", gE3),
              n("B3", gB3),
              n("E4", gE4),
              TIE,
              TIE,
              REST,
              REST,
              REST,
            ],
            bass: [n("E1", bE1), TIE, TIE, TIE, REST, REST, REST, REST],
            drums: [
              d("kick", "crash"),
              d(),
              d(),
              d(),
              d(),
              d(),
              d(),
              d(),
            ],
          },
        },
      ],
    },
  ],
};
