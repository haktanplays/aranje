/**
 * Changing the meter and the grid of music that already exists
 * (spec 13.20 §6, 2N-A).
 *
 * Until this checkpoint a meter and a rhythm grid could only be chosen when a
 * section was *created*. Getting them wrong meant living with them, and the
 * only way out was to rebuild the section by hand. That is a strange thing for
 * an editor to refuse, and it refused it silently — there was no message, just
 * no control.
 *
 * The transform itself is the one already in `bar-regrid.ts`, which preserves
 * a note's moment and its sounding length in **ticks** and refuses anything it
 * cannot write exactly. Nothing here rounds, clamps, truncates or pushes
 * content into the next bar. What this module adds is the part that is about
 * whole bars rather than one bar's slots: which bars are affected, what a
 * shorter bar does to the music that no longer fits, what a longer one does to
 * a note that was tied across its end, and the rule that either all of it
 * happens or none of it does.
 *
 * ## What is preserved
 *
 * - **Musical time.** An onset at tick 384 is at tick 384 afterwards. Where
 *   the new grid cannot express that, the command refuses rather than moving
 *   the note to the nearest slot it can express.
 * - **Ties and legato.** A held note keeps the length it sounds for, rebuilt
 *   with however many continuation slots the new grid needs. A relation that
 *   crossed the bar's end still has to cross it afterwards; see below.
 * - **Silence as absence.** A track with no key in a bar keeps no key. A
 *   lengthened bar gains real rests, not an invented row of empty slots for a
 *   track that was never written there (spec 5.5).
 * - **Tempo.** A section's `bpmOverride` is not touched. How fast a section is
 *   played is a different question from how its bars are counted.
 *
 * ## The bar line moves, and that matters
 *
 * Shortening a bar can leave music with nowhere to be —
 * `content_exceeds_new_measure`, and the check is on the *sound*, not on the
 * onsets: a note that starts inside the new bar and is held past its end is
 * exceeding it just as much as one struck past the end.
 *
 * Lengthening one is subtler. A note that ended exactly at the old bar line
 * and was tied into the next bar now ends *before* the new line, so the
 * continuation in the next bar has a gap in front of it — a chain split by an
 * edit that never touched either note. The same is true of a legato bond
 * reaching back across the line. Both are `timing_change_splits_chain`, and
 * refusing is the only honest answer: the alternative is to lengthen the note
 * to fill the gap, which is writing music the reader did not.
 *
 * ## Everything downstream re-derives
 *
 * A bar's length in ticks is `slotCount × ticksPerSlot`, and every position in
 * the product — the next bar's start, the section's start, the tempo map, MIDI
 * onsets, loop bounds, the playhead — is computed from that (spec 5.5, 8.3).
 * So a 4/4 bar becoming 3/4 moves everything after it by one beat without a
 * single one of those needing to know this command exists.
 */
import { groupingRefusal } from "@/lib/music/meter-beats";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import {
  isRepresentableGrid,
  slotCount,
  ticksPerSlot,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";
import { regridDrumsDetailed, regridMelodicDetailed } from "@/lib/song/bar-regrid";
import { extentsOf, remapRange, type BarExtent } from "@/lib/song/timeline-transform";
import { settle } from "@/lib/song/edit";
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Section,
  type Song,
} from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/** One bar, or every bar of a section. */
export type TimingScope =
  | { readonly kind: "bar"; readonly barIndex: number }
  | { readonly kind: "section" };

export type TimingChange = {
  readonly sectionId: string;
  readonly scope: TimingScope;
  readonly timeSignature: TimeSignature;
  readonly resolution: Resolution;
  /**
   * How the new bar is felt (2V-D.2 §12, §14).
   *
   * Part of the same command because it is part of the same decision: a
   * reader choosing 7/8 chooses `2+2+3` or `3+2+2` in the same breath, and
   * two commands would let a bar exist for one undo step in a metre with a
   * feel from the metre before it.
   *
   * Omitted leaves the metre's ordinary feel, which is what `meterBeats`
   * fills in — so an unchanged 4/4 bar stores nothing new.
   */
  readonly grouping?: BeatGrouping;
};

export type TimingChangeErrorCode =
  /** The pair itself is not writable: 1/4 in 6/8, a triplet grid in 7/8. */
  | "unsupported_meter_resolution"
  /** The accent grouping does not add up to the metre's numerator. */
  | "grouping_does_not_fit"
  /** A moment or a duration falls between two slots of the target grid. */
  | "target_grid_incompatible"
  /** Sound would run past the end of the shorter bar. */
  | "content_exceeds_new_measure"
  /** A tie or a legato bond that crossed the bar line would be left hanging. */
  | "timing_change_splits_chain"
  /** Nothing would change, so nothing is written and no undo step is made. */
  | "no_timing_change"
  | "section_not_found"
  | "bar_not_found"
  | "validation_failed";

