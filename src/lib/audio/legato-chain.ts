/**
 * Slurred notes as one continuing sound (spec 8.5, K-22, K-23).
 *
 * Phase 2F played the target of a hammer-on as a quieter copy of the same
 * onset. That is not what a hammer-on is. The string is already ringing; the
 * finger changes the pitch of a sound that never stopped. Restriking it — even
 * quietly — gives back the pick attack the articulation exists to avoid, which
 * is why the measurements of a restrike and a hammer-on came out almost
 * identical and why it did not pass a listening test.
 *
 * So a run of hammer-ons and pull-offs on one string is modelled here as a
 * **chain**: one voice, started once at the source pitch, whose pitch is moved
 * at each transition and which is released once at the end. `5h7p5` is one
 * voice and two transitions, not three notes.
 *
 * Phase 2F.2 brought the slide into the same model, and it needed one more
 * idea. A hammer-on happens *at* the target: the finger lands and the pitch
 * changes there. A slide happens *before* it: the hand is already travelling
 * while the previous note rings, and the target's written time is when it
 * **arrives**. Putting the glide after the target onset — which is what v1
 * did — hides it under the attack of the note it is supposed to be arriving
 * at, and it stops sounding like a slide at all.
 *
 * So a transition carries two times, not one: when the pitch starts moving and
 * when it gets there. For a hammer-on those are the target onset and a few
 * milliseconds later; for a slide they straddle it.
 *
 * The song is not changed by any of this. Every note stays a note in the
 * timeline and in the scheduler's snapshot; what the chain decides is only how
 * those notes are **rendered**.
 */
import { CENTS_PER_SEMITONE, expressionPresets } from "@/lib/audio/expression";
import { legatoLink, type LegatoOnset } from "@/lib/music/legato";
import {
  durationSeconds,
  secondsAtTicks,
  type TempoMap,
} from "@/lib/audio/tempo";

export type LegatoTransitionKind = "hammer_on" | "pull_off" | "slide";

/** One point of a transition's pitch travel, timed from the chain's start. */
export type TransitionPoint = {
  timeSeconds: number;
  /** Cents against the pitch the chain started on. */
  cents: number;
  curve: "step" | "linear";
};

export type LegatoAuxiliary = {
  /** Level relative to full scale; deliberately far below a real attack. */
  gain: number;
  durationSeconds: number;
  filterHz: number;
};

export type LegatoTransition = {
  kind: LegatoTransitionKind;
  /**
   * When the pitch starts moving, from the chain's own start.
   *
   * For a hammer-on or a pull-off this is the target's onset. For a slide it
   * is **earlier**: the hand sets off during the previous note.
   */
  atSeconds: number;
  /**
   * When the pitch gets there. For a slide this is exactly the target's
   * notated onset (spec 8.5, K-23).
   */
  arrivesAtSeconds: number;
  fromPitch: string;
  toPitch: string;
  /** Signed, against the pitch before it. */
  intervalCents: number;
  /** Signed, against the pitch the chain started on. */
  cumulativeCents: number;
  transitionSeconds: number;
  /** What the ringing voice keeps once the finger has landed. */
  levelAfter: number;
  /** The note this transition belongs to, so a diagnostic can point at it. */
  noteId: string;
  /** The pitch travel, written out. The voice replays exactly these. */
  points: TransitionPoint[];
  /**
   * The short noise the fretting hand makes: a pull-off's pluck coming off
   * the string, or a hammer-on's landing on the fret. A slide has neither.
   */
  auxiliary?: LegatoAuxiliary;
};

export type LegatoChain = {
  /** Canonical and deterministic: track, string and the source's own tick. */
  chainId: string;
  trackId: string;
  stringIndex: number;
  sourcePitch: string;
  startSeconds: number;
  endSeconds: number;
  /** The same start in ticks, so the transport can schedule it. */
  startTicks: number;
  /** Source first, then each target, in playing order. */
  noteIds: readonly string[];
  transitions: readonly LegatoTransition[];
  /** The source note's level; every transition scales down from here. */
  gain: number;
};

