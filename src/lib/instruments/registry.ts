/**
 * Instrument registry (spec 7.1). Track carries `instrumentId` + `presetId`
 * instead of a closed enum, so the catalogue can grow without a schema change.
 *
 * The four instruments used by the core demo are complete. The remaining Core
 * Lite entries are declared so the registry is the single source of truth, but
 * they only become active in phase 2.5.
 */
import { TUNING_PRESETS } from "@/lib/music/fretboard";

/** How a preset is produced. Mirrors the engine column of spec 7.1. */
export type InstrumentEngine =
  | "sampler"
  | "sampler_fx"
  | "sampler_kit"
  | "polysynth";

export type InstrumentKind = "melodic" | "drums";

export type InstrumentPreset = {
  id: string;
  displayName: string;
  engine: InstrumentEngine;
};

export type InstrumentDefinition = {
  id: string;
  displayName: string;
  kind: InstrumentKind;
  /** Available in the core scope (spec 2.5) or deferred to phase 2.5. */
  scope: "core" | "phase_2_5";
  presets: readonly InstrumentPreset[];
  /**
   * Fretted instruments derive their playable range from tuning and fret count
   * (spec 9.1), so no separate numeric range is stored here.
   */
  defaultTuningPresetId?: string;
};

export const DRUM_PIECES = [
  "kick",
  "snare",
  "closed_hat",
  "open_hat",
  "ride",
  "crash",
  "china",
  "tom_high",
  "tom_mid",
  "tom_floor",
] as const;

export type DrumPiece = (typeof DRUM_PIECES)[number];

/** Drum pieces the core rock kit exposes (spec 2.5). */
export const CORE_DRUM_PIECES: readonly DrumPiece[] = [
  "kick",
  "snare",
  "closed_hat",
  "crash",
];

const DEFINITIONS: readonly InstrumentDefinition[] = [
  {
    id: "electric_guitar",
    displayName: "Electric guitar",
    kind: "melodic",
    scope: "core",
    defaultTuningPresetId: TUNING_PRESETS.e_standard?.id ?? "e_standard",
    presets: [
      { id: "clean", displayName: "Clean", engine: "sampler" },
      { id: "crunch", displayName: "Crunch", engine: "sampler_fx" },
      { id: "high_gain", displayName: "High gain", engine: "sampler_fx" },
    ],
  },
  {
    id: "steel_acoustic",
    displayName: "Steel string acoustic",
    kind: "melodic",
    scope: "core",
    defaultTuningPresetId: TUNING_PRESETS.e_standard?.id ?? "e_standard",
    presets: [
      { id: "finger", displayName: "Finger", engine: "sampler" },
      { id: "pick", displayName: "Pick", engine: "sampler" },
    ],
  },
  {
    id: "electric_bass",
    displayName: "Electric bass",
    kind: "melodic",
    scope: "core",
    defaultTuningPresetId: TUNING_PRESETS.bass_standard?.id ?? "bass_standard",
    presets: [
      { id: "finger", displayName: "Finger", engine: "sampler" },
      { id: "pick", displayName: "Pick", engine: "sampler" },
      { id: "driven", displayName: "Driven", engine: "sampler_fx" },
    ],
  },
  {
    id: "drum_kit",
    displayName: "Drum kit",
    kind: "drums",
    scope: "core",
    presets: [
      { id: "rock", displayName: "Rock", engine: "sampler_kit" },
      { id: "metal", displayName: "Metal", engine: "sampler_kit" },
      { id: "electronic", displayName: "Electronic", engine: "sampler_kit" },
    ],
  },
  {
    id: "nylon_guitar",
    displayName: "Nylon guitar",
    kind: "melodic",
    scope: "phase_2_5",
    defaultTuningPresetId: TUNING_PRESETS.e_standard?.id ?? "e_standard",
    presets: [
      { id: "warm", displayName: "Warm", engine: "sampler" },
      { id: "bright", displayName: "Bright", engine: "sampler" },
    ],
  },
  {
    id: "piano",
    displayName: "Piano",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      { id: "grand", displayName: "Grand", engine: "sampler" },
      { id: "upright", displayName: "Upright", engine: "sampler" },
    ],
  },
  {
    id: "electric_piano",
    displayName: "Electric piano",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      { id: "soft", displayName: "Soft", engine: "sampler" },
      { id: "bright", displayName: "Bright", engine: "sampler" },
    ],
  },
  {
    id: "organ",
    displayName: "Organ",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      { id: "rock", displayName: "Rock", engine: "sampler" },
      { id: "church", displayName: "Church", engine: "sampler" },
    ],
  },
  {
    id: "strings",
    displayName: "Strings ensemble",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      { id: "sustain", displayName: "Sustain", engine: "sampler" },
      { id: "staccato", displayName: "Staccato", engine: "sampler" },
    ],
  },
  {
    id: "synth",
    displayName: "Synth",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      { id: "lead", displayName: "Lead", engine: "polysynth" },
      { id: "warm_pad", displayName: "Warm pad", engine: "polysynth" },
      { id: "dark_pad", displayName: "Dark pad", engine: "polysynth" },
    ],
  },
];

export const INSTRUMENT_REGISTRY: ReadonlyMap<string, InstrumentDefinition> =
  new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

export function getInstrument(
  instrumentId: string,
): InstrumentDefinition | undefined {
  return INSTRUMENT_REGISTRY.get(instrumentId);
}

export function getPreset(
  instrumentId: string,
  presetId: string,
): InstrumentPreset | undefined {
  return getInstrument(instrumentId)?.presets.find(
    (preset) => preset.id === presetId,
  );
}

export function isDrumInstrument(instrumentId: string): boolean {
  return getInstrument(instrumentId)?.kind === "drums";
}

export function listInstruments(): readonly InstrumentDefinition[] {
  return DEFINITIONS;
}

export function coreInstruments(): readonly InstrumentDefinition[] {
  return DEFINITIONS.filter((definition) => definition.scope === "core");
}
