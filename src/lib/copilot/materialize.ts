/**
 * A blueprint becomes an empty Song (spec 11.8, K-31).
 *
 * Pure, deterministic and note-free. It builds the *shape* — sections, bars,
 * time signatures, tempos, which tracks are written where — and stops. Every
 * note still arrives through `arrange_track`, one track-section at a time,
 * through the same contract, the same locked surface and the same validators
 * as before. Nothing here widens what a model can write; it only gives the
 * arrange turns somewhere to write into.
 *
 * ## Identity is derived, never taken
 *
 * The blueprint's keys are internal. Song ids are made here from position and
 * role, so a model cannot name something the rest of the system will then
 * live with: not a section id that ends up in a validator path, not a track
 * id that ends up in a bar's slot map. The mapping is deterministic, so the
 * same blueprint always materialises to the same song, which is what makes
 * the fingerprint and the idempotency key mean anything.
 *
 * ## Silence is absence
 *
 * A track that does not play in a section gets **no key** in that section's
 * bars, which is how spec 5.5 spells silence. An array of nulls would be a
 * different statement — "this track plays nothing here" — and it would put
 * the track in the section for every reader that counts keys.
 */
import { instrumentFamily } from "@/lib/instruments/registry";
import { slotCount } from "@/lib/music/timing";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { songLimits } from "@/lib/limits";
import { songSchema, type Bar, type Section, type Song, type Track } from "@/lib/song/schema";
import type { ArrangeSkill } from "@/lib/copilot/contract";
import type { BlueprintTrack, CompositionBlueprint } from "@/lib/copilot/blueprint";

export type MaterializeFailure = {
  reason: string;
};

export type MaterializeResult =
  | { ok: true; song: Song; sectionIdByKey: Map<string, string>; trackIdByRole: Map<string, string> }
  | { ok: false; reason: string };

/**
 * Which instrument each role is realised on, and where it sits (spec 5.2,
 * 8.1, K-31).
 *
 * The pan is part of the *shape* of an arrangement, not a mixing afterthought:
 * two amplified guitars stacked dead centre fight each other for the same
 * frequencies in the same place, and the first S-02 render measured exactly
 * that — 0.00 dB of separation across the whole piece. Anything that carries
 * the middle of the mix on its own stays there.
 *
 * Conservative on purpose: wide enough to separate, never hard-panned, so a
 * listener on one earbud still hears the piece.
 */
const INSTRUMENT_BY_ROLE: Readonly<
  Record<ArrangeSkill, { instrumentId: string; presetId: string; pan: number }>
> = {
  rhythm_guitar: { instrumentId: "electric_guitar", presetId: "high_gain", pan: -0.3 },
  lead_guitar: { instrumentId: "electric_guitar", presetId: "high_gain", pan: 0.25 },
  harmony: { instrumentId: "electric_guitar", presetId: "clean", pan: 0.35 },
  // Alone in its section, so it belongs in the middle.
  acoustic_guitar: { instrumentId: "steel_acoustic", presetId: "finger", pan: 0 },
  bass: { instrumentId: "electric_bass", presetId: "finger", pan: 0 },
  drums: { instrumentId: "drum_kit", presetId: "rock", pan: 0 },
};

/** Tuning words to a preset. Unrecognised wording falls back to standard. */
function tuningFor(intent: string): readonly string[] {
  const text = intent.toLowerCase();
  if (text.includes("drop d")) return TUNING_PRESETS.drop_d?.tuning ?? [];
  if (text.includes("bass")) return TUNING_PRESETS.bass_standard?.tuning ?? [];
  return TUNING_PRESETS.e_standard?.tuning ?? [];
}

/** `sec-1`, `sec-2`, ... — position, not anything the model chose. */
export function sectionIdFor(index: number): string {
  return `sec-${index + 1}`;
}

/** `rhythm_guitar`, `rhythm_guitar-2`, ... — role, then an ordinal if shared. */
export function trackIdFor(role: ArrangeSkill, ordinal: number): string {
  return ordinal === 0 ? role : `${role}-${ordinal + 1}`;
}

function trackFor(entry: BlueprintTrack, id: string, name: string): Track {
  const instrument = INSTRUMENT_BY_ROLE[entry.role];
  const needsFretboard = instrumentFamily(instrument.instrumentId) !== "drums";
  return {
    id,
    name,
    instrumentId: instrument.instrumentId,
    presetId: instrument.presetId,
    volumeDb: -4,
    // Absent rather than zero: the centre is the default, and writing it
    // would put a number in the Song that says nothing (spec 5.2).
    ...(instrument.pan === 0 ? {} : { pan: instrument.pan }),
    ...(needsFretboard
      ? { fretboard: { tuning: [...tuningFor(entry.tuningIntent)], capo: 0 } }
      : {}),
  };
}

/**
 * Build the skeleton, or say why it cannot be built.
 *
 * The refusals here are all shape: a section naming a track that does not
 * exist, a piece longer than the pilot allows. Musical judgement is not this
 * function's business.
 */
