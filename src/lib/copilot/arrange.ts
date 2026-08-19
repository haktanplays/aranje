/**
 * What an `arrange_track` request means, and what an answer to it must look
 * like (spec 11.1, decision K-18).
 *
 * Two jobs, both of them refusals rather than repairs:
 *
 * 1. **Before the provider** — does the request name a section and a track
 *    that exist, and does the skill suit the instrument? A `drums` request
 *    aimed at a guitar is not a prompt problem to be worked around; it is a
 *    request that should never reach a model.
 * 2. **After the provider, before anything is applied** — does the answer
 *    describe exactly the target surface, with the right bars, in the right
 *    order, at the right slot count?
 *
 * The slot count comes from the bar's own time signature and resolution
 * (spec 5.5), so a wrong count is caught here rather than by the shared
 * `slotCount` validator on a candidate that should never have been built.
 */
import { instrumentFamily, isDrumInstrument } from "@/lib/instruments/registry";
import { slotCount } from "@/lib/music/timing";
import type { ArrangeSkill, CopilotPatch, CopilotRequest } from "@/lib/copilot/contract";
import type { Section, Song, Track } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

export type TargetResolution =
  | { ok: true; section: Section; track: Track }
  | { ok: false; reason: string };

/** Which instrument family each skill is allowed to write for (spec 11.1). */
export const SKILL_TARGETS: Readonly<Record<ArrangeSkill, string>> = {
  drums: "drums",
  bass: "bass",
  harmony: "guitar",
};

/** True when this track is the kind of instrument the skill arranges. */
export function skillAccepts(skill: ArrangeSkill, track: Track): boolean {
  const family = instrumentFamily(track.instrumentId);
  if (family !== SKILL_TARGETS[skill]) return false;
  // A fretted skill needs a fretboard to place notes on; drums need none.
  if (skill === "drums") return true;
  return track.fretboard !== undefined;
}

/**
 * Resolve the request against the song. Every refusal here happens before a
 * provider call, so a mis-aimed request costs nothing.
 */
export function resolveTarget(request: CopilotRequest): TargetResolution {
  const song: Song = request.song;

  const section = song.sections.find(
    (entry) => entry.id === request.sectionId,
  );
  if (!section) {
    return { ok: false, reason: `section "${request.sectionId}" not in song` };
  }

  const track = song.tracks.find((entry) => entry.id === request.targetTrackId);
  if (!track) {
    return { ok: false, reason: `track "${request.targetTrackId}" not in song` };
  }

  if (request.lockedTrackIds.includes(track.id)) {
    return { ok: false, reason: "the target track is in lockedTrackIds" };
  }

  if (!skillAccepts(request.skill, track)) {
    return {
      ok: false,
      reason:
        `skill "${request.skill}" needs a ${SKILL_TARGETS[request.skill]} ` +
        `track, but "${track.id}" is ${instrumentFamily(track.instrumentId)}`,
    };
  }

  return { ok: true, section, track };
}

/**
 * Every track in the section that the answer may not touch. `lockedTrackIds`
 * adds nothing to this: the server locks everything that is not the target,
 * so a caller who sends a short list changes nothing (spec 11.1, K-18).
 */
export function lockedTrackIdsFor(song: Song, targetTrackId: string): string[] {
  return song.tracks
    .map((track) => track.id)
    .filter((id) => id !== targetTrackId)
    .sort();
}

export const ARRANGE_SHAPE_CODE = "arrangeShape";

function issue(message: string, sectionId: string, trackId: string): ValidationIssue {
  return {
    code: ARRANGE_SHAPE_CODE,
    severity: "error",
    message,
    sectionId,
    trackId,
  };
}

/**
 * Does the answer describe the surface it was asked about, and only that?
 * Runs before `applyPatch`, so a wrong answer never becomes a candidate.
 */
export function validateArrangeOutput(
  request: CopilotRequest,
  patch: CopilotPatch,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const where = (message: string) =>
    issue(message, request.sectionId, request.targetTrackId);

  if (patch.sectionId !== request.sectionId) {
    issues.push(
      where(
        `Öneri "${patch.sectionId}" bölümünü hedefliyor; istek ` +
          `"${request.sectionId}" bölümü içindi.`,
      ),
    );
  }
  if (patch.targetTrackId !== request.targetTrackId) {
    issues.push(
      where(
        `Öneri "${patch.targetTrackId}" track'ini hedefliyor; istek ` +
          `"${request.targetTrackId}" track'i içindi.`,
      ),
    );
  }
  // A patch aimed elsewhere cannot be measured against this section.
  if (issues.length > 0) return issues;

  const resolved = resolveTarget(request);
  if (!resolved.ok) return [where(resolved.reason)];
  const { section, track } = resolved;

  if (patch.bars.length !== section.bars.length) {
    issues.push(
      where(
        `Bölüm ${section.bars.length} bar; öneri ${patch.bars.length} bar ` +
          `içeriyor.`,
      ),
    );
    return issues;
  }

  const wantsDrums = isDrumInstrument(track.instrumentId);

  patch.bars.forEach((bar, position) => {
    // Exactly once each, in order: no gaps, no repeats, no reshuffling.
    if (bar.barIndex !== position) {
      issues.push(
        where(
          `Bar sırası bozuk: ${position + 1}. sırada barIndex ` +
            `${bar.barIndex} var, ${position} olmalıydı.`,
        ),
      );
      return;
    }

    const target = section.bars[position];
    if (!target) return;

    const expected = slotCount(target.timeSignature, target.resolution);
    if (bar.slots.length !== expected) {
      issues.push(
        where(
          `Bar ${position + 1}: ${target.timeSignature[0]}/` +
            `${target.timeSignature[1]} ve 1/${target.resolution} için ` +
            `${expected} slot gerekiyor, ${bar.slots.length} geldi.`,
        ),
      );
    }

    const isDrumShape = bar.slots.every((slot) => Array.isArray(slot));
    if (wantsDrums && !isDrumShape) {
      issues.push(where(`Bar ${position + 1}: davul track'i melodik slot alamaz.`));
    }
    if (!wantsDrums && isDrumShape && bar.slots.length > 0) {
      issues.push(where(`Bar ${position + 1}: melodik track davul slotu alamaz.`));
    }
  });

  return issues;
}
