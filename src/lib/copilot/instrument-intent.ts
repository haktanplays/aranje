/**
 * Blueprint instrument intent, resolved against the registry (spec 5.2, K-35).
 *
 * S-03 asked for a close that was "clean, acoustic only, no drums and no
 * electric guitar". The model understood: it gave the harmony role a
 * `presetIntent` of "Second clean acoustic voice, soft attack, upper register"
 * and let it play only in the two acoustic sections. Materialization then read
 * a fixed `role -> instrument` table, mapped harmony to `electric_guitar`, and
 * the acoustic-only close rendered with an electric guitar in it.
 *
 * Nothing objected, because nothing was asked. The plan's instrument intent
 * had no path into the Song at all.
 *
 * This module is that path, and it is the only one. A role no longer *chooses*
 * an instrument; it *constrains* which instruments the intent may resolve to.
 * Inside that constraint the blueprint decides, and the answer is checked
 * against the registry rather than trusted.
 *
 * Three rules keep it honest:
 *
 *   - The model never names a technical id. It writes prose; this file maps
 *     prose to a registry option. An invented `instrumentId` cannot enter.
 *   - Intent that names something unavailable fails closed. There is no quiet
 *     fallback to an electric guitar or to anything else, because a silent
 *     fallback is exactly how the acoustic brief was lost.
 *   - Intent that names nothing is not a failure. It is unspecified, and the
 *     role's documented default applies — which is what every existing Song
 *     was built with.
 */
import {
  getInstrument,
  getPreset,
  isAcousticInstrument,
  type InstrumentDefinition,
} from "@/lib/instruments/registry";
import type { ArrangeSkill } from "@/lib/copilot/contract";

/**
 * What each role is allowed to be realised on, and what it is when the
 * blueprint says nothing.
 *
 * The first entry is the default. Panning stays here too: it is mix geometry
 * that belongs to the role, not to the instrument — two amplified guitars dead
 * centre fight each other whatever they are playing (K-31).
 */
type RoleInstruments = {
  readonly allowed: readonly string[];
  readonly defaultPresetId: string;
  readonly pan: number;
};

const ROLE_INSTRUMENTS: Readonly<Record<ArrangeSkill, RoleInstruments>> = {
  // The riff and the lead are amplified parts. An acoustic here is not a
  // quiet preference, it is a different arrangement, so it is refused rather
  // than honoured silently.
  rhythm_guitar: { allowed: ["electric_guitar"], defaultPresetId: "high_gain", pan: -0.3 },
  lead_guitar: { allowed: ["electric_guitar"], defaultPresetId: "high_gain", pan: 0.25 },
  // A second voice follows whatever it is accompanying, so it may be either.
  harmony: {
    allowed: ["electric_guitar", "steel_acoustic", "nylon_guitar"],
    defaultPresetId: "clean",
    pan: 0.35,
  },
  // Alone in its section, so it belongs in the middle.
  acoustic_guitar: { allowed: ["steel_acoustic", "nylon_guitar"], defaultPresetId: "finger", pan: 0 },
  bass: { allowed: ["electric_bass"], defaultPresetId: "finger", pan: 0 },
  drums: { allowed: ["drum_kit"], defaultPresetId: "rock", pan: 0 },
};

/** Words that name an instrument, in the order a reader would weigh them. */
const INSTRUMENT_WORDS: readonly { readonly instrumentId: string; readonly words: readonly string[] }[] = [
  { instrumentId: "nylon_guitar", words: ["nylon", "classical guitar", "gut string", "gut-string"] },
  {
    instrumentId: "steel_acoustic",
    words: ["steel-string", "steel string", "acoustic", "akustik", "unplugged"],
  },
  {
    instrumentId: "electric_guitar",
    words: ["electric", "elektrik", "amplified", "amp ", "distort", "gain", "overdriv"],
  },
  { instrumentId: "electric_bass", words: ["bass", "bas "] },
  { instrumentId: "drum_kit", words: ["drum", "kit", "davul"] },
];

/** Words that name a preset, per instrument. */
const PRESET_WORDS: Readonly<Record<string, readonly { readonly presetId: string; readonly words: readonly string[] }[]>> = {
  electric_guitar: [
    { presetId: "high_gain", words: ["high gain", "high-gain", "heavy", "distort", "aggressive", "metal"] },
    { presetId: "crunch", words: ["crunch", "bite", "edge", "driven"] },
    { presetId: "clean", words: ["clean", "no drive", "undistorted", "temiz"] },
  ],
  steel_acoustic: [
    { presetId: "pick", words: ["pick", "plectrum", "strum"] },
    { presetId: "finger", words: ["finger", "fingerstyle", "fingerpick", "soft attack", "woody"] },
  ],
  nylon_guitar: [
    { presetId: "bright", words: ["bright", "present"] },
    { presetId: "warm", words: ["warm", "mellow", "soft"] },
  ],
  electric_bass: [
    { presetId: "driven", words: ["driven", "distort", "gritty", "rusty"] },
    { presetId: "pick", words: ["pick", "plectrum"] },
    { presetId: "finger", words: ["finger"] },
  ],
  drum_kit: [
    { presetId: "metal", words: ["metal", "aggressive", "modern"] },
    { presetId: "electronic", words: ["electronic", "programmed"] },
    { presetId: "rock", words: ["rock", "acoustic kit", "natural"] },
  ],
};

