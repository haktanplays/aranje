/**
 * Physical string conflicts (spec 10.1 `stringCollision`).
 *
 * Asks one question: does this slot ask a single string to sound two
 * independent notes at once? A string can only vibrate at one pitch, so two
 * simultaneous onsets on the same string are unplayable as written.
 *
 * Where the placements come from
 * ------------------------------
 * From `buildTrackTimeline`, so the model this validator judges is exactly the
 * one the tab draws and the scheduler plays: explicit positions first, the
 * greedy engine (spec 9.2) around them, and the same tie carry across bar and
 * section boundaries the voice counter uses (spec 6). Re-deriving placements
 * here would risk judging a picture nothing else in the app agrees with.
 *
 * What is deliberately not reported
 * ---------------------------------
 * - A sustain or a tie is not an onset. Only a note that is struck in this slot
 *   competes for the string; a note carried in from an earlier slot or an
 *   earlier bar has already been counted where it was struck.
 * - A note the engine could not place at all (no string left, or the pitch is
 *   off the fretboard) has no string to collide on. Spec 10.3 files that under
 *   warnings, not hard errors, and where the pitch itself is out of reach
 *   `range` and `fretboardIntegrity` already say so. Calling it a collision
 *   would name the wrong cause.
 * - Drum tracks have no strings; `drumVocab` owns that track.
 *
 * The check is per track, not per song (spec 10.2, K-3): two rhythm guitars are
 * two physical instruments and may play the same string at the same time.
 */
import { buildTrackTimeline, type FrettedBar } from "@/lib/tab/timeline";
import type { Song } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

/** Notes struck in this slot — ties and sustains excluded by construction. */
function onsetsAt(bar: FrettedBar, slotIndex: number) {
  return bar.spans.filter(
    (span) =>
      span.startSlot === slotIndex &&
      !span.openStart &&
      span.fret !== null &&
      span.stringIndex >= 0,
  );
}

export const validateStringCollision: Validator = (song: Song) => {
  const issues: ValidationIssue[] = [];

  for (const track of song.tracks) {
    const timeline = buildTrackTimeline(song, track.id);
    if (timeline.kind !== "fretted") continue;

    const sectionNames = new Map(
      song.sections.map((section) => [section.id, section.name]),
    );

    for (const bar of timeline.bars) {
      if (bar.silent) continue;

      for (let slotIndex = 0; slotIndex < bar.slotCount; slotIndex += 1) {
        const onsets = onsetsAt(bar, slotIndex);
        if (onsets.length < 2) continue;

        const byString = new Map<number, typeof onsets>();
        for (const span of onsets) {
          const group = byString.get(span.stringIndex);
          if (group) group.push(span);
          else byString.set(span.stringIndex, [span]);
        }

        // Ascending string order, so the same song always reports the same
        // issues in the same sequence.
        const clashed = [...byString.entries()]
          .filter(([, group]) => group.length > 1)
          .sort((a, b) => a[0] - b[0]);

        for (const [stringIndex, group] of clashed) {
          const written = group
            .map((span) => `${span.pitch} (perde ${span.fret})`)
            .join(", ");
          issues.push({
            code: "stringCollision",
            severity: "error",
            message:
              `"${sectionNames.get(bar.sectionId) ?? bar.sectionId}" bölümü, ` +
              `bar ${bar.barIndex + 1}, slot ${slotIndex + 1}: ` +
              `"${track.name}" track'inde ${group.length} nota aynı anda ` +
              `tel ${stringIndex} üzerinde çalınıyor: ${written}. Bir tel ` +
              `aynı anda tek ses verebilir.`,
            sectionId: bar.sectionId,
            barIndex: bar.barIndex,
            trackId: track.id,
            slotIndex,
          });
        }
      }
    }
  }

  return issues;
};
