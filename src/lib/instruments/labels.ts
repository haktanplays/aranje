/**
 * What an instrument and a preset are called *to a reader* (spec 13.11, K-42).
 *
 * The registry's `displayName` is the internal English name, and it stays that
 * way: it is what the code, the fixtures and the eval reports call things, and
 * renaming it would rename them all. What a musician sees is a different
 * question with a different answer, and this file is the only place that
 * answers it.
 *
 * One table, one place. A component that writes `"Elektro gitar"` inline is how
 * the same instrument ends up with two names on two screens; a component that
 * writes `track.instrumentId` is how a reader ends up looking at
 * `steel_acoustic`. Neither is allowed, and neither needs to happen, because
 * every surface asks here.
 *
 * This is deliberately **not** a localisation system. There is one language on
 * screen in this pilot, the strings live beside the ids they name rather than
 * in a catalogue keyed by a code, and nothing here interpolates or pluralises.
 * When the pilot needs a second language, this table is the thing that gets
 * lifted out — which is exactly why it is a table rather than forty string
 * literals spread across the components.
 */

/**
 * What the list of a song's tracks is called on screen.
 *
 * It lives here rather than in the sheet that shows it, because it names the
 * same things this table names. It also used to say "Track", which is the
 * word the code uses for a row of data — a musician has a shorter and better
 * word for what is in that list, and it is the instruments.
 */
import type { DrumPiece } from "@/lib/instruments/registry";

export const INSTRUMENT_LIST_TITLE = "Enstrümanlar";

/** Reader-facing instrument names, keyed by the registry's id. */
const INSTRUMENT_NAMES: Readonly<Record<string, string>> = {
  electric_guitar: "Elektro gitar",
  steel_acoustic: "Çelik telli akustik",
  nylon_guitar: "Klasik gitar",
  electric_bass: "Elektro bas",
  drum_kit: "Davul",
  piano: "Piyano",
};

/**
 * Reader-facing preset names, keyed `instrumentId.presetId`.
 *
 * Keyed by both because a preset id is only unique inside its instrument:
 * "finger" is a way of playing an acoustic and also a way of playing a bass,
 * and they do not have to read the same.
 */
const PRESET_NAMES: Readonly<Record<string, string>> = {
  "electric_guitar.clean": "Temiz",
  "electric_guitar.crunch": "Crunch",
  // The name of the sound, kept as musicians say it. "Yüksek gain" was a
  // translation of a term that is not translated in a rehearsal room.
  "electric_guitar.high_gain": "High gain",
  "steel_acoustic.finger": "Parmakla",
  "steel_acoustic.pick": "Pena ile",
  "nylon_guitar.warm": "Sıcak",
  "nylon_guitar.bright": "Parlak",
  "electric_bass.finger": "Parmakla",
  "electric_bass.pick": "Pena ile",
  "electric_bass.driven": "Sürülmüş",
  "drum_kit.rock": "Rock",
  "drum_kit.metal": "Metal",
  "drum_kit.electronic": "Elektronik",
  "piano.grand": "Kuyruklu",
  "piano.upright": "Duvar",
};

/**
 * The reader's name for an instrument, or `null` when there is none.
 *
 * Null rather than the id: a caller that gets null can fall back to something
 * of its own choosing, whereas a caller handed `steel_acoustic` has already
 * shown it to somebody by the time anyone notices.
 */
export function instrumentName(instrumentId: string): string | null {
  return INSTRUMENT_NAMES[instrumentId] ?? null;
}

export function presetName(instrumentId: string, presetId: string): string | null {
  return PRESET_NAMES[`${instrumentId}.${presetId}`] ?? null;
}

/**
 * The kit's pieces in the reader's language (2Q-B §5.1).
 *
 * A step row is labelled for somebody who plays, not for somebody who reads
 * enum names: nobody has ever called it `closed_hat`. `Record` over the
 * piece union makes adding a piece without naming it a type error.
 */
export const DRUM_PIECE_NAMES: Readonly<Record<DrumPiece, string>> = {
  kick: "Kick",
  snare: "Trampet",
  closed_hat: "Kapalı hi-hat",
  open_hat: "Açık hi-hat",
  ride: "Ride",
  crash: "Crash",
  china: "China",
  tom_high: "Tiz tom",
  tom_mid: "Orta tom",
  tom_floor: "Yer tom",
};

export function drumPieceName(piece: DrumPiece): string {
  return DRUM_PIECE_NAMES[piece];
}
