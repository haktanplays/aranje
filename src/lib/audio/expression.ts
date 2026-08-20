/**
 * What each articulation actually does, as numbers (spec 8.5, K-21).
 *
 * Every starting value the expressive layer uses lives here and nowhere else.
 * A number repeated in a component, in the scheduler and in a voice class is
 * three numbers that will disagree the first time one of them is tuned, and
 * "why does the bend sound different in the preview?" is not a question worth
 * having to answer.
 *
 * These are **starting** values. They are not a claim that the result is
 * realistic; that is decided by listening, and the WAV renders exist for
 * exactly that.
 */
import type { Articulation } from "@/lib/song/schema";

/** A semitone in cents, so no code has to write 100 and mean "a semitone". */
export const CENTS_PER_SEMITONE = 100;

export const expressionPresets = {
  vibrato: {
    /** Peak deviation either side of the written pitch. */
    depthCents: 35,
    rateHz: 5.5,
    /** The hand does not shake the instant the note starts. */
    maxDelaySeconds: 0.12,
    delayFraction: 0.25,
    /** How finely the sine is written out as automation points. */
    pointsPerCycle: 12,
  },
  /**
   * Bend v2 (spec 8.5, K-22).
   *
   * v1 split the note into fixed percentages, which is wrong for a long one:
   * a four-second sustain spent more than two seconds climbing, and a bend
   * that takes two seconds to arrive does not sound like a hand, it sounds
   * like a machine. So the shape still scales with the music, but the rise and
   * the release have real floors and ceilings in seconds.
   */
  bend: {
    halfCents: CENTS_PER_SEMITONE,
    fullCents: CENTS_PER_SEMITONE * 2,
    /** The pick lands before the hand starts pushing. */
    settleSeconds: 0.035,
    /** On a very short note the settle cannot eat the whole note. */
    settleMaxFraction: 0.08,
    riseFraction: 0.22,
    riseMinSeconds: 0.08,
    riseMaxSeconds: 0.28,
    releaseFraction: 0.12,
    releaseMinSeconds: 0.06,
    releaseMaxSeconds: 0.18,
    /** How finely the eased rise and release are written out. */
    curvePoints: 6,
    /**
     * The "expressive" profile only. Not a second articulation and never
     * written to the song: it is a playback character for the same bend.
     */
    top: {
      depthCents: 10,
      rateHz: 5,
      /** The hand settles on the target before it starts moving again. */
      startDelaySeconds: 0.04,
      pointsPerCycle: 10,
    },
  },
  slide: {
    maxGlideSeconds: 0.16,
    glideFraction: 0.35,
    /** Further than this and it is a jump, not a slide (spec 8.5). */
    maxIntervalSemitones: 12,
  },
  /**
   * Hammer-on and pull-off (spec 8.5, K-22).
   *
   * v1 played the target as a quieter copy of the same onset, which is exactly
   * what a hammer-on is not: the string never stops, and the finger changes
   * the pitch of a note that is already ringing. So these numbers describe a
   * **transition on a voice that keeps playing**, not a second attack.
   */
  legato: {
    hammerOn: {
      transitionSeconds: 0.022,
      /** What the ringing voice keeps after the finger lands. */
      levelAfter: 0.88,
    },
    pullOff: {
      transitionSeconds: 0.028,
      levelAfter: 0.78,
      /**
       * A pull-off plucks the string sideways on the way off, so it has a
       * little more bite than a hammer-on. This is that click — short, quiet
       * and filtered, and never a stand-in for the note itself.
       */
      auxiliary: {
        gain: 0.16,
        maxSeconds: 0.035,
        filterHz: 4500,
      },
    },
    /** Further than this and the hand is jumping, not slurring. */
    maxIntervalSemitones: 5,
  },
  palmMute: {
    /** At most this much of the written length, and never longer than the cap. */
    holdFraction: 0.45,
    maxHoldSeconds: 0.18,
    releaseSeconds: 0.04,
    /** A gentle roll-off rather than a wall; palm muting is not a filter sweep. */
    filterHz: 2200,
    filterQ: 0.7,
  },
  accent: {
    /**
     * Conservative on purpose: the master chain has no headroom to spare and
     * an accent that clips is not an accent, it is a fault.
     */
    gainMultiplier: 1.18,
  },
} as const;

/** The eight the pilot actually plays differently (spec 8.5). */
export const EXPRESSIVE_ARTICULATIONS = [
  "accent",
  "palm_mute",
  "vibrato",
  "bend_half",
  "bend_full",
  "slide",
  "hammer_on",
  "pull_off",
] as const;

export type ExpressiveArticulation = (typeof EXPRESSIVE_ARTICULATIONS)[number];

export function isExpressive(
  articulation: Articulation | undefined,
): articulation is ExpressiveArticulation {
  return (
    articulation !== undefined &&
    (EXPRESSIVE_ARTICULATIONS as readonly string[]).includes(articulation)
  );
}

/** The three that need a pitch to move; the rest only shape level and length. */
export function movesPitch(articulation: Articulation | undefined): boolean {
  return (
    articulation === "vibrato" ||
    articulation === "bend_half" ||
    articulation === "bend_full" ||
    articulation === "slide" ||
    articulation === "hammer_on" ||
    articulation === "pull_off"
  );
}

/** The two that only make sense after another note on the same string. */
export function needsPrevious(articulation: Articulation | undefined): boolean {
  return (
    articulation === "slide" ||
    articulation === "hammer_on" ||
    articulation === "pull_off"
  );
}

export function bendTargetCents(articulation: Articulation): number {
  return articulation === "bend_full"
    ? expressionPresets.bend.fullCents
    : expressionPresets.bend.halfCents;
}
