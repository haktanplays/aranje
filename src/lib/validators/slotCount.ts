/**
 * Every slot array in a bar must have exactly the number of slots the meter and
 * resolution derive (spec 10.1 `slotCount`, formula in spec 5.5).
 */
import { formatTimeSignature, slotCount } from "@/lib/music/timing";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const validateSlotCount: Validator = (song) => {
  const issues: ValidationIssue[] = [];

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      const expected = slotCount(bar.timeSignature, bar.resolution);
      for (const [trackId, slots] of Object.entries(bar.slots)) {
        if (slots.length === expected) continue;
        issues.push({
          code: "slotCount",
          severity: "error",
          message:
            `"${section.name}" bölümü, bar ${barIndex + 1}, ` +
            `"${trackId}" track'i: ` +
            `${formatTimeSignature(bar.timeSignature)} ölçüsü ` +
            `${bar.resolution} resolution ile ${expected} slot gerektiriyor, ` +
            `${slots.length} slot var.`,
          sectionId: section.id,
          barIndex,
          trackId,
        });
      }
    });
  }

  return issues;
};
