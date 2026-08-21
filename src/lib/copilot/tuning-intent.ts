/**
 * Blueprint tuning intent, resolved against the registry (spec 9.1, K-36).
 *
 * The sibling of the instrument gate, and the same bug one field along.
 * `tuningIntent` reached the materializer and was matched against the literal
 * string "drop d". Candidate A wrote "Drop-tuned low string for riff weight",
 * which does not contain it, so the track was built in standard tuning. The
 * model then wrote the D2 its own plan called for, the range validator
 * correctly refused a note below the low E it had been given, and a correction
 * was spent on a contradiction the plan never contained.
 *
 * A silent fall back to standard is what made that possible, so there is no
 * longer one. An intent that names a tuning we do not support is an error, not
 * an invitation to guess. An intent that names no tuning at all is not an
 * error: it is unspecified, and the instrument's documented default applies.
 *
 * Tunings come from `TUNING_PRESETS` and instrument defaults from the
 * registry. Nothing here holds its own copy of a string array, because a
 * second list of tunings is a second thing to keep true.
 */
import {
  TUNING_PRESETS,
  type TuningPreset,
} from "@/lib/music/fretboard";
import {
  getInstrument,
  instrumentFamily,
  isDrumInstrument,
} from "@/lib/instruments/registry";

/**
 * How the answer was arrived at.
 *
 * The distinction is the point of the gate. `defaulted` and `resolved` are
 * both fine; `unsupported` and `incompatible` must stop materialization rather
 * than quietly become standard tuning.
 */
export type TuningResolution =
  | {
      readonly ok: true;
      readonly status: "defaulted" | "resolved";
      readonly tuningPresetId: string;
      readonly tuning: readonly string[];
    }
  | {
      /** A fretless instrument has no tuning to write, and none is invented. */
      readonly ok: true;
      readonly status: "not_applicable";
    }
  | {
      readonly ok: false;
      readonly status: "unsupported" | "incompatible";
      readonly reason: string;
    };

/**
 * Prose that names a supported tuning.
 *
 * Every phrase here resolves to a preset that exists. The model writes prose
 * and this maps it to a registry option; it never lets a technical id in.
 */
const TUNING_WORDS: readonly { readonly presetId: string; readonly phrases: readonly string[] }[] = [
  {
    presetId: "drop_d",
    phrases: [
      "drop d",
      "dropped d",
      "drop tuned",
      "drop tuning",
      "lowest string tuned down to d",
      "low string tuned down to d",
      "sixth string to d",
      "drop akort",
    ],
  },
  {
    /* Before plain "standard", so "bass standard" is not read as a guitar's. */
    presetId: "bass_standard",
    phrases: ["bass standard", "bass e standard"],
  },
  {
    presetId: "e_standard",
    phrases: ["standard tuning", "e standard", "standard", "standart akort", "standart"],
  },
];

/**
 * Wordings that name a tuning this build does not have.
 *
 * These are checked before the phrase table, because "D standard" contains
 * "standard" and a substring match would happily call it E standard — which is
 * the original bug wearing a different word. Naming a tuning we do not support
 * has to fail, not resolve to the nearest thing that matched.
 */
const UNSUPPORTED_WORDINGS: readonly RegExp[] = [
  /\b(?:half|whole|full) step down\b/,
  /\bstep down\b/,
  /\btuned down a\b/,
  /\b[a-df-g] standard\b/,
  /\bdrop (?!d\b)[a-g]\b/,
  /\bopen [a-g]\b/,
];

/**
 * Words that mean the prose is talking about tuning at all.
 *
 * Without this the gate cannot tell "names a tuning we do not have" from
 * "says nothing about tuning", and those two have to end differently.
 */
const TUNING_TOPIC = [
  "tuning",
  "tuned",
  "akort",
  "drop",
  "standard",
  "standart",
  "capo",
  "string down",
  "half step down",
  "whole step down",
  "step down",
];

