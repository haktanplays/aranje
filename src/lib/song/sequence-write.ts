/**
 * Writing a fast run into a song, as one thing (2V-B.3, "Hızlı dizi").
 *
 * ## One intent, one transaction
 *
 * The reader made one decision — "put these three notes in this space" — so
 * this produces one Song or none. Undo removes the whole run and the grid
 * change that carried it; redo puts back exactly the same bytes, because the
 * result is a value and not a sequence of steps that could be replayed
 * differently.
 *
 * ## The run opens onto the ordinary note model
 *
 * There is no "sequence" object in the Song and there must not be: the
 * playback engine would not know what one was. What is written is ordinary
 * notes with explicit onsets and explicit durations, and the connections are
 * the same `hammer_on` / `pull_off` articulations the legato brush already
 * writes. Everything downstream — the expression planner, the validators, the
 * string-collision check, the exporter — sees notes, because that is all
 * there is.
 *
 * ## The local override, and what it is allowed to change
 *
 * A run denser than the bar's grid needs a finer grid. `rhythm-availability`
 * decides whether one exists that also holds everything already written here,
 * and the reader is asked before it is used. When it is used, the bar is
 * re-expressed on it *exactly* — `bar-regrid` refuses anything else — so the
 * measure keeps its length, every existing note keeps its moment and its
 * sounding end, and the note after the run keeps its tick. What changes is how
 * finely this one bar is divided, which is the thing the reader agreed to.
 */
import { rhythmAvailability } from "@/lib/music/rhythm-availability";
import type { SequencePlan } from "@/lib/music/note-sequence";
import { slotCount, ticksPerSlot, type Resolution } from "@/lib/music/timing";
import { regridDrums, regridMelodic } from "@/lib/song/bar-regrid";
import { pitchAt, settle, type EditResult } from "@/lib/song/edit";
import { findSection } from "@/lib/song/onset-block";
import { collisionsIntroduced } from "@/lib/song/string-collision";
import { withEmptyLaneInBar } from "@/lib/song/track-lanes";
import {
  isMelodicSlotArray,
  type DrumSlot,
  type MelodicSlot,
  type Song,
} from "@/lib/song/schema";

export type SequenceWriteCommand = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Which bar of the section, zero-based. */
  readonly barIndex: number;
  /** The plan, in ticks from the start of the **bar**. */
  readonly plan: SequencePlan;
  /**
   * The reader said yes to "Bu hareket için bu bölümü sıklaştır."
   *
   * False is the default and the refusal is typed, so a caller that has not
   * asked cannot accidentally change a grid on the reader's behalf.
   */
  readonly allowLocalOverride?: boolean;
  /**
   * Write over what is here, instead of refusing (2V-B.4 §5, §6).
   *
   * "Üçe böl" is a sentence about a note that already exists, so a command
   * that could only write into silence could not answer it. What it replaces
   * is bounded and stated: the notes that *start* inside the run's own span,
   * and the ties that hold them, and nothing else. A note that began before
   * the span and is still sounding into it is not the reader's target and is
   * refused rather than truncated.
   */
  readonly replaceExisting?: boolean;
};

export type SequenceWriteFailure =
  | "no_section"
  | "no_bar"
  | "no_track"
  | "not_fretted"
  | "outside_bar"
  | "target_occupied"
  | "needs_local_override"
  | "rhythm_unavailable"
  | "regrid_failed"
  | "unplayable_position"
  | "string_collision";

export type SequenceWriteResult =
  | {
      readonly ok: true;
      readonly song: Song;
      readonly warnings: EditResult extends { ok: true; warnings: infer W } ? W : never;
      /** True when the reader's yes was used. Reported, never assumed. */
      readonly usedLocalOverride: boolean;
      readonly resolution: Resolution;
    }
  | { readonly ok: false; readonly error: SequenceWriteFailure };

/**
 * Every moment already spoken for in this bar, on every lane.
 *
 * Every lane, because a local override regrids the whole bar — a bar has one
 * grid (K-34) — so a candidate grid the bass or the kit could not survive is
 * not a candidate. Asking only the lane being written to is how the offer and
 * the write come to disagree: the reader is told "sıklaştır" and then refused.
 *
 * A tie counts as much as an onset: a finer grid has to be able to draw where
 * a sound is still going, not only where it started.
 */
function existingTicks(
  slots: Readonly<Record<string, readonly unknown[]>>,
  resolution: Resolution,
): number[] {
  const step = ticksPerSlot(resolution);
  const ticks = new Set<number>();
  for (const lane of Object.values(slots)) {
    for (const [index, slot] of lane.entries()) {
      if (slot === null || slot === undefined) continue;
      if (Array.isArray(slot) && slot.length === 0) continue;
      ticks.add(index * step);
    }
  }
  return [...ticks].sort((left, right) => left - right);
}

