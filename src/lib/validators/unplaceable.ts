/**
 * Notes the position engine could not place (spec 10.3, fourth bullet).
 *
 * Spec 10.3 files this under warnings, not hard errors: the note is still
 * played, it is simply played without a position, so the tab cannot show
 * where the hand goes. A warning informs; it does not block the patch.
 *
 * The case it names is the one no other validator can see. Every pitch in the
 * chord is reachable on its own, but they cannot all be reached at once,
 * because the greedy engine (spec 9.2) gives each string to a single note.
 *
 * Boundaries with the neighbouring validators
 * -------------------------------------------
 * - Pitch not reachable at all on this tuning and capo -> `range` (error).
 *   Nothing is reported here, so one fault is never named twice.
 * - Position written out by hand or by the model and wrong -> those notes
 *   always keep the position they were given, so they never reach this
 *   validator (`fretboardIntegrity` owns them).
 * - Two notes fighting over the same string, both placed -> `stringCollision`
 *   (error). Here nothing was placed at all, which is the opposite case.
 *
 * One slot, one issue: a chord that does not fit is a single musical problem,
 * however many of its notes end up without a string.
 */
import { candidatePositions } from "@/lib/music/voicing";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import type { Fretboard, Song } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const UNPLACEABLE_CODE = "unplaceable";

export const validateUnplaceable: Validator = (song: Song) => {
  const issues: ValidationIssue[] = [];
  const sectionNames = new Map(
    song.sections.map((section) => [section.id, section.name]),
  );

  for (const track of song.tracks) {
    const timeline = buildTrackTimeline(song, track.id);
    // Drums and the phase 2.5 instruments without a fretboard never reach the
    // position engine, so they can never be unplaceable.
    if (timeline.kind !== "fretted") continue;

    const fretboard: Fretboard = {
      tuning: [...timeline.strings],
      capo: timeline.capo,
    };

    for (const bar of timeline.bars) {
      if (bar.silent) continue;

      for (let slotIndex = 0; slotIndex < bar.slotCount; slotIndex += 1) {
        const stranded = bar.spans.filter(
          (span) =>
            // Struck here, not carried in: a tie repeats no decision.
            span.startSlot === slotIndex &&
            !span.openStart &&
            span.fret === null &&
            // Reachable on its own; only the chord around it is the problem.
            // A pitch off the fretboard belongs to `range`.
            candidatePositions(fretboard, span.pitch).length > 0,
        );
        if (stranded.length === 0) continue;

        const pitches = stranded.map((span) => span.pitch).join(", ");
        issues.push({
          code: UNPLACEABLE_CODE,
          severity: "warning",
          message:
            `"${sectionNames.get(bar.sectionId) ?? bar.sectionId}" bölümü, ` +
            `bar ${bar.barIndex + 1}, slot ${slotIndex + 1}: ` +
            `"${track.name}" track'inde ${pitches} notası bu akorda birlikte ` +
            `yerleştirilemedi; tek tek çalınabiliyor ama aynı anda yetecek ` +
            `tel kalmıyor. Nota pozisyonsuz çalınır.`,
          sectionId: bar.sectionId,
          barIndex: bar.barIndex,
          trackId: track.id,
          slotIndex,
        });
      }
    }
  }

  return issues;
};