/** Why a slur could not become a chain. */
export type LegatoRefusal =
  | "no_previous_note"
  | "previous_note_other_string"
  | "wrong_direction"
  | "interval_too_wide"
  | "not_fretted"
  /** There is not enough room before the target to hear the hand travel. */
  | "no_room_to_glide";

export type LegatoDecision =
  | {
      kind: "joined";
      previous: LegatoOnset;
      transition: LegatoTransitionKind;
      /** Slide only, and only when the decision was given a clock. */
      glideSeconds?: number;
    }
  | { kind: "refused"; reason: LegatoRefusal };

/**
 * The clock a slide has to be measured against.
 *
 * A hammer-on is playable or not on the notes alone. A slide is not: it also
 * has to fit in the time between the two onsets, and that is a question about
 * tempo. Callers that know the clock pass it; callers that only want the
 * fretboard rules leave it out.
 */
export type LegatoTiming = {
  /** The song's tempo timeline, so a slur that straddles a tempo change is
   *  measured on both sides of it (spec 8.3, K-25). */
  tempo: TempoMap;
  /** 1 at full speed, 2 at half speed (spec 13.8). */
  timeScale: number;
};

/**
 * Can this note continue the one before it?
 *
 * One place decides, so the validator's warning and the renderer's fallback
 * can never disagree about whether a slur is playable.
 */
export function legatoDecision(
  onsets: readonly LegatoOnset[],
  index: number,
  timing?: LegatoTiming,
): LegatoDecision | null {
  const onset = onsets[index];
  if (!onset) return null;

  const articulation = onset.articulation;
  if (
    articulation !== "hammer_on" &&
    articulation !== "pull_off" &&
    articulation !== "slide"
  ) {
    return null;
  }

  if (onset.fret === null || onset.midi === null) {
    return { kind: "refused", reason: "not_fretted" };
  }

  const link = legatoLink(onsets, index);
  if (link.kind === "other_string") {
    return { kind: "refused", reason: "previous_note_other_string" };
  }
  if (link.kind === "none") {
    return { kind: "refused", reason: "no_previous_note" };
  }

  const previous = link.previous;
  if (previous.midi === null || previous.fret === null) {
    return { kind: "refused", reason: "no_previous_note" };
  }

  const rising = onset.midi > previous.midi;
  if (articulation === "hammer_on" && !rising) {
    return { kind: "refused", reason: "wrong_direction" };
  }
  if (articulation === "pull_off" && onset.midi >= previous.midi) {
    return { kind: "refused", reason: "wrong_direction" };
  }

  const interval = Math.abs(onset.midi - previous.midi);

  if (articulation === "slide") {
    // A slide has no direction rule — the hand goes either way — but it does
    // have a distance beyond which it is a jump.
    if (interval === 0 || interval > expressionPresets.slide.maxIntervalSemitones) {
      return { kind: "refused", reason: "interval_too_wide" };
    }
    if (!timing) return { kind: "joined", previous, transition: articulation };

    const gap = durationSeconds(
      timing.tempo,
      previous.timeTicks,
      onset.timeTicks - previous.timeTicks,
    );
    const glide = glideFor(onset.midi - previous.midi, gap, timing.timeScale);
    if (glide.kind === "too_tight") {
      return { kind: "refused", reason: "no_room_to_glide" };
    }
    return {
      kind: "joined",
      previous,
      transition: articulation,
      glideSeconds: glide.seconds,
    };
  }

  if (interval > expressionPresets.legato.maxIntervalSemitones) {
    return { kind: "refused", reason: "interval_too_wide" };
  }

  return { kind: "joined", previous, transition: articulation };
}

/** How long the hand should take to travel this far, before the clamps. */
export function desiredGlideSeconds(
  intervalSemitones: number,
  timeScale = 1,
): number {
  const preset = expressionPresets.slide;
  const wanted = (Math.abs(intervalSemitones) * preset.msPerSemitone) / 1000;
  return (
    Math.min(preset.maxGlideSeconds, Math.max(preset.minGlideSeconds, wanted)) *
    timeScale
  );
}