export function materializeSongSkeleton(
  blueprint: CompositionBlueprint,
  options: { title: string; key?: string } = { title: "Untitled" },
): MaterializeResult {
  const totalBars = blueprint.sections.reduce((sum, s) => sum + s.bars, 0);
  if (totalBars > songLimits.totalBars) {
    return {
      ok: false,
      reason: `blueprint asks for ${totalBars} bars; the limit is ${songLimits.totalBars}`,
    };
  }

  const sectionKeys = new Set(blueprint.sections.map((s) => s.key));
  if (sectionKeys.size !== blueprint.sections.length) {
    return { ok: false, reason: "two sections share an internal key" };
  }

  // Track ids: role first, then an ordinal only when a role repeats.
  const seenRoles = new Map<ArrangeSkill, number>();
  const trackIdByRole = new Map<string, string>();
  const tracks: Track[] = [];
  for (const entry of blueprint.tracks) {
    const ordinal = seenRoles.get(entry.role) ?? 0;
    seenRoles.set(entry.role, ordinal + 1);
    const id = trackIdFor(entry.role, ordinal);
    // The first track of a role is the one that role's turns will target.
    if (ordinal === 0) trackIdByRole.set(entry.role, id);
    tracks.push(trackFor(entry, id, entry.energyJob.slice(0, 40)));
  }

  if (tracks.length > songLimits.maxTracks) {
    return { ok: false, reason: `blueprint asks for ${tracks.length} tracks` };
  }

  const sectionIdByKey = new Map<string, string>();
  blueprint.sections.forEach((section, index) => {
    sectionIdByKey.set(section.key, sectionIdFor(index));
  });

  const sections: Section[] = [];
  for (const [index, section] of blueprint.sections.entries()) {
    for (const role of section.activeRoles) {
      if (!blueprint.tracks.some((t) => t.role === role)) {
        return {
          ok: false,
          reason: `section "${section.key}" activates role "${role}", which no track has`,
        };
      }
    }

    const active = new Set(section.activeRoles);
    const count = slotCount(section.timeSignature, blueprint.resolution);

    const bar = (): Bar => {
      const slots: Bar["slots"] = {};
      for (const entry of blueprint.tracks) {
        if (!active.has(entry.role)) continue; // silence is absence (spec 5.5)
        const id = trackIdByRole.get(entry.role);
        if (id === undefined) continue;
        slots[id] =
          entry.role === "drums"
            ? Array.from({ length: count }, () => [])
            : Array.from({ length: count }, () => null);
      }
      return {
        timeSignature: section.timeSignature,
        resolution: blueprint.resolution,
        slots,
      };
    };

    sections.push({
      id: sectionIdFor(index),
      name: section.displayName,
      status: "fixed",
      // Only written when it differs from the piece's own tempo, so a song at
      // one tempo carries no overrides at all (spec 8.3, K-25).
      ...(section.bpm === baseBpm(blueprint) ? {} : { bpmOverride: section.bpm }),
      bars: Array.from({ length: section.bars }, bar),
    });
  }

  const parsed = songSchema.safeParse({
    version: 2,
    title: options.title,
    bpm: baseBpm(blueprint),
    key: options.key ?? blueprint.tonalCenter,
    tracks,
    sections,
  });
  if (!parsed.success) {
    return { ok: false, reason: `skeleton does not parse: ${parsed.error.message}` };
  }

  return { ok: true, song: parsed.data, sectionIdByKey, trackIdByRole };
}

/**
 * The piece's own tempo: the one the most bars are written at.
 *
 * Choosing the commonest rather than the first means the fewest sections need
 * an override, so a song at one tempo carries none. Ties go to the earliest
 * section, so the answer is deterministic.
 */
export function baseBpm(blueprint: CompositionBlueprint): number {
  const barsAt = new Map<number, number>();
  for (const section of blueprint.sections) {
    barsAt.set(section.bpm, (barsAt.get(section.bpm) ?? 0) + section.bars);
  }
  let best = blueprint.sections[0]?.bpm ?? 120;
  let bestBars = -1;
  for (const section of blueprint.sections) {
    const bars = barsAt.get(section.bpm) ?? 0;
    if (bars > bestBars) {
      bestBars = bars;
      best = section.bpm;
    }
  }
  return best;
}

/**
 * How long the blueprint will actually last, and whether that is what it
 * said it wanted (spec 11.8, K-31).
 *
 * Computed from the same arithmetic the tempo timeline uses — beats per bar
 * divided by the section's own tempo — so a plan cannot claim sixty seconds
 * and materialise to ninety. This is a check on the *plan*, before a single
 * note is asked for, which is the cheapest place to find out.
 */
export function blueprintDurationSeconds(blueprint: CompositionBlueprint): number {
  let seconds = 0;
  for (const section of blueprint.sections) {
    const [beats, unit] = section.timeSignature;
    // A bar is `beats` notes of length 1/unit; a quarter is one beat at 60/bpm.
    const beatsPerBar = (beats * 4) / unit;
    seconds += (section.bars * beatsPerBar * 60) / section.bpm;
  }
  return seconds;
}

export type DurationVerdict = {
  seconds: number;
  target: number;
  tolerance: number;
  withinTolerance: boolean;
  /** Signed: positive means the plan runs long. */
  driftSeconds: number;
};

export function checkBlueprintDuration(
  blueprint: CompositionBlueprint,
): DurationVerdict {
  const seconds = blueprintDurationSeconds(blueprint);
  const drift = seconds - blueprint.targetDurationSeconds;
  return {
    seconds,
    target: blueprint.targetDurationSeconds,
    tolerance: blueprint.durationToleranceSeconds,
    withinTolerance: Math.abs(drift) <= blueprint.durationToleranceSeconds,
    driftSeconds: drift,
  };
}