export type TimingChangeFailure = {
  readonly code: TimingChangeErrorCode;
  readonly message: string;
};

export type TimingChangeResult =
  | {
      readonly ok: true;
      readonly song: Song;
      /** Warnings never block; they come back so the screen can show them. */
      readonly warnings: readonly ValidationIssue[];
      /** How many bars were rewritten. */
      readonly barsChanged: number;
    }
  | { readonly ok: false; readonly error: TimingChangeFailure };

const fail = (
  code: TimingChangeErrorCode,
  message: string,
): { ok: false; error: TimingChangeFailure } => ({ ok: false, error: { code, message } });

/** Legato articulations: the ones that need the note before them to be there. */
const CHAINING = new Set(["slide", "hammer_on", "pull_off"]);

/* ---------------------------------------------------------- boundary reading */

/**
 * Does anything in the next bar reach back across this bar's end?
 *
 * Two ways it can: the next bar begins with a `"-"` continuing a note struck
 * here, or it begins with an onset bound by a legato articulation to whatever
 * was sounding at the line. Only the next bar's *first* slot is consulted,
 * because that is the only slot a relation across this particular line can
 * start from.
 */
function reachesBackOver(next: Bar | undefined, trackId: string): boolean {
  const slots = next?.slots[trackId];
  if (!Array.isArray(slots) || isDrumSlotArray(slots)) return false;
  const first = (slots as readonly MelodicSlot[])[0];
  if (first === "-") return true;
  if (!first) return false;
  return first.notes.some(
    (note) => note.articulation !== undefined && CHAINING.has(note.articulation),
  );
}

/** True when the final slot of a regridded bar is still sounding. */
function endsSounding(slots: readonly MelodicSlot[]): boolean {
  const last = slots[slots.length - 1];
  return last !== null && last !== undefined;
}

/* --------------------------------------------------------------- the command */

