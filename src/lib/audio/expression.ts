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
     * The written release, as a movement rather than an ending (2V-C.2 §6).
     *
     * The four numbers above shape the release the legacy `bend_half` /
     * `bend_full` enum has always had, and they are not touched: an old song
     * must sound on the day this was added exactly as it did the day before.
     * These are the ones the explicit `bend_release` gesture uses, and they
     * exist because the measurement said the old ones were wrong for it.
     *
     * What the trace showed: the descent took 0.138s against a 0.211s rise —
     * a hand that lets go half again as fast as it pushed — and it landed on
     * the written pitch at the note's very last sample. So the listener never
     * heard the note arrive anywhere. It heard a fall, and then silence,
     * which is why "geri indir tam tatmin etmedi".
     *
     * `ratioToRise` is therefore at least 1: relaxing is never quicker than
     * pushing. `rest` is the part that was missing entirely — the stretch at
     * the end where the note is simply the note again, which is what makes
     * the return a movement that finished rather than one that was cut off.
     * Both are clamped so a long note does not turn the gesture into a slow
     * effect and a short one still gets a rest it can be heard in; when even
     * the clamps do not fit, every stage is squeezed by the same factor, so
     * the character survives and nothing is written past the note.
     */
    release: {
      ratioToRise: 1.15,
      minSeconds: 0.1,
      maxSeconds: 0.34,
      restFraction: 0.12,
      restMinSeconds: 0.07,
      restMaxSeconds: 0.26,
    },
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
  /**
   * Slide (spec 8.5, K-23).
   *
   * v1 put an 80ms ramp at the *start* of the target note, underneath its own
   * pick attack, where nobody could hear it — so a slide sounded like an
   * ordinary restrike. A slide is not a way of beginning a note: it is the
   * hand travelling along the string **into** it. So the glide happens in the
   * previous note's tail and arrives exactly when the target is written.
   */
  slide: {
    /** How long the hand takes per semitone before the clamps below. */
    msPerSemitone: 45,
    minGlideSeconds: 0.12,
    maxGlideSeconds: 0.36,
    /** The source note is heard as itself before the hand starts moving. */
    minLeadSeconds: 0.02,
    /** Below this nobody hears a slide, so it is not played as one. */
    minAudibleSeconds: 0.09,
    /** How finely the eased travel is written out. */
    curvePoints: 8,
    /** Further than this and it is a jump, not a slide. */
    maxIntervalSemitones: 12,
    /**
     * Leaving a note is not entering one backwards (2V-C.2 §11).
     *
     * A slide-in arrives *into* the note: the hand lands, the pitch settles,
     * and the note carries on at full voice for the rest of its length. A
     * slide-out has no note to arrive at. The hand keeps moving as the string
     * is let go, and what the ear follows on the way out is the sound
     * leaving, not a pitch being reached — which is why the exit gets a fade
     * the entry must not have, and why mirroring one curve for both would be
     * wrong rather than economical.
     *
     * The trace showed the exit at full gain right up to the note's last
     * sample, which is a whammy dive cut with scissors. This is how far the
     * voice has fallen by then. Not zero: the note is still stopping, and a
     * ramp that reaches silence early would take the tail with it.
     */
    outFadeToFraction: 0.12,
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
      /**
       * What the ringing voice keeps after the finger lands.
       *
       * 2T-C §10 moved this from 0.88 and the pull-off's from 0.78, because
       * the two together said something untrue about the instrument: 1 dB
       * between them, when the two gestures do opposite things to the
       * string's energy. A hammer-on *drives* the string onto the fret and
       * puts energy in; a pull-off releases a string whose sounding length
       * has just grown, and takes energy out. The pair is now 2.15 dB apart,
       * which is twice the smallest level difference a listener can name.
       */
      levelAfter: 0.92,
      /**
       * The finger landing (2T-C §10).
       *
       * A hammer-on had no moment of arrival at all: the pitch changed and
       * nothing else happened, which is why it sounded like a pitch envelope
       * rather than like a hand. Measured on `6ded910`, the only thing
       * separating it from a pull-off was 1.72 dB of level — under the two
       * decibels a listener can rely on hearing away from a quiet room.
       *
       * So it gets the noise it makes. A fingertip driving the string down
       * onto a fret is duller and quieter than a nail plucking the string
       * sideways on the way off, so both numbers sit below the pull-off's:
       * this is the same event, made by a different part of the hand.
       */
      auxiliary: {
        gain: 0.11,
        maxSeconds: 0.028,
        filterHz: 2000,
      },
    },
    pullOff: {
      transitionSeconds: 0.028,
      /** The other half of the pair above: the hand takes energy out. */
      levelAfter: 0.72,
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
    /**
     * The most of a note a finger landing may take (2S-A §3).
     *
     * A hammer-on's or a pull-off's travel time used to be a constant, and a
     * constant cannot be right at every tempo and every grid: at 1/32 the
     * 28 ms of a pull-off ate more than half the note it was landing on, and
     * at 1/32 with 260 BPM the voice stopped before the pitch had arrived, so
     * the target's own pitch was never sounded at all (measured, and written
     * down in `eval/intent-composer/FINDINGS.md`).
     *
     * The slide already asked this question — `glideFor` fits the travel into
     * the room there is — and this is the same question asked for the other
     * two. The rest of the note belongs to the pitch the reader wrote.
     */
    maxTravelFraction: 0.4,
  },
  /**
   * Coming back from a pause (2V-B.1 §7).
   *
   * A voice that was cut off mid-note is restarted from the point in its own
   * sample where it stopped, and a buffer source opened at full level makes a
   * click at the seam. This is the shortest ramp that removes the seam and is
   * still far below the length of any attack in the pack, so it cannot stand
   * in for one.
   *
   * It is an engineering number, not a claim about how the resume sounds.
   * Nothing in this repository has listened to it; the founder's ear decides
   * that, and §7 forbids anyone else claiming to have.
   */
  resume: {
    fadeSeconds: 0.005,
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
  /*
   * 2T-C §9. Five techniques that have to be heard, not only drawn.
   *
   * Each number below is a claim about what a hand does, and each is
   * measurable in a render — level, length, attack time, or where the pitch
   * sits. Nothing here is a marker that leaves the sound alone.
   */
  ghost: {
    /** Barely fretted: the note is there and deliberately under everything. */
    gainMultiplier: 0.45,
    /** It does not ring on either; the finger is not pressing hard enough. */
    holdFraction: 0.6,
  },
  dead: {
    /**
     * No definite pitch at all — the string is damped and struck, so what is
     * left is a short broadband knock. Short enough that no listener hears a
     * note in it, and rolled off so it does not read as a muted chord.
     */
    holdSeconds: 0.055,
    gainMultiplier: 0.55,
    filterHz: 1200,
    filterQ: 0.9,
  },
  tapping: {
    /**
     * Struck by the fretting hand, so there is no pick in it. The difference
     * a listener actually hears is the attack: a finger arriving on a
     * fingerboard has a softer front than a plectrum crossing a string.
     */
    gainMultiplier: 0.85,
    attackSeconds: 0.014,
  },
  harmonic: {
    /**
     * A natural harmonic sounds a node of the string rather than the stopped
     * length. This models the twelfth-fret node — one octave up — which is
     * the common case and the only one the score currently says enough to
     * know. A written harmonic at another node will sound an octave rather
     * than its own interval, and that limit is recorded here rather than
     * hidden: the alternative is guessing a node the reader never named.
     */
    naturalCents: 1200,
    naturalGain: 0.7,
    /**
     * A pinch harmonic is the fretted note squealing an octave and a fifth
     * above, and it is loud — that is the whole point of using one.
     */
    pinchCents: 1900,
    pinchGain: 0.95,
    /** The squeal arrives a moment after the pick, not with it. */
    pinchRiseSeconds: 0.03,
  },
  /**
   * A strum, which is not an articulation at all (2T-C §9).
   *
   * A strummed chord is one written onset, and the hand still takes real time
   * to cross the strings. That crossing is the entire audible difference
   * between a strum and a block chord, and it has a direction: down starts at
   * the thickest string, up starts at the thinnest.
   *
   * The spread is in seconds rather than in ticks because it is a property of
   * the arm, not of the tempo — a guitarist's hand does not cross the strings
   * twice as slowly because the song is at half speed.
   */
  strum: {
    /** Between one string and the next. */
    perStringSeconds: 0.014,
    /**
     * A short chord may not have room for the full crossing. It is spread
     * into the room there is rather than played over the top of the next
     * onset, which is the same rule the legato travel already follows.
     */
    maxSpreadFraction: 0.5,
  },
} as const;

/**
 * The articulations that are actually played differently (spec 8.5, 2T-C §9).
 *
 * Eight in the pilot; thirteen now. Membership here is not decoration — a
 * technique in this list has a branch in the planner that changes level,
 * length, attack or pitch, and `technique-matrix.test.ts` proves it by
 * planning one and comparing it with a plain note.
 */
export const EXPRESSIVE_ARTICULATIONS = [
  "accent",
  "palm_mute",
  "vibrato",
  "bend_half",
  "bend_full",
  "slide",
  "hammer_on",
  "pull_off",
  "ghost",
  "dead",
  "tapping",
  "natural_harmonic",
  "pinch_harmonic",
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
