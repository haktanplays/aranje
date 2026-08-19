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

export type PhaseScope = "core" | "phase_2_5";

export type InstrumentPreset = {
  id: string;
  displayName: string;
  engine: InstrumentEngine;
  /**
   * Scope is per preset, not per instrument. A core instrument may still carry
   * presets that only open up in phase 2.5 (spec 2.5 lists the core variants).
   */
  scope: PhaseScope;
};

export type InstrumentDefinition = {
  id: string;
  displayName: string;
  kind: InstrumentKind;
  /**
   * Whether the instrument itself is part of the core demo (spec 2.4). An
   * instrument in core scope does not make all of its presets core; see
   * InstrumentPreset.scope.
   */
  scope: PhaseScope;
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
      {
        id: "clean",
        displayName: "Clean",
        engine: "sampler",
        scope: "core",
      },
      {
        id: "crunch",
        displayName: "Crunch",
        engine: "sampler_fx",
        scope: "phase_2_5",
      },
      {
        id: "high_gain",
        displayName: "High gain",
        engine: "sampler_fx",
        scope: "core",
      },
    ],
  },
  {
    id: "steel_acoustic",
    displayName: "Steel string acoustic",
    kind: "melodic",
    scope: "core",
    defaultTuningPresetId: TUNING_PRESETS.e_standard?.id ?? "e_standard",
    presets: [
      {
        id: "finger",
        displayName: "Finger",
        engine: "sampler",
        scope: "core",
      },
      {
        id: "pick",
        displayName: "Pick",
        engine: "sampler",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "electric_bass",
    displayName: "Electric bass",
    kind: "melodic",
    scope: "core",
    defaultTuningPresetId: TUNING_PRESETS.bass_standard?.id ?? "bass_standard",
    presets: [
      {
        id: "finger",
        displayName: "Finger",
        engine: "sampler",
        scope: "core",
      },
      {
        id: "pick",
        displayName: "Pick",
        engine: "sampler",
        scope: "phase_2_5",
      },
      {
        id: "driven",
        displayName: "Driven",
        engine: "sampler_fx",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "drum_kit",
    displayName: "Drum kit",
    kind: "drums",
    scope: "core",
    presets: [
      {
        id: "rock",
        displayName: "Rock",
        engine: "sampler_kit",
        scope: "core",
      },
      {
        id: "metal",
        displayName: "Metal",
        engine: "sampler_kit",
        scope: "phase_2_5",
      },
      {
        id: "electronic",
        displayName: "Electronic",
        engine: "sampler_kit",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "nylon_guitar",
    displayName: "Nylon guitar",
    kind: "melodic",
    scope: "phase_2_5",
    defaultTuningPresetId: TUNING_PRESETS.e_standard?.id ?? "e_standard",
    presets: [
      {
        id: "warm",
        displayName: "Warm",
        engine: "sampler",
        scope: "phase_2_5",
      },
      {
        id: "bright",
        displayName: "Bright",
        engine: "sampler",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "piano",
    displayName: "Piano",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      {
        id: "grand",
        displayName: "Grand",
        engine: "sampler",
        scope: "phase_2_5",
      },
      {
        id: "upright",
        displayName: "Upright",
        engine: "sampler",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "electric_piano",
    displayName: "Electric piano",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      {
        id: "soft",
        displayName: "Soft",
        engine: "sampler",
        scope: "phase_2_5",
      },
      {
        id: "bright",
        displayName: "Bright",
        engine: "sampler",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "organ",
    displayName: "Organ",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      {
        id: "rock",
        displayName: "Rock",
        engine: "sampler",
        scope: "phase_2_5",
      },
      {
        id: "church",
        displayName: "Church",
        engine: "sampler",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "strings",
    displayName: "Strings ensemble",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      {
        id: "sustain",
        displayName: "Sustain",
        engine: "sampler",
        scope: "phase_2_5",
      },
      {
        id: "staccato",
        displayName: "Staccato",
        engine: "sampler",
        scope: "phase_2_5",
      },
    ],
  },
  {
    id: "synth",
    displayName: "Synth",
    kind: "melodic",
    scope: "phase_2_5",
    presets: [
      {
        id: "lead",
        displayName: "Lead",
        engine: "polysynth",
        scope: "phase_2_5",
      },
      {
        id: "warm_pad",
        displayName: "Warm pad",
        engine: "polysynth",
        scope: "phase_2_5",
      },
      {
        id: "dark_pad",
        displayName: "Dark pad",
        engine: "polysynth",
        scope: "phase_2_5",
      },
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

/**
 * Reader-facing name of an instrument. Components never show a raw id, and
 * never map ids to text themselves.
 */
export function instrumentLabel(instrumentId: string): string {
  return getInstrument(instrumentId)?.displayName ?? instrumentId;
}

/** Reader-facing name of a preset, e.g. "high_gain" reads "High gain". */
export function presetLabel(instrumentId: string, presetId: string): string {
  return getPreset(instrumentId, presetId)?.displayName ?? presetId;
}

/** Presets of an instrument that are available in the core scope (spec 2.5). */
export function corePresets(instrumentId: string): readonly InstrumentPreset[] {
  return (
    getInstrument(instrumentId)?.presets.filter(
      (preset) => preset.scope === "core",
    ) ?? []
  );
}

/** Ids of the core presets, keyed by instrument. */
export function corePresetIds(instrumentId: string): readonly string[] {
  return corePresets(instrumentId).map((preset) => preset.id);
}

/** True when this instrument/preset pair may be used in the core scope. */
export function isCorePreset(instrumentId: string, presetId: string): boolean {
  const instrument = getInstrument(instrumentId);
  if (!instrument || instrument.scope !== "core") return false;
  return getPreset(instrumentId, presetId)?.scope === "core";
}
