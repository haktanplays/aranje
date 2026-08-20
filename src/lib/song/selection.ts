/**
 * Which chords are currently picked up (spec 13.1, phase 2E).
 *
 * Pure, so the rules about what a selection is can be read and tested without
 * a screen. Three of them shape everything here:
 *
 * - A selection belongs to **one section**. Music is moved inside a section,
 *   so a selection that reached across one could never be moved as a group.
 *   Touching a chord in another section starts a new selection rather than
 *   quietly extending the old one somewhere the musician cannot see.
 * - It is always held in **canonical order**, by bar then slot, so the same
 *   set of chords is the same selection however it was built up.
 * - Removing the last chord leaves **no selection at all**, rather than an
 *   empty one. There is no such thing as "selecting nothing".
 */
import { canonicalRefs, refKey, type OnsetRef } from "@/lib/song/onset-block";

export type Selection = {
  sectionId: string;
  refs: readonly OnsetRef[];
};

/**
 * `replace` starts a new selection at this chord; `toggle` adds it or takes it
 * out again. Either way, a chord in a different section starts again.
 */
export type SelectMode = "replace" | "toggle";

export function chooseOnset(
  current: Selection | null,
  sectionId: string,
  ref: OnsetRef,
  mode: SelectMode,
): Selection | null {
  if (!current || current.sectionId !== sectionId || mode === "replace") {
    return { sectionId, refs: [{ ...ref }] };
  }

  const key = refKey(ref);
  const without = current.refs.filter((entry) => refKey(entry) !== key);

  if (without.length !== current.refs.length) {
    return without.length === 0 ? null : { sectionId, refs: canonicalRefs(without) };
  }

  return { sectionId, refs: canonicalRefs([...current.refs, ref]) };
}

/** True when this slot is part of the selection's own chords. */
export function isChosen(current: Selection | null, sectionId: string, ref: OnsetRef): boolean {
  if (!current || current.sectionId !== sectionId) return false;
  return current.refs.some((entry) => refKey(entry) === refKey(ref));
}

export function selectionCount(current: Selection | null): number {
  return current?.refs.length ?? 0;
}
