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
 * Thresholds live in `songLimits`' neighbour `handPositionLimits`, not here,
 * and the anchor is measured by the same helper the placement engine uses
 * (spec 9.2, K-19). The engine cannot "solve" a jump it was measuring
 * differently from the validator that reports it.
 */
import {
  anchorOf,
  isLargeShift,
  maxShiftFor,
  medianOf,
  type HandNote,
} from "@/lib/music/hand-position";
import { buildTrackTimeline, type FrettedBar } from "@/lib/tab/timeline";
import type { Song } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const FRET_JUMP_CODE = "fretJump";

export { maxShiftFor, medianOf };

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
  const bySlot = new Map<number, HandNote[]>();

  for (const span of bar.spans) {
    // Struck here, not carried in: a tie repeats no hand movement.
    if (span.openStart || span.startSlot < 0) continue;
    if (span.fret === null) continue; // unplaceable; `unplaceable` owns it
    const group = bySlot.get(span.startSlot) ?? [];
    group.push({ stringIndex: span.stringIndex, physicalFret: capo + span.fret });
    bySlot.set(span.startSlot, group);
  }

  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slotIndex, notes]) => ({
      // Measured by the shared helper, so this and the placement engine can
      // never disagree about where the hand is.
      fret: anchorOf(notes),
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
          if (isLargeShift(previous.fret, anchor.fret, maxShift)) {
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
