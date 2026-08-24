/**
 * What an articulation *does* to the note beside it (spec 5.4, 13.20).
 *
 * A slide, a hammer-on and a pull-off are not decorations on one note: they
 * only mean anything because another note is already sounding, so they bond
 * two onsets together. Everything else in the vocabulary — accent, palm mute,
 * sustain, staccato, vibrato, the two bends — is a property of the single note
 * that carries it.
 *
 * That distinction is a fact about the Song Contract, not a decision about
 * what to do with it. `chain-preflight.ts` owns the decisions — what a command
 * may cut, and what the reader is asked — and it stays the only module that
 * makes them. This one just says which articulations are bonds, so a module
 * that merely needs to *recognise* one does not have to reach into the
 * decision layer to find out.
 */
import type { Articulation } from "@/lib/song/schema";

/** Articulations that only sound if a note is already there. */
export const CHAINING_ARTICULATIONS: ReadonlySet<Articulation> = new Set([
  "slide",
  "hammer_on",
  "pull_off",
]);

/** True when this note is bonded to a neighbouring onset. */
export function isChainArticulation(value: Articulation | undefined): boolean {
  return value !== undefined && CHAINING_ARTICULATIONS.has(value);
}
