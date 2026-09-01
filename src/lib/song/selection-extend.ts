/**
 * Whether "Devam" has anywhere to reach to (2V-A.1 §3, §4).
 *
 * ## What the reach actually does
 *
 * Pressing "Devam" arms the session; the next long press moves the run's
 * **end** edge to the slot under the finger. The start never moves, so the
 * reachable ends are the slot starts from the selection's own start onwards,
 * to the end of the section. A reader can therefore grow the run forward and
 * narrow it back, and cannot drag it somewhere else — which is why this is a
 * reach and not a movement.
 *
 * ## Why the answer is computed here and handed in
 *
 * `selection-capability.ts` promises not to take the Song, for a reason worth
 * keeping: a function that had the whole song would start deciding whether a
 * command would succeed, which is the command's job. So the one fact it needs
 * — is there a second place the end edge could go — is worked out here, the
 * way `hasAudibleNotes` is, and passed in as a boolean.
 *
 * The honest question is not "is there a note after this one". An empty
 * stretch is a perfectly good place to reach across, and a run that ends in
 * silence is a run a reader may well want. What makes the reach impossible is
 * having nowhere else to put the edge at all: a one-slot selection sitting on
 * the section's last slot.
 */
import { ticksPerBar, ticksPerSlot } from "@/lib/music/timing";
import type { SelectionDescriptor } from "@/lib/song/selection-descriptor";
import type { Section, Song } from "@/lib/song/schema";

/** The sentence a reader is given when the reach has nowhere to go. */
export const NOTHING_TO_EXTEND = "Uzatılacak yer kalmadı.";

/** Every slot start in the section, in section-relative ticks. */
function slotStarts(section: Section): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const bar of section.bars) {
    const width = ticksPerBar(bar.timeSignature, bar.resolution);
    const step = ticksPerSlot(bar.resolution);
    for (let at = cursor; at < cursor + width; at += step) starts.push(at);
    cursor += width;
  }
  return starts;
}

export function hasExtendTarget(
  song: Song,
  descriptor: SelectionDescriptor | null,
): boolean {
  if (!descriptor) return false;
  const section = song.sections.find((entry) => entry.id === descriptor.sectionId);
  if (!section) return false;

  /*
   * More than one slot at or after the start. One is the slot the selection
   * already ends on and nowhere else to go; two or more is a reach.
   */
  const reachable = slotStarts(section).filter(
    (start) => start >= descriptor.startTicks,
  );
  return reachable.length > 1;
}
