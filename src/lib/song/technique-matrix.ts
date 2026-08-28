/**
 * Every technique the app can write, and what it reaches (2T-C §9).
 *
 * ## Why this is a table and not a list of features
 *
 * A technique is not supported because it has a glyph. It is supported when a
 * reader can choose it, the tab draws it, the score keeps it, undo takes it
 * back, and it changes what comes out of the speakers. Five links, and a
 * feature missing any one of them is a claim rather than a capability.
 *
 * So the chain is written down here, per technique, and the test beside this
 * file walks it: anything claiming `playback: true` has to produce a plan
 * different from a plain note, and anything with a glyph has to be reachable
 * from the sheet. A technique that quietly loses a link fails a test rather
 * than a listener.
 *
 * ## Four families, because a reader thinks in them
 *
 * - **Bağlantı** joins one note to the one before it.
 * - **Perde hareketi** moves the pitch while it sounds.
 * - **Vuruş** is how, or whether, the string is struck.
 * - **Tını ve süre** is what happens to the sound afterwards.
 *
 * `letRing` and `strum` are in the table but not in the articulation enum:
 * they say what happens *around* the attack rather than how it was made, and
 * they live in fields of their own. Putting them in the enum to keep one tidy
 * list would teach the wrong thing about all seven.
 */
import type { Articulation } from "@/lib/song/schema";

export type TechniqueFamily = "bağlantı" | "perde" | "vuruş" | "tını";

/** Where a technique is written in the Song Contract. */
export type TechniqueField = "articulation" | "letRing" | "strum";

export type TechniqueRow = {
  /** The enum value, or the performance field's name. */
  readonly id: Articulation | "let_ring" | "strum_down" | "strum_up";
  readonly label: string;
  readonly family: TechniqueFamily;
  readonly field: TechniqueField;
  /** What the tab draws, in the words of the visual language. */
  readonly notation: string;
  /** True when this changes the sound, not only the picture. */
  readonly playback: boolean;
};

export const TECHNIQUE_MATRIX: readonly TechniqueRow[] = [
  /* ------------------------------------------------------------ bağlantı */
  {
    id: "hammer_on",
    label: "Hammer-on",
    family: "bağlantı",
    field: "articulation",
    notation: "önceki notaya yay",
    playback: true,
  },
  {
    id: "pull_off",
    label: "Pull-off",
    family: "bağlantı",
    field: "articulation",
    notation: "önceki notaya yay",
    playback: true,
  },
  {
    id: "slide",
    label: "Slide",
    family: "bağlantı",
    field: "articulation",
    notation: "/ veya \\",
    playback: true,
  },
  /* --------------------------------------------------------------- perde */
  {
    id: "bend_half",
    label: "Yarım bend",
    family: "perde",
    field: "articulation",
    notation: "b½",
    playback: true,
  },
  {
    id: "bend_full",
    label: "Tam bend",
    family: "perde",
    field: "articulation",
    notation: "b1",
    playback: true,
  },
  {
    id: "vibrato",
    label: "Vibrato",
    family: "perde",
    field: "articulation",
    notation: "~",
    playback: true,
  },
  /* --------------------------------------------------------------- vuruş */
  {
    id: "accent",
    label: "Vurgu",
    family: "vuruş",
    field: "articulation",
    notation: ">",
    playback: true,
  },
  {
    id: "ghost",
    label: "Hayalet nota",
    family: "vuruş",
    field: "articulation",
    notation: "(5)",
    playback: true,
  },
  {
    id: "dead",
    label: "Ölü nota",
    family: "vuruş",
    field: "articulation",
    notation: "x",
    playback: true,
  },
  {
    id: "tapping",
    label: "Tapping",
    family: "vuruş",
    field: "articulation",
    notation: "T",
    playback: true,
  },
  {
    id: "strum_down",
    label: "Aşağı vuruş",
    family: "vuruş",
    field: "strum",
    notation: "akor yanında ↓",
    playback: true,
  },
  {
    id: "strum_up",
    label: "Yukarı vuruş",
    family: "vuruş",
    field: "strum",
    notation: "akor yanında ↑",
    playback: true,
  },
  /* ---------------------------------------------------------------- tını */
  {
    id: "palm_mute",
    label: "Palm mute",
    family: "tını",
    field: "articulation",
    notation: "PM",
    playback: true,
  },
  {
    id: "natural_harmonic",
    label: "Doğal armonik",
    family: "tını",
    field: "articulation",
    notation: "<5>",
    playback: true,
  },
  {
    id: "pinch_harmonic",
    label: "Pinch armonik",
    family: "tını",
    field: "articulation",
    notation: "PH",
    playback: true,
  },
  {
    id: "staccato",
    label: "Staccato",
    family: "tını",
    field: "articulation",
    notation: ".",
    playback: true,
  },
  {
    id: "sustain",
    label: "Uzatma",
    family: "tını",
    field: "articulation",
    notation: "–",
    playback: true,
  },
  {
    id: "let_ring",
    label: "Çınlat",
    family: "tını",
    field: "letRing",
    notation: "çınlama çizgisi sonraki vuruşun altından geçer",
    playback: true,
  },
];

/** The rows of one family, in the order they are written above. */
export function familyRows(family: TechniqueFamily): readonly TechniqueRow[] {
  return TECHNIQUE_MATRIX.filter((row) => row.family === family);
}

/** The articulations the matrix claims, for a test to compare with the enum. */
export function matrixArticulations(): readonly Articulation[] {
  return TECHNIQUE_MATRIX.filter(
    (row) => row.field === "articulation",
  ).map((row) => row.id as Articulation);
}

export const FAMILY_LABELS: Readonly<Record<TechniqueFamily, string>> = {
  bağlantı: "Bağlantı",
  perde: "Perde hareketi",
  vuruş: "Vuruş",
  tını: "Tını ve süre",
};