export function changeTiming(song: Song, change: TimingChange): TimingChangeResult {
  const { timeSignature, resolution } = change;

  if (!isRepresentableGrid(timeSignature, resolution)) {
    return fail(
      "unsupported_meter_resolution",
      "Bu ölçü işareti bu ritim aralığında yazılamıyor.",
    );
  }

  /* Checked before anything is rewritten, so a grouping typed wrong costs
     the reader a sentence rather than a half-converted section. */
  if (change.grouping) {
    const refusal = groupingRefusal(change.grouping, timeSignature);
    if (refusal) return fail("grouping_does_not_fit", refusal);
  }

  const sectionIndex = song.sections.findIndex((entry) => entry.id === change.sectionId);
  const section = song.sections[sectionIndex];
  if (!section) return fail("section_not_found", "Bu bölüm artık şarkıda yok.");

  const targets =
    change.scope.kind === "section"
      ? section.bars.map((_, index) => index)
      : [change.scope.barIndex];

  for (const index of targets) {
    if (!section.bars[index]) return fail("bar_not_found", "Bu ölçü artık bölümde yok.");
  }

  /*
   * Nothing to do is not a failure to report loudly, but it must not become a
   * write either: an undo step that undoes nothing is worse than no step.
   */
  const sameGrouping = (bar: Bar): boolean => {
    const wanted = change.grouping;
    if (!wanted) return bar.grouping === undefined;
    const written = bar.grouping;
    if (!written || written.length !== wanted.length) return false;
    return written.every((group, index) => group === wanted[index]);
  };
  const alreadyThere = targets.every((index) => {
    const bar = section.bars[index];
    return (
      bar !== undefined &&
      bar.resolution === resolution &&
      bar.timeSignature[0] === timeSignature[0] &&
      bar.timeSignature[1] === timeSignature[1] &&
      sameGrouping(bar)
    );
  });
  if (alreadyThere) {
    return fail("no_timing_change", "Bu ölçü zaten bu ritimde yazılı.");
  }

  const newSlotCount = slotCount(timeSignature, resolution);
  const targetSet = new Set(targets);
  const rewritten = new Map<number, Bar>();

  for (const index of targets) {
    const bar = section.bars[index];
    if (!bar) return fail("bar_not_found", "Bu ölçü artık bölümde yok.");

    const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};

    for (const [trackId, written] of Object.entries(bar.slots)) {
      if (!Array.isArray(written)) continue;

      if (isDrumSlotArray(written)) {
        const result = regridDrumsDetailed(
          written,
          bar.resolution,
          resolution,
          newSlotCount,
        );
        if (!result.ok) return refusalOf(result.reason, index);
        slots[trackId] = result.slots;
        continue;
      }

      const melodic = written as readonly MelodicSlot[];
      const result = regridMelodicDetailed(
        melodic,
        bar.resolution,
        resolution,
        newSlotCount,
      );
      if (!result.ok) return refusalOf(result.reason, index);

      /*
       * The bar line moved under a relation that crossed it.
       *
       * Only asked when something in the next bar really does reach back:
       * refusing every lengthening of every bar would make the command useless
       * for the ordinary case where nothing is tied across the line at all.
       */
      const soundedToTheLine = endsSounding(melodic);
      if (
        reachesBackOver(section.bars[index + 1], trackId) &&
        soundedToTheLine &&
        !endsSounding(result.slots)
      ) {
        return fail(
          "timing_change_splits_chain",
          "Bu değişiklik ölçü çizgisini aşan bir bağlantıyı koparıyor.",
        );
      }

      slots[trackId] = result.slots;
    }

    /*
     * A fresh tuple rather than the caller's: `Bar` holds a mutable pair and
     * handing it the same object for every bar would make one array shared by
     * a whole section.
     */
    rewritten.set(index, {
      timeSignature: [timeSignature[0], timeSignature[1]] as Bar["timeSignature"],
      resolution,
      /* A fresh array for the same reason the tuple is fresh: one shared
         grouping across a section would make an edit to one bar an edit to
         all of them. Absent when the metre is felt its ordinary way. */
      ...(change.grouping ? { grouping: [...change.grouping] } : {}),
      slots,
    });
  }

  const nextBars = section.bars.map((bar, index) =>
    targetSet.has(index) ? (rewritten.get(index) ?? bar) : bar,
  );

  /*
   * The two things written *over* the bars rather than inside them.
   *
   * Notes ride their bar and need no help; a phrase and a technique span are
   * section-relative tick ranges, so a moved bar line leaves them pointing at
   * different music unless they move too. This is the same transaction: if a
   * range cannot be remapped exactly, the whole change is refused and the
   * reader's song is the one they had (§14, §15).
   */
  const before = extentsOf(section.bars.map(lengthOf));
  const after = extentsOf(nextBars.map(lengthOf));

  const phrases = section.phrases ? remapAll(section.phrases, before, after) : null;
  if (phrases === "refused") {
    return fail(
      "content_exceeds_new_measure",
      "Bir cümle yeni ölçüye sığmıyor; hiçbir şey kesilmedi.",
    );
  }
  const spans = section.techniqueSpans
    ? remapAll(section.techniqueSpans, before, after)
    : null;
  if (spans === "refused") {
    return fail(
      "content_exceeds_new_measure",
      "Bir teknik alanı yeni ölçüye sığmıyor; hiçbir şey kesilmedi.",
    );
  }

  const nextSection: Section = {
    ...section,
    // `bpmOverride` and every other section field travel untouched: how fast a
    // section is played is a different question from how its bars are counted.
    bars: nextBars,
    ...(phrases ? { phrases } : {}),
    ...(spans ? { techniqueSpans: spans } : {}),
  };

  const next: Song = {
    ...song,
    sections: song.sections.map((entry, index) =>
      index === sectionIndex ? nextSection : entry,
    ),
  };

  const settled = settle(next);
  if (!settled.ok) {
    return fail("validation_failed", "Bu değişiklik kontrollerden geçmedi ve uygulanmadı.");
  }

  return {
    ok: true,
    song: settled.song,
    warnings: settled.warnings,
    barsChanged: targets.length,
  };
}

function refusalOf(
  reason: "grid_incompatible" | "exceeds_measure",
  barIndex: number,
): { ok: false; error: TimingChangeFailure } {
  const where = `${barIndex + 1}. ölçü`;
  return reason === "grid_incompatible"
    ? fail(
        "target_grid_incompatible",
        `${where} bu ritim aralığında birebir yazılamıyor; en yakın adıma yuvarlanmadı.`,
      )
    : fail(
        "content_exceeds_new_measure",
        `${where} yeni ölçüye sığmıyor; hiçbir şey kesilmedi.`,
      );
}

/** One bar's length, for the extent list the remapper walks. */
const lengthOf = (bar: Bar) => ({
  lengthTicks: slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution),
});

/**
 * Every range remapped, or `"refused"` the moment one of them cannot be.
 *
 * All-or-nothing on purpose: a section with three phrases moved and one left
 * behind is a worse outcome than a section that refused the edit, because the
 * reader cannot see which one is wrong.
 */
function remapAll<T extends { readonly startTicks: number; readonly endTicks: number }>(
  ranges: readonly T[],
  before: readonly BarExtent[],
  after: readonly BarExtent[],
): T[] | "refused" {
  const moved: T[] = [];
  for (const range of ranges) {
    const result = remapRange(range, before, after);
    if (!result.ok) return "refused";
    moved.push(result.range);
  }
  return moved;
}

/** How long a bar of this meter and grid lasts, for a caller sizing a preview. */
export function barTicksOf(
  timeSignature: TimeSignature,
  resolution: Resolution,
): number {
  return slotCount(timeSignature, resolution) * ticksPerSlot(resolution);
}
