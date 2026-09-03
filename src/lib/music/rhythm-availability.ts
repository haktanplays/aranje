/**
 * The one authority on which rhythms a bar can hold (2V-B.3 §17).
 *
 * ## Why there is exactly one
 *
 * Three things need to answer "can this rhythm go here": the control that
 * greys a button, the Copilot command that validates a patch, and the domain
 * validator that decides whether an edit holds. Three implementations of one
 * musical rule is three chances to disagree, and the disagreement is invisible
 * until a reader is told "yes" by a button and "no" by the edit behind it.
 *
 * So they all call this, and the answer they get is the same value.
 *
 * ## Three states, because "no" was hiding two different situations
 *
 * - **available** — the onsets land on slots the bar already has.
 * - **requires_local_override** — the bar's grid is too coarse, but the run
 *   *is* expressible on a finer one that can also hold everything already
 *   written here. The reader is asked, in musician's words, and nothing
 *   happens unless they say yes.
 * - **unavailable** — no grid the format has can hold both the new run and the
 *   music already in this bar. Said plainly, not silently rounded.
 *
 * The middle state is the whole reason this file exists. Without it a denser
 * run in a Straight 1/16 bar could only be refused or *quietly* rewritten to
 * 1/32 — and quietly changing the grid under a reader's music is precisely
 * what a rhythm authority must never do.
 *
 * ## What it will never do
 *
 * Delete, hide or quantise an advanced rhythm that is already in the song. A
 * bar written in a triplet grid that no Simple profile names is not a problem
 * to be normalised; it is music. Every candidate grid below is required to
 * hold the existing onsets *exactly*, and a grid that cannot is not offered.
 */
import { RESOLUTIONS, ticksPerSlot, type Resolution } from "@/lib/music/timing";

export type RhythmAvailabilityState =
  | "available"
  | "requires_local_override"
  | "unavailable";

export type RhythmAvailability = {
  readonly state: RhythmAvailabilityState;
  /**
   * The finer grid the run needs, when one exists.
   *
   * Null when the bar can already hold it, and null when nothing can.
   */
  readonly neededResolution: Resolution | null;
  /**
   * What the reader is offered, in their own language.
   *
   * Never a note value: "1/32" is a fact about notation and the reader is
   * being asked about *this passage*, which is a fact about their music.
   */
  readonly action: string | null;
  readonly actionDetail: string | null;
  /** Why, when the answer is no. One sentence, no jargon. */
  readonly reason: string | null;
};

export const LOCAL_OVERRIDE_ACTION = "Bu hareket için bu bölümü sıklaştır.";
export const LOCAL_OVERRIDE_DETAIL =
  "Yalnız seçili bölüm hızlanır; ölçü ve diğer notalar değişmez.";
const UNAVAILABLE_REASON =
  "Bu hız, bu ölçüdeki mevcut notalarla birlikte yazılamıyor.";

const AVAILABLE: RhythmAvailability = {
  state: "available",
  neededResolution: null,
  action: null,
  actionDetail: null,
  reason: null,
};

/**
 * Everything the question depends on, and nothing else.
 *
 * `existingOnsetTicks` is what makes the refusal honest: a finer grid is only
 * offered when the music already in the bar survives it unchanged. They are
 * ticks from the start of the **bar**, like every other number here.
 */
export type RhythmRequest = {
  readonly resolution: Resolution;
  /** Where the run starts, from the start of the bar. */
  readonly startTicks: number;
  /** The shortest note the run needs. */
  readonly stepTicks: number;
  /** How many of them. */
  readonly stepCount: number;
  /**
   * Onsets and sounding ends already written in this bar, in bar ticks.
   *
   * Both, because a grid has to be able to say where a note starts *and* where
   * it stops — the same rule `bar-regrid` enforces, asked before the edit
   * rather than discovered during it.
   */
  readonly existingTicks: readonly number[];
};

/** Does every moment in `moments` fall exactly on a slot of `resolution`? */
function gridHolds(resolution: Resolution, moments: readonly number[]): boolean {
  const step = ticksPerSlot(resolution);
  return moments.every((tick) => tick % step === 0);
}

export function rhythmAvailability(request: RhythmRequest): RhythmAvailability {
  const { existingTicks, resolution, startTicks, stepCount, stepTicks } = request;
  if (stepTicks <= 0 || stepCount < 1) {
    return {
      state: "unavailable",
      neededResolution: null,
      action: null,
      actionDetail: null,
      reason: UNAVAILABLE_REASON,
    };
  }

  /* Every moment the run needs a slot for: each onset, and where it ends. */
  const wanted = Array.from(
    { length: stepCount + 1 },
    (_, index) => startTicks + index * stepTicks,
  );

  if (gridHolds(resolution, wanted)) return AVAILABLE;

  /*
   * A finer grid that holds both. Finest-first would give the reader more
   * subdivision than they asked for, so the search runs coarse to fine and
   * stops at the first that works — the smallest change to their bar that
   * makes the run writable.
   */
  const finer = [...RESOLUTIONS]
    .filter((candidate) => ticksPerSlot(candidate) < ticksPerSlot(resolution))
    .sort((left, right) => ticksPerSlot(right) - ticksPerSlot(left));

  for (const candidate of finer) {
    if (!gridHolds(candidate, wanted)) continue;
    /* And the music already here has to survive it, exactly. */
    if (!gridHolds(candidate, existingTicks)) continue;
    return {
      state: "requires_local_override",
      neededResolution: candidate,
      action: LOCAL_OVERRIDE_ACTION,
      actionDetail: LOCAL_OVERRIDE_DETAIL,
      reason: null,
    };
  }

  return {
    state: "unavailable",
    neededResolution: null,
    action: null,
    actionDetail: null,
    reason: UNAVAILABLE_REASON,
  };
}