export type IntentResolution =
  | {
      readonly ok: true;
      readonly instrumentId: string;
      readonly presetId: string;
      readonly pan: number;
      /** Whether the blueprint actually asked, or the role default applied. */
      readonly source: "blueprint_intent" | "role_default";
    }
  | { readonly ok: false; readonly reason: string };

const normalise = (text: string) => ` ${text.toLowerCase()} `;

/** The instrument the prose names, if it names one at all. */
function instrumentFromIntent(text: string): string | null {
  const haystack = normalise(text);
  for (const entry of INSTRUMENT_WORDS) {
    if (entry.words.some((word) => haystack.includes(word))) return entry.instrumentId;
  }
  return null;
}

/** The preset the prose names on that instrument, if it names one. */
function presetFromIntent(instrument: InstrumentDefinition, text: string): string | null {
  const haystack = normalise(text);
  for (const entry of PRESET_WORDS[instrument.id] ?? []) {
    if (!entry.words.some((word) => haystack.includes(word))) continue;
    return getPreset(instrument.id, entry.presetId) ? entry.presetId : null;
  }
  return null;
}

/**
 * Resolve one blueprint track's instrument and preset.
 *
 * `family` is the blueprint's `instrumentFamily`; `presetIntent` and
 * `tuningIntent` are its prose. Both prose fields are read, because a plan
 * often says "acoustic" in the tuning line rather than the preset line.
 */
export function resolveInstrumentIntent(input: {
  readonly role: ArrangeSkill;
  readonly family: string;
  readonly presetIntent: string;
  readonly tuningIntent: string;
}): IntentResolution {
  const role = ROLE_INSTRUMENTS[input.role];
  const fallbackId = role.allowed[0];
  if (fallbackId === undefined) {
    return { ok: false, reason: `role "${input.role}" has no allowed instrument` };
  }

  const named = instrumentFromIntent(`${input.presetIntent} ${input.tuningIntent}`);

  // Nothing named: not a failure, just unspecified. The role's default stands.
  if (named === null) {
    return {
      ok: true,
      instrumentId: fallbackId,
      presetId: role.defaultPresetId,
      pan: role.pan,
      source: "role_default",
    };
  }

  // Named something this role cannot be. Refused, never overridden in silence.
  if (!role.allowed.includes(named)) {
    return {
      ok: false,
      reason:
        `track role "${input.role}" asks for "${named}", which that role cannot be realised on ` +
        `(allowed: ${role.allowed.join(", ")}). Change the role or the instrument intent.`,
    };
  }

  const instrument = getInstrument(named);
  if (!instrument) {
    return { ok: false, reason: `instrument "${named}" is not in the registry` };
  }

  // The blueprint's declared family has to agree with what the prose named.
  const wantsAcoustic = isAcousticInstrument(named);
  if (input.family === "drums" && instrument.kind !== "drums") {
    return { ok: false, reason: `track role "${input.role}" declares family "drums" but names "${named}"` };
  }
  if (input.family !== "drums" && instrument.kind === "drums") {
    return { ok: false, reason: `track role "${input.role}" declares family "${input.family}" but names a drum kit` };
  }

  const namedPreset = presetFromIntent(instrument, `${input.presetIntent} ${input.tuningIntent}`);
  const presetId = namedPreset ?? defaultPresetFor(instrument, role, wantsAcoustic);
  if (!getPreset(instrument.id, presetId)) {
    return {
      ok: false,
      reason: `preset "${presetId}" does not exist on instrument "${instrument.id}"`,
    };
  }

  return {
    ok: true,
    instrumentId: instrument.id,
    presetId,
    pan: role.pan,
    source: "blueprint_intent",
  };
}

/**
 * The preset to use when the prose named an instrument but no preset.
 *
 * The role's default only applies when it exists on the instrument that was
 * actually chosen: "clean" is a sensible harmony default on an electric and
 * meaningless on a steel-string, where the equivalent is fingerstyle.
 */
function defaultPresetFor(
  instrument: InstrumentDefinition,
  role: RoleInstruments,
  wantsAcoustic: boolean,
): string {
  if (getPreset(instrument.id, role.defaultPresetId)) return role.defaultPresetId;
  if (wantsAcoustic && getPreset(instrument.id, "finger")) return "finger";
  return instrument.presets[0]?.id ?? role.defaultPresetId;
}

/** Read-only view of the role constraint, for tests and diagnostics. */
export function allowedInstrumentsFor(role: ArrangeSkill): readonly string[] {
  return ROLE_INSTRUMENTS[role].allowed;
}
