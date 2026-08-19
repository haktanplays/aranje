/**
 * Unusual hand-position jumps (spec 10.3, second bullet, decision K-17).
 *
 * What this is: a visible flag on a known risk. The position engine is
 * memoryless by design (spec 9.2, K-4) — it places each chord on its own
 * merits and never looks at the previous one — so it can hand a player a
 * fourteen-fret leap between two eighth notes without noticing. This warning
 * makes that leap show up.
 *
 * What this is not: an ergonomic model. It does not search for a better
 * fingering, it does not weigh finger stretch against string crossing, and it
 * is not "placement v2". A real engine that minimises hand travel is a later
 * quality checkpoint. Reading this as more than a flag would be the wrong
 * conclusion to draw from a green test.
 *
 * How the anchor is measured
 * --------------------------
 * - The anchor of an onset is the **median physical fret** of its fretted
 *   notes. A median rather than a mean, so one stretched finger does not drag
 *   the whole chord's position with it.
 * - **Physical fret is capo + written fret** (spec 9.1). A capo moves the hand
 *   with it, so a capo 5 shape is where the hand actually is.
 * - An onset of open strings only anchors at 0: that is where the hand sits
 *   when it is not fretting anything.
 * - A tie or a sustain sets no anchor. Nothing moved, so nothing jumped.
 * - **A whole bar of silence resets the anchor.** A player who has a full bar
 *   to move is not making a jump, and warning about it would be noise. Less
 *   than a bar, including across a section boundary, still counts.
 * - Silence means silence. A bar filled by a note held over from the bar
 *   before is not a free bar: the hand is still holding it, so the anchor
 *   carries and the next jump is measured from it.
 *
 * Thresholds live in `songLimits`' neighbour `handPositionLimits`, not here.
 */
import { handPositionLimits } from "@/lib/limits";
import { instrumentFamily } from "@/lib/instruments/registry";
import { buildTrackTimeline, type FrettedBar } from "@/lib/tab/timeline";
import type { Song } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const FRET_JUMP_CODE = "fretJump";

/** How far this instrument's hand may travel between neighbouring onsets. */
export function maxShiftFor(instrumentId: string): number | null {
  switch (instrumentFamily(instrumentId)) {
    case "guitar":
      return handPositionLimits.guitarMaxShift;
    case "bass":
      return handPositionLimits.bassMaxShift;
    default:
      // Drums have no frets; a phase 2.5 instrument with no fretboard has no
      // hand position to speak of yet.
      return null;
  }
}

/** The median of a list of numbers; the lower middle for an even count. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted[middle] ?? null;
}

type Anchor = {
  fret: number;
  barKey: string;
  sectionId: string;
  barIndex: number;
  slotIndex: number;
  /** Position in the flattened bar stream, for the silence rule. */
  barNumber: number;
};

/** The anchor of every struck onset in one bar, in slot order. */
function anchorsIn(bar: FrettedBar, capo: number): Anchor[] {
  const bySlot = new Map<number, number[]>();

  for (const span of bar.spans) {
    // Struck here, not carried in: a tie repeats no hand movement.
    if (span.openStart || span.startSlot < 0) continue;
    if (span.fret === null) continue; // unplaceable; `unplaceable` owns it
    const group = bySlot.get(span.startSlot) ?? [];
    group.push(capo + span.fret);
    bySlot.set(span.startSlot, group);
  }

  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slotIndex, frets]) => ({
      // An open-strings-only onset anchors at 0, which medianOf gives us for
      // free: every fret in it is capo + 0.
      fret: medianOf(frets) ?? 0,
      barKey: bar.key,
      sectionId: bar.sectionId,
      barIndex: bar.barIndex,
      slotIndex,
      barNumber: bar.barNumber,
    }));
}

export const validateFretJump: Validator = (song: Song) => {
  const issues: ValidationIssue[] = [];
  const sectionNames = new Map(
    song.sections.map((section) => [section.id, section.name]),
  );

  for (const track of song.tracks) {
    const maxShift = maxShiftFor(track.instrumentId);
    if (maxShift === null) continue;

    const timeline = buildTrackTimeline(song, track.id);
    if (timeline.kind !== "fretted") continue;

    let previous: Anchor | null = null;

    for (const bar of timeline.bars) {
      const anchors = bar.silent ? [] : anchorsIn(bar, timeline.capo);

      if (anchors.length === 0) {
        // Nothing struck here. If nothing is sounding either, the hand had a
        // whole bar free and whatever comes next is not a jump. A bar filled
        // by a sustain is not free, so the anchor carries through it.
        const sounding = !bar.silent && bar.spans.length > 0;
        if (!sounding && previous !== null && bar.barNumber > previous.barNumber) {
          previous = null;
        }
        continue;
      }

      for (const anchor of anchors) {
        if (previous !== null) {
          const shift = Math.abs(anchor.fret - previous.fret);
          if (shift > maxShift) {
            issues.push({
              code: FRET_JUMP_CODE,
              severity: "warning",
              message:
                `"${sectionNames.get(anchor.sectionId) ?? anchor.sectionId}" ` +
                `bölümü, bar ${anchor.barIndex + 1}, slot ` +
                `${anchor.slotIndex + 1}: "${track.name}" track'inde el ` +
                `pozisyonu ${previous.fret}. perdeden ${anchor.fret}. perdeye ` +
                `${shift} perde atlıyor (sınır ${maxShift}). Çalınabilir ama ` +
                `olağandışı.`,
              sectionId: anchor.sectionId,
              barIndex: anchor.barIndex,
              trackId: track.id,
              slotIndex: anchor.slotIndex,
            });
          }
        }
        previous = anchor;
      }
    }
  }

  return issues;
};
