import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { rhythmGroupLabel, type RhythmGuide } from "@/lib/tab/rhythm-guide";

/**
 * The beams under the staff (spec 13.20 §7).
 *
 * Drawn in the rhythm row, below the notes and the articulation glyphs, so it
 * cannot cover a fret number, a glyph, the playhead or the selection band —
 * not by z-order but because it is somewhere else on the page.
 *
 * It carries no colour of its own beyond the ordinary text colour: what a beam
 * says is said by *where* it is and *how many lines* it has, so it still reads
 * in bright sun, in dark mode and to someone who cannot separate two hues.
 *
 * The stem is a short tick down from each onset, and the beams run between the
 * first and last onset of the group. A triplet group carries a small "3",
 * which is the one thing about it a beam alone cannot say.
 */

/** How far apart the beam lines sit, and how tall a stem is. */
const STEM_HEIGHT = 5;
const BEAM_GAP = 3;

export function RhythmGuideLayer({ guide }: { guide: RhythmGuide }) {
  if (guide.groups.length === 0) return null;

  return (
    <div className="pointer-events-none relative h-full">
      {guide.groups.map((group) => {
        const first = group.slots[0] ?? 0;
        const last = group.slots[group.slots.length - 1] ?? first;
        const left = first * SLOT_WIDTH + SLOT_WIDTH / 2;
        const width = (last - first) * SLOT_WIDTH;

        return (
          <div
            key={`${first}-${last}`}
            role="img"
            aria-label={rhythmGroupLabel(group)}
            className="absolute top-0"
            style={{ left, width: Math.max(width, 1) }}
          >
            {/* One stem per onset, so the reader can see which notes the
                beam is joining rather than only that something is joined. */}
            {group.slots.map((slot) => (
              <span
                key={slot}
                aria-hidden
                className="bg-muted/70 absolute top-0 block w-px"
                style={{ left: (slot - first) * SLOT_WIDTH, height: STEM_HEIGHT }}
              />
            ))}

            {Array.from({ length: group.levels }, (_, level) => (
              <span
                key={level}
                aria-hidden
                className="bg-muted/70 absolute block h-px"
                style={{
                  top: STEM_HEIGHT + level * BEAM_GAP,
                  left: 0,
                  width: Math.max(width, 1),
                }}
              />
            ))}

            {group.triplet ? (
              <span
                aria-hidden
                className="text-muted/80 absolute text-[8px] leading-none"
                style={{
                  top: STEM_HEIGHT + group.levels * BEAM_GAP + 1,
                  left: Math.max(0, width / 2 - 2),
                }}
              >
                3
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
