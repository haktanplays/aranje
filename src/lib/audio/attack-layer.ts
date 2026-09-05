/**
 * What an attack does to a note, separated from what else the note is doing
 * (2V-D.1 §8).
 *
 * ## The shape of the defect
 *
 * The planner asked `articulation === "accent"` and returned a plan. Then it
 * asked `=== "palm_mute"` and returned a plan. Then `"ghost"`, `"dead"`,
 * `"tapping"`, the two harmonics, and finally the pitch branches. Every one
 * of them a complete answer, and therefore an exit — which is why an accented
 * bend played as an accent with no bend in it, and a pinch harmonic with a
 * bend written on it played as a squeal that never moved.
 *
 * Nothing was wrong with any of those plans. What was wrong is that they were
 * *plans*, when what an attack contributes is a **layer**: a level, a length,
 * a filter, and for a harmonic a constant offset in cents. None of those is
 * the whole note, and all of them compose with a pitch gesture that is asking
 * a different question.
 *
 * So this describes the contribution, and `composeAttack` applies it to
 * whatever the note is already doing. The numbers are the shipped presets
 * unchanged: this is the same audio, reachable in more combinations.
 *
 * ## Why cents add
 *
 * A harmonic and a bend both end up as one number on one `playbackRate`. A
 * natural harmonic is a step to +1200; a full bend is a ramp to +200; and a
 * bent harmonic is the harmonic, bent — +1400 at the top. Adding them is not
 * an approximation of that, it is that.
 */
import { expressionPresets } from "@/lib/audio/expression";
import type { PitchPoint } from "@/lib/audio/automation";
import type { Articulation, NoteAttack } from "@/lib/song/schema";

/** What one attack contributes. Every field is optional and composes. */
export type AttackLayer = {
  /** Multiplies the note's level. 1 leaves it alone. */
  readonly gainScale: number;
  /** Fraction of the note it is held for, when the attack shortens it. */
  readonly holdFraction?: number;
  /** An absolute cap on the length, in seconds. */
  readonly holdSeconds?: number;
  /** Rolled off, using a preset the voice already knows. */
  readonly filterPreset?: "palm_mute" | "dead";
  /** A constant offset in cents, for a harmonic. */
  readonly centsOffset?: number;
  /** How long the offset takes to arrive. Absent means immediately. */
  readonly centsRiseSeconds?: number;
  /** The level arrives over this long rather than landing, for a tap. */
  readonly attackSeconds?: number;
  /** The note is taken to silence at its end, for a dead note. */
  readonly endsSilent?: boolean;
};

/**
 * The layer for one attack, or null for a note that says nothing about it.
 *
 * Takes either the new `attack` field's values or the legacy articulation's,
 * because they are the same six strikings named twice and the audio is the
 * audio. `palm_mute` is here too: it is not an attack any more, but a song
 * written before spans still says it that way and still has to sound right.
 */
export function attackLayerFor(
  attack: NoteAttack | Articulation | undefined,
): AttackLayer | null {
  const preset = expressionPresets;
  switch (attack) {
    case "accent":
      return { gainScale: preset.accent.gainMultiplier };
    case "ghost":
      return {
        gainScale: preset.ghost.gainMultiplier,
        holdFraction: preset.ghost.holdFraction,
      };
    case "dead":
      return {
        gainScale: preset.dead.gainMultiplier,
        holdSeconds: preset.dead.holdSeconds,
        filterPreset: "dead",
        endsSilent: true,
      };
    case "tapping":
      return {
        gainScale: preset.tapping.gainMultiplier,
        attackSeconds: preset.tapping.attackSeconds,
      };
    case "natural_harmonic":
      return {
        gainScale: preset.harmonic.naturalGain,
        centsOffset: preset.harmonic.naturalCents,
      };
    case "pinch_harmonic":
      return {
        gainScale: preset.harmonic.pinchGain,
        centsOffset: preset.harmonic.pinchCents,
        centsRiseSeconds: preset.harmonic.pinchRiseSeconds,
      };
    default:
      return null;
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export type ComposedAttack = {
  readonly durationSeconds: number;
  readonly gainEnvelope: readonly { timeSeconds: number; value: number }[];
  readonly pitchAutomation: readonly PitchPoint[];
  readonly filterPreset?: "palm_mute" | "dead";
};

/**
 * Apply a layer to what the note is already doing.
 *
 * `pitchAutomation` comes in as whatever the pitch axis produced — a flat
 * line, a bend, a slide's travel — and comes out with the harmonic's offset
 * added to every point of it. A note with no pitch gesture has one flat point
 * and gets the harmonic alone, which is what it used to get.
 *
 * The gain envelope is built rather than merged, because there is only ever
 * one thing shaping it here: `gainScale` sets the level, `attackSeconds`
 * decides whether it lands or arrives, and `endsSilent` decides whether it
 * stops or fades. A note whose level is already being shaped by something
 * else — a slide's handoff — keeps its own envelope and takes only the scale,
 * which is why that is passed separately.
 */
export function composeAttack(
  layer: AttackLayer,
  input: {
    readonly gain: number;
    readonly durationSeconds: number;
    readonly pitchAutomation: readonly PitchPoint[];
  },
): ComposedAttack {
  let duration = input.durationSeconds;
  if (layer.holdFraction !== undefined) duration = duration * layer.holdFraction;
  if (layer.holdSeconds !== undefined) duration = Math.min(duration, layer.holdSeconds);
  duration = round(duration);

  const level = round(input.gain * layer.gainScale);
  const gainEnvelope: { timeSeconds: number; value: number }[] = [];
  if (layer.attackSeconds !== undefined) {
    /* No pick, so no pick transient: the level arrives rather than lands. */
    const rise = Math.min(layer.attackSeconds, duration / 2);
    gainEnvelope.push({ timeSeconds: 0, value: 0 });
    gainEnvelope.push({ timeSeconds: round(rise), value: level });
  } else {
    gainEnvelope.push({ timeSeconds: 0, value: level });
  }
  if (layer.endsSilent === true) {
    gainEnvelope.push({ timeSeconds: duration, value: 0 });
  }

  const offset = layer.centsOffset ?? 0;
  let pitchAutomation: readonly PitchPoint[] = input.pitchAutomation;
  if (offset !== 0) {
    const rise = layer.centsRiseSeconds;
    const shifted = input.pitchAutomation.map((point) => ({
      ...point,
      cents: round(point.cents + offset),
    }));
    pitchAutomation =
      rise === undefined
        ? shifted
        : /*
           * The squeal arrives a moment after the pick. The note starts where
           * the pitch axis put it and climbs to the harmonic from there, so a
           * pinch harmonic on a bent note starts at the bend's own beginning
           * rather than jumping to a pitch the string was never at.
           */
          [
            { ...(input.pitchAutomation[0] ?? { curve: "step" as const }), timeSeconds: 0, cents: round(input.pitchAutomation[0]?.cents ?? 0) },
            ...shifted.map((point) => ({
              ...point,
              timeSeconds: round(Math.max(point.timeSeconds, rise)),
              curve: point.timeSeconds <= rise ? ("linear" as const) : point.curve,
            })),
          ];
  }

  return {
    durationSeconds: duration,
    gainEnvelope,
    pitchAutomation,
    ...(layer.filterPreset === undefined ? {} : { filterPreset: layer.filterPreset }),
  };
}