export type GlidePlan =
  | { kind: "glide"; seconds: number; desiredSeconds: number }
  /** There is not enough room between the two notes to hear a slide. */
  | { kind: "too_tight"; availableSeconds: number; desiredSeconds: number };

/**
 * How long the travel actually gets.
 *
 * It cannot start before the source note has been heard as itself, and it must
 * finish exactly when the target is written. If what is left over is too short
 * to hear, it is not played as a slide at all (spec 8.5, K-23).
 */
export function glideFor(
  intervalSemitones: number,
  availableSeconds: number,
  timeScale = 1,
): GlidePlan {
  const preset = expressionPresets.slide;
  const desiredSeconds = desiredGlideSeconds(intervalSemitones, timeScale);
  const room = availableSeconds - preset.minLeadSeconds * timeScale;

  if (room < preset.minAudibleSeconds * timeScale) {
    return { kind: "too_tight", availableSeconds: Math.max(0, room), desiredSeconds };
  }

  return { kind: "glide", seconds: Math.min(desiredSeconds, room), desiredSeconds };
}

/** Gentle away, quick through the middle, controlled on arrival. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The pitch travel of one transition, written out as points.
 *
 * A single linear ramp is what v1 used, and it is the wrong shape: a hand does
 * not move at a constant speed and the ear reads the constant one as a
 * portamento effect rather than as a finger. The last point lands exactly on
 * the target, so there is no overshoot and nothing to correct afterwards.
 */
export function transitionPoints(
  kind: LegatoTransitionKind,
  startsAt: number,
  arrivesAt: number,
  fromCents: number,
  toCents: number,
): TransitionPoint[] {
  if (kind !== "slide") {
    // A finger landing is one short move; it was accepted in 2F.1 and is not
    // being re-tuned here.
    return [
      { timeSeconds: startsAt, cents: fromCents, curve: "step" },
      { timeSeconds: arrivesAt, cents: toCents, curve: "linear" },
    ];
  }

  const steps = expressionPresets.slide.curvePoints;
  const span = arrivesAt - startsAt;
  const points: TransitionPoint[] = [
    { timeSeconds: startsAt, cents: fromCents, curve: "step" },
  ];

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    points.push({
      timeSeconds: startsAt + span * t,
      cents: fromCents + (toCents - fromCents) * smoothstep(t),
      curve: "linear",
    });
  }

  // The last point is the target exactly, whatever the curve did on the way.
  points[points.length - 1] = {
    timeSeconds: arrivesAt,
    cents: toCents,
    curve: "linear",
  };

  return points;
}

/**
 * How long a finger landing takes, given the room the music leaves for it
 * (spec 8.5, K-22; 2S-A §3).
 *
 * `availableSeconds` is the target note's own sounding length: from its
 * written onset to the moment the chain's voice stops, which is where the
 * next thing begins. The travel takes at most `maxTravelFraction` of it, so
 * what is left is the target's own pitch — which is the note the reader
 * wrote, and the only reason the note is there.
 *
 * Nothing here moves an onset, changes a length or rounds a tick. The written
 * moment of the target is the written moment at every tempo; what shortens is
 * only how long the hand is allowed to be on its way there.
 *
 * Passing no room at all gives back the preset, which is what a caller that
 * does not know the clock should get — the same shape `legatoDecision` has.
 */
export function transitionSeconds(
  kind: LegatoTransitionKind,
  timeScale = 1,
  availableSeconds?: number,
): number {
  const preset =
    kind === "hammer_on"
      ? expressionPresets.legato.hammerOn
      : expressionPresets.legato.pullOff;
  const wanted = preset.transitionSeconds * timeScale;
  if (availableSeconds === undefined) return wanted;
  const room = Math.max(0, availableSeconds);
  return Math.min(wanted, room * expressionPresets.legato.maxTravelFraction);
}

