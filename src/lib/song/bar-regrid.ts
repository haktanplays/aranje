/**
 * The same bar, written on a different grid — exactly, or not at all
 * (spec 5.5, 13.12, K-43).
 *
 * A 1/8 bar and a 1/16 bar can hold the same music: every eighth is two
 * sixteenths. A 1/8 bar and a 1/12 triplet bar cannot, because a straight
 * eighth falls between two triplets and there is no slot for it. This is the
 * one place that difference is decided, and the answer is always exact or
 * `null` — never "close enough".
 *
 * That refusal is the whole point. A rounded paste is worse than a rejected
 * one: the reader gets music back that is subtly not what they copied, and
 * nothing tells them. The tick contract makes the test trivial — a slot's
 * moment either divides into the target step or it does not.
 *
 * Ties are rebuilt rather than copied. On a finer grid a held note needs more
 * continuation slots than it had; on a coarser one, fewer. What is preserved
 * is how long the note *sounds*, which is the thing anyone can hear — and what
 * is checked is both ends of it, the moment it starts and the moment it stops.
 */
import { ticksPerSlot, type Resolution } from "@/lib/music/timing";
import type { DrumSlot, MelodicSlot } from "@/lib/song/schema";

/**
 * Re-express melodic slots on another grid.
 *
 * `null` when any sounding run — its onset or its end — would fall between two
 * slots of the target.
 */
export function regridMelodic(
  slots: readonly MelodicSlot[],
  fromResolution: Resolution,
  toResolution: Resolution,
  toSlotCount: number,
): MelodicSlot[] | null {
  const fromStep = ticksPerSlot(fromResolution);
  const toStep = ticksPerSlot(toResolution);

  /*
   * Sounding runs, not slots.
   *
   * Aligning slot *starts* is not enough, and the first version of this made
   * exactly that mistake: an eighth note whose onset happens to land on a
   * triplet slot would be written there and silently stretched to the triplet's
   * length, because nothing checked that its *duration* could be written too.
   * A run carries both, so both are checked.
   *
   * A leading continuation — a note struck in the bar before — is a run with
   * no notes of its own. It still has to land exactly, or the sound it
   * continues would start in the wrong place.
   */
  type Run = { startTicks: number; durationTicks: number; notes: MelodicSlot | null };
  const runs: Run[] = [];
  let open: Run | null = null;

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const startTicks = index * fromStep;

    if (slot === null || slot === undefined) {
      open = null;
      continue;
    }
    if (slot === "-") {
      if (open) {
        open.durationTicks += fromStep;
      } else {
        // Sound carried in from the previous bar.
        open = { startTicks, durationTicks: fromStep, notes: null };
        runs.push(open);
      }
      continue;
    }
    open = { startTicks, durationTicks: fromStep, notes: slot };
    runs.push(open);
  }

  const out: MelodicSlot[] = Array.from({ length: toSlotCount }, () => null);

  for (const run of runs) {
    if (run.startTicks % toStep !== 0) return null;
    if (run.durationTicks % toStep !== 0) return null;

    const at = run.startTicks / toStep;
    const span = run.durationTicks / toStep;
    if (at + span > toSlotCount) return null;

    if (run.notes === null || run.notes === "-") {
      for (let offset = 0; offset < span; offset += 1) out[at + offset] = "-";
      continue;
    }
    out[at] = { notes: run.notes.notes.map((note) => ({ ...note })) };
    for (let offset = 1; offset < span; offset += 1) out[at + offset] = "-";
  }

  return out;
}

/**
 * The same, for drums.
 *
 * Simpler, because a drum hit has no length: there is nothing to keep sounding
 * and therefore nothing to rebuild. A hit either lands on the target grid or
 * the bar cannot be written there.
 */
export function regridDrums(
  slots: readonly DrumSlot[],
  fromResolution: Resolution,
  toResolution: Resolution,
  toSlotCount: number,
): DrumSlot[] | null {
  const fromStep = ticksPerSlot(fromResolution);
  const toStep = ticksPerSlot(toResolution);
  const out: DrumSlot[] = Array.from({ length: toSlotCount }, () => []);

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot || slot.length === 0) continue;

    const startTicks = index * fromStep;
    if (startTicks % toStep !== 0) return null;
    const target = startTicks / toStep;
    if (target >= toSlotCount) return null;

    out[target] = slot.map((hit) => ({ ...hit }));
  }

  return out;
}
