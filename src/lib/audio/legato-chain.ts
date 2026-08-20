/**
 * Hammer-on and pull-off as one continuing note (spec 8.5, K-22).
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
 * The song is not changed by any of this. Every note stays a note in the
 * timeline and in the scheduler's snapshot; what the chain decides is only how
 * those notes are **rendered**.
 */
import { CENTS_PER_SEMITONE, expressionPresets } from "@/lib/audio/expression";
import { legatoLink, type LegatoOnset } from "@/lib/music/legato";

export type LegatoTransitionKind = "hammer_on" | "pull_off";

export type LegatoAuxiliary = {
  /** Level relative to full scale; deliberately far below a real attack. */
  gain: number;
  durationSeconds: number;
  filterHz: number;
};

export type LegatoTransition = {
  kind: LegatoTransitionKind;
  /** Seconds from the chain's own start. */
  atSeconds: number;
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
  /** Pull-off only: the short click of the finger coming off the string. */
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

/** Why a hammer-on or pull-off could not become a chain. */
export type LegatoRefusal =
  | "no_previous_note"
  | "previous_note_other_string"
  | "wrong_direction"
  | "interval_too_wide"
  | "not_fretted";

export type LegatoDecision =
  | { kind: "joined"; previous: LegatoOnset; transition: LegatoTransitionKind }
  | { kind: "refused"; reason: LegatoRefusal };

/**
 * Can this note continue the one before it?
 *
 * One place decides, so the validator's warning and the renderer's fallback
 * can never disagree about whether a slur is playable.
 */
export function legatoDecision(
  onsets: readonly LegatoOnset[],
  index: number,
): LegatoDecision | null {
  const onset = onsets[index];
  if (!onset) return null;

  const articulation = onset.articulation;
  if (articulation !== "hammer_on" && articulation !== "pull_off") return null;

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
  if (interval > expressionPresets.legato.maxIntervalSemitones) {
    return { kind: "refused", reason: "interval_too_wide" };
  }

  return { kind: "joined", previous, transition: articulation };
}

/** How long a transition takes, stretched with the practice speed. */
export function transitionSeconds(
  kind: LegatoTransitionKind,
  timeScale = 1,
): number {
  const preset =
    kind === "hammer_on"
      ? expressionPresets.legato.hammerOn
      : expressionPresets.legato.pullOff;
  return preset.transitionSeconds * timeScale;
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
  /** Ticks to seconds, at the speed being practised at. */
  secondsPerTick: number;
  timeScale: number;
  /** The note id of each onset, by index, so the chain can name its members. */
  noteIds: readonly string[];
  /** Linear gain of each onset, by index. */
  gains: readonly number[];
  /** Off renders a pull-off with no finger click. Render comparisons only. */
  withAuxiliary?: boolean;
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
  const { onsets, secondsPerTick, timeScale, noteIds, gains } = input;
  const chains: LegatoChain[] = [];
  const membership = new Map<number, ChainMembership>();
  const refusals = new Map<number, LegatoRefusal>();

  /** Index of the onset each chain currently ends on. */
  const openChains = new Map<string, { chain: LegatoChain; lastIndex: number }>();

  onsets.forEach((onset, index) => {
    const decision = legatoDecision(onsets, index);
    if (!decision) return;
    if (decision.kind === "refused") {
      refusals.set(index, decision.reason);
      return;
    }

    const previousIndex = onsets.indexOf(decision.previous);
    if (previousIndex < 0) return;

    const previous = decision.previous;
    if (previous.midi === null || onset.midi === null) return;

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
        startSeconds: previous.timeTicks * secondsPerTick,
        endSeconds: (previous.timeTicks + previous.durationTicks) * secondsPerTick,
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
        : expressionPresets.legato.pullOff;

    const sourceMidi = previousMidiOf(chain, onsets, previousIndex);
    const cumulative =
      (onset.midi - sourceMidi) * CENTS_PER_SEMITONE;

    const auxiliary =
      decision.transition === "pull_off" && (input.withAuxiliary ?? true)
        ? {
            gain: expressionPresets.legato.pullOff.auxiliary.gain,
            durationSeconds:
              expressionPresets.legato.pullOff.auxiliary.maxSeconds * timeScale,
            filterHz: expressionPresets.legato.pullOff.auxiliary.filterHz,
          }
        : undefined;

    const transition: LegatoTransition = {
      kind: decision.transition,
      atSeconds: onset.timeTicks * secondsPerTick - chain.startSeconds,
      fromPitch: previous.pitch,
      toPitch: onset.pitch,
      intervalCents: (onset.midi - previous.midi) * CENTS_PER_SEMITONE,
      cumulativeCents: cumulative,
      transitionSeconds: transitionSeconds(decision.transition, timeScale),
      levelAfter: preset.levelAfter,
      noteId: noteIds[index] ?? "",
      ...(auxiliary ? { auxiliary } : {}),
    };

    chain.transitions = [...chain.transitions, transition];
    chain.noteIds = [...chain.noteIds, noteIds[index] ?? ""];
    chain.endSeconds = (onset.timeTicks + onset.durationTicks) * secondsPerTick;

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