/**
 * Lowercase, with punctuation and runs of whitespace flattened to one space.
 *
 * "Drop-tuned", "drop tuned" and "DROP  TUNED" are the same request written
 * three ways, and a gate that only accepted one of them would be the bug again
 * in a smaller form. Punctuation counts: candidate A's own plan says "Standard
 * tuning, matched to the acoustic guitar", and a comma is not a different
 * request.
 */
function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim()} `;
}

const presetById = (id: string): TuningPreset | undefined => TUNING_PRESETS[id];

/** The tuning this instrument uses when the plan does not say. */
function defaultPresetFor(instrumentId: string): TuningPreset | undefined {
  const declared = getInstrument(instrumentId)?.defaultTuningPresetId;
  if (declared) return presetById(declared);
  return instrumentFamily(instrumentId) === "bass"
    ? presetById("bass_standard")
    : presetById("e_standard");
}

/**
 * Whether a tuning can physically be this instrument's.
 *
 * String count is the honest test: a four-string bass tuning is not a guitar
 * tuning however it is worded, and the fretboard maths would silently produce
 * a two-string guitar if it were allowed through.
 */
function isCompatible(instrumentId: string, preset: TuningPreset): boolean {
  const fallback = defaultPresetFor(instrumentId);
  if (!fallback) return false;
  return preset.tuning.length === fallback.tuning.length;
}

export function resolveTuningIntent(input: {
  readonly instrumentId: string;
  readonly tuningIntent: string;
}): TuningResolution {
  // Drums are tuned too, but not in strings, and nothing here should invent
  // a fretboard for them.
  if (isDrumInstrument(input.instrumentId) || instrumentFamily(input.instrumentId) === "drums") {
    return { ok: true, status: "not_applicable" };
  }

  const fallback = defaultPresetFor(input.instrumentId);
  if (!fallback) {
    return {
      ok: false,
      status: "unsupported",
      reason: `instrument "${input.instrumentId}" has no known default tuning`,
    };
  }

  const text = normalise(input.tuningIntent);

  const unsupported = UNSUPPORTED_WORDINGS.find((pattern) => pattern.test(text));
  if (unsupported) {
    return {
      ok: false,
      status: "unsupported",
      reason:
        `tuning intent "${input.tuningIntent}" asks for a tuning this build does not support ` +
        `(available: ${Object.values(TUNING_PRESETS).map((preset) => preset.displayName).join(", ")}).`,
    };
  }

  const named = TUNING_WORDS.find((entry) =>
    entry.phrases.some((phrase) => text.includes(` ${phrase} `)),
  );

  if (!named) {
    // Says nothing about tuning: the instrument's default stands.
    if (!TUNING_TOPIC.some((word) => text.includes(word))) {
      return {
        ok: true,
        status: "defaulted",
        tuningPresetId: fallback.id,
        tuning: fallback.tuning,
      };
    }
    // Talks about tuning, but not about one we have. Refused, never guessed.
    return {
      ok: false,
      status: "unsupported",
      reason:
        `tuning intent "${input.tuningIntent}" asks for a tuning this build does not support ` +
        `(available: ${Object.values(TUNING_PRESETS).map((preset) => preset.displayName).join(", ")}).`,
    };
  }

  /*
   * "Standard tuning" means the standard tuning *of this instrument*. A bass
   * asking for standard is asking for bass standard, not for the six-string
   * one it cannot physically hold — which is why tuning has to be resolved
   * after the instrument is known, not before.
   */
  const preset =
    named.presetId === "e_standard" && instrumentFamily(input.instrumentId) === "bass"
      ? defaultPresetFor(input.instrumentId)
      : presetById(named.presetId);
  if (!preset) {
    return {
      ok: false,
      status: "unsupported",
      reason: `tuning preset "${named.presetId}" is not in the registry`,
    };
  }

  if (!isCompatible(input.instrumentId, preset)) {
    return {
      ok: false,
      status: "incompatible",
      reason:
        `tuning "${preset.displayName}" has ${preset.tuning.length} strings and cannot be used on ` +
        `"${input.instrumentId}", which has ${fallback.tuning.length}.`,
    };
  }

  return {
    ok: true,
    status: "resolved",
    tuningPresetId: preset.id,
    tuning: preset.tuning,
  };
}