export function chainIdFor(
  trackId: string,
  stringIndex: number,
  sourceTicks: number,
): string {
  return `${trackId}:${stringIndex}:${sourceTicks}`;
}

/** Where a note sits in a chain, if it is in one. */
export type ChainRole = "source" | "target";

export type ChainMembership = {
  chainId: string;
  role: ChainRole;
};

export type ChainBuildInput = {
  trackId: string;
  onsets: readonly LegatoOnset[];
  /** Ticks to seconds, section tempos included (spec 8.3, K-25). */
  tempo: TempoMap;
  timeScale: number;
  /** The note id of each onset, by index, so the chain can name its members. */
  noteIds: readonly string[];
  /** Linear gain of each onset, by index. */
  gains: readonly number[];
  /** Off renders a pull-off with no finger click. Render comparisons only. */
  withAuxiliary?: boolean;
  /** Leaves slides to the old per-note path. Render comparisons only. */
  skipSlides?: boolean;
};

export type ChainBuildResult = {
  chains: LegatoChain[];
  /** Which chain each onset belongs to, by onset index. */
  membership: Map<number, ChainMembership>;
  /** Why an onset could not join one, by onset index. */
  refusals: Map<number, LegatoRefusal>;
};

/**
 * Every legato chain of one track.
 *
 * A chain grows while each new note joins the one before it. Anything that
 * ends a sounding note — a rest, a bar the track is not written in, a jump to
 * another string — ends the chain too, because those are the same thing.
 */