export function applySequenceWrite(
  song: Song,
  command: SequenceWriteCommand,
): SequenceWriteResult {
  const {
    allowLocalOverride = false,
    barIndex,
    plan,
    replaceExisting = false,
    sectionId,
    trackId,
  } = command;
  const section = findSection(song, sectionId);
  if (!section) return { ok: false, error: "no_section" };
  const bar = section.bars[barIndex];
  if (!bar) return { ok: false, error: "no_bar" };
  const track = song.tracks.find((entry) => entry.id === trackId);
  if (!track) return { ok: false, error: "no_track" };
  const fretboard = track.fretboard;
  if (!fretboard) return { ok: false, error: "not_fretted" };

  const barTicks = slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution);
  if (plan.startTicks < 0 || plan.startTicks + plan.spanTicks > barTicks) {
    return { ok: false, error: "outside_bar" };
  }

  /* The lane may not exist yet; laying it is part of the same candidate. */
  const grounded = withEmptyLaneInBar(song, track, sectionId, barIndex);
  const groundedBar = findSection(grounded, sectionId)?.bars[barIndex];
  const lane = groundedBar?.slots[trackId];
  if (!lane || !isMelodicSlotArray(lane)) return { ok: false, error: "not_fretted" };

  /*
   * Is the run writable here at all, and at what price?
   *
   * The same authority the control that offered this asked, so a run the
   * reader was told they could make cannot be refused here for a different
   * reason than the one they were shown.
   */
  const availability = rhythmAvailability({
    resolution: bar.resolution,
    startTicks: plan.startTicks,
    stepTicks: plan.stepTicks,
    stepCount: plan.notes.length,
    existingTicks: existingTicks(groundedBar.slots, bar.resolution),
  });
  if (availability.state === "unavailable") {
    return { ok: false, error: "rhythm_unavailable" };
  }
  if (availability.state === "requires_local_override" && !allowLocalOverride) {
    return { ok: false, error: "needs_local_override" };
  }

  const resolution = availability.neededResolution ?? bar.resolution;
  const usedLocalOverride = resolution !== bar.resolution;
  const targetSlots = slotCount(bar.timeSignature, resolution);
  const step = ticksPerSlot(resolution);

  /*
   * Every lane of the bar moves to the finer grid together, not just the one
   * being written to: a bar has one grid, and re-expressing one track's lane
   * while leaving another's would be two rhythms in one measure.
   */
  const regridded: Record<string, MelodicSlot[] | readonly unknown[]> = {};
  if (usedLocalOverride) {
    for (const [id, slots] of Object.entries(groundedBar.slots)) {
      /*
       * Drums come too (2V-B.4 §8).
       *
       * This refused a bar with a kit in it, which is nearly every bar of
       * nearly every song — so "Bu bölümü sıklaştır" was an offer that could
       * not be taken wherever a drummer was playing. A kit has no lengths to
       * rebuild, only onsets to re-place, and `bar-regrid` already knows how
       * and refuses when a hit would not land on the finer grid.
       */
      const moved = isMelodicSlotArray(slots)
        ? regridMelodic(slots, bar.resolution, resolution, targetSlots)
        : regridDrums(slots as readonly DrumSlot[], bar.resolution, resolution, targetSlots);
      if (!moved) return { ok: false, error: "regrid_failed" };
      regridded[id] = moved;
    }
  }

  const laneNow = (usedLocalOverride ? (regridded[trackId] as MelodicSlot[]) : [...lane]).slice();

  /* The run's own slots, and the slots it needs to be empty. */
  const written: number[] = [];
  for (const note of plan.notes) {
    const slotIndex = note.timeTicks / step;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= targetSlots) {
      return { ok: false, error: "rhythm_unavailable" };
    }
    written.push(slotIndex);
  }
  const lastSlot = written[written.length - 1]! + plan.stepTicks / step;
  const firstSlot = written[0]!;
  if (replaceExisting) {
    /* A tie arriving from before the span belongs to a note the reader did
       not point at; cutting it would change music outside the target. */
    if (laneNow[firstSlot] === "-") return { ok: false, error: "target_occupied" };
    for (let index = firstSlot; index < lastSlot; index += 1) laneNow[index] = null;
    /* And the tail of the last note being replaced goes with it: half a note
       left sounding past the run would be a fragment nobody wrote. */
    for (let index = lastSlot; laneNow[index] === "-"; index += 1) laneNow[index] = null;
  } else {
    for (let index = firstSlot; index < lastSlot; index += 1) {
      if (laneNow[index] !== null && laneNow[index] !== undefined) {
        return { ok: false, error: "target_occupied" };
      }
    }
  }

  for (const [index, note] of plan.notes.entries()) {
    const pitch = pitchAt(fretboard, note.stringIndex, note.fret);
    if (pitch === null) return { ok: false, error: "unplayable_position" };
    laneNow[written[index]!] = {
      notes: [
        {
          pitch,
          position: { string: note.stringIndex, fret: note.fret },
          durationTicks: note.durationTicks,
          ...(note.connection ? { articulation: note.connection } : {}),
        },
      ],
    };
    /* Ties for the rest of this note's own length, so the run reads as three
       notes of a real duration rather than three of the grid's shortest. */
    const span = note.durationTicks / step;
    for (let offset = 1; offset < span; offset += 1) {
      laneNow[written[index]! + offset] = "-";
    }
  }

  const nextBars = section.bars.map((entry, index) =>
    index === barIndex
      ? {
          ...entry,
          resolution,
          slots: {
            ...(usedLocalOverride
              ? (regridded as Record<string, MelodicSlot[]>)
              : groundedBar.slots),
            [trackId]: laneNow,
          },
        }
      : entry,
  );
  const candidate: Song = {
    ...grounded,
    sections: grounded.sections.map((entry) =>
      entry.id === sectionId ? { ...entry, bars: nextBars } : entry,
    ),
  };

  const settled = settle(candidate);
  if (!settled.ok) return { ok: false, error: "rhythm_unavailable" };
  if (collisionsIntroduced(song, settled.song, trackId).length > 0) {
    return { ok: false, error: "string_collision" };
  }

  return {
    ok: true,
    song: settled.song,
    warnings: settled.warnings as never,
    usedLocalOverride,
    resolution,
  };
}