export function buildLegatoChains(input: ChainBuildInput): ChainBuildResult {
  const { onsets, tempo, timeScale, noteIds, gains } = input;
  const chains: LegatoChain[] = [];
  const membership = new Map<number, ChainMembership>();
  const refusals = new Map<number, LegatoRefusal>();

  /** Index of the onset each chain currently ends on. */
  const openChains = new Map<string, { chain: LegatoChain; lastIndex: number }>();

  onsets.forEach((onset, index) => {
    if (input.skipSlides && onset.articulation === "slide") return;

    // The decision is given the clock, so "there is no room to slide here" is
    // answered once, before a chain is opened for a transition that cannot
    // happen. A source sitting in a chain with no transitions is a half chain,
    // which is not a thing that can be played.
    const decision = legatoDecision(onsets, index, { tempo, timeScale });
    if (!decision) return;
    if (decision.kind === "refused") {
      refusals.set(index, decision.reason);
      return;
    }

    const previousIndex = onsets.indexOf(decision.previous);
    if (previousIndex < 0) return;

    const previous = decision.previous;
    if (previous.midi === null || onset.midi === null) return;

    const glideSeconds = decision.glideSeconds ?? null;

    const existing = membership.get(previousIndex);
    let entry = existing ? openChains.get(existing.chainId) : undefined;

    if (!entry) {
      // The note before this one becomes the chain's source, whatever it was
      // written as: it is the note that will actually be struck.
      const chain: LegatoChain = {
        chainId: chainIdFor(input.trackId, previous.stringIndex, previous.timeTicks),
        trackId: input.trackId,
        stringIndex: previous.stringIndex,
        sourcePitch: previous.pitch,
        startSeconds: secondsAtTicks(tempo, previous.timeTicks),
        endSeconds: secondsAtTicks(
          tempo,
          previous.timeTicks + previous.durationTicks,
        ),
        startTicks: previous.timeTicks,
        noteIds: [noteIds[previousIndex] ?? ""],
        transitions: [],
        gain: gains[previousIndex] ?? 1,
      };
      chains.push(chain);
      entry = { chain, lastIndex: previousIndex };
      openChains.set(chain.chainId, entry);
      membership.set(previousIndex, { chainId: chain.chainId, role: "source" });
    }

    const chain = entry.chain;
    const preset =
      decision.transition === "hammer_on"
        ? expressionPresets.legato.hammerOn
        : decision.transition === "pull_off"
          ? expressionPresets.legato.pullOff
          : null;

    const sourceMidi = previousMidiOf(chain, onsets, previousIndex);
    const cumulative = (onset.midi - sourceMidi) * CENTS_PER_SEMITONE;
    const fromCents = (previous.midi - sourceMidi) * CENTS_PER_SEMITONE;
    const targetAt = secondsAtTicks(tempo, onset.timeTicks) - chain.startSeconds;

    let startsAt: number;
    let arrivesAt: number;

    if (glideSeconds !== null) {
      // The written time of the target is when the hand *arrives*, so the
      // travel is measured backwards from it (spec 8.5, K-23).
      arrivesAt = targetAt;
      startsAt = targetAt - glideSeconds;
    } else {
      // The room is the target's own note: from where it is written to where
      // the chain's voice stops, which is where the next onset begins.
      const targetRoom = durationSeconds(tempo, onset.timeTicks, onset.durationTicks);
      startsAt = targetAt;
      arrivesAt =
        targetAt + transitionSeconds(decision.transition, timeScale, targetRoom);
    }

    /*
     * The click is a transient, so it lives inside the note it belongs to.
     * Its length was a constant too, and a 35 ms click on a 26 ms note is a
     * click that outlives its own note and bleeds into the next one.
     */
    const heldAfterArrival = Math.max(
      0,
      secondsAtTicks(tempo, onset.timeTicks + onset.durationTicks) -
        chain.startSeconds -
        arrivesAt,
    );
    /*
     * Both hands make a noise (2T-C §10). A pull-off plucks the string
     * sideways coming off it; a hammer-on drives it onto the fret. Which
     * preset is used says which of the two it was — quieter and duller for
     * the landing, brighter for the pluck — and a slide makes neither,
     * because nothing is struck or released on the way.
     */
    const fingerNoise =
      decision.transition === "pull_off"
        ? expressionPresets.legato.pullOff.auxiliary
        : decision.transition === "hammer_on"
          ? expressionPresets.legato.hammerOn.auxiliary
          : null;
    const auxiliary =
      fingerNoise !== null && (input.withAuxiliary ?? true)
        ? {
            gain: fingerNoise.gain,
            durationSeconds: Math.min(
              fingerNoise.maxSeconds * timeScale,
              heldAfterArrival,
            ),
            filterHz: fingerNoise.filterHz,
          }
        : undefined;

    const transition: LegatoTransition = {
      kind: decision.transition,
      atSeconds: startsAt,
      arrivesAtSeconds: arrivesAt,
      fromPitch: previous.pitch,
      toPitch: onset.pitch,
      intervalCents: (onset.midi - previous.midi) * CENTS_PER_SEMITONE,
      cumulativeCents: cumulative,
      transitionSeconds: arrivesAt - startsAt,
      // A slide is already at the target when the note starts, so nothing is
      // lost to the transition; a finger landing costs a little energy.
      levelAfter: preset?.levelAfter ?? 1,
      noteId: noteIds[index] ?? "",
      points: transitionPoints(
        decision.transition,
        startsAt,
        arrivesAt,
        fromCents,
        cumulative,
      ),
      ...(auxiliary ? { auxiliary } : {}),
    };

    chain.transitions = [...chain.transitions, transition];
    chain.noteIds = [...chain.noteIds, noteIds[index] ?? ""];
    chain.endSeconds = secondsAtTicks(
      tempo,
      onset.timeTicks + onset.durationTicks,
    );

    entry.lastIndex = index;
    membership.set(index, { chainId: chain.chainId, role: "target" });
  });

  return { chains, membership, refusals };
}

/** The midi number the chain started on, for the cumulative offset. */
function previousMidiOf(
  chain: LegatoChain,
  onsets: readonly LegatoOnset[],
  previousIndex: number,
): number {
  const source = onsets.find(
    (onset) =>
      onset.stringIndex === chain.stringIndex && onset.timeTicks === chain.startTicks,
  );
  return source?.midi ?? onsets[previousIndex]?.midi ?? 0;
}
